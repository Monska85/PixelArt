// WebSocket transport to the simulator: one line per text message.

import { MAX_LINE } from "./lines";
import type { Transport } from "./transport";

export const DEFAULT_SIMULATOR_URL = "ws://127.0.0.1:8765";
// The simulator serves one client and frees its slot a moment after a close.
const CONNECT_TRIES = 5;
const RETRY_DELAY_MS = 200;

// The hosts the Content Security Policy in index.html lets the page connect to.
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

export class WebSocketTransport implements Transport {
  onLine: ((line: Uint8Array) => void) | null = null;
  onClose: ((reason?: string) => void) | null = null;
  private ended = false;

  private constructor(private readonly socket: WebSocket) {
    socket.binaryType = "arraybuffer";
    socket.onmessage = (event: MessageEvent) => {
      if (typeof event.data !== "string") return;
      // A UTF-8 line is never shorter than its UTF-16 length, so this check is cheap and safe.
      if (event.data.length > MAX_LINE) return;
      const bytes = new TextEncoder().encode(event.data);
      if (bytes.length <= MAX_LINE) this.onLine?.(bytes);
    };
    socket.onclose = () => this.finish("the simulator closed the connection");
    socket.onerror = () => this.finish("the connection to the simulator failed");
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
    for (let i = 0; i < CONNECT_TRIES; i++) {
      try {
        return new WebSocketTransport(await WebSocketTransport.attempt(checked.url));
      } catch {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
    throw new Error(`Cannot connect to ${checked.url}. Is the simulator running (make serve)?`);
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
