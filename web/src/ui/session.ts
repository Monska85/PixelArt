// SPDX-License-Identifier: GPL-3.0-or-later

// The connection to a board or to the simulator, shared by the whole app.

import { useSyncExternalStore } from "react";
import { createEmitter } from "./emitter";
import {
  BoardClient,
  BoardError,
  CONNECTION_LOST,
  NO_REPLY,
  abortUpload,
  getStatus,
  isToken,
  listFiles,
  type BoardInfo,
  type Kind,
  type Login,
} from "../protocol";
import { FileListReader, KINDS, NO_LISTS, type FileLists } from "./fileLists";
import { SerialTransport, serialApi, type SerialPortLike } from "../protocol/serial";
import type { ImprovLink } from "../protocol/improv";
import type { Transport } from "../protocol/transport";
import { DEFAULT_SIMULATOR_URL, WebSocketTransport, parseBoardAddress, type BoardAddress } from "../protocol/websocket";
import { readStored, removeStored, SIMULATOR_KEY, tokenKey, WIFI_KEY, writeStored } from "./storage";

export type ConnectionState = "disconnected" | "connecting" | "connected" | "lost";

export interface Snapshot {
  state: ConnectionState;
  /** How the app is connected: USB serial, the simulator's WebSocket, or a board over WiFi. */
  via: "board" | "simulator" | "wifi" | null;
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
  /** Set while a board over WiFi asks for a login and the app has no token for it: the dialog asks the user. */
  loginRequest: { host: string } | null;
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
  loginRequest: null,
};

/** After a first install the board restarts and may still be formatting its file system: how long and how often to retry. */
export const PORT_RETRY_FOR_MS = 20_000;
export const PORT_RETRY_EVERY_MS = 1000;

/** A failed connection attempt: the error, and whether waiting can clear it. */
class AttemptFailure extends Error {
  constructor(
    readonly error: unknown,
    readonly retryable: boolean,
  ) {
    super(error instanceof Error ? error.message : "The connection failed.");
  }
}

