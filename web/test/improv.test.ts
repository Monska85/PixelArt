// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ImprovClient,
  ImprovError,
  LineSplitter,
  buildFrame,
  parseResult,
  scanFrame,
  wifiSettingsFrame,
  type ImprovFrame,
  type ImprovLink,
} from "../src/protocol";
import { text } from "./helpers";

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);
const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

/** A frame as the board sends it, built here byte by byte with its own sum: IMPROV is 477 (0x1DD). */
function boardFrame(type: number, ...data: number[]): Uint8Array {
  const head = [...ascii("IMPROV"), 1, type, data.length, ...data];
  return bytes(...head, head.reduce((a, b) => a + b, 0) & 0xff);
}

const state = (value: number) => boardFrame(1, value);
const error = (value: number) => boardFrame(2, value);
const result = (command: number, ...strings: string[]) => {
  const body = strings.flatMap((s) => [s.length, ...ascii(s)]);
  return boardFrame(4, command, body.length, ...body);
};

describe("frames", () => {
  it("builds the frame of the specification", () => {
    // "Request scanned networks": IMPROV, 01, type 03, length 02, command 04, data length 00; 477 + 1 + 3 + 2 + 4 = 487 = 0xE7.
    expect(scanFrame()).toEqual(bytes(...ascii("IMPROV"), 1, 3, 2, 4, 0, 0xe7));
  });

  it("builds the WiFi settings with the length of each text", () => {
    const frame = wifiSettingsFrame("ab", "xyz");
    const args = [2, ...ascii("ab"), 3, ...ascii("xyz")];
    const data = [1, args.length, ...args];
    const head = [...ascii("IMPROV"), 1, 3, data.length, ...data];
    expect(frame).toEqual(bytes(...head, head.reduce((a, b) => a + b, 0) & 0xff));
  });

  it("counts bytes, not characters, and accepts an open network", () => {
    expect(wifiSettingsFrame("é", "")[9 + 2]).toBe(2); // the network name length, in UTF-8 bytes
    expect(() => wifiSettingsFrame("a", "")).not.toThrow();
    expect(() => wifiSettingsFrame("a".repeat(32), "p".repeat(64))).not.toThrow();
  });

  it("refuses what the board would refuse", () => {
    for (const [ssid, password] of [
      ["", "x"],
      ["a".repeat(33), ""],
      ["é".repeat(17), ""],
      ["a", "p".repeat(65)],
      ["a\0", "p"],
      ["a", "p\0"],
    ] as const)
      expect(() => wifiSettingsFrame(ssid, password), `${ssid.length} ${password.length}`).toThrow(ImprovError);
  });

  it("refuses data over 255 bytes", () => {
    expect(() => buildFrame(3, new Uint8Array(256))).toThrow(ImprovError);
    expect(buildFrame(3, new Uint8Array(255))).toHaveLength(7 + 2 + 255 + 1);
  });

  it("reads the strings of a result", () => {
    expect(parseResult(bytes(4, 8, 4, ...ascii("Home"), 2, ...ascii("-5")))).toEqual({
      command: 4,
      strings: ["Home", "-5"],
    });
    expect(parseResult(bytes(1, 0))).toEqual({ command: 1, strings: [] });
    expect(parseResult(bytes(4, 3, 9, 65, 66))).toBeNull(); // a string longer than the data
    expect(parseResult(bytes(4, 5, 1, 65))).toBeNull(); // the length does not match
    expect(parseResult(bytes(4))).toBeNull();
  });
});

