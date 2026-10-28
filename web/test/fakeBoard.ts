// SPDX-License-Identifier: GPL-3.0-or-later

// A scripted board for the protocol client tests: an in-memory implementation
// of the commands, with hooks to damage, drop or reorder what it says.

import { crc32Hex } from "../src/protocol/crc32";
import { decodeLine, type Body } from "../src/protocol/framing";
import { sha256Hex } from "../src/protocol/files";
import type { Transport } from "../src/protocol/transport";

const encoder = new TextEncoder();

export function replyLine(body: Body): Uint8Array {
  const payload = JSON.stringify(body);
  return encoder.encode(`@PR ${crc32Hex(encoder.encode(payload))} ${payload}`);
}

type Fault = "drop" | "bad_frame" | "corrupt" | undefined;
type Kind = "animation" | "playlist" | "schedule";

const ID = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const NTP_SERVER = /^[A-Za-z0-9.-]{1,64}$/;

export class FakeBoard implements Transport {
  onLine: ((line: Uint8Array) => void) | null = null;
  onClose: ((reason?: string) => void) | null = null;
  files: Record<Kind, Map<string, Uint8Array>> = { animation: new Map(), playlist: new Map(), schedule: new Map() };
  settings = { brightness: 100, playlist: "default" };
  /**
   * A firmware that knows schedules: `info` reports them, the `schedule` kind works, the settings have `play`,
   * `playlists`, `time_sync_hours` and `ntp_server` with the mapping for older clients, and `status` has `play`.
   * Off, the board is a firmware from before schedules.
   */
  schedules = false;
  /** `play` and `playlists` once a client set one of them; null: derived from `playlist`, as on an upgraded board. */
  storedPlay: { play: "auto" | "playlists"; playlists: string[] } | null = null;
  time = { time_sync_hours: 6, ntp_server: "pool.ntp.org" };
  /** The play state `status` reports; null derives one from the settings and the stored files. */
  statusPlay: Body | null = null;
  /** What `info` reports as storage. */
  storage = { total: 983040, used: 8192 };
  bootId = 111;
  chunk = 512;
  page = 8;
  protocol = 1;
  /** Every request line received, decoded, duplicates included. */
  requests: Body[] = [];
  /** Decides what happens to the reply of the n-th (0-based) request line received. */
  fault: (index: number, request: Body) => Fault = () => undefined;
  /** Runs before a command is executed; returns a reply to send instead. */
  override: (request: Body) => Body | undefined = () => undefined;
  /** Lines sent right after the reply to a request, for foreign or late replies. */
  extra: (request: Body) => Uint8Array[] = () => [];
  closed = false;
  private upload: { kind: Kind; id: string; size: number; sha256: string; data: number[] } | null = null;
  private last: { seq: number; crc: string; reply: Body } | null = null;

  get uploading(): boolean {
    return this.upload !== null;
  }

  reboot(): void {
    this.bootId += 1;
    this.upload = null;
    this.last = null;
  }

  async send(line: string): Promise<void> {
    const bytes = encoder.encode(line);
    expectAscii(line);
    const request = decodeLine(bytes);
    if (!request) throw new Error(`the client sent a bad line: ${line}`);
    const index = this.requests.length;
    this.requests.push(request);
    const fault = this.fault(index, request);
    if (fault === "drop") return;
    if (fault === "bad_frame") {
      this.onLine?.(replyLine({ ok: false, error: "bad_frame", message: "checksum does not match" }));
      return;
    }
    const crc = line.split(" ")[1] as string;
    let reply: Body;
    if (this.last && this.last.seq === request.seq && this.last.crc === crc) reply = this.last.reply;
    else {
      reply = await this.run(request);
      this.last = { seq: request.seq as number, crc, reply };
    }
    const out = replyLine(reply);
    if (fault === "corrupt") out[out.length - 2] = (out[out.length - 2] as number) ^ 1;
    this.onLine?.(out);
    for (const extra of this.extra(request)) this.onLine?.(extra);
  }

  async close(): Promise<void> {
    this.closed = true;
    this.onClose?.();
  }

  /** `play` and `playlists` as the board reads them: stored, or derived from `playlist`. */
  private play(): { play: "auto" | "playlists"; playlists: string[] } {
    if (this.storedPlay) return this.storedPlay;
    const { playlist } = this.settings;
    return { play: playlist === "default" ? "auto" : "playlists", playlists: [playlist] };
  }

