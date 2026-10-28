// SPDX-License-Identifier: GPL-3.0-or-later

// Port of lib/PixelEngine/src/server_choice.cpp: the pixelart-play/1 loader (docs/format/play-v1.md). Whether the
// schedule or the playlists exist is not a rule of the format.

import { PLAY_JSON_DEPTH, isArray, isObject, parseStrictJson, type JsonValue } from "./json";
import type { ServerChoice } from "./schedule";
import { MAX_DIAGNOSTICS, MAX_PLAY_FILE_SIZE, MAX_SCHEDULE_PLAYLISTS, isValidId, type Diagnostic } from "./types";

export interface PlayResult {
  /** The `default` of the file, or null when the file has errors. */
  choice: ServerChoice | null;
  diagnostics: Diagnostic[];
}

type Fault = "structure" | "limit_exceeded";

const idOf = (value: JsonValue | undefined): string | null =>
  typeof value === "string" && isValidId(value) ? value : null;

/** The `default` object, or the fault with its message. Called only when the object has no unknown key. */
function readChoice(value: JsonValue | undefined): ServerChoice | { fault: Fault; message: string } {
  const shape = "must be an object with one of schedule or playlists";
  if (!isObject(value) || value.size !== 1) return { fault: "structure", message: shape };
  const schedule = value.get("schedule");
  if (schedule !== undefined && schedule !== null) {
    const id = idOf(schedule);
    return id === null
      ? { fault: "structure", message: "schedule must be a schedule ID: lowercase letters, digits, _ and -" }
      : { schedule: id };
  }
  const list = value.get("playlists");
  if (!isArray(list)) return { fault: "structure", message: shape };
  if (list.length > MAX_SCHEDULE_PLAYLISTS)
    return { fault: "limit_exceeded", message: `more than ${MAX_SCHEDULE_PLAYLISTS} playlists` };
  const playlists: string[] = [];
  for (const item of list) {
    const id = idOf(item);
    if (id === null || playlists.includes(id))
      return {
        fault: "structure",
        message: `playlists must be 1 to ${MAX_SCHEDULE_PLAYLISTS} playlist IDs, none twice: lowercase letters, digits, _ and -`,
      };
    playlists.push(id);
  }
  if (playlists.length === 0)
    return {
      fault: "structure",
      message: `playlists must be 1 to ${MAX_SCHEDULE_PLAYLISTS} playlist IDs, none twice: lowercase letters, digits, _ and -`,
    };
  return { playlists };
}

/** Parses and validates a play file (docs/format/play-v1.md#validation). */
export function loadPlay(bytes: Uint8Array): PlayResult {
  const diagnostics: Diagnostic[] = [];
  let ok = true;
  // Keeps at most MAX_DIAGNOSTICS entries, like the other loaders.
  const error = (code: string, where: string, message: string): void => {
    if (diagnostics.length < MAX_DIAGNOSTICS) diagnostics.push({ severity: "error", code, where, message });
    ok = false;
  };
  const rejected = (): PlayResult => ({ choice: null, diagnostics });

  if (bytes.length > MAX_PLAY_FILE_SIZE) {
    error("limit_exceeded", "", `file larger than ${MAX_PLAY_FILE_SIZE / 1024} KiB`);
    return rejected();
  }
  const parsed = parseStrictJson(bytes, PLAY_JSON_DEPTH);
  if (!parsed.ok) {
    error("structure", "", `not valid JSON: ${parsed.reason}`);
    return rejected();
  }
  const root = parsed.value;
  const format = isObject(root) ? root.get("format") : undefined;
  if (!isObject(root) || format !== "pixelart-play/1") {
    error("format_unsupported", "format", `unsupported format "${typeof format === "string" ? format : ""}"`);
    return rejected();
  }

  for (const key of root.keys())
    if (key !== "format" && key !== "default") error("structure", key, `unknown field "${key}"`);
  const value = root.get("default");
  if (value === undefined) {
    error("structure", "default", "is required");
    return rejected();
  }

  let unknownKey = false;
  if (isObject(value))
    for (const key of value.keys())
      if (key !== "schedule" && key !== "playlists") {
        error("structure", `default.${key}`, `unknown field "${key}"`);
        unknownKey = true;
      }
  let choice: ServerChoice | null = null;
  if (!unknownKey) {
    const read = readChoice(value);
    if ("fault" in read) error(read.fault, "default", read.message);
    else choice = read;
  }
  return ok && choice ? { choice, diagnostics } : rejected();
}
