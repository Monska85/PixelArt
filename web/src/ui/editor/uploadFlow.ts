// SPDX-License-Identifier: GPL-3.0-or-later

import type { QueueFile } from "../../queue/plan";
import type { Doc } from "../../editor/doc";
import type { ShownError } from "../errors";
import type { QueueOutcome } from "../queue/summary";
import type { UploadQueue } from "../queue/useUploadQueue";

/** What the editor's upload has once the document is checked: the ID, the document and the file the queue sends. */
export interface PreparedUpload {
  id: string;
  doc: Doc;
  bytes: Uint8Array;
  file: QueueFile;
}

export type EditorUpload =
  /** The preparation ended the upload itself (a cancelled question, an invalid animation it already reported). */
  | { status: "ended" }
  /** The queue refused, or the preparation threw: the editor shows `shown`, because the queue was asked to stay quiet. */
  | { status: "refused"; shown: ShownError }
  | { status: "finished"; prepared: PreparedUpload; outcome: Exclude<QueueOutcome, { status: "refused" }> };

/**
 * Runs the editor's upload through the queue, holding the queue from the preparation to the last byte. A refusal is
 * reported before anything of the preparation is read, so a preparation that failed cannot end the upload silently.
 */
export async function runEditorUpload(
  uploadAfter: UploadQueue["uploadAfter"],
  prepare: () => Promise<PreparedUpload | null>,
): Promise<EditorUpload> {
  const held: { prepared: PreparedUpload | null } = { prepared: null };
  const outcome = await uploadAfter(
    async () => {
      held.prepared = await prepare();
      return held.prepared ? [held.prepared.file] : null;
    },
    { manifest: null, quiet: true },
  );
  if (outcome?.status === "refused") return { status: "refused", shown: outcome.shown };
  if (!outcome || !held.prepared) return { status: "ended" };
  return { status: "finished", prepared: held.prepared, outcome };
}
