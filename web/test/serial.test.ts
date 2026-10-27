// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from "vitest";
import { CLOSE_STEP_MS, PORT_BUSY, SerialTransport, type SerialPortLike } from "../src/protocol/serial";
import { PORT_RETRY_EVERY_MS, PORT_RETRY_FOR_MS, session } from "../src/ui/session";
import { FakeBoard } from "./fakeBoard";

/**
 * A Web Serial port as Chrome behaves: open() fails while the port is open, close() fails while a stream is locked,
 * and the streams exist only while the port is open. It can answer through a FakeBoard, or not at all.
 */
class FakePort implements SerialPortLike {
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
  /** Cancelling the readable never completes, so the page's pipe from it never settles. */
  cancelHangs = false;
  /** close() stays pending until this is called; null closes at once. */
  finishClose: (() => void) | null = null;
  closeHangs = false;
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
    if (error) throw error;
    if (this.isOpen) throw new DOMException("The port is already open.", "InvalidStateError");
    this.isOpen = true;
    if (this.noStreams) return;
    this.readable = new ReadableStream({
      start: (controller) => void (this.source = controller),
      cancel: () => (this.cancelHangs ? new Promise<void>(() => {}) : undefined),
    });
    this.writable = new WritableStream({
      write: (chunk) => {
        if (this.writesHang) return new Promise(() => {});
        const line = new TextDecoder().decode(chunk);
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

describe("Improv on the serial port", () => {
  it("sends a frame as it is, with no newline", async () => {
    const port = new FakePort("port", []);
    const transport = await SerialTransport.open(port);
    const frame = Uint8Array.from([...new TextEncoder().encode("IMPROV"), 1, 3, 2, 4, 0, 0xe7]);
    await transport.improv.send(frame);
    // The fake port decodes what it is given as text: the bytes are all below 0x80.
    expect(port.written).toEqual([new TextDecoder().decode(frame)]);
    await transport.close();
  });

  it("hands the board's frames to the link and keeps the lines for the protocol", async () => {
    const port = new FakePort("port", []);
    const transport = await SerialTransport.open(port);
    const lines: string[] = [];
    const frames: number[] = [];
    transport.onLine = (line) => lines.push(new TextDecoder().decode(line));
    transport.improv.onFrame = (frame) => frames.push(frame.type);
    // IMPROV, 1, type 1 (state), length 1, the state 4, checksum: 477 + 1 + 1 + 1 + 4 = 484 = 0xE4.
    const state = Uint8Array.from([...new TextEncoder().encode("IMPROV"), 1, 1, 1, 4, 0xe4]);
    port.receive(
      Uint8Array.from([...new TextEncoder().encode("@PR a\n"), ...state, ...new TextEncoder().encode("log\n")]),
    );
    await vi.waitFor(() => expect(lines).toEqual(["@PR a", "log"]));
    expect(frames).toEqual([1]);
    await transport.close();
  });
});

describe("opening a serial port", () => {
  it("opens at 115,200 baud with an 8 KiB buffer and keeps DTR and RTS low", async () => {
    const port = new FakePort("port", []);
    await SerialTransport.open(port);
    expect(port.openOptions).toEqual({ baudRate: 115200, bufferSize: 8192 });
    expect(port.signals).toEqual({ dataTerminalReady: false, requestToSend: false });
  });

  it("shows what the browser said after the friendly hint, and does not retry other errors", async () => {
    const log: string[] = [];
    const port = new FakePort("port", log);
    port.openErrors = [new DOMException("Failed to open serial port.", "NetworkError")];
    await expect(SerialTransport.open(port)).rejects.toThrow(
      `${PORT_BUSY} (NetworkError: Failed to open serial port.)`,
    );
    expect(log).toEqual(["port open"]);
  });

  it("closes a port this page still holds open and opens it once more", async () => {
    const log: string[] = [];
    const port = new FakePort("port", log);
    port.openErrors = [new DOMException("The port is already open.", "InvalidStateError")];
    const transport = await SerialTransport.open(port);
    expect(log).toEqual(["port open", "port close", "port open"]);
    await transport.close();
    expect(port.isOpen).toBe(false);
    await expect(transport.send("x")).rejects.toThrow(/closed/);
  });

  it("reports a port that is still open after the second try", async () => {
    const port = new FakePort("port", []);
    port.openErrors = [
      new DOMException("The port is already open.", "InvalidStateError"),
      new DOMException("The port is already open.", "InvalidStateError"),
    ];
    await expect(SerialTransport.open(port)).rejects.toThrow("InvalidStateError: The port is already open.");
  });

  it("closes a port that opened but cannot be used, so the browser does not keep it", async () => {
    const log: string[] = [];
    const port = new FakePort("port", log);
    port.noStreams = true;
    await expect(SerialTransport.open(port)).rejects.toThrow(PORT_BUSY);
    expect(log).toEqual(["port open", "port close"]);
    expect(port.isOpen).toBe(false);
  });
});

describe("a serial port in use", () => {
  it("delivers lines and sends them with a newline", async () => {
    const port = new FakePort("port", []);
    const transport = await SerialTransport.open(port);
    const lines: string[] = [];
    transport.onLine = (line) => lines.push(new TextDecoder().decode(line));
    port.receive("hel");
    port.receive("lo\r\nwor");
    port.receive("ld\n");
    await vi.waitFor(() => expect(lines).toEqual(["hello", "world"]));
    await transport.send("@PR x");
    expect(port.written).toEqual(["@PR x\n"]);
  });

  it("tells when the port ends", async () => {
    const port = new FakePort("port", []);
    const transport = await SerialTransport.open(port);
    let closed = false;
    transport.onClose = () => (closed = true);
    port.end();
    await vi.waitFor(() => expect(closed).toBe(true));
  });
});

describe("closing a serial port", () => {
  afterEach(() => vi.useRealTimers());

  it("closes the port even when a write never completes", async () => {
    vi.useFakeTimers();
    const port = new FakePort("port", []);
    const transport = await SerialTransport.open(port);
    port.writesHang = true;
    void transport.send("stuck").catch(() => undefined);
    const closed = transport.close();
    await vi.advanceTimersByTimeAsync(3 * CLOSE_STEP_MS);
    await closed;
    expect(port.isOpen).toBe(false);
  });

  it("closes once when it is called twice at the same time", async () => {
    const log: string[] = [];
    const port = new FakePort("port", log);
    const transport = await SerialTransport.open(port);
    const first = transport.close();
    const second = transport.close();
    expect(second).toBe(first);
    await first;
    expect(log.filter((entry) => entry === "port close")).toHaveLength(1);
  });

  it("gives up waiting for a pipe that never settles", async () => {
    vi.useFakeTimers();
    const log: string[] = [];
    const port = new FakePort("port", log);
    const transport = await SerialTransport.open(port);
    port.cancelHangs = true;
    let done = false;
    const closed = transport.close().then(() => (done = true));
    await vi.advanceTimersByTimeAsync(4 * CLOSE_STEP_MS);
    await closed;
    expect(done).toBe(true);
    expect(log).toContain("port close");
  });

  it("gives up waiting for a port that never closes, and opening it again waits for that close", async () => {
    vi.useFakeTimers();
    const log: string[] = [];
    const port = new FakePort("port", log);
    const transport = await SerialTransport.open(port);
    port.closeHangs = true;
    const closed = transport.close();
    await vi.advanceTimersByTimeAsync(4 * CLOSE_STEP_MS);
    await closed;
    expect(port.isOpen).toBe(true);

    // The port is still closing: open() finds it open, waits for the close under way and opens it then.
    port.closeHangs = false;
    const opening = SerialTransport.open(port);
    await vi.advanceTimersByTimeAsync(CLOSE_STEP_MS / 4);
    port.finishClose?.();
    const again = await opening;
    expect(log.filter((entry) => entry === "port close")).toHaveLength(1);
    expect(log.at(-1)).toBe("port open");
    await again.close();
  });

  it("reports a vanished device once and still releases the port", async () => {
    const port = new FakePort("port", []);
    const transport = await SerialTransport.open(port);
    const reasons: Array<string | undefined> = [];
    transport.onClose = (reason) => reasons.push(reason);
    port.vanish();
    await vi.waitFor(() => expect(reasons).toEqual(["the serial port closed"]));
    await transport.close();
    await transport.close();
    expect(port.isOpen).toBe(false);
    expect(reasons).toHaveLength(1);
  });
});

describe("the session with a serial port", () => {
  afterEach(async () => {
    vi.useRealTimers();
    await session.disconnect();
  });

  it("releases a port whose board never answers the handshake", async () => {
    vi.useFakeTimers();
    const log: string[] = [];
    const port = new FakePort("port", log);
    const connecting = session["connect"]("board", () => SerialTransport.open(port));
    await vi.advanceTimersByTimeAsync(5 * 2000 + 3 * CLOSE_STEP_MS);
    await connecting;
    expect(session.getSnapshot().state).toBe("disconnected");
    expect(session.getSnapshot().message).toBeTruthy();
    expect(port.isOpen).toBe(false);
  });

  it("closes the lost port before it opens the next one", async () => {
    const log: string[] = [];
    const first = new FakePort("first", log, new FakeBoard());
    await session["connect"]("board", () => SerialTransport.open(first));
    expect(session.getSnapshot().state).toBe("connected");

    first.vanish();
    await vi.waitFor(() => expect(session.getSnapshot().state).toBe("lost"));

    const second = new FakePort("second", log, new FakeBoard());
    await session["connect"]("board", () => SerialTransport.open(second));
    expect(session.getSnapshot().state).toBe("connected");
    expect(first.isOpen).toBe(false);
    expect(log.indexOf("first close")).toBeGreaterThanOrEqual(0);
    expect(log.indexOf("first close")).toBeLessThan(log.indexOf("second open"));
  });

  it("connects over a port already picked, trying again every second while it cannot be opened", async () => {
    vi.useFakeTimers();
    const log: string[] = [];
    const port = new FakePort("port", log, new FakeBoard());
    port.openErrors = [new DOMException("busy", "NetworkError"), new DOMException("busy", "NetworkError")];
    const connecting = session.connectPort(port);
    await vi.advanceTimersByTimeAsync(PORT_RETRY_EVERY_MS - 1);
    expect(session.getSnapshot().state).toBe("connecting");
    expect(log.filter((entry) => entry === "port open")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2 * PORT_RETRY_EVERY_MS);
    expect(await connecting).toBe(true);
    expect(session.getSnapshot()).toMatchObject({ state: "connected", via: "board", message: null });
    expect(log.filter((entry) => entry === "port open")).toHaveLength(3);
  });

  it("tries again when the link drops during the handshake, and connects", async () => {
    vi.useFakeTimers();
    const log: string[] = [];
    const port = new FakePort("port", log, new FakeBoard());
    port.vanishOnOpen = true;
    const connecting = session.connectPort(port);
    await vi.advanceTimersByTimeAsync(PORT_RETRY_EVERY_MS - 1);
    expect(session.getSnapshot()).toMatchObject({ state: "connecting", message: null });
    await vi.advanceTimersByTimeAsync(PORT_RETRY_EVERY_MS);
    expect(await connecting).toBe(true);
    expect(session.getSnapshot()).toMatchObject({ state: "connected", message: null });
    expect(log.filter((entry) => entry === "port open")).toHaveLength(2);
  });

  it("gives up after 20 seconds with the reason, stays connecting meanwhile, and leaves the port closed", async () => {
    vi.useFakeTimers();
    const port = new FakePort("port", []);
    const connecting = session.connectPort(port);
    await vi.advanceTimersByTimeAsync(PORT_RETRY_FOR_MS - 1);
    expect(session.getSnapshot()).toMatchObject({ state: "connecting", message: null });
    await vi.advanceTimersByTimeAsync(10 * 2000 + 10 * CLOSE_STEP_MS);
    expect(await connecting).toBe(false);
    expect(session.getSnapshot().state).toBe("disconnected");
    expect(session.getSnapshot().message).toBeTruthy();
    expect(port.isOpen).toBe(false);
  });

  it("does not wait for a refusal that waiting cannot clear", async () => {
    vi.useFakeTimers();
    const log: string[] = [];
    const board = new FakeBoard();
    board.protocol = 99;
    const port = new FakePort("port", log, board);
    const connecting = session.connectPort(port);
    await vi.advanceTimersByTimeAsync(0);
    expect(await connecting).toBe(false);
    expect(session.getSnapshot()).toMatchObject({ state: "disconnected", offerFirmware: true });
    expect(session.getSnapshot().message).toContain("protocol 99");
    await vi.advanceTimersByTimeAsync(PORT_RETRY_FOR_MS);
    expect(log.filter((entry) => entry === "port open")).toHaveLength(1);
    expect(port.isOpen).toBe(false);
  });

  it("stops trying when the user disconnects", async () => {
    vi.useFakeTimers();
    const log: string[] = [];
    const port = new FakePort("port", log);
    port.openErrors = Array.from({ length: 30 }, () => new DOMException("busy", "NetworkError"));
    const connecting = session.connectPort(port);
    await vi.advanceTimersByTimeAsync(PORT_RETRY_EVERY_MS * 2);
    await session.disconnect();
    const opened = log.length;
    await vi.advanceTimersByTimeAsync(PORT_RETRY_FOR_MS);
    expect(await connecting).toBe(false);
    expect(log).toHaveLength(opened);
  });
});
