// Client of the command protocol, with the rules of tools/pixelart.py
// (docs/protocol/protocol-v1.md): one request in flight, a random first seq,
// retries with the same seq, an immediate resend on bad_frame.

import { decodeLine, encodeLine, type Body } from "./framing";
import type { Transport } from "./transport";

export const REQUEST_TIMEOUT_MS = 2000;
export const PUT_END_TIMEOUT_MS = 10_000;
export const TRIES = 5;
export const PROTOCOL_VERSION = 1;
const DEFAULT_CHUNK = 512;
const MAX_DIAGNOSTICS = 32;

export type Kind = "animation" | "playlist";

export interface WireDiagnostic {
  severity: string;
  code: string;
  where: string;
  message: string;
}

/** A failure the user should see. `code` is the board's error code, or one of the client's own. */
export class BoardError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly diagnostics: WireDiagnostic[] = [],
    readonly details: Body = {},
  ) {
    super(message);
    this.name = "BoardError";
  }
}

/** Client error codes: no reply after the tries, and a connection that ended. */
export const NO_REPLY = "no_reply";
export const CONNECTION_LOST = "connection_lost";

export type Reply = Body;

export interface BoardInfo {
  protocol: number;
  firmware: string;
  board: string;
  bootId: number | null;
  formats: { animation: string[]; playlist: string[] };
  storage: { total: number; used: number } | null;
  limits: { line: number; chunk: number; page: number; animation: number; playlist: number };
}

const isRecord = (value: unknown): value is Body =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const count = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((s): s is string => typeof s === "string") : [];
const text = (value: unknown): string => (typeof value === "string" ? value : "");

export function parseInfo(reply: Reply): BoardInfo {
  const formats = isRecord(reply.formats) ? reply.formats : {};
  const storage = isRecord(reply.storage) ? reply.storage : {};
  const limits = isRecord(reply.limits) ? reply.limits : {};
  const total = count(storage.total);
  const used = count(storage.used);
  return {
    protocol: typeof reply.protocol === "number" ? reply.protocol : -1,
    firmware: text(reply.firmware),
    board: text(reply.board),
    bootId: count(reply.boot_id),
    formats: { animation: strings(formats.animation), playlist: strings(formats.playlist) },
    storage: total !== null && used !== null ? { total, used } : null,
    limits: {
      line: count(limits.line) ?? 1024,
      chunk: count(limits.chunk) || DEFAULT_CHUNK,
      page: count(limits.page) ?? 8,
      animation: count(limits.animation) ?? 64 * 1024,
      playlist: count(limits.playlist) ?? 16 * 1024,
    },
  };
}

export function parseDiagnostics(value: unknown): WireDiagnostic[] {
  if (!Array.isArray(value)) return [];
  const out: WireDiagnostic[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || out.length >= MAX_DIAGNOSTICS) continue;
    out.push({
      severity: text(entry.severity),
      code: text(entry.code),
      where: text(entry.where),
      message: text(entry.message),
    });
  }
  return out;
}

export function errorFromReply(reply: Reply): BoardError {
  const code = text(reply.error) || "error";
  let message = text(reply.message);
  if (code === "bad_offset" && typeof reply.expected === "number") message += ` (expected offset ${reply.expected})`;
  return new BoardError(code, message, parseDiagnostics(reply.diagnostics), reply);
}

type Outcome = { kind: "reply"; reply: Reply } | { kind: "again" } | { kind: "timeout" } | { kind: "closed" };

interface Waiter {
  seq: number;
  resolve: (outcome: Outcome) => void;
}

export interface ClientOptions {
  /** First seq; default random. For tests. */
  firstSeq?: number;
  requestTimeoutMs?: number;
  putEndTimeoutMs?: number;
}

export class BoardClient {
  private seq: number;
  private waiter: Waiter | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  private readonly requestTimeoutMs: number;
  private readonly putEndTimeoutMs: number;
  /** Set after the handshake. */
  info: BoardInfo | null = null;
  /** Called when the client gave up on a request or the link ended. */
  onLost: ((reason: string) => void) | null = null;
  /** Called when `info` reports another boot_id than before: the board restarted. */
  onRestart: (() => void) | null = null;

