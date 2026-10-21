// Where the editor's document is saved: the two real copies (a file on a board, a YAML file on the computer) and
// what the header says about them (docs/web/web-app-v1.md#where-the-work-is-saved). Pure, so it runs in the tests.

export type CopyKind = "board" | "download" | "file";

/** One copy of the document outside the browser, remembered with the content it had. */
export interface SavedCopy {
  kind: CopyKind;
  /** "board": the ID on the board. "download": the downloaded file name. "file": the file the document came from. */
  name: string;
  /** When it was uploaded, downloaded or opened, in milliseconds. */
  at: number;
  /** The document as strict JSON text, to tell by content whether it is still the same. */
  json: string;
  /** "board": the SHA-256 of the file the board stored, to check it against the connected board's list. */
  sha256?: string;
}

/** At most one copy on a board and one file on the computer. */
export interface Saves {
  board: SavedCopy | null;
  file: SavedCopy | null;
}

export const NO_SAVES: Saves = { board: null, file: null };

export const copiesOf = (saves: Saves): SavedCopy[] =>
  [saves.board, saves.file].filter((copy): copy is SavedCopy => copy !== null);

/** Whether some copy has exactly this content. */
export const hasCurrentCopy = (saves: Saves, json: string): boolean => copiesOf(saves).some((c) => c.json === json);

export function withCopy(saves: Saves, copy: SavedCopy): Saves {
  return copy.kind === "board" ? { ...saves, board: copy } : { ...saves, file: copy };
}

export function isSaves(value: unknown): value is Saves {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return [v.board, v.file].every((c) => c === null || isCopy(c));
}

function isCopy(value: unknown): value is SavedCopy {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    (v.kind === "board" || v.kind === "download" || v.kind === "file") &&
    typeof v.name === "string" &&
    typeof v.at === "number" &&
    typeof v.json === "string" &&
    (v.sha256 === undefined || typeof v.sha256 === "string")
  );
}

/**
 * What the connected board stores under each ID: null when no board is connected, "unknown" when one is connected
 * but nothing is known about its files (the first read is not done, or the last read failed). A known list that is
 * being read again after a change has `staleSince`, the time that read began: a board copy saved by the editor
 * since then is taken as on the board until the new read lands, and an older one is judged by the last entries.
 */
export type BoardFiles =
  { entries: Array<{ id: string; sha256: string | null }>; staleSince: number | null } | "unknown" | null;

export type SaveStateKind = "draft" | "board" | "download" | "file" | "changed" | "not-on-board" | "unchecked";

export interface SaveState {
  kind: SaveStateKind;
  /** The sentence for the header. */
  text: string;
  /** Warning: the work exists only in this browser, or has changed since its last copy. */
  warning: boolean;
  /** One line per copy, for the tooltip. */
  details: string[];
}

const clock = (at: number): string =>
  new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });

function describe(copy: SavedCopy): string {
  switch (copy.kind) {
    case "board":
      return `Saved to board as ${copy.name} at ${clock(copy.at)}`;
    case "download":
      return `Downloaded as ${copy.name} at ${clock(copy.at)}`;
    case "file":
      return `Same as ${copy.name}`;
  }
}

/** "Saved to board as ball at 10:42" after "Changed since": the copy as a past event. */
function describeBefore(copy: SavedCopy): string {
  if (copy.kind === "file") return `opened from ${copy.name}`;
  const text = describe(copy);
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/**
 * The save state of a document with this content. A board copy counts only while the connected board still has the
 * file with the SHA-256 the board stored, or was saved after the last read of a list that is being read again. With
 * no board connected (`board` is null) the copy counts; while nothing is known about the connected board's files
 * ("unknown") it does not, and the state says it is unchecked.
 */
export function deriveSaveState(saves: Saves, json: string, board: BoardFiles): SaveState {
  const copies = copiesOf(saves);
  const details = copies.map((c) => `${describe(c)}${c.json === json ? "" : " (older version)"}`);
  if (copies.length === 0)
    return {
      kind: "draft",
      text: "Draft in this browser only",
      warning: true,
      details: ["Not saved to a board or a file."],
    };

  const onBoard = (copy: SavedCopy): boolean => {
    if (board === null) return true;
    if (board === "unknown") return false;
    const stored = board.entries.find((f) => f.id === copy.name);
    if (stored !== undefined && stored.sha256 !== null && stored.sha256 === copy.sha256) return true;
    return board.staleSince !== null && copy.at >= board.staleSince;
  };
  const current = copies.filter((c) => c.json === json);
  const live = current.filter((c) => c.kind !== "board" || onBoard(c)).sort((a, b) => b.at - a.at);
  const newest = live[0];
  if (newest) return { kind: newest.kind, text: describe(newest), warning: false, details };
  if (current.length > 0 && board === "unknown")
    return {
      kind: "unchecked",
      text: "Board copy not checked",
      warning: true,
      details: [
        ...details,
        "Nothing is known yet about the files on the connected board, so its copy is not counted as saved.",
      ],
    };
  if (current.length > 0)
    return {
      kind: "not-on-board",
      text: "Not on the connected board",
      warning: true,
      details: [...details, "The connected board has no file with this ID and content."],
    };
  const last = [...copies].sort((a, b) => b.at - a.at)[0] as SavedCopy;
  return { kind: "changed", text: `Changed since: ${describeBefore(last)}`, warning: true, details };
}
