// SPDX-License-Identifier: GPL-3.0-or-later

// The playlist editor's model: a stored playlist as items the editor changes, and back to a document.

import {
  isObject,
  JsonNumber,
  parseStrictJson,
  PLAYLIST_JSON_DEPTH,
  type JsonObject,
  type JsonValue,
} from "../../engine";
import { downloadFile, type BoardClient } from "../../protocol";
import { writeJson } from "../../yaml/writeJson";

export interface EditorItem {
  key: number;
  animation: string;
  repeat: number;
  enabled: boolean;
  /** The item as it was in the file, so its other fields survive. */
  original: JsonObject | null;
}

export interface PlaylistModel {
  id: string;
  isNew: boolean;
  name: string;
  /** The document as it was in the file, so its other fields survive. */
  original: JsonObject | null;
  items: EditorItem[];
}

let nextKey = 1;

/** A key for a new item of the editor. */
export const newItemKey = (): number => nextKey++;

export function newModel(): PlaylistModel {
  return { id: "", isNew: true, name: "", original: null, items: [] };
}

const integer = (value: JsonValue | undefined, fallback: number): number =>
  value instanceof JsonNumber && value.integer ? value.value : fallback;

/** The editor's model of a stored playlist, or an error message when the file is not one. */
export function modelFromBytes(id: string, bytes: Uint8Array): PlaylistModel | string {
  const parsed = parseStrictJson(bytes, PLAYLIST_JSON_DEPTH);
  if (!parsed.ok || !isObject(parsed.value))
    return "This file is not a playlist the editor can open: it is not valid JSON.";
  const items = parsed.value.get("items");
  if (!Array.isArray(items)) return "This file is not a playlist the editor can open: it has no list of items.";
  const name = parsed.value.get("name");
  return {
    id,
    isNew: false,
    name: typeof name === "string" ? name : "",
    original: parsed.value,
    items: items.map((entry) => {
      const item = isObject(entry) ? entry : null;
      const animation = item?.get("animation");
      return {
        key: nextKey++,
        animation: typeof animation === "string" ? animation : "",
        repeat: integer(item?.get("repeat"), 1),
        enabled: item?.get("enabled") !== false,
        original: item,
      };
    }),
  };
}

/** What a model would store, with its ID: two models with the same key are the same playlist. */
export const contentKey = (model: PlaylistModel): string => `${model.id}\n${writeJson(documentFromModel(model))}`;

/** The playlist document for a model: fields of the original kept, defaults left out. */
export function documentFromModel(model: PlaylistModel): JsonValue {
  const root: JsonObject = model.original
    ? new Map(model.original)
    : new Map<string, JsonValue>([
        ["format", "pixelart-playlist/1"],
        [
          "canvas",
          new Map<string, JsonValue>([
            ["width", JsonNumber.int(16)],
            ["height", JsonNumber.int(16)],
          ]),
        ],
      ]);
  if (model.name === "") root.delete("name");
  else root.set("name", model.name);
  root.set(
    "items",
    model.items.map((item) => {
      const entry: JsonObject = new Map(item.original ?? []);
      entry.set("animation", item.animation);
      if (item.repeat === 1) entry.delete("repeat");
      else entry.set("repeat", JsonNumber.int(item.repeat));
      if (item.enabled) entry.delete("enabled");
      else entry.set("enabled", false);
      return entry;
    }),
  );
  return root;
}

/** Downloads a stored playlist and builds the editor's model for it. */
export async function openStoredPlaylist(client: BoardClient, id: string): Promise<PlaylistModel | string> {
  return modelFromBytes(id, await downloadFile(client, "playlist", id));
}
