// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_LINE } from "../src/protocol";
import {
  CONNECT_TIMEOUT_MS,
  WIFI_BROWSER_NOTE,
  WebSocketTransport,
  parseBoardAddress,
} from "../src/protocol/websocket";

class FakeSocket {
  static instance: FakeSocket;
  static urls: string[] = [];
  static readonly OPEN = 1;
  binaryType = "";
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url?: string) {
    FakeSocket.instance = this;
    if (url) FakeSocket.urls.push(url);
    queueMicrotask(() => this.onopen?.());
  }
  send(): void {}
  close(): void {}
}

afterEach(() => vi.unstubAllGlobals());

describe("the WebSocket transport", () => {
  it("passes lines up to the limit and drops longer messages", async () => {
    vi.stubGlobal("WebSocket", FakeSocket);
    const transport = await WebSocketTransport.connect("ws://127.0.0.1:8765");
    const lines: number[] = [];
    transport.onLine = (line) => lines.push(line.length);
    const deliver = (data: string): void => FakeSocket.instance.onmessage?.({ data } as MessageEvent);
    deliver("a".repeat(MAX_LINE));
    deliver("a".repeat(MAX_LINE + 1));
    deliver("é".repeat(MAX_LINE));
    expect(lines).toEqual([MAX_LINE]);
  });

  it.each(["ws://127.0.0.1:8765", "ws://localhost:8765", " ws://LOCALHOST:9000/ "])("accepts %s", async (address) => {
    vi.stubGlobal("WebSocket", FakeSocket);
    await expect(WebSocketTransport.connect(address)).resolves.toBeInstanceOf(WebSocketTransport);
  });

  it.each([
    "ws://192.168.1.20:8765",
    "ws://[::1]:8765",
    "ws://127.0.0.2:8765",
    "wss://127.0.0.1:8765",
    "127.0.0.1:8765",
  ])("rejects %s at once and names the allowed hosts", async (address) => {
    const socket = vi.fn();
    vi.stubGlobal("WebSocket", socket);
    await expect(WebSocketTransport.connect(address)).rejects.toThrow("only ws:// on 127.0.0.1 or localhost");
    expect(socket).not.toHaveBeenCalled();
  });
});

