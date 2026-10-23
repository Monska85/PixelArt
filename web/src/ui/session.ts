// The connection to a board or to the simulator, shared by the whole app.

import { useSyncExternalStore } from "react";
import { createEmitter } from "./emitter";
import { BoardClient, BoardError, abortUpload, listFiles, type BoardInfo, type Kind } from "../protocol";
import { FileListReader, KINDS, NO_LISTS, type FileLists } from "./fileLists";
import { SerialTransport, serialApi } from "../protocol/serial";
import type { Transport } from "../protocol/transport";
import { DEFAULT_SIMULATOR_URL, WebSocketTransport } from "../protocol/websocket";
import { readStored, SIMULATOR_KEY } from "./storage";

export type ConnectionState = "disconnected" | "connecting" | "connected" | "lost";

export interface Snapshot {
  state: ConnectionState;
  via: "board" | "simulator" | null;
  client: BoardClient | null;
  info: BoardInfo | null;
  /** Why the app is not connected, or why the connection was lost. */
  message: string | null;
  /** Changes every time the board is found to have restarted. */
  restarts: number;
  /** Why uploads are disabled although a board is connected, or null. */
  uploadsBlocked: string | null;
  /** The connected board's stored files: the one source for every view and for the leave-the-page question. */
  files: FileLists;
  /** The board is too old or too new for this app: the Firmware view is the way forward. */
  offerFirmware: boolean;
}

const IDLE: Snapshot = {
  state: "disconnected",
  via: null,
  client: null,
  info: null,
  message: null,
  restarts: 0,
  uploadsBlocked: null,
  files: NO_LISTS,
  offerFirmware: false,
};

export const SERIAL_SUPPORTED = (): boolean => serialApi() !== null;

function uploadsBlocked(info: BoardInfo): string | null {
  if (info.formats.animation.includes("pixelart/1") && info.formats.playlist.includes("pixelart-playlist/1"))
    return null;
  return "This board does not read the file formats of this web app. Uploads are disabled: update the firmware.";
}

class Session {
  private snapshot: Snapshot = IDLE;
  private readonly changes = createEmitter();
  private transport: Transport | null = null;
  private interrupted = false;
  private attempt = 0;
  private reader = new FileListReader(
    (kind) => {
      const client = this.snapshot.client;
      if (!client) throw new Error("No board is connected.");
      return listFiles(client, kind);
    },
    (files) => this.set({ files }),
  );

  subscribe = this.changes.subscribe;

  getSnapshot = (): Snapshot => this.snapshot;

  private set(patch: Partial<Snapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.changes.emit();
  }

  /** Remembers that an upload was cut by a lost connection: put_abort goes out after the next connection. */
  markUploadInterrupted(): void {
    this.interrupted = true;
  }

  connectBoard(): Promise<void> {
    return this.connect("board", () => SerialTransport.request());
  }

  connectSimulator(address: string): Promise<void> {
    return this.connect("simulator", () => WebSocketTransport.connect(address));
  }

  /** Connects again the way the lost connection was made: a board asks for its port again, the simulator reuses its address. */
  reconnect(): Promise<void> {
    return this.snapshot.via === "board"
      ? this.connectBoard()
      : this.connectSimulator(readStored(SIMULATOR_KEY) || DEFAULT_SIMULATOR_URL);
  }

  private async connect(via: "board" | "simulator", open: () => Promise<Transport>): Promise<void> {
    await this.disconnect();
    const attempt = ++this.attempt;
    this.reader.reset();
    this.set({ ...IDLE, state: "connecting", via, restarts: this.snapshot.restarts });
    let transport: Transport | null = null;
    try {
      transport = await open();
      if (attempt !== this.attempt) {
        await transport.close();
        return;
      }
      const client = new BoardClient(transport);
      this.transport = transport;
      client.onLost = (reason) => {
        if (attempt !== this.attempt) return;
        this.set({ state: "lost", message: reason });
        void transport?.close();
      };
      client.onRestart = () => {
        this.set({ restarts: this.snapshot.restarts + 1 });
        void this.refreshFiles(KINDS);
      };
      const info = await client.handshake();
      if (attempt !== this.attempt) return;
      if (this.interrupted) {
        this.interrupted = false;
        await abortUpload(client);
      }
      this.set({ state: "connected", client, info, message: null, uploadsBlocked: uploadsBlocked(info) });
      void this.refreshFiles(KINDS);
    } catch (error) {
      if (attempt !== this.attempt) return;
      await transport?.close().catch(() => undefined);
      this.transport = null;
      this.set({
        ...IDLE,
        restarts: this.snapshot.restarts,
        message: error instanceof Error ? error.message : "The connection failed.",
        offerFirmware: error instanceof BoardError && error.code === "protocol_unsupported",
      });
    }
  }

  /** Reads `info` again: the storage used, and a restart of the board. False when it could not be read. */
  async refreshInfo(): Promise<boolean> {
    if (this.snapshot.state !== "connected") return false;
    try {
      this.set({ info: await this.snapshot.client!.handshake() });
      return true;
    } catch {
      // A lost connection is reported through onLost.
      return false;
    }
  }

  /**
   * Reads the board's lists of these kinds again; call it, without waiting for it, after anything that adds or
   * removes files of those kinds. A failed read leaves the list "unknown", never the old one.
   */
  async refreshFiles(kinds: readonly Kind[]): Promise<void> {
    if (this.snapshot.state !== "connected") return;
    await this.reader.refresh(kinds);
  }

  async disconnect(): Promise<void> {
    this.attempt++;
    const transport = this.transport;
    this.transport = null;
    this.reader.reset();
    if (this.snapshot.state !== "disconnected") this.set({ ...IDLE, restarts: this.snapshot.restarts });
    await transport?.close().catch(() => undefined);
  }
}

export const session = new Session();

export function useSession(): Snapshot {
  return useSyncExternalStore(session.subscribe, session.getSnapshot);
}
