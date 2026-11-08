// SPDX-License-Identifier: GPL-3.0-or-later

// `status`: the board's WiFi, time, play and update state (docs/protocol/protocol-v1.md#status).

import {
  PLAY_REASONS,
  PLAY_SOURCES,
  parseServerChoice,
  type PlayMode,
  type PlayReason,
  type PlaySource,
  type ServerChoice,
} from "../engine/scheduleChoice";
import { BoardError, type BoardClient } from "./client";
import type { Body } from "./framing";
import { isRecord } from "./guards";

export type WifiState =
  | "not_configured"
  | "connecting"
  | "connected"
  | "network_not_found"
  | "wrong_password"
  | "no_address"
  | "disconnected";

const WIFI_STATES: readonly string[] = [
  "not_configured",
  "connecting",
  "connected",
  "network_not_found",
  "wrong_password",
  "no_address",
  "disconnected",
];

export interface WifiStatus {
  /** A state this app does not know (a later firmware) reads as `disconnected`. */
  state: WifiState;
  ip: string | null;
  /** Signal strength in dBm, or null when not joined. */
  rssi: number | null;
  /** The transmit power in use, in dBm as text ("19.5"). */
  power: string | null;
  powerReduced: boolean;
  hostname: string | null;
  /** The name of the stored network, or null when none is stored (or a firmware that does not send it). */
  ssid: string | null;
}

export type UpdateState = "idle" | "checking" | "downloading" | "installing" | "waiting_for_time";

const UPDATE_STATES: readonly string[] = ["idle", "checking", "downloading", "installing", "waiting_for_time"];

/** What the board says about its updates (docs/protocol/protocol-v1.md#status). */
export interface UpdateStatus {
  /** A state this app does not know (a later firmware) reads as `idle`. */
  state: UpdateState;
  /** From 0 to 100 while downloading or installing. */
  progress: number;
  /** Seconds since the last check ended, or null when none ended since the board started. */
  lastCheck: number | null;
  /** `ok`, or the update error of the last check or installation; null before the first one. */
  lastResult: string | null;
  /** `no_release` when the last check failed because a manifest answered 404; null otherwise. */
  lastDetail: string | null;
  failedFiles: number;
  /** The firmware version available, or null. */
  firmware: string | null;
  /** How many animations, playlists and schedules would be added or replaced. */
  files: number;
  lastInstall: { result: string; from: string; to: string } | null;
}

const isPlayReason = (value: unknown): value is PlayReason =>
  typeof value === "string" && (PLAY_REASONS as readonly string[]).includes(value);

const isPlaySource = (value: unknown): value is PlaySource =>
  typeof value === "string" && (PLAY_SOURCES as readonly string[]).includes(value);

/** What the board plays and why (`status.play`), on a firmware that knows schedules. */
export interface PlayStatus {
  mode: PlayMode;
  /** Where the list comes from: the server choice, My choice, or the board's own rule. */
  source: PlaySource;
  /** The ID of the schedule the list comes from, or null. */
  schedule: string | null;
  /** The stored format selected by new firmware; null for no schedule or older firmware. */
  scheduleFormat?: 1 | 2 | null;
  reason: PlayReason;
  /** The winning entry's 0-based index in the schedule, or null. */
  entry: number | null;
  /** The list the board plays. */
  playlists: string[];
  /** The playlist now playing or the next to start, or null when the board plays every animation. */
  playing: string | null;
  /** What the release says Automatic plays, in every mode; null when there is none. */
  serverChoice: ServerChoice | null;
}

/** The reason names of `status.power.resets` (docs/protocol/protocol-v1.md#status). */
const POWER_RESET_REASONS = ["brownout", "power_on", "software", "panic", "watchdog", "deep_sleep", "other"] as const;
export type PowerResetReason = (typeof POWER_RESET_REASONS)[number];