  private reported(): Body {
    if (!this.schedules) return { ...this.settings };
    const { play, playlists } = this.play();
    return {
      brightness: this.settings.brightness,
      play,
      playlists: [...playlists],
      playlist: play === "auto" ? "default" : playlists[0],
      ...this.time,
    };
  }

  private setOld(r: Body): Body {
    if (typeof r.brightness === "number") this.settings.brightness = r.brightness;
    if (typeof r.playlist === "string") this.settings.playlist = r.playlist;
    return { seq: r.seq, ok: true, settings: { ...this.settings } };
  }

  // docs/protocol/protocol-v1.md#settings_get-settings_set: every field is checked first, bad_request before
  // invalid_id before not_found, then the agreement of `playlist` with `play` and `playlists`.
  private setWithPlay(r: Body): Body {
    const seq = r.seq;
    const { play, playlists, playlist, time_sync_hours: hours, ntp_server: server } = r;
    const hasPlay = "play" in r;
    const hasList = "playlists" in r;
    if (hasPlay && play !== "auto" && play !== "playlists") return this.fail(seq, "bad_request");
    if (
      hasList &&
      (!Array.isArray(playlists) ||
        playlists.length < 1 ||
        playlists.length > 8 ||
        !playlists.every((id) => typeof id === "string") ||
        new Set(playlists).size !== playlists.length)
    )
      return this.fail(seq, "bad_request");
    if ("playlist" in r && typeof playlist !== "string") return this.fail(seq, "bad_request");
    if ("time_sync_hours" in r && !(Number.isInteger(hours) && (hours as number) >= 1 && (hours as number) <= 168))
      return this.fail(seq, "bad_request");
    if ("ntp_server" in r && !(typeof server === "string" && NTP_SERVER.test(server)))
      return this.fail(seq, "bad_request");
    const ids = [...(hasList ? (playlists as string[]) : []), ...(typeof playlist === "string" ? [playlist] : [])];
    if (ids.some((id) => !ID.test(id))) return this.fail(seq, "invalid_id");
    if (ids.some((id) => !this.files.playlist.has(id))) return this.fail(seq, "not_found");
    let next = this.storedPlay;
    if (hasPlay || hasList) {
      const current = this.play();
      next = {
        play: hasPlay ? (play as "auto" | "playlists") : current.play,
        playlists: hasList ? [...(playlists as string[])] : current.playlists,
      };
      const agreed = next.play === "auto" ? "default" : next.playlists[0];
      if (typeof playlist === "string" && playlist !== agreed) return this.fail(seq, "bad_request");
    } else if (typeof playlist === "string" && this.storedPlay)
      next = { play: playlist === "default" ? "auto" : "playlists", playlists: [playlist] };
    if (typeof r.brightness === "number") this.settings.brightness = r.brightness;
    this.storedPlay = next;
    if (next) this.settings.playlist = next.play === "auto" ? "default" : (next.playlists[0] as string);
    else if (typeof playlist === "string") this.settings.playlist = playlist;
    if (typeof hours === "number") this.time.time_sync_hours = hours;
    if (typeof server === "string") this.time.ntp_server = server;
    return { seq, ok: true, settings: this.reported() };
  }

  /** A `status.play` that follows the settings: no time, and the fallback of a stored schedule `default`. */
  private playStatus(): Body {
    if (this.statusPlay) return this.statusPlay;
    const { play, playlists } = this.play();
    const playing = (list: string[]): string | null => list.find((id) => this.files.playlist.has(id)) ?? null;
    if (play === "playlists")
      return { mode: play, reason: "user", entry: null, playlists, playing: playing(playlists) };
    const stored = this.files.schedule.get("default");
    const fallback = stored ? (JSON.parse(new TextDecoder().decode(stored)) as { fallback?: string[] }).fallback : null;
    const list = fallback ?? ["default"];
    return {
      mode: play,
      reason: stored ? "no_time" : "no_schedule",
      entry: null,
      playlists: list,
      playing: playing(list),
    };
  }

  private fail(seq: unknown, error: string, message = error, more: Body = {}): Body {
    return { seq, ok: false, error, message, ...more };
  }

