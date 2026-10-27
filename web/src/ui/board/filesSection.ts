// SPDX-License-Identifier: GPL-3.0-or-later

import { useCallback, useState } from "react";
import type { Settings } from "../../protocol";
import type { BoardFileList } from "../fileLists";
import { plural } from "../format";
import { BOARD_FILES_KEY, readStored, writeStored } from "../storage";
import { entriesOf } from "./useBoardData";

/** What the Files card's summary line is made of. */
export interface FilesSummary {
  animations: BoardFileList;
  playlists: BoardFileList;
  /** The settings, or null while they are not known: the summary then leaves out the active playlist. */
  settings: Settings | null;
  /** The stored playlists by ID with their names, or null while they are not known. */
  playlistNames: ReadonlyMap<string, string | null> | null;
}

/** The one line the card always shows: the counts and the active playlist. */
export function summarize({ animations, playlists, settings, playlistNames }: FilesSummary): string {
  if (animations.status === "unknown" || playlists.status === "unknown")
    return "Could not read the files from the board.";
  const a = entriesOf(animations);
  const p = entriesOf(playlists);
  if (a === null || p === null) return "Reading the files from the board...";
  const counts = `${plural(a.length, "animation")}, ${plural(p.length, "playlist")}`;
  if (settings === null) return counts;
  const id = settings.playlist;
  if (id === "") return `${counts}, no active playlist: every animation plays`;
  if (playlistNames !== null && !playlistNames.has(id)) return `${counts}, active playlist: ${id} (not stored)`;
  return `${counts}, active playlist: ${playlistNames?.get(id) || id}`;
}

/** The user's own choice, kept in this browser: only "open" reads as open, so the section is closed by default. */
export const readFilesOpen = (): boolean => readStored(BOARD_FILES_KEY) === "open";

export function writeFilesOpen(open: boolean): void {
  writeStored(BOARD_FILES_KEY, open ? "open" : "closed");
}

/**
 * The open or closed state of the Files section. `toggle` is the user's choice and is stored. `reveal` opens the
 * section for the moment's need (an editor, a preview, an upload) and is not stored, so it never undoes a choice to
 * keep the list closed.
 */
export function useFilesSection(): { open: boolean; toggle: () => void; reveal: () => void } {
  const [open, setOpen] = useState(readFilesOpen);
  return {
    open,
    toggle: () => {
      writeFilesOpen(!open);
      setOpen(!open);
    },
    reveal: useCallback(() => setOpen(true), []),
  };
}
