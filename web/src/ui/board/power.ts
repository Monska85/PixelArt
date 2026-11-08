// SPDX-License-Identifier: GPL-3.0-or-later

// The words and the show rule of the Power card, kept apart from the component so they are tested as plain functions.

import type { PowerStatus } from "../../protocol";

/** The power object the Power card shows, or null while the card stays hidden: no object, or the limit is off. */
export function shownPower(power: PowerStatus | null): PowerStatus | null {
  return power !== null && power.limitActive ? power : null;
}

/** The anchor of the power supply section of the README. */
export const POWER_ADVICE_ANCHOR = "power-supply-improvement";

export const POWER_RESET_TITLE = "Turn power protection off?";

export const POWER_ON_TITLE = "Power protection is on.";

export const POWER_DIMMING_TEXT =
  "Bright animations now play dimmer so the board stops restarting; other animations are unchanged.";

export const POWER_FLOOR_TEXT = "Your power supply is not adequate even at the lowest level.";

// The "3" in the two texts below is the restart count that turns the protection on (docs/board/power-protection-v1.md,
// Trigger); keep them equal to it.
export const POWER_RESET_EXPLANATION =
  "Use this only after you changed the power hardware: a stronger 5 V supply, a separate supply for the LED matrix, a shorter or thicker cable, or a capacitor on the matrix power. The board forgets its past restarts and plays every animation at full brightness again. Changing the brightness, WiFi or playlists is not a reason to press it. If the supply is still too weak, the board will restart again during bright animations, and after 3 restarts the protection turns back on.";

export const POWER_RESET_CONFIRM =
  "The board forgets its past restarts and plays every animation at full brightness again. If the supply is still too weak, the protection turns back on after 3 more restarts.";

/** "The board restarted 3 times because ...": no count for 0, "once" for 1. */
export function restartSentence(brownouts: number): string {
  const times = brownouts === 0 ? "" : brownouts === 1 ? " once" : ` ${brownouts} times`;
  return `The board restarted${times} because its power supply could not deliver enough current.`;
}

/** What the animation playing now gets: nothing, or the percentage of the power scale. */
export function scaleSentence(scale: number): string {
  return scale === 100 ? "The animation playing now is not dimmed." : `Playing now at ${scale}%.`;
}
