import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_LINE } from "../src/protocol";
import { WebSocketTransport } from "../src/protocol/websocket";

class FakeSocket {
  static instance: FakeSocket;
  static readonly OPEN = 1;
  binaryType = "";
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    FakeSocket.instance = this;
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
});
