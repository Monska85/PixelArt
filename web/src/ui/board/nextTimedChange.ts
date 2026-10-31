// SPDX-License-Identifier: GPL-3.0-or-later

import {
  MAX_SCHEDULE_YEAR,
  NEXT_CHANGE_DAYS,
  nextDay,
  playlistsAt,
  scheduleWinner,
  type LocalDate,
  type Schedule,
} from "../../engine";
import { parseHour } from "../../engine/schedule";

/** First changed list at a local minute boundary or midnight, within the same 366-day horizon. */
export function nextTimedChange(
  schedule: Schedule,
  today: LocalDate,
  minute: number,
): { date: LocalDate; minute: number; entry: number | null; playlists: string[] } | null {
  const at = (date: LocalDate, time: number) => {
    const entry = scheduleWinner(schedule, date);
    return { entry, playlists: entry < 0 ? schedule.fallback : playlistsAt(schedule, entry, time) };
  };
  const current = at(today, minute).playlists.join(",");
  let date = today;
  for (let day = 0; day <= NEXT_CHANGE_DAYS; day++) {
    if (date.year > MAX_SCHEDULE_YEAR) return null;
    const entry = scheduleWinner(schedule, date);
    const boundaries =
      entry < 0
        ? []
        : (schedule.entries[entry]!.hours?.flatMap((w) => [parseHour(w.from)!, parseHour(w.to, true)!]) ?? []);
    for (const boundary of [...new Set([0, ...boundaries])].sort((a, b) => a - b)) {
      if (boundary >= 1440 || (day === 0 && boundary <= minute)) continue;
      const next = at(date, boundary);
      if (next.playlists.join(",") !== current)
        return { date, minute: boundary, entry: next.entry < 0 ? null : next.entry, playlists: next.playlists };
    }
    date = nextDay(date);
  }
  return null;
}
