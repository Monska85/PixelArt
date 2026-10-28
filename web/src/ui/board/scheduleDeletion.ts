// SPDX-License-Identifier: GPL-3.0-or-later

// What the board plays by its own rule, and what deleting a schedule it plays from does, in words. Apart from play.ts,
// so the Files list, loaded when the app starts, does not load the texts of What to play.

import { DEFAULT_PLAYLIST_ID, DEFAULT_SCHEDULE_ID } from "../../engine";
import type { PlayStatus } from "../../protocol";

/** What the board plays by its own rule, when Automatic or My choice has nothing usable: in words. */
export const ownRule = (schedules: { has: (id: string) => boolean }): string =>
  schedules.has(DEFAULT_SCHEDULE_ID) ? `the schedule ${DEFAULT_SCHEDULE_ID}` : `the playlist ${DEFAULT_PLAYLIST_ID}`;

/** What a deletion of the schedule the board plays from does, in words; `remaining` are the schedules left. */
export function describeScheduleDeletion(play: PlayStatus, remaining: ReadonlySet<string>): string {
  const own = ownRule(remaining);
  switch (play.source) {
    case "server":
      return `The site chose this schedule for Automatic: the board will then play ${own}.`;
    case "schedule":
      return `My choice plays this schedule: the board will then play ${own}.`;
    default:
      return `Automatic plays this schedule: the board will then play ${own}.`;
  }
}