describe("the address of a board over WiFi", () => {
  const accepted: Array<[string, string, string]> = [
    ["pixelart-118c.local", "pixelart-118c.local", "ws://pixelart-118c.local/ws"],
    ["  Pixelart-118C.LOCAL ", "pixelart-118c.local", "ws://pixelart-118c.local/ws"],
    ["192.168.1.42", "192.168.1.42", "ws://192.168.1.42/ws"],
    ["192.168.1.42:8080", "192.168.1.42:8080", "ws://192.168.1.42:8080/ws"],
    ["ws://pixelart-118c.local/ws", "pixelart-118c.local", "ws://pixelart-118c.local/ws"],
    ["ws://192.168.1.42/", "192.168.1.42", "ws://192.168.1.42/ws"],
    ["pixelart-118c.local/ws", "pixelart-118c.local", "ws://pixelart-118c.local/ws"],
    ["localhost:8765", "localhost:8765", "ws://localhost:8765/ws"],
    ["nas.lan", "nas.lan", "ws://nas.lan/ws"],
    ["127.0.0.1:65535", "127.0.0.1:65535", "ws://127.0.0.1:65535/ws"],
  ];
  it.each(accepted)("accepts %j", (text, host, url) => {
    expect(parseBoardAddress(text)).toEqual({ ok: true, address: { host, url } });
  });

  it.each([
    "",
    "   ",
    "http://192.168.1.42",
    "wss://pixelart.local",
    "user@pixelart.local",
    "user:pass@192.168.1.42",
    "192.168.1.42/other",
    "192.168.1.42/ws/extra",
    "192.168.1.42?x=1",
    "192.168.1.42#x",
    "192.168.1.42:",
    "192.168.1.42:0",
    "192.168.1.42:65536",
    "192.168.1.42:080",
    "192.168.1.42:80:80",
    "192.168.1.256",
    "192.168.1",
    "192.168.1.1.1",
    "192.168.01.1",
    "1234",
    "[::1]",
    "[::1]:8080",
    "-a.local",
    "a-.local",
    "a..local",
    ".local",
    "pixel art.local",
    "pixelart_1.local",
    "pixelart.local/../x",
    `${"a".repeat(64)}.local`,
  ])("refuses %j and says how to write an address", (text) => {
    const result = parseBoardAddress(text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("pixelart-XXXX.local");
  });
});

describe("connecting to a board over WiFi", () => {
  it("times out silent sockets, closes each one, and ignores a late open", async () => {
    vi.useFakeTimers();
    const sockets: Array<{ onopen: (() => void) | null; close: ReturnType<typeof vi.fn> }> = [];
    vi.stubGlobal(
      "WebSocket",
      class {
        onopen: (() => void) | null = null;
        onerror: (() => void) | null = null;
        onclose: (() => void) | null = null;
        close = vi.fn();
        constructor() {
          sockets.push(this);
        }
      },
    );
    const parsed = parseBoardAddress("192.168.1.42");
    if (!parsed.ok) throw new Error("the address is valid");
    const failure = WebSocketTransport.connectBoard(parsed.address).catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS);
    expect(sockets[0]?.close).toHaveBeenCalledTimes(1);
    expect(sockets[0]?.onopen).toBeNull();
    await vi.advanceTimersByTimeAsync(5 * CONNECT_TIMEOUT_MS + 6200);
    expect(sockets).toHaveLength(6);
    expect(await failure).toBeInstanceOf(Error);
    expect(sockets.every((socket) => socket.close.mock.calls.length === 1)).toBe(true);
    vi.useRealTimers();
  });

  it("opens ws://<address>/ws", async () => {
    vi.stubGlobal("WebSocket", FakeSocket);
    FakeSocket.urls = [];
    const parsed = parseBoardAddress("pixelart-118c.local");
    if (!parsed.ok) throw new Error("the address is valid");
    await WebSocketTransport.connectBoard(parsed.address);
    expect(FakeSocket.urls).toEqual(["ws://pixelart-118c.local/ws"]);
  });

  it("names the browsers that can do it when the connection fails", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "WebSocket",
      class {
        onerror: (() => void) | null = null;
        constructor() {
          queueMicrotask(() => this.onerror?.());
        }
      },
    );
    const parsed = parseBoardAddress("192.168.1.42");
    if (!parsed.ok) throw new Error("the address is valid");
    const failure = WebSocketTransport.connectBoard(parsed.address).catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(7000);
    const error = await failure;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("Cannot connect to 192.168.1.42");
    expect((error as Error).message).toContain(WIFI_BROWSER_NOTE);
    vi.useRealTimers();
  });

  it("tries 6 times and waits 200, 400, 800, 1600 and 3200 milliseconds between the tries", async () => {
    vi.useFakeTimers();
    const tries: number[] = [];
    vi.stubGlobal(
      "WebSocket",
      class {
        onclose: (() => void) | null = null;
        constructor() {
          tries.push(Date.now());
          queueMicrotask(() => this.onclose?.());
        }
      },
    );
    const parsed = parseBoardAddress("192.168.1.42");
    if (!parsed.ok) throw new Error("the address is valid");
    const start = Date.now();
    let settled = false;
    const failure = WebSocketTransport.connectBoard(parsed.address).catch((error: Error) => {
      settled = true;
      return error;
    });
    await vi.advanceTimersByTimeAsync(6199);
    expect(tries.map((time) => time - start)).toEqual([0, 200, 600, 1400, 3000]);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(tries.map((time) => time - start)).toEqual([0, 200, 600, 1400, 3000, 6200]);
    expect(await failure).toBeInstanceOf(Error);
    expect(settled).toBe(true);
    vi.useRealTimers();
  });

  it("stops trying once a try opens", async () => {
    vi.useFakeTimers();
    let tries = 0;
    vi.stubGlobal(
      "WebSocket",
      class {
        binaryType = "";
        onopen: (() => void) | null = null;
        onclose: (() => void) | null = null;
        constructor() {
          tries++;
          const refused = tries < 3;
          queueMicrotask(() => (refused ? this.onclose?.() : this.onopen?.()));
        }
      },
    );
    const parsed = parseBoardAddress("192.168.1.42");
    if (!parsed.ok) throw new Error("the address is valid");
    const opened = WebSocketTransport.connectBoard(parsed.address);
    await vi.advanceTimersByTimeAsync(600);
    await expect(opened).resolves.toBeInstanceOf(WebSocketTransport);
    await vi.advanceTimersByTimeAsync(5000);
    expect(tries).toBe(3);
    vi.useRealTimers();
  });

  it("still allows only the loopback hosts for the simulator", async () => {
    vi.stubGlobal("WebSocket", FakeSocket);
    await expect(WebSocketTransport.connect("ws://192.168.1.20:8765")).rejects.toThrow("only ws:// on 127.0.0.1");
  });
});
