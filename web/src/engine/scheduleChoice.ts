// SPDX-License-Identifier: GPL-3.0-or-later

import { MAX_SCHEDULE_PLAYLISTS, isValidId } from "./types";

/** `play`: Automatic (the server choice), or My choice as a list of playlists or as a schedule. */
export type PlayMode = "auto" | "playlists" | "schedule";
export const PLAY_REASONS = ["playlists", "schedule", "fallback", "no_time", "no_schedule"] as const;
export type PlayReason = (typeof PLAY_REASONS)[number];
export const PLAY_SOURCES = ["server", "playlists", "schedule", "fallback"] as const;
export type PlaySource = (typeof PLAY_SOURCES)[number];

/** What the release says Automatic plays: a schedule or a list of playlists. */
export type ServerChoice = { schedule: string } | { playlists: string[] };

/** The server choice in `value`, or null when it breaks the play file rules. */
export function parseServerChoice(value: unknown): ServerChoice | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== 1) return null;
  const { schedule, playlists } = value as { schedule?: unknown; playlists?: unknown };
  if (keys[0] === "schedule") return typeof schedule === "string" && isValidId(schedule) ? { schedule } : null;
  if (keys[0] !== "playlists" || !Array.isArray(playlists)) return null;
  const ok =
    playlists.length >= 1 &&
    playlists.length <= MAX_SCHEDULE_PLAYLISTS &&
    playlists.every((id) => typeof id === "string" && isValidId(id)) &&
    new Set(playlists).size === playlists.length;
  return ok ? { playlists: playlists as string[] } : null;
}

export const DEFAULT_PLAYLIST_ID = "default";
export const DEFAULT_SCHEDULE_ID = "default";
