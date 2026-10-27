// SPDX-License-Identifier: GPL-3.0-or-later

// Web Serial transport (desktop Chromium browsers).

import type { ImprovLink } from "./improv";
import { createLineSplitterStream } from "./lines";
import type { Transport } from "./transport";

// The parts of the Web Serial API this app uses; lib.dom does not describe it.
export interface SerialPortLike {
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  open(options: { baudRate: number; bufferSize?: number }): Promise<void>;
  close(): Promise<void>;
  setSignals(signals: { dataTerminalReady?: boolean; requestToSend?: boolean }): Promise<void>;
}

interface SerialLike {
  requestPort(): Promise<SerialPortLike>;
}

const BAUD_RATE = 115_200;
const BUFFER_SIZE = 8192;

export function serialApi(): SerialLike | null {
  const serial = (globalThis.navigator as { serial?: SerialLike } | undefined)?.serial;
  return serial ?? null;
}

export const SERIAL_UNSUPPORTED =
  "Connecting a board needs Web Serial, which only desktop Chrome, Edge, Opera and other Chromium browsers have. Use one of them, or connect the simulator.";

export const PORT_BUSY =
  "The browser could not open the serial port. Close every other program that uses it (another browser tab, the serial monitor, tools/pixelart.py) and try again.";

/** How long closing waits for each stream before it closes the port anyway: a vanished device can leave them pending. */
export const CLOSE_STEP_MS = 1000;

/** A port that could not be opened: the friendly hint, then what the browser said, so other failures can be told apart. */
class SerialOpenError extends Error {
  constructor(cause: unknown) {
    const said =
      cause instanceof Error ? `${cause.name}: ${cause.message}` : typeof cause === "string" ? cause : "unknown error";
    super(`${PORT_BUSY} (${said})`, { cause });
    this.name = "SerialOpenError";
  }
}

// A port's close that outlived CLOSE_STEP_MS: opening the port again waits for it, or the port is still closing.
const closingPorts = new WeakMap<SerialPortLike, Promise<void>>();

// The transport that holds each open port, so a page that still holds a port can release it before opening it again.
const holders = new WeakMap<SerialPortLike, SerialTransport>();

/** Waits for `promise`, but never longer than `ms`; its failure is ignored. */
async function settle(promise: Promise<unknown> | null | undefined, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.resolve(promise).catch(() => undefined),
    new Promise((resolve) => (timer = setTimeout(resolve, ms))),
  ]);
  clearTimeout(timer);
}

/**
 * Frees a port this page still holds open. The transport that holds it releases its streams first, because the port
 * cannot close while one is locked. A close still under way finishes next; otherwise the port is closed here. Each step is bounded, and no failure is raised: the caller opens the port and reports what the browser says.
 */
async function releaseHeldPort(port: SerialPortLike): Promise<void> {
  const holder = holders.get(port);
  await holder?.close();
  const closing = closingPorts.get(port);
  await settle(closing, CLOSE_STEP_MS);
  if (port.readable || port.writable || (!holder && !closing)) await settle(port.close(), CLOSE_STEP_MS);
}

export class SerialTransport implements Transport {
  onLine: ((line: Uint8Array) => void) | null = null;
  onClose: ((reason?: string) => void) | null = null;
  /** Improv frames share the port with the protocol lines. */
  readonly improv: ImprovLink = {
    send: async (frame) => {
      if (!this.writer) throw new Error("the serial port is closed");
      await this.writer.write(frame);
    },
    onFrame: null,
  };
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private piped: Promise<void> | null = null;
  private ended = false;
  private closing: Promise<void> | null = null;

  private constructor(private readonly port: SerialPortLike) {}

  /** Asks the user for a port and opens it. Needs a user gesture. */
  static async request(): Promise<SerialTransport> {
    const serial = serialApi();
    if (!serial) throw new Error(SERIAL_UNSUPPORTED);
    return SerialTransport.open(await serial.requestPort());
  }

