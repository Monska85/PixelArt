// SPDX-License-Identifier: GPL-3.0-or-later

// Client of the command protocol, with the rules of tools/pixelart.py
// (docs/protocol/protocol-v1.md): one request in flight, a random first seq,
// retries with the same seq, an immediate resend on bad_frame.

import { FILE_LIMITS, MAX_DIAGNOSTICS } from "../engine/types";
import { NONCE_PATTERN, loginHmac, type Login } from "./auth";
import { decodeLine, encodeLine, type Body } from "./framing";
import { isCount, isRecord } from "./guards";
import type { Transport } from "./transport";

const REQUEST_TIMEOUT_MS = 2000;
export const PUT_END_TIMEOUT_MS = 10_000;
export const TRIES = 5;
const PROTOCOL_VERSION = 1;
const DEFAULT_CHUNK = 512;

export type Kind = "animation" | "playlist" | "schedule" | "schedule_v2" | "play";

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

export interface BoardInfo {
  protocol: number;
  firmware: string;
  board: string;
  bootId: number | null;
  /**
   * `schedule` is null on a firmware older than schedules, which knows no schedule, `play` or time settings; `play`
   * is null on one older than the play file.
   */
  formats: {
    animation: string[];
    playlist: string[];
    schedule: string[] | null;
    schedule_v2?: string[] | null;
    play: string[] | null;
  };
  storage: { total: number; used: number } | null;
  limits: {
    line: number;
    chunk: number;
    page: number;
    animation: number;
    playlist: number;
    schedule: number;
    schedule_v2?: number;
    play: number;
  };
}

/** Whether the board knows schedules, the `play`, `playlists`, `time_sync_hours` and `ntp_server` settings and `status.play`. */
export const supportsSchedules = (info: BoardInfo | null | undefined): boolean =>
  (info?.formats.schedule ?? null) !== null;
export const supportsScheduleV2 = (info: BoardInfo | null | undefined): boolean =>
  (info?.formats.schedule_v2 ?? null) !== null;

/** Whether the board stores the play file, the server choice of Automatic (`play` kind, `status.play.server_choice`). */
export const supportsPlayFile = (info: BoardInfo | null | undefined): boolean => (info?.formats.play ?? null) !== null;

const count = (value: unknown): number | null => (isCount(value) ? value : null);
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((s): s is string => typeof s === "string") : [];
const text = (value: unknown): string => (typeof value === "string" ? value : "");

