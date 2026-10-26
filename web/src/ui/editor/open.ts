// SPDX-License-Identifier: GPL-3.0-or-later

// Ways to open an animation in the editor.

import { ANIMATION_JSON_DEPTH, isObject, isValidId, parseStrictJson, type JsonValue } from "../../engine";
import { NO_SAVES, type Saves } from "../../editor/saves";
import { writeJson } from "../../yaml/writeJson";
import { navigatedSince } from "../navigation";
import { idFromFileName, prepareUpload, readPicked } from "../files";
import type { DraftOrigin } from "./drafts";
import type { Opening } from "./store";

export type Opened = { ok: true; opening: Opening } | { ok: false; message: string };

function check(document: JsonValue, id: string | null, source: string, saves: Saves = NO_SAVES): Opened {
  if (!isObject(document))
    return { ok: false, message: "The file is not an animation: its top level is not a mapping." };
  const format = document.get("format");
  if (format === "pixelart-playlist/1")
    return { ok: false, message: "This file is a playlist. The editor opens animations." };
  return { ok: true, opening: { doc: document, id: id !== null && isValidId(id) ? id : null, source, saves } };
}

/** Opens a picked `.yaml`, `.yml` or `.json` file. */
export async function readAnimationFile(file: File): Promise<Opened> {
  let bytes: Uint8Array;
  try {
    bytes = await readPicked(file);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "The file cannot be read." };
  }
  const prepared = await prepareUpload(file.name, bytes);
  if (!prepared.ok) return { ok: false, message: prepared.message };
  const copy = { kind: "file", name: file.name, at: Date.now(), json: writeJson(prepared.document) } as const;
  return check(prepared.document, idFromFileName(file.name), `The file ${file.name}`, { board: null, file: copy });
}

/**
 * Opens the bytes of a stored or published JSON file. `onBoard` says the bytes are the board's file `id`, with its
 * SHA-256: the document then starts as saved to the board.
 */
export function readAnimationBytes(
  bytes: Uint8Array,
  id: string,
  source: string,
  onBoard?: { sha256: string },
): Opened {
  const parsed = parseStrictJson(bytes, ANIMATION_JSON_DEPTH);
  if (!parsed.ok) return { ok: false, message: `The file is not valid JSON: ${parsed.reason}` };
  const saves: Saves = onBoard
    ? {
        board: { kind: "board", name: id, at: Date.now(), json: writeJson(parsed.value), sha256: onBoard.sha256 },
        file: null,
      }
    : NO_SAVES;
  return check(parsed.value, id, source, saves);
}

/**
 * Opens a document from a view and then shows the editor: at once, or after the user agrees to discard the unsaved
 * changes of the document being edited. The editor is also shown when the user keeps the document being edited.
 * A request that a newer one replaced shows nothing: the newer one decides. When the user went to another view
 * since `mark` (taken when they asked, before the download), the document is still opened in the store but the
 * view stays where the user is.
 */
export async function showInEditor(opening: Opening, from: DraftOrigin, mark: number): Promise<void> {
  // The editor's store holds the YAML library: it is loaded here, or at start-up, never with the first paint.
  const { editorStore } = await import("./store");
  const result = await editorStore.request({ ...opening, from });
  if (result !== "superseded" && !navigatedSince(mark)) window.location.hash = "editor";
}
