// SPDX-License-Identifier: GPL-3.0-or-later

// The space left on the board, for the Storage card of the Board view (docs/web/web-app-v1.md#storage).

import { BLOCK_SIZE, blocksOf } from "../../queue/plan";

/** What the Storage card says, worked out from `info.storage` and the stored files. */
export interface StorageSummary {
  total: number;
  used: number;
  free: number;
  /** The used part of the total, from 0 to 100. */
  percent: number;
  animations: number;
  playlists: number;
  /**
   * What one animation of average size takes, in whole file system blocks: the mean over the stored animations of
   * their sizes rounded up to blocks. Null when no animation is stored.
   */
  averageAnimation: number | null;
  /** How many more animations of that size would fit, an estimate. Null when there is no average to go by. */
  estimate: number | null;
  /** Not even one more file fits. */
  full: boolean;
  /** Less than one average animation is left (less than one block when none is stored). */
  low: boolean;
}

export function summarizeStorage(
  storage: { total: number; used: number },
  animations: ReadonlyArray<{ size: number }>,
  playlists: ReadonlyArray<unknown>,
): StorageSummary {
  const total = Math.max(0, storage.total);
  const used = Math.min(Math.max(0, storage.used), total);
  const free = total - used;
  const averageAnimation =
    animations.length === 0 ? null : animations.reduce((sum, a) => sum + blocksOf(a.size), 0) / animations.length;
  const needed = averageAnimation ?? BLOCK_SIZE;
  return {
    total,
    used,
    free,
    percent: total === 0 ? 100 : Math.round((used / total) * 100),
    animations: animations.length,
    playlists: playlists.length,
    averageAnimation,
    estimate: averageAnimation === null ? null : Math.floor(free / averageAnimation),
    full: free < BLOCK_SIZE,
    low: free < needed,
  };
}
