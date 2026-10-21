import { useCallback, useRef, useState } from "react";
import type { PlaylistModel } from "./playlistModel";

interface Switch {
  /** How the dialog names the playlist being edited, taken when the switch was requested. */
  from: string;
  to: PlaylistModel;
}

const nameOf = (id: string): string => (id === "" ? "the new playlist" : `playlist ${id}`);

/** The open playlist editor and the confirmation before another playlist replaces unsaved work. */
export function usePlaylistEditor() {
  // `seq` makes every opening a new editor, so it is focused again even for the same playlist.
  const [editing, setEditing] = useState<{ model: PlaylistModel; seq: number } | null>(null);
  const [pending, setPending] = useState<Switch | null>(null);
  const seq = useRef(0);
  // A ref, not state: `requestOpen` runs after an await and must see the editor as it is then, not as it was
  // when the caller's closure was rendered. The editor and `open` and `close` write it directly.
  const latest = useRef({ open: false, dirty: false, id: "" });

  const open = useCallback((model: PlaylistModel): void => {
    latest.current = { open: true, dirty: false, id: model.id };
    setPending(null);
    setEditing({ model, seq: ++seq.current });
  }, []);

  const close = useCallback((): void => {
    latest.current = { open: false, dirty: false, id: "" };
    setEditing(null);
  }, []);

  const onChange = useCallback((dirty: boolean, id: string): void => {
    latest.current = { ...latest.current, dirty, id };
  }, []);

  const requestOpen = (model: PlaylistModel): void => {
    if (latest.current.open && latest.current.dirty) setPending({ from: nameOf(latest.current.id), to: model });
    else open(model);
  };

  return {
    editing,
    open,
    close,
    onChange,
    requestOpen,
    pending: pending && { from: pending.from, to: nameOf(pending.to.id) },
    confirmSwitch: (): void => {
      if (pending) open(pending.to);
    },
    cancelSwitch: (): void => setPending(null),
  };
}
