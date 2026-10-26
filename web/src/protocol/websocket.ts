// SPDX-License-Identifier: GPL-3.0-or-later

// WebSocket transport to the simulator or to a board over WiFi: one line per text message.

import { MAX_LINE } from "./lines";
import type { Transport } from "./transport";

export const DEFAULT_SIMULATOR_URL = "ws://127.0.0.1:8765";
// The simulator and the board serve one client and free the slot a moment after a close. The wait doubles after each
// refusal, so a second tab or a reload that finds the slot taken sends the board a few connections, not a burst. The
// tries come at about 0, 0.2, 0.6, 1.4, 3.0 and 6.2 seconds: the board pings a stalled holder at the first refusal and
// closes it at the refusal at 3.0 seconds (it waits 3 seconds for an answer), so the last try gets in.
export const RETRY_DELAYS_MS = [200, 400, 800, 1600, 3200];

// The simulator listens on the loopback interface only.
const LOOPBACK_HOSTS = ["127.0.0.1", "localhost"];

/** The address to connect to, or an error message. Only ws:// addresses on a loopback host are accepted. */
function checkSimulatorUrl(text: string): { ok: true; url: string } | { ok: false; message: string } {
  try {
    const url = new URL(text.trim());
    if (url.protocol === "ws:" && LOOPBACK_HOSTS.includes(url.hostname)) return { ok: true, url: url.toString() };
  } catch {
    // Falls through to the message.
  }
  return {
    ok: false,
    message: `The address must look like ${DEFAULT_SIMULATOR_URL}: only ws:// on 127.0.0.1 or localhost is allowed`,
  };
}

/** What the app says when a connection to a board over WiFi fails: the browsers that can and cannot do it. */
export const WIFI_BROWSER_NOTE =
  "Connecting over WiFi is expected to work in Chromium browsers (Chrome, Edge, Opera); Chrome asks to allow access to devices on the local network the first time. Firefox and Safari are expected not to let a page from the internet reach a board.";

const WIFI_ADDRESS_HELP = "Type the board's name (pixelart-XXXX.local) or its IP address, such as 192.168.1.42.";

/** A board's address as the app uses it. `host` is what is remembered and keys the stored token; `url` is the WebSocket's. */
export interface BoardAddress {
  host: string;
  url: string;
}

const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

function validIpv4(text: string): boolean {
  const parts = text.split(".");
  return parts.length === 4 && parts.every((part) => /^(0|[1-9][0-9]{0,2})$/.test(part) && Number(part) <= 255);
}

/**
 * The WebSocket address of a board from what the user typed: a host name or an IPv4 address, with an optional port. A
 * leading `ws://` and a trailing `/ws` or `/` are accepted and dropped. Nothing else is: no user information, no other
 * path, no IPv6 address.
 */
export function parseBoardAddress(text: string): { ok: true; address: BoardAddress } | { ok: false; message: string } {
  const refused = { ok: false as const, message: WIFI_ADDRESS_HELP };
  let rest = text.trim().toLowerCase();
  if (rest.startsWith("ws://")) rest = rest.slice("ws://".length);
  rest = rest.replace(/\/ws\/?$/, "").replace(/\/$/, "");
  const match = /^([a-z0-9.-]+)(?::([0-9]{1,5}))?$/.exec(rest);
  if (!match) return refused;
  const host = match[1] as string;
  const port = match[2];
  if (port !== undefined && (Number(port) < 1 || Number(port) > 65535 || port.startsWith("0"))) return refused;
  if (/^[0-9.]+$/.test(host)) {
    if (!validIpv4(host)) return refused;
  } else if (host.length > 253 || !host.split(".").every((label) => LABEL.test(label))) return refused;
  const shown = port === undefined ? host : `${host}:${port}`;
  return { ok: true, address: { host: shown, url: `ws://${shown}/ws` } };
}

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
      socket.onopen = () => resolve(socket);
      socket.onerror = () => reject(new Error("cannot connect"));
      socket.onclose = () => reject(new Error("cannot connect"));
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
