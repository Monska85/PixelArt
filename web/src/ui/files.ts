// SPDX-License-Identifier: GPL-3.0-or-later

// Saving files and reading what the user picked.

import { jsonBytes } from "../yaml/writeJson";
import { writeYaml } from "../yaml/writeYaml";
import {
  ANIMATION_JSON_DEPTH,
  isObject,
  loadAnimation,
  loadPlaylist,
  parseStrictJson,
  type Diagnostic,
  type JsonValue,
} from "../engine";
import type { Kind } from "../protocol";

const MAX_PICKED_BYTES = 1024 * 1024;

/** A file name made only of characters that are safe on every system. */
function safeFileName(name: string): string {
  return name.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 64) || "file";
}

export function saveBytes(bytes: Uint8Array, fileName: string, type: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = safeFileName(fileName);
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** The YAML text for the bytes of a stored JSON file. */
export function jsonBytesToYaml(bytes: Uint8Array): string {
  const parsed = parseStrictJson(bytes, ANIMATION_JSON_DEPTH);
  if (!parsed.ok) throw new Error(`The file is not valid JSON, so it cannot be converted: ${parsed.reason}`);
  return writeYaml(parsed.value);
}

export async function readPicked(file: File): Promise<Uint8Array> {
  if (file.size > MAX_PICKED_BYTES)
    throw new Error("The file is larger than 1 MiB, far above the limit of any file the board stores.");
  return new Uint8Array(await file.arrayBuffer());
}

type Prepared = { ok: true; bytes: Uint8Array; document: JsonValue } | { ok: false; message: string };

/**
 * The JSON bytes to upload for a picked file: YAML is converted, JSON is kept byte for byte. The YAML reader is a
 * large library, so it is loaded the first time a YAML file needs it.
 */
export async function prepareUpload(fileName: string, bytes: Uint8Array): Promise<Prepared> {
  if (/\.ya?ml$/i.test(fileName)) {
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return { ok: false, message: "The YAML file is not valid UTF-8 text." };
    }
    const { readYaml } = await import("../yaml/read");
    const read = readYaml(text);
    if (!read.ok)
      return { ok: false, message: `${read.line !== undefined ? `Line ${read.line}: ` : ""}${read.message}` };
    return { ok: true, bytes: jsonBytes(read.value), document: read.value };
  }
  const parsed = parseStrictJson(bytes, ANIMATION_JSON_DEPTH);
  if (!parsed.ok) return { ok: false, message: `The file is not valid JSON: ${parsed.reason}` };
  return { ok: true, bytes, document: parsed.value };
}

const KINDS: Record<string, Kind> = { "pixelart/1": "animation", "pixelart-playlist/1": "playlist" };

/** The name of a file the app reads: JSON or YAML. */
export const SUPPORTED_FILE = /\.(json|ya?ml)$/i;

/** The ID of a file: its name without the extension, lower-cased. */
export const idFromFileName = (name: string): string => name.replace(SUPPORTED_FILE, "").toLowerCase();

/** A valid ID close to a file name, offered to the user. */
export function suggestId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^[_-]+/, "")
    .slice(0, 32);
}

/** Which kind of file a document is, from its `format`. */
export function detectKind(document: JsonValue): { ok: true; kind: Kind } | { ok: false; message: string } {
  const format = isObject(document) ? document.get("format") : undefined;
  const kind = typeof format === "string" ? KINDS[format] : undefined;
  if (kind) return { ok: true, kind };
  const described = typeof format === "string" ? `"${format}"` : format === undefined ? "missing" : "not a text";
  return {
    ok: false,
    message: `The format of this file is ${described}, which is neither "pixelart/1" nor "pixelart-playlist/1".`,
  };
}

/** The app's own check of a file, with the diagnostics whether it passes or not. */
export function validateFile(kind: Kind, bytes: Uint8Array): { ok: boolean; diagnostics: Diagnostic[] } {
  const result = kind === "animation" ? loadAnimation(bytes) : loadPlaylist(bytes);
  const rejected = ("animation" in result ? result.animation : result.items) === null;
  return { ok: !rejected, diagnostics: result.diagnostics };
}

type Inspected =
  | { ok: true; kind: Kind; bytes: Uint8Array; diagnostics: Diagnostic[] }
  | {
      ok: false;
      /** "refused": not a file this app knows. "rejected": the engine found errors. */
      status: "refused" | "rejected";
      message: string;
      diagnostics: Diagnostic[];
      kind?: Kind;
    };

/** Conversion, kind and check of a picked file, in the order of the spec. Pure: nothing is sent. */
export async function inspectFile(fileName: string, picked: Uint8Array): Promise<Inspected> {
  const prepared = await prepareUpload(fileName, picked);
  if (!prepared.ok) return { ok: false, status: "refused", message: prepared.message, diagnostics: [] };
  const detected = detectKind(prepared.document);
  if (!detected.ok) return { ok: false, status: "refused", message: detected.message, diagnostics: [] };
  const checked = validateFile(detected.kind, prepared.bytes);
  if (!checked.ok)
    return {
      ok: false,
      status: "rejected",
      message: "The file has errors and was not uploaded.",
      diagnostics: checked.diagnostics,
      kind: detected.kind,
    };
  return { ok: true, kind: detected.kind, bytes: prepared.bytes, diagnostics: checked.diagnostics };
}
