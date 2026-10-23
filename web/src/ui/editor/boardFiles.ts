// SPDX-License-Identifier: GPL-3.0-or-later

import type { BoardFiles } from "../../editor/saves";
import type { Snapshot } from "../session";

/**
 * The connected board's animations as the save state needs them: null while no board is connected, "unknown" while
 * the list is not read for the first time or could not be read. A known list read again after a change keeps its
 * last entries.
 */
export function boardFilesOf({ state, files }: Snapshot): BoardFiles {
  if (state !== "connected") return null;
  const list = files.animation;
  if (list.status !== "known") return "unknown";
  return {
    entries: list.entries.map((e) => ({ id: e.id, sha256: e.sha256 })),
    staleSince: list.staleSince,
  };
}
