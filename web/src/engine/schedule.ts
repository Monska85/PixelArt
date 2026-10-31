// SPDX-License-Identifier: GPL-3.0-or-later

// Port of lib/PixelEngine/src/schedule.cpp: the pixelart-schedule/1 loader (docs/format/schedule-v1.md), the winner
// rules and the choice of the playlists the board plays (docs/format/playlist-v1.md#how-the-board-chooses-what-to-play).

import {
  SCHEDULE_JSON_DEPTH,
  codePointLength,
  isArray,
  isInteger,
  isObject,
  parseStrictJson,
  type JsonValue,
} from "./json";
import {
  MAX_DIAGNOSTICS,
  MAX_SCHEDULE_ENTRIES,
  MAX_SCHEDULE_FILE_SIZE,
  MAX_SCHEDULE_PLAYLISTS,
  MAX_SCHEDULE_YEAR,
  MIN_SCHEDULE_YEAR,
  isValidId,
  type Diagnostic,
} from "./types";
import {
  DEFAULT_PLAYLIST_ID,
  DEFAULT_SCHEDULE_ID,
  type PlayMode,
  type PlayReason,
  type PlaySource,
  type ServerChoice,
} from "./scheduleChoice";
export {
  DEFAULT_PLAYLIST_ID,
  DEFAULT_SCHEDULE_ID,
  PLAY_REASONS,
  PLAY_SOURCES,
  parseServerChoice,
} from "./scheduleChoice";
export type { PlayMode, PlayReason, PlaySource, ServerChoice } from "./scheduleChoice";

/** A local date of the Gregorian calendar. */
export interface LocalDate {
  year: number;
  /** 1 to 12. */
  month: number;
  /** 1 to 31. */
  day: number;
}

/** One end of an entry: the parts that are present. */
export interface ScheduleEnd {
  year?: number;
  month?: number;
  day?: number;
}

export interface ScheduleEntry {
  name: string | null;
  from: ScheduleEnd;
  to: ScheduleEnd;
  playlists: string[];
  hours?: { from: string; to: string; playlists: string[] }[];
}

export interface Schedule {
  format?: "pixelart-schedule/1" | "pixelart-schedule/2";
  name: string | null;
  fallback: string[];
  entries: ScheduleEntry[];
}

export interface ScheduleResult {
  /** The schedule, or null when the file has errors. */
  schedule: Schedule | null;
  diagnostics: Diagnostic[];
}

const PART_YEAR = 1;
const PART_MONTH = 2;
const PART_DAY = 4;
const YEAR_MONTH_DAY = PART_YEAR | PART_MONTH | PART_DAY;
const MONTH_DAY = PART_MONTH | PART_DAY;
const YEAR_MONTH = PART_YEAR | PART_MONTH;
const PARTS = [
  [PART_YEAR, "year"],
  [PART_MONTH, "month"],
  [PART_DAY, "day"],
] as const;
const MAX_NAME = 128;
// Days before each month in a common year.
const DAYS_BEFORE = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334] as const;
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

const isLeap = (year: number): boolean => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

const daysInMonth = (year: number, month: number): number =>
  month === 2 && isLeap(year) ? 29 : (MONTH_DAYS[month - 1] as number);