function parseInfo(reply: Body): BoardInfo {
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
    formats: {
      animation: strings(formats.animation),
      playlist: strings(formats.playlist),
      schedule: Array.isArray(formats.schedule) ? strings(formats.schedule) : null,
      schedule_v2: Array.isArray(formats.schedule_v2) ? strings(formats.schedule_v2) : null,
      play: Array.isArray(formats.play) ? strings(formats.play) : null,
    },
    storage: total !== null && used !== null ? { total, used } : null,
    limits: {
      line: count(limits.line) ?? 1024,
      chunk: count(limits.chunk) || DEFAULT_CHUNK,
      page: count(limits.page) ?? 8,
      animation: count(limits.animation) ?? FILE_LIMITS.animation,
      playlist: count(limits.playlist) ?? FILE_LIMITS.playlist,
      schedule: count(limits.schedule) ?? FILE_LIMITS.schedule,
      schedule_v2: count(limits.schedule_v2) ?? FILE_LIMITS.schedule_v2,
      play: count(limits.play) ?? FILE_LIMITS.play,
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

export function errorFromReply(reply: Body): BoardError {
  const code = text(reply.error) || "error";
  let message = text(reply.message);
  if (code === "bad_offset" && typeof reply.expected === "number") message += ` (expected offset ${reply.expected})`;
  return new BoardError(code, message, parseDiagnostics(reply.diagnostics), reply);
}

type Outcome = { kind: "reply"; reply: Body } | { kind: "again" } | { kind: "timeout" } | { kind: "closed" };

interface Waiter {
  seq: number;
  resolve: (outcome: Outcome) => void;
}

interface ClientOptions {
  /** First seq; default random. For tests. */
  firstSeq?: number;
}

/**
 * The write of one request's line, at most one in flight: a board that never reads its input leaves the write pending,
 * and the tries go on waiting for a reply, so a request never outlasts its tries because of it.
 */
class RequestWrite {
  private failedWrite = false;
  private pending: Promise<void> | null = null;
  private ended = false;
  private waiting: { cancel: () => void } | null = null;

  constructor(private readonly send: () => Promise<void>) {}

  /** The send failed while the request was still running. */
  get failed(): boolean {
    return this.failedWrite;
  }

  /** Writes the line unless a write is still pending. A failure ends `waiting`, the wait of the current try. */
  ensureSent(waiting: { cancel: () => void }): void {
    this.waiting = waiting;
    if (this.pending) return;
    // The wrapper turns a synchronous throw of send() into a rejection.
    const sent = (async () => this.send())();
    this.pending = sent;
    // Handled here, so a write that fails after the request ended is not an unhandled rejection.
    void sent.then(
      () => {
        if (this.pending === sent) this.pending = null;
      },
      () => {
        if (this.ended) return;
        this.failedWrite = true;
        this.waiting?.cancel();
      },
    );
  }

  /** The write counts as done, so the next try writes again. */
  forget(): void {
    this.pending = null;
  }

  /** The request ended: a later failure of the write is ignored. */
  end(): void {
    this.ended = true;
  }
}

export class BoardClient {
  private seq: number;
  private waiter: Waiter | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  /** Set after the handshake. */
  info: BoardInfo | null = null;
  /** Called when the client gave up on a request or the link ended. */
  onLost: ((reason: string) => void) | null = null;
  /** Called when `info` reports another boot_id than before: the board restarted. */
  onRestart: (() => void) | null = null;
  /** Set on a connection over WiFi: how to log in when the board answers `unauthorized`. */
  login: Login | null = null;

  constructor(
    private readonly transport: Transport,
    options: ClientOptions = {},
  ) {
    // A fresh run never reuses a seq the board still remembers.
    this.seq = options.firstSeq ?? ((crypto.getRandomValues(new Uint32Array(1))[0] as number) % 2 ** 31) + 1;
    transport.onLine = (line) => this.receive(line);
    transport.onClose = (reason) => this.linkClosed(reason ?? "the connection closed");
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

  /**
   * Sends a request and returns the reply, whether it succeeded or not. Throws BoardError when no reply comes. A board
   * that answers `unauthorized` is logged in to once, then the request goes again.
   */
  request(cmd: string, fields: Body = {}, timeoutMs: number = REQUEST_TIMEOUT_MS): Promise<Body> {
    return this.serial(async () => {
      const reply = await this.exchange(cmd, fields, timeoutMs);
      if (reply.error !== "unauthorized" || !this.login || cmd === "auth_challenge" || cmd === "auth") return reply;
      await this.logIn(this.login);
      return this.exchange(cmd, fields, timeoutMs);
    });
  }

  /** One request with its retries: the part of request() that talks to the board. */
  private async exchange(cmd: string, fields: Body, timeoutMs: number): Promise<Body> {
    if (this.closed) throw new BoardError(CONNECTION_LOST, "the connection is closed");
    this.seq = (this.seq + 1) % 2 ** 32;
    const seq = this.seq;
    const line = encodeLine({ seq, cmd, ...fields });
    const write = new RequestWrite(() => this.transport.send(line));
    try {
      for (let attempt = 0; attempt < TRIES; attempt++) {
        const waiting = this.wait(seq, timeoutMs);
        write.ensureSent(waiting);
        const outcome = await waiting.outcome;
        if (outcome.kind === "reply") return outcome.reply;
        // The board read the line, so the write is done whatever its promise says: the resend writes again.
        if (outcome.kind === "again") write.forget();
        if (outcome.kind === "closed") {
          // The wait ended because the send failed, or because the link closed (or the client was closed).
          if (write.failed) {
            this.linkClosed("the connection failed");
            throw new BoardError(CONNECTION_LOST, "the connection failed");
          }
          throw new BoardError(CONNECTION_LOST, "the connection closed");
        }
      }
    } finally {
      write.end();
    }
    this.linkClosed(`no reply to '${cmd}' after ${TRIES} tries`);
    throw new BoardError(NO_REPLY, `no reply to '${cmd}' after ${TRIES} tries`);
  }

  /** Answers the board's challenge with an HMAC of the nonce under the token. Never sends the token. */
  private async logIn(login: Login): Promise<void> {
    const token = await login.getToken();
    if (token === null) throw new BoardError("unauthorized", "The board asks for a login, and none was given");
    const challenge = await this.exchange("auth_challenge", {}, REQUEST_TIMEOUT_MS);
    if (challenge.ok !== true) throw errorFromReply(challenge);
    if (typeof challenge.nonce !== "string" || !NONCE_PATTERN.test(challenge.nonce))
      throw new BoardError("protocol", "the board sent an invalid login challenge");
    const answer = await this.exchange("auth", { hmac: await loginHmac(token, challenge.nonce) }, REQUEST_TIMEOUT_MS);
    if (answer.ok !== true) {
      const failure = errorFromReply(answer);
      if (failure.code === "unauthorized") login.refused();
      throw failure;
    }
  }

  /** Like request(), but a failure reply throws a BoardError carrying the board's diagnostics. */
  async command(cmd: string, fields: Body = {}, timeoutMs?: number): Promise<Body> {
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
