// Port of lib/PixelEngine/src/playlist.cpp.

import {
  PLAYLIST_JSON_DEPTH,
  codePointLength,
  isArray,
  isInteger,
  isObject,
  parseStrictJson,
  type JsonObject,
  type JsonValue,
} from "./json";
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  MAX_DIAGNOSTICS,
  MAX_PLAYLIST_FILE_SIZE,
  MAX_PLAYLIST_ITEMS,
  MAX_PLAYLIST_REPEAT,
  isValidId,
  type Diagnostic,
  type PlaylistItem,
  type PlaylistResult,
} from "./types";

const isNull = (value: JsonValue | undefined): boolean => value === undefined || value === null;

/** Parses and validates a pixelart-playlist/1 file. Disabled items are dropped. */
export function loadPlaylist(bytes: Uint8Array): PlaylistResult {
  const diagnostics: Diagnostic[] = [];
  let ok = true;
  // Keeps at most MAX_DIAGNOSTICS entries; a playlist has no warnings.
  const error = (code: string, where: string, message: string): void => {
    if (diagnostics.length < MAX_DIAGNOSTICS) diagnostics.push({ severity: "error", code, where, message });
    ok = false;
  };
  const rejected = (): PlaylistResult => ({ items: null, diagnostics });

  if (bytes.length > MAX_PLAYLIST_FILE_SIZE) {
    error("limit_exceeded", "", `file larger than ${MAX_PLAYLIST_FILE_SIZE / 1024} KiB`);
    return rejected();
  }
  const parsed = parseStrictJson(bytes, PLAYLIST_JSON_DEPTH);
  if (!parsed.ok) {
    error("structure", "", `not valid JSON: ${parsed.reason}`);
    return rejected();
  }
  const root: JsonValue = parsed.value;
  const format = isObject(root) ? root.get("format") : undefined;
  if (!isObject(root) || format !== "pixelart-playlist/1") {
    error("format_unsupported", "format", `unsupported format "${typeof format === "string" ? format : ""}"`);
    return rejected();
  }

  for (const key of root.keys())
    if (!["format", "name", "canvas", "items"].includes(key)) error("structure", key, `unknown field "${key}"`);

  const name = root.get("name");
  if (!isNull(name) && (typeof name !== "string" || name === "" || codePointLength(name) > 128))
    error("structure", "name", "must be a text of 1 to 128 characters");

  const canvas = root.get("canvas");
  const width = isObject(canvas) ? canvas.get("width") : undefined;
  const height = isObject(canvas) ? canvas.get("height") : undefined;
  if (!isObject(canvas) || canvas.size !== 2 || !isInteger(width) || !isInteger(height))
    error("structure", "canvas", "must be { width, height }");
  else if (width.value !== CANVAS_WIDTH || height.value !== CANVAS_HEIGHT)
    error("canvas_mismatch", "canvas", "the playlist is made for a different matrix than 16x16");

  const items = root.get("items");
  if (!isArray(items) || items.length === 0) {
    error("structure", "items", "must be a non-empty list");
    return rejected();
  }
  if (items.length > MAX_PLAYLIST_ITEMS) {
    error("limit_exceeded", "items", `more than ${MAX_PLAYLIST_ITEMS} items`);
    return rejected();
  }

  const result: PlaylistItem[] = [];
  items.forEach((entry, i) => {
    const where = `items[${i}]`;
    if (!isObject(entry)) {
      error("structure", where, 'must be an object with "animation"');
      return;
    }
    const item: JsonObject = entry;
    for (const key of item.keys())
      if (!["animation", "repeat", "enabled"].includes(key))
        error("structure", `${where}.${key}`, `unknown field "${key}"`);
    const id = item.get("animation");
    if (typeof id !== "string" || !isValidId(id)) {
      error("structure", `${where}.animation`, "must be an animation ID: lowercase letters, digits, _ and -");
      return;
    }
    let repeat = 1;
    const repeatValue = item.get("repeat");
    if (!isNull(repeatValue)) {
      if (!isInteger(repeatValue) || repeatValue.value < 1 || repeatValue.value > MAX_PLAYLIST_REPEAT) {
        error("structure", `${where}.repeat`, `must be an integer from 1 to ${MAX_PLAYLIST_REPEAT}`);
        return;
      }
      repeat = repeatValue.value;
    }
    let enabled = true;
    const enabledValue = item.get("enabled");
    if (!isNull(enabledValue)) {
      if (typeof enabledValue !== "boolean") {
        error("structure", `${where}.enabled`, "must be true or false");
        return;
      }
      enabled = enabledValue;
    }
    if (enabled) result.push({ animation: id, repeat });
  });
  return ok ? { items: result, diagnostics } : rejected();
}
