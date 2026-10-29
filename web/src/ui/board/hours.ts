// SPDX-License-Identifier: GPL-3.0-or-later

/** A whole number of hours from `min` to `max`, at most 999, as the board takes its hour settings. Null otherwise. */
export function parseHours(text: string, min: number, max: number): number | null {
  if (!/^\d{1,3}$/.test(text.trim())) return null;
  const hours = Number(text.trim());
  return hours >= min && hours <= max ? hours : null;
}