describe("the line splitter and Improv frames", () => {
  const collect = () => {
    const frames: ImprovFrame[] = [];
    let at = 0;
    const splitter = new LineSplitter(
      1024,
      (f) => frames.push(f),
      () => at,
    );
    return { frames, splitter, tick: (ms: number) => (at += ms) };
  };
  const decode = (lines: Uint8Array[]): string[] => lines.map((l) => new TextDecoder().decode(l));

  it("passes a frame between lines and keeps the lines", () => {
    const { frames, splitter } = collect();
    const stream = [text("@PR a\n"), state(4), text("log\n"), result(3, "PixelArt"), text("@PR b\r\n")];
    const input = Uint8Array.from(stream.flatMap((c) => [...c]));
    expect(decode(splitter.push(input))).toEqual(["@PR a", "log", "@PR b"]);
    expect(frames.map((f) => f.type)).toEqual([1, 4]);
    expect([...frames[0]!.data]).toEqual([4]);
  });

  it("reads a frame that holds a newline and a carriage return", () => {
    const { frames, splitter } = collect();
    const frame = result(4, "a\nb\r");
    expect(decode(splitter.push(Uint8Array.from([...frame, ...text("@PR next\n")])))).toEqual(["@PR next"]);
    expect(parseResult(frames[0]!.data)?.strings).toEqual(["a\nb\r"]);
  });

  it("gives the same frames and lines whatever the chunking", () => {
    const stream = Uint8Array.from([
      ...text("@PR 1 x\n"),
      ...result(4, "Net\n", "-40", "YES"),
      ...text("noise"),
      ...state(3),
      ...text("\n@PR 2 y\n"),
    ]);
    const whole = collect();
    const wholeLines = decode(whole.splitter.push(stream));
    for (const size of [1, 2, 3, 7, 11]) {
      const piece = collect();
      const lines: string[] = [];
      for (let at = 0; at < stream.length; at += size)
        lines.push(...decode(piece.splitter.push(stream.subarray(at, at + size))));
      expect(lines).toEqual(wholeLines);
      expect(piece.frames).toEqual(whole.frames);
    }
    expect(whole.frames).toHaveLength(2);
  });

  it("drops a frame with a wrong checksum and goes on with the lines", () => {
    const { frames, splitter } = collect();
    const bad = state(4);
    bad[bad.length - 1] = (bad[bad.length - 1]! + 1) & 0xff;
    expect(decode(splitter.push(Uint8Array.from([...bad, ...text("@PR ok\n")])))).toEqual(["@PR ok"]);
    expect(frames).toEqual([]);
  });

  it("does not take the header inside a protocol line for a frame", () => {
    const { frames, splitter } = collect();
    const line = Uint8Array.from([...text("@PR 0 x IMPROV"), 1, ...text("\n")]);
    expect(splitter.push(line)).toHaveLength(1);
    expect(frames).toEqual([]);
  });

  it("finds a frame after noise on the same line, and after a runaway line", () => {
    const { frames, splitter } = collect();
    splitter.push(Uint8Array.from([...text("boot noise"), ...state(2)]));
    expect(frames).toHaveLength(1);
    expect(splitter.push(new Uint8Array(5000).fill(0x61))).toEqual([]);
    expect(decode(splitter.push(Uint8Array.from([...state(4), ...text("fine\n")])))).toEqual(["fine"]);
    expect(frames).toHaveLength(2);
  });

  it("ignores another version of the header", () => {
    const { frames, splitter } = collect();
    expect(decode(splitter.push(Uint8Array.from([...text("IMPROV"), 2, ...text("x\n")])))).toHaveLength(1);
    expect(frames).toEqual([]);
  });

  it("drops a frame that stopped and reads the lines after it", () => {
    const { frames, splitter, tick } = collect();
    const frame = state(4);
    splitter.push(frame.subarray(0, frame.length - 2));
    tick(1001);
    expect(decode(splitter.push(text("@PR next\n")))).toEqual(["@PR next"]);
    expect(frames).toEqual([]);
  });
});

