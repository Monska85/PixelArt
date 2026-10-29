// SPDX-License-Identifier: GPL-3.0-or-later

// WebSocket transport to the simulator or to a board over WiFi: one line per text message.

import { MAX_LINE } from "./lines";
import type { Transport } from "./transport";
import { checkSimulatorUrl, WIFI_BROWSER_NOTE, type BoardAddress } from "./address";
export { DEFAULT_SIMULATOR_URL, WIFI_BROWSER_NOTE, parseBoardAddress } from "./address";
export type { BoardAddress } from "./address";

// The simulator and the board serve one client and free the slot a moment after a close. The wait doubles after each
// refusal, so a second tab or a reload that finds the slot taken sends the board a few connections, not a burst. The
// tries come at about 0, 0.2, 0.6, 1.4, 3.0 and 6.2 seconds: the board pings a stalled holder at the first refusal and
// closes it at the refusal at 3.0 seconds (it waits 3 seconds for an answer), so the last try gets in.
export const RETRY_DELAYS_MS = [200, 400, 800, 1600, 3200];
export const CONNECT_TIMEOUT_MS = 3_000;

export class WebSocketTransport implements Transport {
  onLine: ((line: Uint8Array) => void) | null = null;
  onClose: ((reason?: string) => void) | null = null;
  private ended = false;

  private constructor(
    private readonly socket: WebSocket,
    private readonly peer: string,
  ) {
    socket.binaryType = "arraybuffer";
    socket.onmessage = (event: MessageEvent) => {
      if (typeof event.data !== "string") return;
      // A UTF-8 line is never shorter than its UTF-16 length, so this check is cheap and safe.
      if (event.data.length > MAX_LINE) return;
      const bytes = new TextEncoder().encode(event.data);
      if (bytes.length <= MAX_LINE) this.onLine?.(bytes);
    };
    socket.onclose = () => this.finish(`the ${this.peer} closed the connection`);
    socket.onerror = () => this.finish(`the connection to the ${this.peer} failed`);
  }

  private finish(reason: string): void {
    if (this.ended) return;
    this.ended = true;
    this.onClose?.(reason);
  }

  private static attempt(url: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      let settled = false;
      const finish = (opened: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.onopen = null;
        socket.onerror = null;
        socket.onclose = null;
        if (opened) resolve(socket);
        else {
          try {
            socket.close();
          } catch {
            // Some browsers cannot close a socket before its handshake completes.
          }
          reject(new Error("cannot connect"));
        }
      };
      const timer = setTimeout(() => finish(false), CONNECT_TIMEOUT_MS);
      socket.onopen = () => finish(true);
      socket.onerror = () => finish(false);
      socket.onclose = () => finish(false);
    });
  }

  static async connect(address: string): Promise<WebSocketTransport> {
    const checked = checkSimulatorUrl(address);
    if (!checked.ok) throw new Error(checked.message);
    const socket = await WebSocketTransport.open(checked.url);
    if (socket) return new WebSocketTransport(socket, "simulator");
    throw new Error(`Cannot connect to ${checked.url}. Is the simulator running (make serve)?`);
  }

  /** Connects to a board over WiFi, at `ws://<address>/ws`. */
  static async connectBoard(address: BoardAddress): Promise<WebSocketTransport> {
    const socket = await WebSocketTransport.open(address.url);
    if (socket) return new WebSocketTransport(socket, "board");
    throw new Error(
      `Cannot connect to ${address.host}. Check the address, that the board is on this network and that another program does not hold its connection. ${WIFI_BROWSER_NOTE}`,
    );
  }

  /** Tries 6 times, waiting longer after each refusal, since the server serves one client and frees its place a moment after a close. */
  private static async open(url: string): Promise<WebSocket | null> {
    for (const delay of [...RETRY_DELAYS_MS, null]) {
      try {
        return await WebSocketTransport.attempt(url);
      } catch {
        if (delay === null) break;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    return null;
  }

  async send(line: string): Promise<void> {
    if (this.socket.readyState !== WebSocket.OPEN) throw new Error("the connection is closed");
    this.socket.send(line);
  }

  async close(): Promise<void> {
    this.ended = true;
    this.socket.close(1000);
  }
}
