// The upload queue's decisions (docs/web/web-app-v1.md#upload-queue), with no access to the page or the board:
// what a file needs (missing, identical, different), which animations a playlist brings, how much space a batch
// needs, in which order files go, and what became of them. The caller reads the board and sends the files.

import { isArray, isObject, parseStrictJson, PLAYLIST_JSON_DEPTH, type Diagnostic } from "../engine";
import type { Entry, Kind } from "../protocol";
import type { Manifest, Published } from "../release/manifest";

/** A file that passed the app's own check and is ready to go. */
export interface QueueFile {
  kind: Kind;
  id: string;
  bytes: Uint8Array;
  /** Lowercase hexadecimal SHA-256 of `bytes`. */
  sha256: string;
  /** Where it came from, for messages: a file name, or "the Library". */
  origin: string;
  /** The app's own warnings for the file, shown when the board has none of its own. */
  localWarnings?: Diagnostic[];
}

export interface StoredFiles {
  animation: Entry[];
  playlist: Entry[];
}

export type PlanStatus = "missing" | "identical" | "different";

export interface PlanEntry {
  file: QueueFile;
  status: PlanStatus;
  /** The stored file with this kind and ID, if any. */
  stored: Entry | null;
}

/** The queue sees one file per kind and ID: the first one wins, the others are reported. */
export function dedupe(files: QueueFile[]): { files: QueueFile[]; duplicates: QueueFile[] } {
  const seen = new Map<string, QueueFile>();
  const kept: QueueFile[] = [];
  const duplicates: QueueFile[] = [];
  for (const file of files) {
    const key = `${file.kind}/${file.id}`;
    const first = seen.get(key);
    if (!first) {
      seen.set(key, file);
      kept.push(file);
    } else if (first.sha256 !== file.sha256) duplicates.push(file);
  }
  return { files: kept, duplicates };
}

/** Sorts each file into missing, identical (same SHA-256) or different, against the board's list. */
export function planAgainstBoard(files: QueueFile[], stored: StoredFiles): PlanEntry[] {
  return files.map((file) => {
    const entry = stored[file.kind].find((e) => e.id === file.id) ?? null;
    if (!entry) return { file, status: "missing", stored: null };
    const same = entry.sha256 !== null && entry.sha256.toLowerCase() === file.sha256;
    return { file, status: same ? "identical" : "different", stored: entry };
  });
}

/** Every animation a playlist names, enabled or not, once each, in order. Not a valid playlist: none. */
export function playlistAnimations(bytes: Uint8Array): string[] {
  const parsed = parseStrictJson(bytes, PLAYLIST_JSON_DEPTH);
  if (!parsed.ok || !isObject(parsed.value)) return [];
  const items = parsed.value.get("items");
  if (!isArray(items)) return [];
  const names: string[] = [];
  for (const item of items) {
    const name = isObject(item) ? item.get("animation") : undefined;
    if (typeof name === "string" && !names.includes(name)) names.push(name);
  }
  return names;
}

export interface Resolution {
  /** Animations to download from the Library, because nothing in the queue has them. */
  fromLibrary: Published[];
  /** Named animations that only the board has: nothing to send, the board's copy is used. */
  onBoard: string[];
  /** Named animations found nowhere, with the playlists that name them. */
  missing: Array<{ animation: string; playlists: string[] }>;
}

/**
 * Where each animation named by the playlists of `files` comes from: the same selection first, then the published
 * Library (compared with the board like any file), then the board's own copy. Names found nowhere are `missing`.
 */
export function resolveAnimations(files: QueueFile[], stored: StoredFiles, library: Manifest | null): Resolution {
  const have = new Set(files.filter((f) => f.kind === "animation").map((f) => f.id));
  const result: Resolution = { fromLibrary: [], onBoard: [], missing: [] };
  for (const playlist of files.filter((f) => f.kind === "playlist")) {
    for (const name of playlistAnimations(playlist.bytes)) {
      if (have.has(name)) continue;
      const published = library?.animations.find((e) => e.id === name);
      if (published) {
        result.fromLibrary.push(published);
        have.add(name);
      } else if (stored.animation.some((e) => e.id === name)) {
        if (!result.onBoard.includes(name)) result.onBoard.push(name);
      } else {
        const known = result.missing.find((m) => m.animation === name);
        if (known) known.playlists.push(playlist.id);
        else result.missing.push({ animation: name, playlists: [playlist.id] });
      }
    }
  }
  return result;
}