describe("ImprovClient", () => {
  /** A link that answers each frame it is sent with the frames `reply` returns, in order. */
  function fakeLink(reply: (frame: Uint8Array) => ImprovFrame[]): ImprovLink & { sent: Uint8Array[] } {
    const link: ImprovLink & { sent: Uint8Array[] } = {
      sent: [],
      onFrame: null,
      async send(frame) {
        link.sent.push(frame);
        for (const f of reply(frame)) queueMicrotask(() => link.onFrame?.(f));
      },
    };
    return link;
  }
  const frameOf = (bytes_: Uint8Array): ImprovFrame => ({
    type: bytes_[7]!,
    data: bytes_.subarray(9, bytes_.length - 1),
  });

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("lists the networks strongest first, once each, until the empty result", async () => {
    const link = fakeLink(() =>
      [
        error(0),
        result(4, "Weak", "-80", "YES"),
        result(4, "Strong", "-40", "NO"),
        result(4, "Strong", "-70", "NO"),
        result(4, "Middle", "-60", "YES"),
        result(4, "Broken", "x", "YES"),
        result(4),
      ].map(frameOf),
    );
    const networks = await new ImprovClient(link).scan();
    expect(networks).toEqual([
      { ssid: "Strong", rssi: -40, secure: false },
      { ssid: "Middle", rssi: -60, secure: true },
      { ssid: "Weak", rssi: -80, secure: true },
    ]);
    expect(link.sent).toEqual([scanFrame()]);
    expect(link.onFrame).toBeNull(); // the client leaves the link as it found it
  });

  it("gives an empty list when the board sees no network", async () => {
    const link = fakeLink(() => [frameOf(error(0)), frameOf(result(4))]);
    expect(await new ImprovClient(link).scan()).toEqual([]);
  });

  it("sends the network and waits for provisioned", async () => {
    const link = fakeLink(() => [error(0), state(3), state(4), result(1)].map(frameOf));
    await new ImprovClient(link).provision("HomeNet", "secret");
    expect(link.sent).toEqual([wifiSettingsFrame("HomeNet", "secret")]);
  });

  it("rejects with the board's error and names the problem without the secrets", async () => {
    const link = fakeLink(() => [error(0), state(3), error(3), state(2)].map(frameOf));
    const failure = await new ImprovClient(link).provision("HomeNet", "secret").catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ImprovError);
    expect(failure).toMatchObject({ code: "unable_to_connect" });
    expect((failure as Error).message).toContain("could not connect");
    expect((failure as Error).message).not.toContain("HomeNet");
    expect((failure as Error).message).not.toContain("secret");
  });

  it("maps the other errors", async () => {
    for (const [code, name] of [
      [1, "invalid_rpc"],
      [2, "unknown_rpc"],
      [0xff, "unknown"],
    ] as const) {
      const link = fakeLink(() => [frameOf(error(code))]);
      await expect(new ImprovClient(link).scan()).rejects.toMatchObject({ code: name });
    }
  });

  it("times out when the board is silent", async () => {
    const link = fakeLink(() => []);
    const client = new ImprovClient(link, { scanMs: 100, provisionMs: 200 });
    const scan = client.scan().catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(100);
    expect(await scan).toMatchObject({ code: "timeout" });
    const provision = client.provision("a", "b").catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(199);
    await vi.advanceTimersByTimeAsync(1);
    expect(await provision).toMatchObject({ code: "timeout" });
  });

  it("runs one request at a time", async () => {
    const link = fakeLink(() => []);
    const client = new ImprovClient(link, { scanMs: 100, provisionMs: 100 });
    const first = client.scan().catch(() => undefined);
    await expect(client.provision("a", "b")).rejects.toMatchObject({ code: "busy" });
    await vi.advanceTimersByTimeAsync(100);
    await first;
    const again = client.provision("a", "b").catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(100);
    expect(await again).toMatchObject({ code: "timeout" });
  });

  it("refuses a bad name or password before it sends anything", async () => {
    const link = fakeLink(() => []);
    await expect(new ImprovClient(link).provision("", "x")).rejects.toBeInstanceOf(ImprovError);
    expect(link.sent).toEqual([]);
  });

  it("reports a link that cannot send", async () => {
    const link: ImprovLink = {
      onFrame: null,
      send: () => Promise.reject(new Error("the serial port is closed")),
    };
    await expect(new ImprovClient(link).scan()).rejects.toThrow("the serial port is closed");
  });
});
