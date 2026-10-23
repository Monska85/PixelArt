// SPDX-License-Identifier: GPL-3.0-or-later

// Splits the bytes of a serial port into lines. Data arrives in arbitrary
// pieces, so a line can span many chunks and a chunk can hold many lines.
//
// Improv Wi-Fi frames travel on the same port. A frame starts with `IMPROV` and the version byte anywhere outside a
// protocol line (one that starts with `@PR `), is read to its end by its length field, and goes to `onFrame`: a
// newline inside it ends nothing. Lines are handled as they always were.

import { IMPROV_HEADER, IMPROV_MAGIC, checksum, type ImprovFrame } from "./improv";

export const MAX_LINE = 16 * 1024;
/** A frame that stops for this long is dropped, so a lost byte never swallows the lines after it. */
export const FRAME_IDLE_MS = 1000;

const MARKER = [0x40, 0x50, 0x52, 0x20]; // "@PR "
const HEADER_SUM = checksum(IMPROV_HEADER);
// The type and the length come first; the data follows, then the checksum.
const FRAME_HEAD = 2;

export class LineSplitter {
  private line = new Uint8Array(1024);
  private length = 0;
  private dropping = false;
  private protocolLine = false;
  private matched = 0; // bytes of the Improv header seen at the end of the line so far
  private frame: Uint8Array | null = null;
  private frameSize = 0;
  private frameSum = 0;
  private lastAt = 0;

  constructor(
    private readonly maxLine = MAX_LINE,
    private readonly onFrame: ((frame: ImprovFrame) => void) | null = null,
    private readonly now: () => number = Date.now,
  ) {}

  /** Feeds a chunk and returns the lines it completed. A `\r` before the `\n` is removed. */
  push(chunk: Uint8Array): Uint8Array[] {
    const at = this.now();
    if (this.frame && at - this.lastAt > FRAME_IDLE_MS) this.frame = null;
    this.lastAt = at;
    const lines: Uint8Array[] = [];
    for (const byte of chunk) {
      if (this.frame) this.readFrame(byte);
      else if (byte === 0x0a) {
        const line = this.finish();
        if (line) lines.push(line);
      } else this.append(byte);
    }
    return lines;
  }

  private append(byte: number): void {
    if (!this.dropping) {
      if (this.length === this.line.length) {
        const bigger = new Uint8Array(this.line.length * 2);
        bigger.set(this.line);
        this.line = bigger;
      }
      this.line[this.length++] = byte;
      if (this.length === MARKER.length) this.protocolLine = MARKER.every((m, i) => this.line[i] === m);
      // Even without its newline, a line this long is over the limit.
      if (this.length > this.maxLine + 1) {
        this.length = 0;
        this.dropping = true;
      }
    }
    // A protocol line never holds the header: a raw 0x01 is not valid JSON.
    if (this.protocolLine) return;
    if (byte === IMPROV_HEADER[this.matched]) this.matched++;
    else this.matched = byte === IMPROV_MAGIC[0] ? 1 : 0;
    if (this.matched === IMPROV_HEADER.length) this.startFrame();
  }

  private startFrame(): void {
    // What came before the header on this line was not a protocol line.
    this.length = 0;
    this.dropping = false;
    this.matched = 0;
    this.frame ??= new Uint8Array(FRAME_HEAD + 255 + 1);
    this.frameSize = 0;
    this.frameSum = HEADER_SUM;
  }

  private readFrame(byte: number): void {
    const frame = this.frame as Uint8Array;
    const length = this.frameSize >= FRAME_HEAD ? (frame[1] as number) : -1;
    if (length < 0 || this.frameSize < FRAME_HEAD + length) {
      frame[this.frameSize++] = byte;
      this.frameSum = (this.frameSum + byte) & 0xff;
      return;
    }
    // The checksum byte.
    const done = { type: frame[0] as number, data: frame.slice(FRAME_HEAD, FRAME_HEAD + length) };
    this.frame = null;
    if (byte === this.frameSum) this.onFrame?.(done);
  }

  private finish(): Uint8Array | null {
    const dropped = this.dropping;
    const end = this.length > 0 && this.line[this.length - 1] === 0x0d ? this.length - 1 : this.length;
    const line = dropped || end > this.maxLine ? null : this.line.slice(0, end);
    this.length = 0;
    this.dropping = false;
    this.protocolLine = false;
    this.matched = 0;
    return line;
  }
}

export function createLineSplitterStream(
  maxLine = MAX_LINE,
  onFrame: ((frame: ImprovFrame) => void) | null = null,
): TransformStream<Uint8Array, Uint8Array> {
  const splitter = new LineSplitter(maxLine, onFrame);
  return new TransformStream({
    transform(chunk, controller) {
      for (const line of splitter.push(chunk)) controller.enqueue(line);
    },
  });
}
