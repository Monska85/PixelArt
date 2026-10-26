// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { LineSplitter, MAX_LINE, createLineSplitterStream } from "../src/protocol";
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
