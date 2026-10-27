// SPDX-License-Identifier: GPL-3.0-or-later

import type { SerialPortLike } from "../src/protocol/serial";
import type { FakeBoard } from "./fakeBoard";

/**
 * A Web Serial port as Chrome behaves: open() fails while the port is open, close() fails while a stream is locked,
 * and the streams exist only while the port is open. It can answer through a FakeBoard, or not at all.
 */
export class FakePort implements SerialPortLike {
  readable: ReadableStream<Uint8Array> | null = null;
  writable: WritableStream<Uint8Array> | null = null;
  isOpen = false;
  /** Errors the next open() calls throw, in order. */
  openErrors: Error[] = [];
  /** Opens without streams, like a port that fails right after opening. */
  noStreams = false;
  /** The next open() leaves a port whose readable has failed already, as when the device goes during the handshake. */
  vanishOnOpen = false;
  /** Writes never complete, like a device that has gone. */
  writesHang = false;
  /** Writes never complete until the writer is aborted, then fail, as Chrome does when the device refuses data. */
  writesBlock = false;
  /** Every written line is answered with a line that is not the protocol, like the log of an old sketch. */
  garbage = false;
  /** Cancelling the readable never completes, so the page's pipe from it never settles. */
  cancelHangs = false;
  /** close() stays pending until this is called; null closes at once. */
  finishClose: (() => void) | null = null;
  closeHangs = false;
  /** The name of every error open() threw. */
  failedOpens: string[] = [];
  /** What the last open() and setSignals() were given, and every line written without a board. */
  openOptions: unknown = null;
  signals: unknown = null;
  written: string[] = [];
  private source: ReadableStreamDefaultController<Uint8Array> | null = null;

  constructor(
    readonly name: string,
    readonly log: string[],
    private readonly board: FakeBoard | null = null,
  ) {}

  async open(options: unknown): Promise<void> {
    this.log.push(`${this.name} open`);
    this.openOptions = options;
    const error = this.openErrors.shift();
    if (error) {
      this.failedOpens.push(error.name);
      throw error;
    }
    if (this.isOpen) {
      this.failedOpens.push("InvalidStateError");
      throw new DOMException("The port is already open.", "InvalidStateError");
    }
    this.isOpen = true;
    if (this.noStreams) return;
    this.readable = new ReadableStream({
      start: (controller) => void (this.source = controller),
      cancel: () => (this.cancelHangs ? new Promise<void>(() => {}) : undefined),
    });
    this.writable = new WritableStream({
      write: (chunk, controller) => {
        if (this.writesHang) return new Promise(() => {});
        if (this.writesBlock)
          return new Promise<void>((_resolve, reject) =>
            controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true }),
          );
        const line = new TextDecoder().decode(chunk);
        if (this.garbage)
          try {
            this.receive("pixelart: booting, no command protocol here\n");
          } catch {
            // The page cancelled the readable already.
          }
        if (this.board) void this.board.send(line.trimEnd());
        else this.written.push(line);
      },
    });
    if (this.vanishOnOpen) {
      this.vanishOnOpen = false;
      this.vanish();
    }
    if (this.board)
      this.board.onLine = (line) => {
        // A reply that comes after the page cancelled the stream is lost, as on a real port.
        try {
          this.source?.enqueue(new Uint8Array([...line, 0x0a]));
        } catch {
          // The stream is closed.
        }
      };
  }

  async close(): Promise<void> {
    this.log.push(`${this.name} close`);
    if (this.readable?.locked || this.writable?.locked) throw new TypeError("Cannot close a locked stream");
    if (this.closeHangs) await new Promise<void>((resolve) => (this.finishClose = resolve));
    this.isOpen = false;
    this.readable = null;
    this.writable = null;
  }

  async setSignals(signals: unknown): Promise<void> {
    this.signals = signals;
  }

  /** Bytes from the device. */
  receive(data: string | Uint8Array): void {
    this.source?.enqueue(typeof data === "string" ? new TextEncoder().encode(data) : data);
  }

  /** The readable ends, as when the port is closed from the other side. */
  end(): void {
    this.source?.close();
  }

  /** The device goes away: the readable errors, as Chrome does when the USB device disappears. */
  vanish(): void {
    this.source?.error(new DOMException("The device has been lost.", "NetworkError"));
  }
}
