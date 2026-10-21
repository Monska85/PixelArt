// The connected board's stored files, one list per kind, read through one function. The session owns it, so the
// Board view, the Library, the editor's save state and the leave-the-page check all see the same lists.

import type { Entry, Kind } from "../protocol";

/**
 * One list. "loading": not read yet since the connection was made. "unknown": the last read failed, so nothing is
 * known about the board's files of this kind. `staleSince` (milliseconds): a change happened and the list is being
 * read again since then; null when the entries are current.
 */
export type BoardFileList =
  | { status: "loading" }
  | { status: "known"; entries: Entry[]; staleSince: number | null }
  | { status: "unknown"; error: unknown };

export interface FileLists {
  animation: BoardFileList;
  playlist: BoardFileList;
}

export const KINDS: Kind[] = ["animation", "playlist"];

export const NO_LISTS: FileLists = { animation: { status: "loading" }, playlist: { status: "loading" } };

export class FileListReader {
  private lists: FileLists = NO_LISTS;
  /** Counts the reads of each kind: a read that is not the latest one never replaces a newer result. */
  private sequence: Record<Kind, number> = { animation: 0, playlist: 0 };

  constructor(
    private readonly read: (kind: Kind) => Promise<Entry[]>,
    private readonly publish: (lists: FileLists) => void,
  ) {}

  get current(): FileLists {
    return this.lists;
  }

  /** Forgets everything, for a new connection or none: reads still in flight are discarded. */
  reset(): void {
    for (const kind of KINDS) this.sequence[kind]++;
    this.lists = NO_LISTS;
    this.publish(this.lists);
  }

  /** Reads the lists of these kinds again. Never rejects: a failed read leaves the list "unknown". */
  async refresh(kinds: readonly Kind[]): Promise<void> {
    await Promise.all(kinds.map((kind) => this.refreshOne(kind)));
  }

  private async refreshOne(kind: Kind): Promise<void> {
    const mine = ++this.sequence[kind];
    const before = this.lists[kind];
    // An earlier read still running keeps its start: a save between the two starts must still count.
    if (before.status === "known") this.put(kind, { ...before, staleSince: before.staleSince ?? Date.now() });
    let next: BoardFileList;
    try {
      next = { status: "known", entries: await this.read(kind), staleSince: null };
    } catch (error) {
      next = { status: "unknown", error };
    }
    if (mine === this.sequence[kind]) this.put(kind, next);
  }

  private put(kind: Kind, list: BoardFileList): void {
    this.lists = { ...this.lists, [kind]: list };
    this.publish(this.lists);
  }
}