// Days since 1970-01-01 of a real date (Howard Hinnant's days_from_civil).
function daysFromCivil(year: number, month: number, day: number): number {
  const y = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

// The day number `n(month, day)` of docs/format/schedule-v1.md#lengths: February 29 is March 1's.
const commonDay = (month: number, day: number): number => (DAYS_BEFORE[month - 1] as number) + day;

const partsOf = (end: ScheduleEnd): number =>
  (end.year !== undefined ? PART_YEAR : 0) |
  (end.month !== undefined ? PART_MONTH : 0) |
  (end.day !== undefined ? PART_DAY : 0);

// Rank of a part set by rules 1 and 2 of the winner: lower wins.
function rank(parts: number): number {
  switch (parts) {
    case YEAR_MONTH_DAY:
      return 0;
    case MONTH_DAY:
      return 1;
    case YEAR_MONTH:
      return 2;
    case PART_DAY:
      return 3;
    case PART_MONTH:
      return 4;
    default:
      return 5; // PART_YEAR
  }
}

// Whether `value` is in [from, to], or, for a range that crosses the end of its cycle, in [from, end] or [start, to].
const inCycle = (value: number, from: number, to: number): boolean =>
  from <= to ? from <= value && value <= to : value >= from || value <= to;

/** True for a real date with a year from 2000 to 2999. */
export function isScheduleDate(date: LocalDate): boolean {
  return (
    Number.isInteger(date.year) &&
    Number.isInteger(date.month) &&
    Number.isInteger(date.day) &&
    date.year >= MIN_SCHEDULE_YEAR &&
    date.year <= MAX_SCHEDULE_YEAR &&
    date.month >= 1 &&
    date.month <= 12 &&
    date.day >= 1 &&
    date.day <= daysInMonth(date.year, date.month)
  );
}

// Reports an error of the loader.
type ErrorSink = (code: string, where: string, message: string) => void;

// A property that is present with the value null is not absent: it is validated like any other value.
function readName(error: ErrorSink, value: JsonValue | undefined, where: string): string | null {
  if (value === undefined) return null;
  if (typeof value !== "string" || value === "" || codePointLength(value) > MAX_NAME) {
    error("structure", where, "must be a text of 1 to 128 characters");
    return null;
  }
  return value;
}

// A list of 1 to 8 playlist IDs, no ID twice. Null when it is not one.
function readPlaylists(error: ErrorSink, value: JsonValue | undefined, where: string): string[] | null {
  if (!isArray(value) || value.length === 0) {
    error("structure", where, "must be a non-empty list of playlist IDs");
    return null;
  }
  if (value.length > MAX_SCHEDULE_PLAYLISTS) {
    error("limit_exceeded", where, `more than ${MAX_SCHEDULE_PLAYLISTS} playlists`);
    return null;
  }
  const ids: string[] = [];
  for (const [i, item] of value.entries()) {
    const at = `${where}[${i}]`;
    if (typeof item !== "string" || !isValidId(item)) {
      error("structure", at, "must be a playlist ID: lowercase letters, digits, _ and -");
      return null;
    }
    if (ids.includes(item)) {
      error("structure", at, `names "${item}" twice`);
      return null;
    }
    ids.push(item);
  }
  return ids;
}

// An end with the parts the file names, or null when it is refused. A part out of its values is reported, left out
// of `end` and `range.valid` cleared.
function readEnd(
  error: ErrorSink,
  value: JsonValue | undefined,
  where: string,
  range: { valid: boolean },
): { end: ScheduleEnd; parts: number } | null {
  if (!isObject(value)) {
    error("structure", where, "must be an object with year, month or day");
    return null;
  }
  let structureOk = true;
  for (const key of value.keys())
    if (!["year", "month", "day"].includes(key)) {
      error("structure", `${where}.${key}`, `unknown field "${key}"`);
      structureOk = false;
    }
  const end: ScheduleEnd = {};
  let parts = 0;
  for (const [part, name] of PARTS) {
    const v = value.get(name);
    if (v === undefined) continue;
    parts |= part;
    const at = `${where}.${name}`;
    // An integer outside int64 is not an integer for the formats (json.ts): a structure error.
    if (!isInteger(v)) {
      error("structure", at, "must be an integer");
      structureOk = false;
      continue;
    }
    const low = part === PART_YEAR ? MIN_SCHEDULE_YEAR : 1;
    const high = part === PART_YEAR ? MAX_SCHEDULE_YEAR : part === PART_MONTH ? 12 : 31;
    if (v.value < low || v.value > high) {
      error("invalid_date", at, `must be from ${low} to ${high}`);
      range.valid = false;
      continue;
    }
    end[name] = v.value;
  }
  if (!structureOk) return null;
  if (parts === 0) {
    error("structure", where, "must have a year, a month or a day");
    return null;
  }
  if (parts === (PART_YEAR | PART_DAY)) {
    error("structure", where, "a year and a day need a month");
    return null;
  }
  return { end, parts };
}

// The rules on the ends of an entry whose parts are each in their values: each end is a date, and with a year
// `from` is not after `to`.
function checkDates(error: ErrorSink, parts: number, from: ScheduleEnd, to: ScheduleEnd, where: string): void {
  let valid = true;
  for (const [end, side] of [
    [from, ".from"],
    [to, ".to"],
  ] as const) {
    // {month, day} needs a date of some year, so February 29 counts in a leap year.
    if (
      (parts & MONTH_DAY) === MONTH_DAY &&
      (end.day as number) > daysInMonth(parts & PART_YEAR ? (end.year as number) : 2000, end.month as number)
    ) {
      error("invalid_date", `${where}${side}`, "is not a date");
      valid = false;
    }
  }
  if (valid && parts & PART_YEAR) {
    const key = (end: ScheduleEnd): number => (end.year as number) * 10000 + (end.month ?? 0) * 100 + (end.day ?? 0);
    if (key(from) > key(to)) error("invalid_date", where, "from is after to");
  }
}

// An entry of the file, or null when it is refused or its playlists are.
function readEntry(error: ErrorSink, value: JsonValue, where: string, v2: boolean): ScheduleEntry | null {
  if (!isObject(value)) {
    error("structure", where, "must be an object with from, to and playlists");
    return null;
  }
  for (const key of value.keys())
    if (!["name", "from", "to", "playlists", ...(v2 ? ["hours"] : [])].includes(key))
      error("structure", `${where}.${key}`, `unknown field "${key}"`);
  let hours: ScheduleEntry["hours"];
  if (v2 && value.has("hours")) {
    const raw = value.get("hours");
    if (!isArray(raw)) error("structure", `${where}.hours`, "must be a list");
    else {
      if (raw.length > 8) error("limit_exceeded", `${where}.hours`, "more than 8 windows");
      hours = [];
      for (const [i, item] of raw.entries()) {
        const at = `${where}.hours[${i}]`;
        if (!isObject(item)) {
          error("structure", at, "must be an object");
          continue;
        }
        for (const key of item.keys())
          if (!["from", "to", "playlists"].includes(key)) error("structure", `${at}.${key}`, "unknown field");
        const from = item.get("from"),
          to = item.get("to");
        const start = typeof from === "string" ? parseHour(from) : null;
        const end = typeof to === "string" ? parseHour(to, true) : null;
        if (start === null || end === null) error("structure", at, "from and to must be HH:MM daily boundaries");
        else if (start >= end || hours.some((w) => start < parseHour(w.to, true)! && parseHour(w.from)! < end))
          error("invalid_time", at, "daily windows overlap or are empty");
        const windowPlaylists = readPlaylists(error, item.get("playlists"), `${at}.playlists`);
        if (start !== null && end !== null && windowPlaylists)
          hours.push({ from: from as string, to: to as string, playlists: windowPlaylists });
      }
    }
  }
  const name = readName(error, value.get("name"), `${where}.name`);
  const playlists = readPlaylists(error, value.get("playlists"), `${where}.playlists`);
  const range = { valid: true };
  const fromEnd = readEnd(error, value.get("from"), `${where}.from`, range);
  const toEnd = readEnd(error, value.get("to"), `${where}.to`, range);
  if (!fromEnd || !toEnd) return null;
  if (fromEnd.parts !== toEnd.parts) {
    error("structure", where, "from and to must have the same parts");
    return null;
  }
  if (!range.valid) return null;
  checkDates(error, fromEnd.parts, fromEnd.end, toEnd.end, where);
  return playlists ? { name, from: fromEnd.end, to: toEnd.end, playlists, ...(hours ? { hours } : {}) } : null;
}

export function parseHour(text: string, end = false): number | null {
  if (end && text === "24:00") return 1440;
  if (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(text)) return null;
  return Number(text.slice(0, 2)) * 60 + Number(text.slice(3));
}

export function playlistsAt(schedule: Schedule, entry: number, minute: number): string[] {
  const selected = schedule.entries[entry]!;
  const window = selected.hours?.find((w) => parseHour(w.from)! <= minute && minute < parseHour(w.to, true)!);
  return window?.playlists ?? selected.playlists;
}

/** Parses and validates either schedule format, or one required format when specified. */
export function loadSchedule(
  bytes: Uint8Array,
  expectedFormat?: "pixelart-schedule/1" | "pixelart-schedule/2",
): ScheduleResult {
  const diagnostics: Diagnostic[] = [];
  let ok = true;
  // Keeps at most MAX_DIAGNOSTICS entries, like the animation and playlist loaders.
  const error: ErrorSink = (code, where, message) => {
    if (diagnostics.length < MAX_DIAGNOSTICS) diagnostics.push({ severity: "error", code, where, message });
    ok = false;
  };
  const rejected = (): ScheduleResult => ({ schedule: null, diagnostics });

  if (bytes.length > MAX_SCHEDULE_FILE_SIZE) {
    error("limit_exceeded", "", `file larger than ${MAX_SCHEDULE_FILE_SIZE / 1024} KiB`);
    return rejected();
  }
  const parsed = parseStrictJson(bytes, SCHEDULE_JSON_DEPTH);
  if (!parsed.ok) {
    error("structure", "", `not valid JSON: ${parsed.reason}`);
    return rejected();
  }
  const root: JsonValue = parsed.value;
  const format = isObject(root) ? root.get("format") : undefined;
  if (
    !isObject(root) ||
    (format !== "pixelart-schedule/1" && format !== "pixelart-schedule/2") ||
    (expectedFormat !== undefined && format !== expectedFormat)
  ) {
    error("format_unsupported", "format", `unsupported format "${typeof format === "string" ? format : ""}"`);
    return rejected();
  }

  for (const key of root.keys())
    if (!["format", "name", "fallback", "entries"].includes(key)) error("structure", key, `unknown field "${key}"`);
  const name = readName(error, root.get("name"), "name");
  const fallback = readPlaylists(error, root.get("fallback"), "fallback");

  const entries: ScheduleEntry[] = [];
  const list = root.get("entries");
  if (list !== undefined) {
    if (!isArray(list)) error("structure", "entries", "must be a list");
    else if (list.length > MAX_SCHEDULE_ENTRIES)
      error("limit_exceeded", "entries", `more than ${MAX_SCHEDULE_ENTRIES} entries`);
    else
      list.forEach((value, i) => {
        const entry = readEntry(error, value, `entries[${i}]`, format === "pixelart-schedule/2");
        if (entry) entries.push(entry);
      });
  }
  if (entries.reduce((count, entry) => count + (entry.hours?.length ?? 0), 0) > 64)
    error("limit_exceeded", "entries", "more than 64 daily windows");
  if (!ok || !fallback) return rejected();
  return { schedule: { format, name, fallback, entries }, diagnostics };
}

/**
 * Index of the entry that wins on `date` by the rules of docs/format/schedule-v1.md#which-entry-wins, or -1 when no
 * entry matches. A tie goes to the first tied entry in the file. Looks at each entry once.
 */
export function scheduleWinner(schedule: Schedule, date: LocalDate): number {
  let best = -1;
  let bestRank = 0;
  let bestLength = 0;
  schedule.entries.forEach((entry, i) => {
    const { from, to } = entry;
    const parts = partsOf(from);
    let match: boolean;
    let length: number;
    switch (parts) {
      case YEAR_MONTH_DAY: {
        const day = daysFromCivil(date.year, date.month, date.day);
        const start = daysFromCivil(from.year!, from.month!, from.day!);
        const end = daysFromCivil(to.year!, to.month!, to.day!);
        match = start <= day && day <= end;
        length = end - start + 1;
        break;
      }
      case MONTH_DAY: {
        const start = from.month! * 100 + from.day!;
        const end = to.month! * 100 + to.day!;
        match = inCycle(date.month * 100 + date.day, start, end);
        const nFrom = commonDay(from.month!, from.day!);
        const nTo = commonDay(to.month!, to.day!);
        length = start <= end ? nTo - nFrom + 1 : 365 - nFrom + nTo + 1;
        break;
      }
      case YEAR_MONTH: {
        const month = 12 * date.year + date.month;
        const start = 12 * from.year! + from.month!;
        const end = 12 * to.year! + to.month!;
        match = start <= month && month <= end;
        length = end - start + 1;
        break;
      }
      case PART_DAY:
        match = inCycle(date.day, from.day!, to.day!);
        length = from.day! <= to.day! ? to.day! - from.day! + 1 : 31 - from.day! + to.day! + 1;
        break;
      case PART_MONTH:
        match = inCycle(date.month, from.month!, to.month!);
        length = from.month! <= to.month! ? to.month! - from.month! + 1 : 12 - from.month! + to.month! + 1;
        break;
      default: // PART_YEAR
        match = from.year! <= date.year && date.year <= to.year!;
        length = to.year! - from.year! + 1;
    }
    if (!match) return;
    const r = rank(parts);
    if (best < 0 || r < bestRank || (r === bestRank && length < bestLength)) {
      best = i;
      bestRank = r;
      bestLength = length;
    }
  });
  return best;
}

export interface PlayChoice {
  source: PlaySource;
  /** The ID of the schedule the list comes from, or null. */
  schedule: string | null;
  reason: PlayReason;
  /** The winning entry, or null when none won. */
  entry: number | null;
  /** The list the board plays. */
  playlists: string[];
  /** The first playable playlist of the list, or null: every animation plays. */
  playing: string | null;
}

export interface PlayInputs {
  mode: PlayMode;
  /** The `playlists` setting. */
  playlists: readonly string[];
  /** The `schedule` setting. */
  schedule: string;
  serverChoice: ServerChoice | null;
  /** The valid schedules stored on the board, by ID. */
  schedules: ReadonlyMap<string, Schedule>;
  /** The local date, or null while the time is not known. */
  date: LocalDate | null;
  minute?: number | null;
  /** Whether the board can play a playlist. */
  playable: (id: string) => boolean;
}

/**
 * The list the board plays, by the table of docs/format/playlist-v1.md#how-the-board-chooses-what-to-play. Resolves
 * one date: never loops over days or years.
 */
export function choosePlaylists({
  mode,
  playlists,
  schedule,
  serverChoice,
  schedules,
  date,
  minute,
  playable,
}: PlayInputs): PlayChoice {
  const choice = (
    source: PlaySource,
    scheduleId: string | null,
    list: readonly string[],
    reason: PlayReason,
    entry: number | null,
  ): PlayChoice => ({
    source,
    schedule: scheduleId,
    reason,
    entry,
    playlists: [...list],
    playing: list.find(playable) ?? null,
  });
  // The existing Automatic chain for one valid schedule.
  const fromSchedule = (source: PlaySource, id: string, valid: Schedule): PlayChoice => {
    let reason: PlayReason = "no_time";
    let entry: number | null = null;
    if (date && (minute != null || !valid.entries.some((e) => e.hours?.length))) {
      const winner = scheduleWinner(valid, date);
      if (winner >= 0) {
        const chosen = choice(
          source,
          id,
          minute === undefined || minute === null
            ? valid.entries[winner]!.playlists
            : playlistsAt(valid, winner, minute),
          "schedule",
          winner,
        );
        if (chosen.playing !== null) return chosen;
        // Every playlist of the winning entry is skipped: entry still names it.
        entry = winner;
      }
      reason = "fallback";
    }
    const fallback = choice(source, id, valid.fallback, reason, entry);
    return fallback.playing !== null ? fallback : choice(source, id, [DEFAULT_PLAYLIST_ID], reason, entry);
  };
  // The board's own rule: the schedule `default` if it is valid and stored, else the playlist `default`.
  const boardRule = (): PlayChoice => {
    const own = schedules.get(DEFAULT_SCHEDULE_ID);
    return own
      ? fromSchedule("fallback", DEFAULT_SCHEDULE_ID, own)
      : choice("fallback", null, [DEFAULT_PLAYLIST_ID], "no_schedule", null);
  };

  // My playlists never fall back to `default`: every playlist skipped plays every animation.
  if (mode === "playlists") return choice("playlists", null, playlists, "playlists", null);
  if (mode === "schedule") {
    const mine = schedules.get(schedule);
    return mine ? fromSchedule("schedule", schedule, mine) : boardRule();
  }
  if (serverChoice && "schedule" in serverChoice) {
    const named = schedules.get(serverChoice.schedule);
    if (named) return fromSchedule("server", serverChoice.schedule, named);
  } else if (serverChoice) {
    const listed = choice("server", null, serverChoice.playlists, "playlists", null);
    if (listed.playing !== null) return listed;
  }
  return boardRule();
}

/** The day after `date`. */
export function nextDay(date: LocalDate): LocalDate {
  if (date.day < daysInMonth(date.year, date.month)) return { ...date, day: date.day + 1 };
  if (date.month < 12) return { year: date.year, month: date.month + 1, day: 1 };
  return { year: date.year + 1, month: 1, day: 1 };
}

/** The playlists the schedule names for `date`: the winning entry's, or `fallback`, with the entry's index or -1. */
function scheduledFor(schedule: Schedule, date: LocalDate): { entry: number; playlists: string[] } {
  const entry = scheduleWinner(schedule, date);
  return { entry, playlists: entry >= 0 ? schedule.entries[entry]!.playlists : schedule.fallback };
}

/** How far ahead `nextScheduleChange` looks: one year, leap day included. */
export const NEXT_CHANGE_DAYS = 366;

/**
 * The first day after `today`, at most NEXT_CHANGE_DAYS days ahead and never past the year 2999, on which the schedule
 * names other playlists than on `today`; null when there is none. Resolves one date at a time.
 */
export function nextScheduleChange(
  schedule: Schedule,
  today: LocalDate,
): { date: LocalDate; entry: number | null; playlists: string[] } | null {
  const now = scheduledFor(schedule, today).playlists.join(",");
  let date = today;
  for (let i = 0; i < NEXT_CHANGE_DAYS; i++) {
    date = nextDay(date);
    if (date.year > MAX_SCHEDULE_YEAR) return null;
    const next = scheduledFor(schedule, date);
    if (next.playlists.join(",") !== now)
      return { date, entry: next.entry >= 0 ? next.entry : null, playlists: next.playlists };
  }
  return null;
}
