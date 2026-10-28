// SPDX-License-Identifier: GPL-3.0-or-later

// The texts and rules of What to play and the time settings (docs/web/web-app-v1.md#settings), kept out of the
// components so they can be tested.

import type { LocalDate, Schedule, ScheduleEnd, ScheduleEntry } from "../../engine";
import { MAX_SCHEDULE_PLAYLISTS } from "../../engine";
import type { PlayStatus } from "../../protocol";
import { parseHours } from "./hours";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const monthName = (month: number): string => MONTHS[month - 1] ?? String(month);

/** "December 1, 2026". */
export const formatDate = (date: LocalDate): string => `${monthName(date.month)} ${date.day}, ${date.year}`;

/** One end of an entry in words: "December 1", "November 2026", "day 28", "2027". */
export function describeEnd(end: ScheduleEnd): string {
  const { year, month, day } = end;
  if (month !== undefined && day !== undefined)
    return year !== undefined ? formatDate({ year, month, day }) : `${monthName(month)} ${day}`;
  if (month !== undefined) return year !== undefined ? `${monthName(month)} ${year}` : monthName(month);
  if (day !== undefined) return `day ${day}`;
  return String(year);
}

/** What an entry is called: its name, else its place in the file. */
export const entryLabel = (entry: ScheduleEntry | undefined, index: number): string =>
  entry?.name ?? `entry ${index + 1}`;

/** "default", "halloween and christmas", "a, b and c". */
export function playlistList(ids: readonly string[]): string {
  if (ids.length <= 1) return ids[0] ?? "";
  return `${ids.slice(0, -1).join(", ")} and ${ids.at(-1)}`;
}

/** What the board says it plays now, in Automatic, from `status.play`. */
export function describePlay(play: PlayStatus, schedule: Schedule | null): string {
  const list = playlistList(play.playlists);
  const entry = play.entry === null ? null : entryLabel(schedule?.entries[play.entry], play.entry);
  let text: string;
  switch (play.reason) {
    case "schedule":
      text = `${entry ?? "An entry of the schedule"} is on: the board plays ${list}.`;
      break;
    case "fallback":
      text =
        entry !== null
          ? `${entry} is on, but none of its playlists can play: the board plays the fallback, ${list}.`
          : `No entry of the schedule is on today: the board plays the fallback, ${list}.`;
      break;
    case "no_time":
      text = `The board does not know the date yet: it plays the fallback, ${list}.`;
      break;
    case "no_schedule":
      text = `The board stores no valid schedule default: it plays the playlist ${list}.`;
      break;
    default:
      text = `The board plays ${list}.`;
  }
  return play.playing === null ? `${text} None of them can play, so it plays every animation.` : text;
}

/**
 * What plays today by the stored schedule, for when the board does not say: `todayEntry` is the entry that wins
 * today, or -1 for the fallback.
 */
export function describeToday(schedule: Schedule, todayEntry: number): string {
  const entry = todayEntry >= 0 ? schedule.entries[todayEntry] : undefined;
  const who = entry ? entryLabel(entry, todayEntry) : "The fallback";
  return `${who} plays today: ${playlistList(entry ? entry.playlists : schedule.fallback)}.`;
}

/** The rule of a time server: a host name or an IPv4 address (docs/protocol/protocol-v1.md#settings_get-settings_set). */
const NTP_SERVER = /^[A-Za-z0-9.-]{1,64}$/;

export const MIN_SYNC_HOURS = 1;
export const MAX_SYNC_HOURS = 168;

/** The hours between time syncs as the board takes them: a whole number from 1 to 168. Null when the text is not one. */
export function parseSyncHours(text: string): number | null {
  return parseHours(text, MIN_SYNC_HOURS, MAX_SYNC_HOURS);
}

/** Why a time server cannot be sent, or null when it can. */
export function ntpServerProblem(text: string): string | null {
  return NTP_SERVER.test(text)
    ? null
    : "A host name or IPv4 address of 1 to 64 characters: letters, digits, dots and hyphens.";
}

/**
 * The list to send after a change of My playlists. The board accepts only stored playlists, so the ones it lacks are
 * left out; null when nothing would be left, or more than the board takes.
 */
export function listToSend(next: readonly string[], stored: ReadonlySet<string>): string[] | null {
  const kept = next.filter((id) => stored.has(id));
  return kept.length === 0 || kept.length > MAX_SCHEDULE_PLAYLISTS ? null : kept;
}

const READING_PLAYLISTS = "Reading the playlists on the board.";

/**
 * Why My playlists cannot be reordered, or "" when it can. `stored` is null while the board's playlists are not known.
 * The board takes only stored playlists: with one it lacks in the list, a change leaves that one out.
 */
export function editReason(order: readonly string[], stored: ReadonlySet<string> | null): string {
  if (stored === null) return READING_PLAYLISTS;
  return listToSend(order, stored) === null
    ? "Add a stored playlist first: the board takes only playlists it stores."
    : "";
}

/** Why `id` cannot be removed from My playlists, or "" when it can. */
export function removeReason(order: readonly string[], id: string, stored: ReadonlySet<string> | null): string {
  if (order.length === 1) return "The list keeps at least one playlist.";
  if (stored === null) return READING_PLAYLISTS;
  return listToSend(
    order.filter((other) => other !== id),
    stored,
  ) === null
    ? "The list keeps at least one stored playlist."
    : "";
}

/** Why no playlist can be added to My playlists, or "" when one can. */
export function addReason(order: readonly string[], stored: ReadonlySet<string> | null): string {
  if (stored === null) return READING_PLAYLISTS;
  if (order.length >= MAX_SCHEDULE_PLAYLISTS) return `The list holds at most ${MAX_SCHEDULE_PLAYLISTS} playlists.`;
  if ([...stored].every((id) => order.includes(id))) return "Every stored playlist is in the list.";
  return "";
}