/** What the board says about its brownout power protection (`status.power`), on a firmware that has it. */
export interface PowerStatus {
  /** The brownouts among the last reset reasons the board keeps. */
  brownouts: number;
  limitActive: boolean;
  /** The current limit in mA, or null when the limit is off. */
  limitMa: number | null;
  atFloor: boolean;
  /** The power scale, in percent, of the animation playing now: 100 when it is not dimmed. */
  scale: number;
  /** `lastBrownout` and `resets` are validated as the protocol's client rules require, not shown yet. */
  lastBrownout: { animation: string | null; frame: number | null; date: string | null } | null;
  /** The last reset reasons, oldest first; a name this app does not know reads as `other`. */
  resets: PowerResetReason[];
}

export interface BoardStatus {
  wifi: WifiStatus;
  /** Whether the board knows the time. */
  timeKnown: boolean;
  /** Null for a firmware older than schedules, or a `play` this app cannot read. */
  play: PlayStatus | null;
  update: UpdateStatus;
  /** Null for a firmware without power protection, or a `power` this app cannot read. */
  power: PowerStatus | null;
}

/** Whether a check or an installation is running: the app asks for the status more often meanwhile. */
export const isUpdateRunning = (update: UpdateStatus): boolean =>
  update.state === "checking" || update.state === "downloading" || update.state === "installing";

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);

function parseWifi(value: unknown): WifiStatus {
  const wifi = isRecord(value) ? value : {};
  const state = typeof wifi.state === "string" && WIFI_STATES.includes(wifi.state) ? wifi.state : "disconnected";
  return {
    state: state as WifiState,
    ip: text(wifi.ip),
    rssi: typeof wifi.rssi === "number" && Number.isFinite(wifi.rssi) ? wifi.rssi : null,
    power: text(wifi.power),
    powerReduced: wifi.power_reduced === true,
    hostname: text(wifi.hostname),
    ssid: text(wifi.ssid),
  };
}

const count = (value: unknown): number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;

function parseLastInstall(value: unknown): UpdateStatus["lastInstall"] {
  if (!isRecord(value)) return null;
  const result = text(value.result);
  const from = text(value.from);
  const to = text(value.to);
  return result !== null && from !== null && to !== null ? { result, from, to } : null;
}

function parseUpdate(value: unknown): UpdateStatus {
  const update = isRecord(value) ? value : {};
  const state = typeof update.state === "string" && UPDATE_STATES.includes(update.state) ? update.state : "idle";
  return {
    state: state as UpdateState,
    progress: Math.min(100, count(update.progress)),
    lastCheck:
      typeof update.last_check === "number" && Number.isSafeInteger(update.last_check) && update.last_check >= 0
        ? update.last_check
        : null,
    lastResult: text(update.last_result),
    lastDetail: text(update.last_detail),
    failedFiles: count(update.failed_files),
    firmware: text(update.firmware),
    files: count(update.files),
    lastInstall: parseLastInstall(update.last_install),
  };
}

function parsePlay(value: unknown): PlayStatus | null {
  if (!isRecord(value)) return null;
  const { mode, source, schedule, reason, entry, playlists, playing } = value;
  if (mode !== "auto" && mode !== "playlists" && mode !== "schedule") return null;
  if (!isPlaySource(source) || !isPlayReason(reason)) return null;
  if (!Array.isArray(playlists) || !playlists.every((id) => typeof id === "string")) return null;
  return {
    mode,
    source,
    schedule: text(schedule),
    ...("schedule_format" in value
      ? { scheduleFormat: value.schedule_format === 1 || value.schedule_format === 2 ? value.schedule_format : null }
      : {}),
    reason,
    entry: typeof entry === "number" && Number.isSafeInteger(entry) && entry >= 0 ? entry : null,
    playlists: playlists as string[],
    playing: text(playing),
    serverChoice: parseServerChoice(value.server_choice),
  };
}

/** The lowest limit the board sets, in mA. */
const POWER_FLOOR_MA = 300;

/** How many reset reasons the board keeps, and so the most brownouts and resets it reports. */
const POWER_HISTORY_MAX = 10;

const isIntegerIn = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;

/** A real calendar date written `YYYY-MM-DD`. */
function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number) as [number, number, number];
  // setUTCFullYear, unlike the Date constructor, keeps years below 100 as written; an impossible day rolls over.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** `undefined` for a value the table does not allow, so that it can be told from the `null` of no brownout. */
