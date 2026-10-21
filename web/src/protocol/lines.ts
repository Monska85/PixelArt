// Splits the bytes of a serial port into lines. Data arrives in arbitrary
// pieces, so a line can span many chunks and a chunk can hold many lines.

export const MAX_LINE = 16 * 1024;

export class LineSplitter {
  private pending: Uint8Array[] = [];
  private length = 0;
  private dropping = false;

  constructor(private readonly maxLine = MAX_LINE) {}

  /** Feeds a chunk and returns the lines it completed. A `\r` before the `\n` is removed. */
  push(chunk: Uint8Array): Uint8Array[] {
    const lines: Uint8Array[] = [];
    let start = 0;
    for (;;) {
      const end = chunk.indexOf(0x0a, start);
      if (end < 0) {
        this.append(chunk.subarray(start));
        return lines;
      }
      const line = this.finish(chunk.subarray(start, end));
      if (line) lines.push(line);
      start = end + 1;
    }
  }

  private append(part: Uint8Array): void {
    if (this.dropping || part.length === 0) return;
    this.pending.push(part);
    this.length += part.length;
    // Even without its newline, a line this long is over the limit.
    if (this.length > this.maxLine + 1) {
      this.pending = [];
      this.length = 0;
      this.dropping = true;
    }
  }

  private finish(last: Uint8Array): Uint8Array | null {
    if (this.dropping) {
      this.dropping = false;
      return null;
    }
    const whole = new Uint8Array(this.length + last.length);
    let offset = 0;
    for (const part of this.pending) {
      whole.set(part, offset);
      offset += part.length;
    }
    whole.set(last, offset);
    this.pending = [];
    this.length = 0;
    const end = whole[whole.length - 1] === 0x0d ? whole.length - 1 : whole.length;
    return end > this.maxLine ? null : whole.slice(0, end);
  }
}

export function createLineSplitterStream(maxLine = MAX_LINE): TransformStream<Uint8Array, Uint8Array> {
  const splitter = new LineSplitter(maxLine);
  return new TransformStream({
    transform(chunk, controller) {
      for (const line of splitter.push(chunk)) controller.enqueue(line);
    },
  });
}
