// SPDX-License-Identifier: GPL-3.0-or-later

// Kept apart from the configs: importing a config runs it, and the screenshot config sets PIXELART_DATA.

/** PIXELART_JOBS as a number of workers: a positive whole number, else 2 (missing, not a number, zero or negative). */
export function workers(value: string | undefined): number {
  const jobs = Math.floor(Number(value));
  return Number.isFinite(jobs) && jobs >= 1 ? jobs : 2;
}
