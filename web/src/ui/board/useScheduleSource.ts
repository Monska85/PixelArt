// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useState } from "react";
import { loadSchedule, type Schedule } from "../../engine";
import { downloadFile, type BoardClient, type Entry } from "../../protocol";
import { downloadPublished } from "../../release/library";
import type { ManifestState } from "../useManifest";

/** The one schedule the board plays (docs/format/schedule-v1.md#files). */
export const PLAYED_SCHEDULE = "default";

/**
 * The schedule the Automatic card shows. "board": the board's `/schedules/default.json`, or null when it is not valid
 * (the board then plays as with no schedule). "site": the schedule the site publishes, for a board that stores none.
 * "none": neither is there. "loading": being read, or the board's list is not known yet.
 */
export type ScheduleSource =
  | { status: "loading" }
  | { status: "none" }
  | { status: "board"; schedule: Schedule | null }
  | { status: "site"; schedule: Schedule };

/**
 * Reads the board's schedule `default` when its list has one, again when its SHA-256 changes; otherwise the published
 * one of the release the app is served with. A read that fails counts as no schedule to show.
 */
export function useScheduleSource(client: BoardClient, stored: Entry[] | null, library: ManifestState): ScheduleSource {
  const entry = stored?.find((e) => e.id === PLAYED_SCHEDULE) ?? null;
  const published =
    library.status === "ready" ? library.manifest.schedules.find((e) => e.id === PLAYED_SCHEDULE) : null;
  // What to read: the stored file by its SHA-256, else the published one by its own.
  const key =
    stored === null
      ? null
      : entry
        ? `board:${entry.sha256 ?? ""}:${entry.size}`
        : library.status === "loading"
          ? null
          : published
            ? `site:${published.sha256}`
            : "none";
  const [source, setSource] = useState<{ key: string | null; value: ScheduleSource }>({
    key: null,
    value: { status: "loading" },
  });

  useEffect(() => {
    if (key === null || key === "none") return;
    let current = true;
    void (async () => {
      let value: ScheduleSource;
      try {
        if (entry) {
          const bytes = await downloadFile(client, "schedule", entry.id, entry);
          value = { status: "board", schedule: loadSchedule(bytes).schedule };
        } else {
          const schedule = published ? loadSchedule(await downloadPublished("schedule", published)).schedule : null;
          value = schedule ? { status: "site", schedule } : { status: "none" };
        }
      } catch {
        value = entry ? { status: "board", schedule: null } : { status: "none" };
      }
      if (current) setSource({ key, value });
    })();
    return () => {
      current = false;
    };
    // `key` names the file: the entries are read again only when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, key]);

  if (key === null) return { status: "loading" };
  if (key === "none") return { status: "none" };
  return source.key === key ? source.value : { status: "loading" };
}
