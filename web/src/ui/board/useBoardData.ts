// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useState } from "react";
import { getSettings, type BoardClient, type Entry, type Settings } from "../../protocol";
import { toShownError, type ShownError } from "../errors";
import type { BoardFileList } from "../fileLists";
import { useSession } from "../session";
import { useLatest } from "../useLatest";

/** The entries of a list that is known, or null: callers must not read "not known" as "empty". */
export const entriesOf = (list: BoardFileList): Entry[] | null => (list.status === "known" ? list.entries : null);

// A failed read is a new `unknown` object. It is reported the first time any view sees it, not on every mount.
const reportedFailures = new WeakSet<object>();

/** The stored files (kept by the session, shared with every view). A failed read is reported once. */
export function useBoardFiles(onError: (error: ShownError) => void) {
  const { files } = useSession();
  const report = useLatest(onError);
  useReportOnce(files.animation, report);
  useReportOnce(files.playlist, report);
  useReportOnce(files.schedule, report);
  return { animations: files.animation, playlists: files.playlist, schedules: files.schedule };
}

/**
 * The stored files and the settings of the connected board. The settings are read again on `reload` and when the
 * board restarts; a failed read of either is reported once. Views that do not use the settings call `useBoardFiles`.
 */
export function useBoardData(client: BoardClient, restarts: number, onError: (error: ShownError) => void) {
  const files = useBoardFiles(onError);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [unreadable, setUnreadable] = useState(false);
  const [round, setRound] = useState(0);
  const report = useLatest(onError);

  useEffect(() => {
    let current = true;
    void (async () => {
      try {
        const value = await getSettings(client);
        if (!current) return;
        setSettings(value);
        setUnreadable(false);
      } catch (error) {
        if (!current) return;
        setUnreadable(true);
        report.current(toShownError("Reading the board", error));
      }
    })();
    return () => {
      current = false;
    };
  }, [client, restarts, round, report]);

  return {
    data: { ...files, settings },
    /** The settings could not be read and are not known: the view offers `reload` to read them again. */
    settingsUnreadable: unreadable && settings === null,
    reload: () => setRound((n) => n + 1),
    setSettings,
  };
}

function useReportOnce(list: BoardFileList, report: { current: (error: ShownError) => void }): void {
  useEffect(() => {
    if (list.status !== "unknown" || reportedFailures.has(list)) return;
    reportedFailures.add(list);
    report.current(toShownError("Reading the board", list.error));
  }, [list, report]);
}