/** After the port opened, only a board that does not answer yet or a link that dropped can clear by waiting. */
function isWaitable(error: unknown): boolean {
  return error instanceof BoardError && (error.code === NO_REPLY || error.code === CONNECTION_LOST);
}

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
  /** The address of the board connected over WiFi, to connect again after a loss. */
  private wifiAddress: BoardAddress | null = null;
  /** Resolves the token the login dialog is waiting for. */
  private tokenAnswer: ((token: string | null) => void) | null = null;
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

  /**
   * Connects over a port the user already picked (the one ESP Web Tools used), so no picker opens. The board has just
   * restarted: while the port cannot be opened or the board does not answer, it tries again every
   * PORT_RETRY_EVERY_MS until PORT_RETRY_FOR_MS have passed, staying "connecting". Resolves true when connected.
   */
  async connectPort(port: SerialPortLike): Promise<boolean> {
    await this.connect("board", () => SerialTransport.open(port), PORT_RETRY_FOR_MS);
    return this.snapshot.state === "connected" && this.snapshot.via === "board";
  }

  connectSimulator(address: string): Promise<void> {
    return this.connect("simulator", () => WebSocketTransport.connect(address));
  }

  /** Connects to a board over WiFi. An address that is not one fails at once, with the way to write it. */
  connectWifi(text: string): Promise<void> {
    const parsed = parseBoardAddress(text);
    if (!parsed.ok) {
      this.set({ ...IDLE, restarts: this.snapshot.restarts, message: parsed.message });
      return Promise.resolve();
    }
    this.wifiAddress = parsed.address;
    writeStored(WIFI_KEY, parsed.address.host);
    return this.connect("wifi", () => WebSocketTransport.connectBoard(parsed.address));
  }

  /** Connects again the way the lost connection was made: a board asks for its port again, the others reuse their address. */
  reconnect(): Promise<void> {
    if (this.snapshot.via === "board") return this.connectBoard();
    if (this.snapshot.via === "wifi") return this.connectWifi(this.wifiAddress?.host ?? readStored(WIFI_KEY) ?? "");
    return this.connectSimulator(readStored(SIMULATOR_KEY) || DEFAULT_SIMULATOR_URL);
  }

  /** The login dialog's answer: the token the user typed, remembered for this board. */
  submitToken(token: string): void {
    if (!isToken(token) || !this.tokenAnswer) return;
    if (this.wifiAddress) writeStored(tokenKey(this.wifiAddress.host), token);
    this.answerToken(token);
  }

  /** The user gave up the login: the connection ends, with the way to try again. */
  cancelLogin(): void {
    this.answerToken(null);
  }

  private answerToken(token: string | null): void {
    const answer = this.tokenAnswer;
    this.tokenAnswer = null;
    this.set({ loginRequest: null });
    answer?.(token);
  }

  /** Where the login of the connection over WiFi gets its token: the browser's store, else the user, once. */
  private loginFor(address: BoardAddress): Login {
    const key = tokenKey(address.host);
    return {
      getToken: async () => {
        const stored = readStored(key);
        if (stored !== null && isToken(stored)) return stored;
        const attempt = this.attempt;
        const token = await new Promise<string | null>((resolve) => {
          this.tokenAnswer = resolve;
          this.set({ loginRequest: { host: address.host } });
        });
        // The user disconnected meanwhile: nothing more to say.
        if (token === null && attempt === this.attempt)
          this.endWith(
            "The board asks for a login. Connect again and enter its token (shown over USB, in the Network access card).",
          );
        return token;
      },
      refused: () => {
        removeStored(key);
        this.endWith(
          "The board did not accept the token. Connect again and enter the token the Network access card shows over USB.",
        );
      },
    };
  }

  /** Ends the connection with a message the app shows. */
  private endWith(message: string): void {
    const transport = this.transport;
    this.attempt++;
    this.transport = null;
    this.reader.reset();
    this.set({ ...IDLE, restarts: this.snapshot.restarts, message });
    void transport?.close().catch(() => undefined);
  }

  /** After a USB connection: the board's name on the network, remembered as the address to connect over WiFi. */
  private async rememberWifiAddress(client: BoardClient): Promise<void> {
    try {
      const { wifi } = await getStatus(client);
      if (wifi.hostname && /^[a-z0-9-]{1,63}$/.test(wifi.hostname)) writeStored(WIFI_KEY, `${wifi.hostname}.local`);
    } catch {
      // A firmware without `status`, or a lost connection: nothing to remember.
    }
  }

  /**
   * Connects, trying again every PORT_RETRY_EVERY_MS for `retryForMs` after an attempt failed in a way waiting can
   * clear: no new attempt starts after that time, but one under way is not cut short.
   */
  private async connect(
    via: "board" | "simulator" | "wifi",
    open: () => Promise<Transport>,
    retryForMs = 0,
  ): Promise<void> {
    await this.disconnect();
    const attempt = ++this.attempt;
    this.reader.reset();
    this.set({ ...IDLE, state: "connecting", via, restarts: this.snapshot.restarts });
    const giveUpAt = Date.now() + retryForMs;
    for (;;) {
      try {
        await this.connectOnce(via, open, attempt, retryForMs > 0);
        return;
      } catch (failure) {
        if (attempt !== this.attempt) return;
        this.transport = null;
        const { error, retryable, message } = failure as AttemptFailure;
        if (retryable && Date.now() < giveUpAt) {
          await new Promise((resolve) => setTimeout(resolve, PORT_RETRY_EVERY_MS));
          if (attempt !== this.attempt) return;
          continue;
        }
        this.set({
          ...IDLE,
          restarts: this.snapshot.restarts,
          message,
          offerFirmware: error instanceof BoardError && error.code === "protocol_unsupported",
        });
        return;
      }
    }
  }

  /**
   * One attempt: open, handshake, publish the connection. Returns when connected or when a newer attempt took over,
   * and throws an AttemptFailure otherwise, with the transport closed. A caller that retries is not told of a link
   * lost before the handshake: that is the attempt's own failure.
   */
  private async connectOnce(
    via: "board" | "simulator" | "wifi",
    open: () => Promise<Transport>,
    attempt: number,
    retrying: boolean,
  ): Promise<void> {
    let transport: Transport | null = null;
    let opened = false;
    try {
      transport = await open();
      opened = true;
      if (attempt !== this.attempt) {
        await transport.close();
        return;
      }
      const client = new BoardClient(transport);
      if (via === "wifi" && this.wifiAddress) client.login = this.loginFor(this.wifiAddress);
      this.transport = transport;
      let handshaken = false;
      client.onLost = (reason) => {
        if (attempt !== this.attempt || (retrying && !handshaken)) return;
        this.set({ state: "lost", message: reason });
        void transport?.close();
      };
      client.onRestart = () => {
        this.set({ restarts: this.snapshot.restarts + 1 });
        void this.refreshFiles(KINDS);
      };
      const info = await client.handshake();
      if (attempt !== this.attempt) return;
      handshaken = true;
      if (this.interrupted) {
        this.interrupted = false;
        await abortUpload(client);
      }
      this.set({ state: "connected", client, info, message: null, uploadsBlocked: uploadsBlocked(info) });
      void this.refreshFiles(KINDS);
      if (via === "board") void this.rememberWifiAddress(client);
    } catch (error) {
      if (attempt === this.attempt) await transport?.close().catch(() => undefined);
      throw new AttemptFailure(error, !opened || isWaitable(error));
    }
  }

  /** The link to the board's Improv frames: only a USB connection has one. */
  improv(): ImprovLink | null {
    return this.snapshot.state === "connected" ? (this.transport?.improv ?? null) : null;
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
    this.answerToken(null);
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
