// SPDX-License-Identifier: GPL-3.0-or-later

import { useCallback, useState } from "react";
import { BOARD_FILES_KEY, readStored, writeStored } from "../storage";

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
