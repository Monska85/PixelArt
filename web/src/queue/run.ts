// SPDX-License-Identifier: GPL-3.0-or-later

// One run of the upload queue (docs/web/web-app-v1.md#upload-queue), from files that already passed the app's own
// check to the summary: read the board, bring a playlist's animations, ask about what differs, check the space,
// send. It has no access to the page: the questions, the notices, the free-space reading and the sending come in
// through `RunDeps`, so a test can script all of them.

import { loadAnimation, type Diagnostic } from "../engine";
import { listFiles, type BoardClient } from "../protocol";
import { downloadPublished } from "../release/library";
import { loadManifest, type Manifest, type Published } from "../release/manifest";
import {
  checkSpace,
  dedupe,
  planAgainstBoard,
  playlistAnimations,
  resolveAnimations,
  sendOrder,
  type PlanEntry,
  type QueueFile,
  type QueueSummary,
  type Resolution,
  type SpaceCheck,
  type StoredFiles,
} from "./plan";

export type DifferingChoice = "replace" | "keep";

/** Something to tell the user that does not stop the run: a file left out, a copy that was not used. */
export interface Notice {
  /** What the queue was doing. */
  context: string;
  /** With `message`, a notice of the queue's own; otherwise `error` says what happened. */
  code?: string;
  message?: string;
  error?: unknown;
  diagnostics?: Diagnostic[];
  warning?: boolean;
}

/** Why the run stopped without a summary. `busy` and `not_connected` are decided by the caller before a run starts. */
export type Refusal =
  | { reason: "busy" }
  | { reason: "not_connected" }
  | { reason: "read_failed"; error: unknown }
  | { reason: "no_space"; space: SpaceCheck }
  | { reason: "failed"; error: unknown };

export type RunResult =
  | { status: "refused"; refusal: Refusal }
  /** The user answered Cancel to a question: nothing was sent. */
  | { status: "cancelled" }
  | { status: "summary"; summary: QueueSummary };

export interface RunDeps {
  client: BoardClient;
  ask: {
    differing: (entries: PlanEntry[]) => Promise<DifferingChoice | null>;
    missing: (missing: Resolution["missing"]) => Promise<boolean>;
  };
  notify: (notice: Notice) => void;
  /** The board's storage, read again now, or null when it does not say. */
  storage: () => Promise<{ total: number; used: number } | null>;
  /** Sends the planned files, in order, under the upload lock. */
  send: (sends: PlanEntry[], skipped: QueueSummary["skipped"]) => Promise<QueueSummary>;
  /**
   * The published release to take missing animations from. `undefined` reads it when a playlist needs it, `null`
   * says there is none.
   */
  manifest?: Manifest | null;
  download?: typeof downloadPublished;
}

async function readBoard(client: BoardClient): Promise<StoredFiles> {
  const animation = await listFiles(client, "animation");
  const playlist = await listFiles(client, "playlist");
  return { animation, playlist };
}

/** The animations that a playlist names and nothing in the queue has, taken from the Library. */
async function fromLibrary(entries: Published[], deps: RunDeps): Promise<{ files: QueueFile[]; failed: string[] }> {
  const download = deps.download ?? downloadPublished;
  const files: QueueFile[] = [];
  const failed: string[] = [];
  for (const entry of entries) {
    const context = `Installing animation ${entry.id}`;
    try {
      const bytes = await download("animation", entry);
      const checked = loadAnimation(bytes);
      if (checked.animation === null) {
        deps.notify({
          context,
          code: "rejected",
          message: "The published file has errors and was not used.",
          diagnostics: checked.diagnostics,
        });
        failed.push(entry.id);
      } else files.push({ kind: "animation", id: entry.id, bytes, sha256: entry.sha256, origin: "the Library" });
    } catch (error) {
      deps.notify({ context, error });
      failed.push(entry.id);
    }
  }
  return { files, failed };
}

export async function runQueue(deps: RunDeps, input: QueueFile[]): Promise<RunResult> {
  const { files: unique, duplicates } = dedupe(input);
  for (const file of duplicates)
    deps.notify({
      context: `Uploading ${file.origin}`,
      code: "duplicate",
      message: `The ${file.kind} ${file.id} is there twice with different content. The first one is used.`,
      warning: true,
    });

  let stored: StoredFiles;
  try {
    stored = await readBoard(deps.client);
  } catch (error) {
    return { status: "refused", refusal: { reason: "read_failed", error } };
  }

  let all = unique;
  if (unique.some((f) => f.kind === "playlist")) {
    const library = deps.manifest === undefined ? await loadManifest() : deps.manifest;
    const resolution = resolveAnimations(unique, stored, library);
    const loaded = await fromLibrary(resolution.fromLibrary, deps);
    const missing = [...resolution.missing];
    // A download that failed leaves the animation missing only when the board does not store it either.
    for (const id of loaded.failed) {
      if (stored.animation.some((e) => e.id === id)) continue;
      const playlists = unique
        .filter((f) => f.kind === "playlist" && playlistAnimations(f.bytes).includes(id))
        .map((f) => f.id);
      missing.push({ animation: id, playlists });
    }
    if (missing.length > 0 && !(await deps.ask.missing(missing))) return { status: "cancelled" };
    all = [...unique, ...loaded.files];
  }

  const entries = planAgainstBoard(all, stored);
  const differing = entries.filter((e) => e.status === "different");
  let choice: DifferingChoice = "replace";
  if (differing.length > 0) {
    const answer = await deps.ask.differing(differing);
    if (answer === null) return { status: "cancelled" };
    choice = answer;
  }
  const skipped: QueueSummary["skipped"] = [];
  const sends: PlanEntry[] = [];
  for (const entry of entries) {
    if (entry.status === "identical") skipped.push({ file: entry.file, reason: "identical" });
    else if (entry.status === "different" && choice === "keep") skipped.push({ file: entry.file, reason: "kept" });
    else sends.push(entry);
  }
  const ordered = sendOrder(sends);
  if (ordered.length === 0)
    return {
      status: "summary",
      summary: { uploaded: [], skipped, failed: null, notAttempted: [], cancelled: false },
    };

  let storage: Awaited<ReturnType<RunDeps["storage"]>>;
  try {
    storage = await deps.storage();
  } catch (error) {
    return { status: "refused", refusal: { reason: "read_failed", error } };
  }
  const space = checkSpace(ordered, storage);
  if (space.short > 0) return { status: "refused", refusal: { reason: "no_space", space } };

  try {
    return { status: "summary", summary: await deps.send(ordered, skipped) };
  } catch (error) {
    return { status: "refused", refusal: { reason: "failed", error } };
  }
}