function parseLastBrownout(value: unknown): PowerStatus["lastBrownout"] | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const { animation, frame, date } = value;
  if (animation !== null && typeof animation !== "string") return undefined;
  if (frame !== null && !isIntegerIn(frame, 0, Number.MAX_SAFE_INTEGER)) return undefined;
  if ((animation === null) !== (frame === null)) return undefined;
  if (date !== null && (typeof date !== "string" || !isCalendarDate(date))) return undefined;
  return { animation, frame, date };
}

const isResetReason = (value: string): value is PowerResetReason =>
  (POWER_RESET_REASONS as readonly string[]).includes(value);

const isStringArray = (value: unknown[]): value is string[] => value.every((item) => typeof item === "string");

/**
 * `status.power`, read by the client rules of docs/protocol/protocol-v1.md#status: a known field that is missing or
 * outside its table makes the whole object absent (null); a reset reason it does not know reads as `other`.
 */
export function parsePower(value: unknown): PowerStatus | null {
  if (!isRecord(value)) return null;
  const { brownouts, limit_active, limit_ma, at_floor, scale, resets } = value;
  if (
    !isIntegerIn(brownouts, 0, POWER_HISTORY_MAX) ||
    typeof limit_active !== "boolean" ||
    typeof at_floor !== "boolean"
  )
    return null;
  if (!isIntegerIn(scale, 1, 100)) return null;
  // limit_ma is a number of at least the floor while the limit is on, null while it is off.
  if (limit_active && !isIntegerIn(limit_ma, POWER_FLOOR_MA, Number.MAX_SAFE_INTEGER)) return null;
  if (!limit_active && limit_ma !== null) return null;
  // at_floor is true exactly when the limit is on at the floor.
  if (at_floor !== (limit_active && limit_ma === POWER_FLOOR_MA)) return null;
  const limitMa = typeof limit_ma === "number" ? limit_ma : null;
  const lastBrownout = parseLastBrownout(value.last_brownout);
  if (lastBrownout === undefined) return null;
  if (!Array.isArray(resets) || resets.length > POWER_HISTORY_MAX || !isStringArray(resets)) return null;
  return {
    brownouts,
    limitActive: limit_active,
    limitMa,
    atFloor: at_floor,
    scale,
    lastBrownout,
    resets: resets.map((reason) => (isResetReason(reason) ? reason : "other")),
  };
}

export function parseStatus(reply: Body): BoardStatus {
  return {
    wifi: parseWifi(reply.wifi),
    timeKnown: isRecord(reply.time) && reply.time.known === true,
    play: parsePlay(reply.play),
    update: parseUpdate(reply.update),
    power: parsePower(reply.power),
  };
}

/** Reads the status. A firmware without the command answers `unknown_command`, which the caller reads as "no WiFi". */
export async function getStatus(client: BoardClient): Promise<BoardStatus> {
  return parseStatus(await client.command("status"));
}

export async function forgetWifi(client: BoardClient): Promise<void> {
  await client.command("wifi_forget");
}

/** `update_check`: starts a check at once, in the background. The status follows it. */
export async function checkForUpdates(client: BoardClient): Promise<void> {
  await client.command("update_check");
}

/** `update_install`: installs what the last check found, ignoring the install window. `force` is for a firmware version the board skipped. */
export async function installUpdate(
  client: BoardClient,
  target: "firmware" | "animations",
  force = false,
): Promise<void> {
  await client.command("update_install", target === "firmware" && force ? { target, force: true } : { target });
}

const isCleared = (power: PowerStatus): boolean =>
  power.brownouts === 0 &&
  !power.limitActive &&
  power.scale === 100 &&
  power.lastBrownout === null &&
  power.resets.length === 0;

/**
 * `power_reset`: the board forgets its past restarts and lifts the limit. Resolves with the cleared power object. An
 * unreadable object, or one that is not cleared, throws `protocol`; `unknown_command` (a board without power
 * protection) propagates.
 */
export async function powerReset(client: BoardClient): Promise<PowerStatus> {
  const power = parsePower((await client.command("power_reset")).power);
  if (power === null) throw new BoardError("protocol", "the board sent an unreadable power state for power_reset");
  if (!isCleared(power))
    throw new BoardError("protocol", "the board sent a power state that is not cleared for power_reset");
  return power;
}