  /**
   * Opens a port without resetting the board: DTR and RTS stay low. A port this page still holds open (an earlier
   * connection that did not close, "InvalidStateError") is released, with the streams of the transport that holds it,
   * and opened once more. Any failure after the port opened closes it again, so the browser never keeps it.
   */
  static async open(port: SerialPortLike): Promise<SerialTransport> {
    const options = { baudRate: BAUD_RATE, bufferSize: BUFFER_SIZE };
    try {
      await port.open(options);
    } catch (error) {
      if (!(error instanceof Error && error.name === "InvalidStateError")) throw new SerialOpenError(error);
      await releaseHeldPort(port);
      try {
        await port.open(options);
      } catch (again) {
        throw new SerialOpenError(again);
      }
    }
    const transport = new SerialTransport(port);
    try {
      await port.setSignals({ dataTerminalReady: false, requestToSend: false });
    } catch {
      // Some adapters have no control lines; the port still works.
    }
    try {
      transport.start();
    } catch (error) {
      await transport.close();
      throw error instanceof SerialOpenError ? error : new SerialOpenError(error);
    }
    holders.set(port, transport);
    return transport;
  }

  private start(): void {
    const { readable, writable } = this.port;
    if (!readable || !writable) throw new SerialOpenError(new Error("the port opened without its streams"));
    this.writer = writable.getWriter();
    const splitter = createLineSplitterStream(undefined, (frame) => this.improv.onFrame?.(frame));
    this.piped = readable.pipeTo(splitter.writable).catch(() => undefined);
    this.reader = splitter.readable.getReader();
    void this.readLoop();
  }

  private async readLoop(): Promise<void> {
    const reader = this.reader;
    if (!reader) return;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        this.onLine?.(value);
      }
    } catch {
      // The port was unplugged or closed.
    }
    this.finish("the serial port closed");
  }

  private finish(reason: string): void {
    if (this.ended) return;
    this.ended = true;
    this.onClose?.(reason);
  }

  async send(line: string): Promise<void> {
    if (!this.writer) throw new Error("the serial port is closed");
    await this.writer.write(new TextEncoder().encode(`${line}\n`));
  }

  /**
   * Releases every stream lock, then closes the port, which rejects while a stream is locked. Each stream step waits
   * at most CLOSE_STEP_MS: when the device has gone, a pending write or read may never settle, and the port must be
   * closed anyway, or the browser keeps it open and every later attempt finds it busy. Calling it again waits for the
   * first call.
   */
  close(): Promise<void> {
    this.closing ??= this.closeOnce();
    return this.closing;
  }

  private async closeOnce(): Promise<void> {
    this.ended = true;
    await settle(this.reader?.cancel(), CLOSE_STEP_MS);
    try {
      this.reader?.releaseLock();
    } catch {
      // Already released.
    }
    // Cancelling the splitter side cancels the pipe, which then releases the readable.
    await settle(this.piped, CLOSE_STEP_MS);
    // Abort, not close: close waits for every queued write, abort drops them and waits only for the one in flight,
    // which a vanished device may never complete: the step limit covers that one.
    await settle(this.writer?.abort(), CLOSE_STEP_MS);
    try {
      this.writer?.releaseLock();
    } catch {
      // Already released.
    }
    this.writer = null;
    this.reader = null;
    await this.closePort();
    if (holders.get(this.port) === this) holders.delete(this.port);
  }

  /** The port refuses to close while a stream is still locked, so a refusal gets one more try once the streams settled. */
  private async closePort(): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const closing = this.port.close();
      closingPorts.set(this.port, closing);
      let refused = false;
      await settle(
        closing.catch(() => void (refused = true)),
        CLOSE_STEP_MS,
      );
      if (!refused) return;
      await settle(this.piped, CLOSE_STEP_MS);
    }
  }
}
