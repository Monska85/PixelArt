// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useState } from "react";
import { DEFAULT_SCHEDULE_ID, loadPlay, loadSchedule, type Schedule } from "../../engine";
import { downloadFile, type BoardClient, type Entry } from "../../protocol";
import { downloadPublished } from "../../release/library";
import type { Published } from "../../release/manifest";
import type { ManifestState } from "../useManifest";

/**
 * A schedule a card shows. "board": the board's file, or null when it is not valid (the board then plays as with no
 * schedule). "site": the schedule the site publishes, for a board that stores none. "none": neither is there.
 * "loading": being read, or the board's list is not known yet.
 */
export type ScheduleSource =
  | { status: "loading" }
  | { status: "none" }
  | { status: "board"; schedule: Schedule | null }
  | { status: "site"; schedule: Schedule };

/**
 * What to read: the stored file by its SHA-256, else the published one by its own. "none" when neither is there, null
 * while the board's list or the release is not known yet.
 */
function sourceKey(
  stored: Entry[] | null,
  entry: Entry | null,
  library: ManifestState,
  siteId: string | null,
  published: Published | null | undefined,
): string | null {
  if (stored === null) return null;
  if (entry) return `board:${entry.id}:${entry.sha256 ?? ""}:${entry.size}`;
  if (siteId === null) return "none";
  if (library.status === "loading") return null;
  if (published) return `site:${published.sha256}`;
  return "none";
}

/** The schedules read from the board, by SHA-256, so two cards that show one file read it once. */
const READS = new Map<string, Promise<Schedule | null>>();
const MAX_READS = 16;

function readBoardSchedule(client: BoardClient, entry: Entry): Promise<Schedule | null> {
  const key = entry.sha256 === null ? null : `${entry.sha256}:${entry.size}`;
  const cached = key === null ? undefined : READS.get(key);
  if (cached) return cached;
  const read = downloadFile(client, "schedule", entry.id, entry).then((bytes) => loadSchedule(bytes).schedule);
  if (key !== null) {
    if (READS.size >= MAX_READS) READS.delete(READS.keys().next().value as string);
    READS.set(key, read);
    read.catch(() => READS.delete(key));
  }
  return read;
}

/**
 * Reads the board's schedule `id` when its list has it, again when its SHA-256 changes. Without it, and when `siteId`
 * is given, the published schedule of that ID of the release the app is served with. A read that fails counts as no
 * schedule to show.
 */
export function useScheduleSource(
  client: BoardClient,
  stored: Entry[] | null,
  library: ManifestState,
  id: string | null,
  siteId: string | null = null,
): ScheduleSource {
  const entry = (id !== null && stored?.find((e) => e.id === id)) || null;
  const published =
    siteId !== null && library.status === "ready" ? library.manifest.schedules.find((e) => e.id === siteId) : null;
  const key = sourceKey(stored, entry, library, siteId, published);
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
          value = { status: "board", schedule: await readBoardSchedule(client, entry) };
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

/**
 * The ID of the schedule the site publishes for a board that stores none: the one its play file names, else `default`
 * (the board's own rule). Null while `enabled` is false or the release or its play file is still being read.
 */
export function useSiteSchedule(library: ManifestState, enabled: boolean): string | null {
  const entry = enabled && library.status === "ready" ? library.manifest.play.find((e) => e.id === "default") : null;
  const [read, setRead] = useState<{ sha256: string; id: string } | null>(null);

  useEffect(() => {
    if (!entry) return;
    let current = true;
    void downloadPublished("play", entry)
      .then((bytes) => loadPlay(bytes).choice)
      .catch(() => null)
      .then((choice) => {
        if (current)
          setRead({ sha256: entry.sha256, id: choice && "schedule" in choice ? choice.schedule : DEFAULT_SCHEDULE_ID });
      });
    return () => {
      current = false;
    };
    // The file is read again only when its SHA-256 changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.sha256]);

  if (!enabled || library.status === "loading") return null;
  if (!entry) return DEFAULT_SCHEDULE_ID;
  return read?.sha256 === entry.sha256 ? read.id : null;
}
