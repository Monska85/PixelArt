// Web Serial transport (desktop Chromium browsers).

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

export const BAUD_RATE = 115_200;
export const BUFFER_SIZE = 8192;

export function serialApi(): SerialLike | null {
  const serial = (globalThis.navigator as { serial?: SerialLike } | undefined)?.serial;
  return serial ?? null;
}

export const SERIAL_UNSUPPORTED =
  "Connecting a board needs Web Serial, which only desktop Chrome, Edge, Opera and other Chromium browsers have. Use one of them, or connect the simulator.";

export const PORT_BUSY =
  "The browser could not open the serial port. Close every other program that uses it (the serial monitor, tools/pixelart.py) and try again.";

export class SerialTransport implements Transport {
  onLine: ((line: Uint8Array) => void) | null = null;
  onClose: ((reason?: string) => void) | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private piped: Promise<void> | null = null;
  private ended = false;

  private constructor(private readonly port: SerialPortLike) {}

  /** Asks the user for a port and opens it. Needs a user gesture. */
  static async request(): Promise<SerialTransport> {
    const serial = serialApi();
    if (!serial) throw new Error(SERIAL_UNSUPPORTED);
    return SerialTransport.open(await serial.requestPort());
  }

  /** Opens a port without resetting the board: DTR and RTS stay low. */
  static async open(port: SerialPortLike): Promise<SerialTransport> {
    try {
      await port.open({ baudRate: BAUD_RATE, bufferSize: BUFFER_SIZE });
    } catch {
      throw new Error(PORT_BUSY);
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
      throw error;
    }
    return transport;
  }

  private start(): void {
    const { readable, writable } = this.port;
    if (!readable || !writable) throw new Error(PORT_BUSY);
    this.writer = writable.getWriter();
    const splitter = createLineSplitterStream();
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

  /** Releases every stream lock before port.close(), which rejects while a stream is locked. */
  async close(): Promise<void> {
    this.ended = true;
    try {
      await this.reader?.cancel();
    } catch {
      // Already closed.
    }
    // Cancelling the splitter side cancels the pipe, which then releases the readable.
    await this.piped;
    try {
      await this.writer?.close();
    } catch {
      await this.writer?.abort().catch(() => undefined);
    }
    this.writer?.releaseLock();
    this.writer = null;
    try {
      await this.port.close();
    } catch {
      // Already closed.
    }
  }
}