/** The board allocates space in blocks of this many bytes (`storage::BLOCK_SIZE`). */
export const BLOCK_SIZE = 4096;

export const blocksOf = (size: number): number => Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE;

export interface SpaceCheck {
  /** Bytes the files need, in whole blocks. */
  needed: number;
  /** Bytes the replaced files give back, each one only after its replacement is stored. */
  freed: number;
  free: number;
  /** How much more free space the tightest point of the queue needs: 0 when everything fits. */
  short: number;
}

/**
 * Plays the sends in order against the board's free space, in 4,096-byte blocks. The board needs room for the new
 * file while the old one still exists (`put_begin` checks it, and the old file goes at the rename), so a replaced
 * file gives its blocks back only after its own upload. `short` is the most any file lacks at its turn, assuming
 * the files before it were stored. `storage` unknown (a board that does not say) means no check: `short` is 0.
 */
export function checkSpace(sends: PlanEntry[], storage: { total: number; used: number } | null): SpaceCheck {
  const needed = sends.reduce((sum, e) => sum + blocksOf(e.file.bytes.length), 0);
  const freed = sends.reduce((sum, e) => sum + (e.stored ? blocksOf(e.stored.size) : 0), 0);
  if (!storage) return { needed, freed, free: Infinity, short: 0 };
  const free = Math.max(0, storage.total - storage.used);
  let left = free;
  let short = 0;
  for (const e of sends) {
    const size = blocksOf(e.file.bytes.length);
    short = Math.max(short, size - left);
    left += (e.stored ? blocksOf(e.stored.size) : 0) - size;
  }
  return { needed, freed, free, short };
}

/** Animations first, playlists last, each kind in the order given: a playlist never arrives before its animations. */
export function sendOrder<T extends { file: QueueFile }>(entries: T[]): T[] {
  return [...entries.filter((e) => e.file.kind === "animation"), ...entries.filter((e) => e.file.kind === "playlist")];
}

export type SendOutcome =
  | { status: "done"; warnings: Array<{ severity: string; code: string; where: string; message: string }> }
  | { status: "cancelled" }
  | { status: "failed"; error: unknown };

export interface QueueSummary {
  uploaded: Array<{ file: QueueFile; warnings: Extract<SendOutcome, { status: "done" }>["warnings"] }>;
  /** Not sent because the board has the same file, or because the user kept the board's file. */
  skipped: Array<{ file: QueueFile; reason: "identical" | "kept" }>;
  failed: { file: QueueFile; error: unknown } | null;
  notAttempted: QueueFile[];
  cancelled: boolean;
}

/**
 * Sends the files one at a time through `send`, which reports each outcome. It stops at the first file that fails
 * or is cancelled, so a playlist is never sent after one of the animations before it failed. Running the same
 * queue again resumes: identical files are skipped by the plan.
 */
export async function runSends(
  sends: PlanEntry[],
  skipped: QueueSummary["skipped"],
  send: (file: QueueFile, index: number, total: number) => Promise<SendOutcome>,
): Promise<QueueSummary> {
  const summary: QueueSummary = {
    uploaded: [],
    skipped: [...skipped],
    failed: null,
    notAttempted: [],
    cancelled: false,
  };
  for (const [index, entry] of sends.entries()) {
    const outcome = await send(entry.file, index, sends.length);
    if (outcome.status === "done") {
      summary.uploaded.push({ file: entry.file, warnings: outcome.warnings });
      continue;
    }
    if (outcome.status === "cancelled") summary.cancelled = true;
    else summary.failed = { file: entry.file, error: outcome.error };
    summary.notAttempted = sends.slice(index + (outcome.status === "cancelled" ? 0 : 1)).map((e) => e.file);
    break;
  }
  return summary;
}
