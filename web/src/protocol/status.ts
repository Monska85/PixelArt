// SPDX-License-Identifier: GPL-3.0-or-later

// `status`: the board's WiFi, time, play and update state (docs/protocol/protocol-v1.md#status).

import type { PlayMode, PlayReason } from "../engine/schedule";
import type { BoardClient } from "./client";
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

const PLAY_REASONS: readonly string[] = ["user", "schedule", "fallback", "no_time", "no_schedule"];

/** What the board plays and why (`status.play`), on a firmware that knows schedules. */
export interface PlayStatus {
  mode: PlayMode;
  reason: PlayReason;
  /** The winning entry's 0-based index in the schedule, or null. */
  entry: number | null;
  /** The list the board plays. */
  playlists: string[];
  /** The playlist now playing or the next to start, or null when the board plays every animation. */
  playing: string | null;
}

export interface BoardStatus {
  wifi: WifiStatus;
  /** Whether the board knows the time. */
  timeKnown: boolean;
  /** Null for a firmware older than schedules, or a `play` this app cannot read. */
  play: PlayStatus | null;
  update: UpdateStatus;
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
  const { mode, reason, entry, playlists, playing } = value;
  if (mode !== "auto" && mode !== "playlists") return null;
  if (typeof reason !== "string" || !PLAY_REASONS.includes(reason)) return null;
  if (!Array.isArray(playlists) || !playlists.every((id) => typeof id === "string")) return null;
  return {
    mode,
    reason: reason as PlayReason,
    entry: typeof entry === "number" && Number.isSafeInteger(entry) && entry >= 0 ? entry : null,
    playlists: playlists as string[],
    playing: text(playing),
  };
}

export function parseStatus(reply: Body): BoardStatus {
  return {
    wifi: parseWifi(reply.wifi),
    timeKnown: isRecord(reply.time) && reply.time.known === true,
    play: parsePlay(reply.play),
    update: parseUpdate(reply.update),
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
