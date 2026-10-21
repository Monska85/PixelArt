import { describe, expect, it } from "vitest";
import { LineSplitter, MAX_LINE, createLineSplitterStream } from "../src/protocol";
import { SerialTransport, type SerialPortLike } from "../src/protocol/serial";
import { text } from "./helpers";

const decode = (lines: Uint8Array[]): string[] => lines.map((l) => new TextDecoder().decode(l));

function feed(splitter: LineSplitter, bytes: Uint8Array, sizes: number[]): Uint8Array[] {
  const out: Uint8Array[] = [];
  let at = 0;
  for (let i = 0; at < bytes.length; i++) {
    const size = sizes[i % sizes.length] as number;
    out.push(...splitter.push(bytes.subarray(at, at + size)));
    at += size;
  }
  return out;
}

describe("LineSplitter", () => {
  it("splits at newlines and drops a carriage return before them", () => {
    const lines = new LineSplitter().push(text("one\r\ntwo\nthree\r\r\n\nfour"));
    expect(decode(lines)).toEqual(["one", "two", "three\r", ""]);
  });

  it("keeps a partial line for the next chunk", () => {
    const splitter = new LineSplitter();
    expect(splitter.push(text("ab"))).toEqual([]);
    expect(splitter.push(text("cd\r"))).toEqual([]);
    expect(decode(splitter.push(text("\nef\n")))).toEqual(["abcd", "ef"]);
  });

  it("gives the same lines whatever the chunking", () => {
    const stream = text("@PR 1 a\r\nlog line\n\n@PR 2 é中\u{1f600}\r\n" + "x".repeat(5000) + "\nlast\n");
    const whole = decode(new LineSplitter().push(stream));
    let seed = 7;
    const random = (): number => (seed = (seed * 1103515245 + 12345) % 2 ** 31);
    for (let round = 0; round < 200; round++) {
      const sizes = Array.from({ length: 1 + (random() % 6) }, () => 1 + (random() % 700));
      expect(decode(feed(new LineSplitter(), stream, sizes))).toEqual(whole);
    }
    expect(decode(feed(new LineSplitter(), stream, [1]))).toEqual(whole);
  });

  it("accepts a line of 16 KiB and drops a longer one, up to its newline", () => {
    const ok = "a".repeat(MAX_LINE);
    const tooLong = "b".repeat(MAX_LINE + 1);
    const stream = text(`${ok}\n${tooLong}\nnext\r\n${ok}\r\n${tooLong}\r\nend\n`);
    for (const sizes of [[stream.length], [1000], [1], [MAX_LINE], [MAX_LINE + 1], [3, 5000]]) {
      const lines = decode(feed(new LineSplitter(), stream, sizes));
      expect(lines).toEqual([ok, "next", ok, "end"]);
    }
  });

  it("drops a runaway line that never ends, then recovers", () => {
    const splitter = new LineSplitter();
    for (let i = 0; i < 100; i++) expect(splitter.push(new Uint8Array(1024).fill(0x61))).toEqual([]);
    expect(decode(splitter.push(text("tail\nfine\n")))).toEqual(["fine"]);
  });

  it("works as a stream transform", async () => {
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const piece of ["@PR a", "b\r", "\nx\ny", "\n"]) controller.enqueue(text(piece));
        controller.close();
      },
    });
    const reader = source.pipeThrough(createLineSplitterStream()).getReader();
    const lines: string[] = [];
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      lines.push(new TextDecoder().decode(value));
    }
    expect(lines).toEqual(["@PR ab", "x", "y"]);
  });
});

describe("SerialTransport", () => {
  function fakePort() {
    const written: string[] = [];
    let push: (chunk: Uint8Array) => void = () => undefined;
    let end: () => void = () => undefined;
    const calls: unknown[] = [];
    const port: SerialPortLike = {
      readable: new ReadableStream({
        start(controller) {
          push = (chunk) => controller.enqueue(chunk);
          end = () => controller.close();
        },
      }),
      writable: new WritableStream({
        write: (chunk: Uint8Array) => void written.push(new TextDecoder().decode(chunk)),
      }),
      open: async (options) => void calls.push(["open", options]),
      close: async () => void calls.push(["close"]),
      setSignals: async (signals) => void calls.push(["signals", signals]),
    };
    return { port, written, push: (s: string) => push(text(s)), end: () => end(), calls };
  }

  it("opens at 115,200 baud with an 8 KiB buffer and keeps DTR and RTS low", async () => {
    const { port, calls } = fakePort();
    await SerialTransport.open(port);
    expect(calls[0]).toEqual(["open", { baudRate: 115200, bufferSize: 8192 }]);
    expect(calls[1]).toEqual(["signals", { dataTerminalReady: false, requestToSend: false }]);
  });

  it("delivers lines and sends them with a newline", async () => {
    const { port, written, push } = fakePort();
    const transport = await SerialTransport.open(port);
    const lines: string[] = [];
    transport.onLine = (line) => lines.push(new TextDecoder().decode(line));
    push("hel");
    push("lo\r\nwor");
    push("ld\n");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(lines).toEqual(["hello", "world"]);
    await transport.send("@PR x");
    expect(written).toEqual(["@PR x\n"]);
  });

  it("tells when the port ends", async () => {
    const { port, end } = fakePort();
    const transport = await SerialTransport.open(port);
    let closed = false;
    transport.onClose = () => (closed = true);
    end();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(closed).toBe(true);
  });

  it("says to close the other program when the port is busy", async () => {
    const { port } = fakePort();
    port.open = async () => {
      throw new Error("NetworkError");
    };
    await expect(SerialTransport.open(port)).rejects.toThrow(/Close every other program/);
  });

  it("unlocks both streams before it closes the port, as a browser needs", async () => {
    const { port, calls } = fakePort();
    port.close = async () => {
      if (port.readable?.locked || port.writable?.locked) throw new Error("streams are locked");
      calls.push(["close"]);
    };
    const transport = await SerialTransport.open(port);
    await transport.close();
    expect(calls.at(-1)).toEqual(["close"]);
    await expect(transport.send("x")).rejects.toThrow(/closed/);
  });

  it("closes the port when the streams cannot be used after it opened", async () => {
    const { port, calls } = fakePort();
    port.writable = null;
    await expect(SerialTransport.open(port)).rejects.toThrow(/Close every other program/);
    expect(calls.at(-1)).toEqual(["close"]);
  });
});
