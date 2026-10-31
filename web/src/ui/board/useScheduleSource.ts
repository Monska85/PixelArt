// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useState } from "react";
import { DEFAULT_SCHEDULE_ID, loadPlay, loadSchedule, type Schedule, type ServerChoice } from "../../engine";
import { downloadFile, type BoardClient, type Entry } from "../../protocol";
import { downloadPublished } from "../../release/library";
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
/** The schedules read from the board, by SHA-256, so two cards that show one file read it once. */
const READS = new Map<string, Promise<Schedule | null>>();
const MAX_READS = 16;

export function readBoardSchedule(
  client: BoardClient,
  entry: Entry,
  kind: "schedule" | "schedule_v2",
): Promise<Schedule | null> {
  const key = entry.sha256 === null ? null : `${kind}:${entry.sha256}:${entry.size}`;
  const cached = key === null ? undefined : READS.get(key);
  if (cached) return cached;
  const read = downloadFile(client, kind, entry.id, entry).then((bytes) => {
    const schedule = loadSchedule(bytes).schedule;
    return schedule?.format === (kind === "schedule_v2" ? "pixelart-schedule/2" : "pixelart-schedule/1")
      ? schedule
      : null;
  });
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
  storedV2: Entry[] | null,
  library: ManifestState,
  id: string | null,
  siteId: string | null = null,
): ScheduleSource {
  const v2Supported = !!client.info?.formats.schedule_v2;
  const v1 = (id !== null && stored?.find((e) => e.id === id)) || null;
  const v2 = (v2Supported && id !== null && storedV2?.find((e) => e.id === id)) || null;
  const publishedV1 =
    siteId !== null && library.status === "ready" ? library.manifest.schedules.find((e) => e.id === siteId) : null;
  const publishedV2 =
    v2Supported && siteId !== null && library.status === "ready"
      ? library.manifest.schedules_v2?.find((e) => e.id === siteId)
      : null;
  const key =
    stored === null || (v2Supported && storedV2 === null)
      ? null
      : v2 || v1
        ? `board:${v2?.sha256 ?? ""}:${v2?.size ?? 0}:${v1?.sha256 ?? ""}:${v1?.size ?? 0}`
        : siteId === null
          ? "none"
          : library.status === "loading"
            ? null
            : publishedV2 || publishedV1
              ? `site:${publishedV2?.sha256 ?? ""}:${publishedV1?.sha256 ?? ""}`
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
        if (v2 || v1) {
          let schedule: Schedule | null = null;
          if (v2) schedule = await readBoardSchedule(client, v2, "schedule_v2").catch(() => null);
          if (!schedule && v1) schedule = await readBoardSchedule(client, v1, "schedule").catch(() => null);
          value = { status: "board", schedule };
        } else {
          let schedule: Schedule | null = null;
          if (publishedV2)
            schedule = await downloadPublished("schedule_v2", publishedV2)
              .then((bytes) => loadSchedule(bytes).schedule)
              .catch(() => null);
          if (!schedule && publishedV1)
            schedule = await downloadPublished("schedule", publishedV1)
              .then((bytes) => loadSchedule(bytes).schedule)
              .catch(() => null);
          value = schedule ? { status: "site", schedule } : { status: "none" };
        }
      } catch {
        value = v2 || v1 ? { status: "board", schedule: null } : { status: "none" };
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
 * The schedule the site's play file leads to: the one it names, none when it chooses playlists (they have no schedule
 * to show), and `default`, the board's own rule, without a play file or with one that cannot be read.
 */
export function siteScheduleId(choice: ServerChoice | null): string | null {
  if (choice === null) return DEFAULT_SCHEDULE_ID;
  return "schedule" in choice ? choice.schedule : null;
}

/**
 * The ID of the schedule the site publishes for a board that stores none, as siteScheduleId() gives it. Null while
 * `enabled` is false, the release or its play file is still being read, or the site chose playlists.
 */
export function useSiteSchedule(library: ManifestState, enabled: boolean): string | null {
  const entry = enabled && library.status === "ready" ? library.manifest.play.find((e) => e.id === "default") : null;
  const [read, setRead] = useState<{ sha256: string; id: string | null } | null>(null);

  useEffect(() => {
    if (!entry) return;
    let current = true;
    void downloadPublished("play", entry)
      .then((bytes) => loadPlay(bytes).choice)
      .catch(() => null)
      .then((choice) => {
        if (current) setRead({ sha256: entry.sha256, id: siteScheduleId(choice) });
      });
    return () => {
      current = false;
    };
    // The file is read again only when its SHA-256 changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.sha256]);

  if (!enabled || library.status === "loading") return null;
  if (!entry) return siteScheduleId(null);
  return read?.sha256 === entry.sha256 ? read.id : null;
}