  private async run(r: Body): Promise<Body> {
    const seq = r.seq;
    const forced = this.override(r);
    if (forced) return { seq, ...forced };
    const kind = r.kind as Kind;
    if (kind === "schedule" && !this.schedules) return this.fail(seq, "invalid_kind");
    switch (r.cmd) {
      case "info":
        return {
          seq,
          ok: true,
          protocol: this.protocol,
          firmware: "1.2.0",
          board: "simulator",
          boot_id: this.bootId,
          formats: {
            animation: ["pixelart/1"],
            playlist: ["pixelart-playlist/1"],
            ...(this.schedules && { schedule: ["pixelart-schedule/1"] }),
          },
          canvas: { width: 16, height: 16 },
          storage: { ...this.storage },
          memory: { free: 0, largest: 0 },
          limits: {
            line: 1024,
            chunk: this.chunk,
            page: this.page,
            animation: 65536,
            playlist: 16384,
            ...(this.schedules && { schedule: 16384 }),
          },
        };
      case "list": {
        const ids = [...this.files[kind].keys()]
          .sort()
          .filter((id) => r.after === undefined || id > (r.after as string));
        const slice = ids.slice(0, this.page);
        const entries = await Promise.all(
          slice.map(async (id) => {
            const data = this.files[kind].get(id) as Uint8Array;
            return { id, size: data.length, sha256: await sha256Hex(data), name: id.toUpperCase() };
          }),
        );
        return { seq, ok: true, kind, entries, more: ids.length > slice.length };
      }
      case "get": {
        const data = this.files[kind].get(r.id as string);
        if (!data) return this.fail(seq, "not_found");
        const part = data.subarray(r.offset as number, (r.offset as number) + (r.length as number));
        return { seq, ok: true, size: data.length, offset: r.offset, data: Buffer.from(part).toString("base64") };
      }
      case "put_begin":
        this.upload = { kind, id: r.id as string, size: r.size as number, sha256: r.sha256 as string, data: [] };
        return { seq, ok: true };
      case "put_chunk": {
        if (!this.upload) return this.fail(seq, "no_upload");
        const have = this.upload.data.length;
        const offset = r.offset as number;
        if (offset > have) return this.fail(seq, "bad_offset", "bad_offset", { expected: have });
        if (offset < have) return { seq, ok: true, received: have };
        this.upload.data.push(...Buffer.from(r.data as string, "base64"));
        return { seq, ok: true, received: this.upload.data.length };
      }
      case "put_end": {
        const up = this.upload;
        if (!up) return this.fail(seq, "no_upload");
        this.upload = null;
        const data = Uint8Array.from(up.data);
        if (data.length !== up.size) return this.fail(seq, "size_mismatch");
        if ((await sha256Hex(data)) !== up.sha256) return this.fail(seq, "checksum_mismatch");
        if (new TextDecoder().decode(data).includes("INVALID"))
          return this.fail(seq, "invalid_file", "the file is not valid", {
            diagnostics: [
              { severity: "error", code: "unknown_color", where: "sprites.a.points[0]", message: "unknown color" },
            ],
          });
        this.files[up.kind].set(up.id, data);
        return {
          seq,
          ok: true,
          warnings: [{ severity: "warning", code: "unused_color", where: "palette.x", message: "never used" }],
        };
      }
      case "put_abort":
        this.upload = null;
        return { seq, ok: true };
      case "delete_all": {
        const removed = {
          ...(this.schedules && { schedules: this.files.schedule.size }),
          playlists: this.files.playlist.size,
          animations: this.files.animation.size,
        };
        this.upload = null;
        this.files.schedule.clear();
        this.files.playlist.clear();
        this.files.animation.clear();
        if (r.settings !== true) return { seq, ok: true, ...removed };
        this.settings = { brightness: 100, playlist: "default" };
        this.storedPlay = null;
        this.time = { time_sync_hours: 6, ntp_server: "pool.ntp.org" };
        return { seq, ok: true, ...removed, settings: this.reported() };
      }
      case "delete":
        return this.files[kind].delete(r.id as string) ? { seq, ok: true } : this.fail(seq, "not_found");
      case "settings_get":
        return { seq, ok: true, settings: this.reported() };
      case "settings_set":
        return this.schedules ? this.setWithPlay(r) : this.setOld(r);
      case "status":
        if (!this.schedules) return this.fail(seq, "unknown_command");
        return { seq, ok: true, wifi: { state: "connected" }, time: { known: false }, play: this.playStatus() };
      default:
        return this.fail(seq, "unknown_command");
    }
  }
}

function expectAscii(line: string): void {
  for (let i = 0; i < line.length; i++)
    if (line.charCodeAt(i) > 0x7e) throw new Error("a request line has a non-ASCII character");
}