  constructor(
    private readonly transport: Transport,
    options: ClientOptions = {},
  ) {
    // A fresh run never reuses a seq the board still remembers.
    this.seq = options.firstSeq ?? ((crypto.getRandomValues(new Uint32Array(1))[0] as number) % 2 ** 31) + 1;
    this.requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
    this.putEndTimeoutMs = options.putEndTimeoutMs ?? PUT_END_TIMEOUT_MS;
    transport.onLine = (line) => this.receive(line);
    transport.onClose = (reason) => this.linkClosed(reason ?? "the connection closed");
  }

  get putEndTimeout(): number {
    return this.putEndTimeoutMs;
  }

  get chunkSize(): number {
    return Math.min(this.info?.limits.chunk ?? DEFAULT_CHUNK, DEFAULT_CHUNK);
  }

  private receive(line: Uint8Array): void {
    const waiter = this.waiter;
    if (!waiter) return;
    const body = decodeLine(line);
    if (!body) return;
    if (body.error === "bad_frame" && !("seq" in body)) {
      waiter.resolve({ kind: "again" });
      return;
    }
    // A reply to another request, such as a late duplicate, is discarded.
    if (body.seq === waiter.seq) waiter.resolve({ kind: "reply", reply: body });
  }

  private linkClosed(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.waiter?.resolve({ kind: "closed" });
    this.onLost?.(reason);
  }

  /** Runs one request at a time, in the order called. */
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  // Registers the waiter before the line is sent: a fast board can answer before send() settles.
  private wait(seq: number, timeoutMs: number): { outcome: Promise<Outcome>; cancel: () => void } {
    let finish: (outcome: Outcome) => void = () => undefined;
    const outcome = new Promise<Outcome>((resolve) => {
      const timer = setTimeout(() => finish({ kind: "timeout" }), timeoutMs);
      finish = (result) => {
        clearTimeout(timer);
        if (this.waiter?.resolve === finish) this.waiter = null;
        resolve(result);
      };
      this.waiter = { seq, resolve: finish };
    });
    return { outcome, cancel: () => finish({ kind: "closed" }) };
  }

  /** Sends a request and returns the reply, whether it succeeded or not. Throws BoardError when no reply comes. */
  request(cmd: string, fields: Body = {}, timeoutMs: number = this.requestTimeoutMs): Promise<Reply> {
    return this.serial(async () => {
      if (this.closed) throw new BoardError(CONNECTION_LOST, "the connection is closed");
      this.seq = (this.seq + 1) % 2 ** 32;
      const seq = this.seq;
      const line = encodeLine({ seq, cmd, ...fields });
      for (let attempt = 0; attempt < TRIES; attempt++) {
        const waiting = this.wait(seq, timeoutMs);
        try {
          await this.transport.send(line);
        } catch {
          waiting.cancel();
          this.linkClosed("the connection failed");
          throw new BoardError(CONNECTION_LOST, "the connection failed");
        }
        const outcome = await waiting.outcome;
        if (outcome.kind === "reply") return outcome.reply;
        if (outcome.kind === "closed") throw new BoardError(CONNECTION_LOST, "the connection closed");
      }
      this.linkClosed(`no reply to '${cmd}' after ${TRIES} tries`);
      throw new BoardError(NO_REPLY, `no reply to '${cmd}' after ${TRIES} tries`);
    });
  }

  /** Like request(), but a failure reply throws a BoardError carrying the board's diagnostics. */
  async command(cmd: string, fields: Body = {}, timeoutMs?: number): Promise<Reply> {
    const reply = await this.request(cmd, fields, timeoutMs);
    if (reply.ok !== true) throw errorFromReply(reply);
    return reply;
  }

  /** The handshake: `info` first, with the protocol version check. Reads `info` again to watch boot_id. */
  async handshake(): Promise<BoardInfo> {
    const previous = this.info?.bootId ?? null;
    const reply = await this.command("info");
    const info = parseInfo(reply);
    if (info.protocol !== PROTOCOL_VERSION)
      throw new BoardError(
        "protocol_unsupported",
        `This board speaks protocol ${info.protocol}, which this web app does not know`,
      );
    this.info = info;
    if (previous !== null && info.bootId !== previous) this.onRestart?.();
    return info;
  }

  async close(): Promise<void> {
    this.closed = true;
    this.waiter?.resolve({ kind: "closed" });
    await this.transport.close();
  }
}
