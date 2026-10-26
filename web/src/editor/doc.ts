// SPDX-License-Identifier: GPL-3.0-or-later

// Operations on an animation document held as strict JSON values (maps keep the
// order of the fields, numbers keep integer and float apart). Every function
// returns a new document and shares what it did not change, so a document is
// an undo snapshot. No access to the page.

import {
  CANVAS_WIDTH as GRID,
  HEX_PATTERN,
  JsonNumber,
  MAX_COORD,
  MIN_COORD,
  NAME_PATTERN,
  isArray,
  isObject,
  type JsonArray,
  type JsonObject,
  type JsonValue,
} from "../engine";
import { writeJson } from "../yaml/writeJson";

export type Doc = JsonObject;
/** Position of a timeline item: the index in the timeline, then the index in the steps of that loop, and so on. */
export type Path = number[];

export { GRID, HEX_PATTERN, MAX_COORD, MIN_COORD };

/** Field order of the format, used where the editor adds a field the file did not have. */
const ORDER: { doc: string[]; sprite: string[]; frame: string[]; loop: string[]; ref: string[] } = {
  doc: [
    "format",
    "name",
    "version",
    "author",
    "description",
    "canvas",
    "frame_ms",
    "brightness",
    "background",
    "palette",
    "sprites",
    "timeline",
  ],
  sprite: ["at", "points", "parts", "pivot"],
  frame: ["show", "ms", "repeat", "recolor"],
  loop: ["loop", "steps"],
  ref: ["sprite", "at", "move", "wrap", "rotate", "spin", "flip", "pivot"],
};

const int = (n: number): JsonNumber => JsonNumber.int(n);
const pos = (x: number, y: number): JsonArray => [int(x), int(y)];
const same = (a: JsonValue | undefined, b: JsonValue | undefined): boolean =>
  a !== undefined && b !== undefined && writeJson(a) === writeJson(b);

// ---------------------------------------------------------------- generic

function withKey(map: JsonObject, key: string, value: JsonValue, order?: string[]): JsonObject {
  if (map.has(key) || !order) {
    const next = new Map(map);
    next.set(key, value);
    return next;
  }
  const rank = order.indexOf(key);
  const next: JsonObject = new Map();
  let placed = false;
  for (const [k, v] of map) {
    if (!placed && rank >= 0 && order.indexOf(k) > rank) {
      next.set(key, value);
      placed = true;
    }
    next.set(k, v);
  }
  if (!placed) next.set(key, value);
  return next;
}

function withoutKey(map: JsonObject, key: string): JsonObject {
  if (!map.has(key)) return map;
  const next = new Map(map);
  next.delete(key);
  return next;
}

function renameKey(map: JsonObject, from: string, to: string): JsonObject {
  const next: JsonObject = new Map();
  for (const [k, v] of map) next.set(k === from ? to : k, v);
  return next;
}

/**
 * Sets an optional field. `null` removes it. A value equal to the default is not
 * added to a map that lacks the field, and is kept when the field is there.
 */
function setField(
  map: JsonObject,
  key: string,
  value: JsonValue | null,
  order: string[],
  fallback?: JsonValue,
): JsonObject {
  if (value === null) return withoutKey(map, key);
  if (!map.has(key) && fallback !== undefined && same(value, fallback)) return map;
  return withKey(map, key, value, order);
}

const replaceAt = <T>(list: T[], index: number, value: T): T[] => list.map((v, i) => (i === index ? value : v));
const removeAt = <T>(list: T[], index: number): T[] => list.filter((_, i) => i !== index);
function moveAt<T>(list: T[], index: number, delta: number): T[] {
  const to = index + delta;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(index, 1);
  next.splice(to, 0, item as T);
  return next;
}

export const asObject = (v: JsonValue | undefined): JsonObject | undefined => (isObject(v) ? v : undefined);
export const asList = (v: JsonValue | undefined): JsonValue[] | undefined => (isArray(v) ? v : undefined);
export const asNumber = (v: JsonValue | undefined): number | null => (v instanceof JsonNumber ? v.value : null);

export function readPos(v: JsonValue | undefined): { x: number; y: number } | null {
  if (!isArray(v) || v.length !== 2) return null;
  const x = asNumber(v[0]);
  const y = asNumber(v[1]);
  return x === null || y === null ? null : { x, y };
}

const clampCoord = (n: number): number => Math.max(MIN_COORD, Math.min(MAX_COORD, Math.round(n)));

/** A name that is not in `taken`, built from `base` and a number when needed, at most 32 characters. */
export function uniqueName(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const clean = base.slice(0, 28);
  if (!used.has(base) && NAME_PATTERN.test(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${clean}_${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

// ---------------------------------------------------------------- template

/** A valid minimal animation: one red pixel shown for 500 ms. */
export function newAnimation(): Doc {
  return new Map<string, JsonValue>([
    ["format", "pixelart/1"],
    ["name", "New animation"],
    [
      "canvas",
      new Map<string, JsonValue>([
        ["width", int(16)],
        ["height", int(16)],
      ]),
    ],
    ["palette", new Map<string, JsonValue>([["red", "#ff0000"]])],
    [
      "sprites",
      new Map<string, JsonValue>([
        [
          "dot",
          new Map<string, JsonValue>([
            ["at", pos(7, 7)],
            ["points", new Map([["red", [pos(0, 0)]]])],
          ]),
        ],
      ]),
    ],
    ["timeline", [new Map<string, JsonValue>([["show", ["dot"]]])]],
  ]);
}

// ---------------------------------------------------------------- top level fields

/** Sets or removes a top-level field. */
export function setTopField(doc: Doc, key: string, value: JsonValue | null, fallback?: JsonValue): Doc {
  return setField(doc, key, value, ORDER.doc, fallback);
}

// ---------------------------------------------------------------- palette

export function paletteEntries(doc: Doc): Array<{ name: string; hex: string }> {
  const palette = asObject(doc.get("palette"));
  if (!palette) return [];
  const entries: Array<{ name: string; hex: string }> = [];
  for (const [name, value] of palette) if (typeof value === "string") entries.push({ name, hex: value });
  return entries;
}

/** The `#rrggbb` text a color reference stands for, or null when it is unknown. */
export function resolveColor(doc: Doc, ref: string): string | null {
  if (HEX_PATTERN.test(ref)) return ref.toLowerCase();
  const value = asObject(doc.get("palette"))?.get(ref);
  return typeof value === "string" && HEX_PATTERN.test(value) ? value.toLowerCase() : null;
}

/** Why `name` cannot be a new palette name, or null. `except` is the entry being renamed. */
export function colorNameProblem(doc: Doc, name: string, except?: string): string | null {
  if (!NAME_PATTERN.test(name))
    return "Use lowercase letters, digits and _, start with a letter, at most 32 characters.";
  if (name !== except && asObject(doc.get("palette"))?.has(name)) return "A color with this name exists.";
  return null;
}

export function addColor(doc: Doc, name: string, hex: string): Doc {
  if (colorNameProblem(doc, name) || !HEX_PATTERN.test(hex)) return doc;
  const palette = asObject(doc.get("palette")) ?? new Map();
  return withKey(doc, "palette", withKey(palette, name, hex.toLowerCase()), ORDER.doc);
}

export function setColorHex(doc: Doc, name: string, hex: string): Doc {
  const palette = asObject(doc.get("palette"));
  if (!palette?.has(name) || !HEX_PATTERN.test(hex)) return doc;
  return withKey(doc, "palette", withKey(palette, name, hex.toLowerCase()));
}

// Applies `fn` to the `field` of every sprite that has it. Only the sprites it changed are rebuilt.
function mapSprites(doc: Doc, field: string, fn: (value: JsonValue) => JsonValue): Doc {
  const sprites = asObject(doc.get("sprites"));
  if (!sprites) return doc;
  let next = sprites;
  for (const [name, sprite] of sprites) {
    const map = asObject(sprite);
    const value = map?.get(field);
    if (!map || value === undefined) continue;
    const mapped = fn(value);
    if (mapped !== value) next = withKey(next, name, withKey(map, field, mapped));
  }
  return next === sprites ? doc : withKey(doc, "sprites", next);
}

// Applies `leaf` to every frame of the timeline, inside loops too. Only the items it changed are rebuilt.
function mapTimeline(doc: Doc, leaf: (frame: JsonObject) => JsonObject): Doc {
  const walk = (list: JsonValue[]): JsonValue[] => {
    let changed = false;
    const next = list.map((item) => {
      const map = asObject(item);
      if (!map) return item;
      const steps = asList(map.get("steps"));
      const mapped = steps ? walk(steps) : leaf(map);
      if (mapped === steps || mapped === map) return item;
      changed = true;
      return steps ? withKey(map, "steps", mapped as JsonValue[]) : mapped;
    });
    return changed ? next : list;
  };
  const timeline = asList(doc.get("timeline"));
  if (!timeline) return doc;
  const mapped = walk(timeline);
  return mapped === timeline ? doc : withKey(doc, "timeline", mapped);
}

// Applies `change` to every color reference of the document: the background, the
// points of every sprite (both forms) and the recolor pairs of every frame.
function mapColors(doc: Doc, change: (ref: string) => string): Doc {
  let result = doc;
  const background = doc.get("background");
  if (typeof background === "string" && change(background) !== background)
    result = withKey(result, "background", change(background));
  result = mapSprites(result, "points", (points) => mapPoints(points, change));
  return mapTimeline(result, (frame) => {
    const recolor = asObject(frame.get("recolor"));
    if (!recolor) return frame;
    let touched = false;
    const pairs: JsonObject = new Map();
    for (const [from, to] of recolor) {
      const newFrom = change(from);
      const newTo = typeof to === "string" ? change(to) : to;
      if (newFrom !== from || newTo !== to) touched = true;
      pairs.set(newFrom, newTo);
    }
    return touched ? withKey(frame, "recolor", pairs) : frame;
  });
}

function mapPoints(points: JsonValue, change: (ref: string) => string): JsonValue {
  if (isArray(points)) {
    let changed = false;
    const next = points.map((p) => {
      if (!isArray(p) || typeof p[2] !== "string" || change(p[2]) === p[2]) return p;
      changed = true;
      return replaceAt(p, 2, change(p[2]));
    });
    return changed ? next : points;
  }
  if (isObject(points)) {
    let changed = false;
    const next: JsonObject = new Map();
    for (const [key, list] of points) {
      const to = change(key);
      if (to !== key) changed = true;
      const existing = next.get(to);
      next.set(to, isArray(existing) && isArray(list) ? [...existing, ...list] : list);
    }
    return changed ? next : points;
  }
  return points;
}

/** Renames a palette color and every place that uses it, points group keys and recolor pairs included. */
export function renameColor(doc: Doc, from: string, to: string): Doc {
  const palette = asObject(doc.get("palette"));
  if (!palette?.has(from) || from === to || colorNameProblem(doc, to, from)) return doc;
  const renamed = withKey(doc, "palette", renameKey(palette, from, to));
  return mapColors(renamed, (ref) => (ref === from ? to : ref));
}

/** Deletes a palette color and writes its hex value where the name was used. */
export function deleteColor(doc: Doc, name: string): Doc {
  const palette = asObject(doc.get("palette"));
  const hex = palette?.get(name);
  if (!palette || typeof hex !== "string") return doc;
  const without = withKey(doc, "palette", withoutKey(palette, name));
  return mapColors(without, (ref) => (ref === name ? hex : ref));
}

/** How many places use a color name. */
export function countColorUses(doc: Doc, name: string): number {
  let count = 0;
  mapColors(doc, (ref) => {
    if (ref === name) count++;
    return ref;
  });
  return count;
}

// ---------------------------------------------------------------- sprites

export const spriteNames = (doc: Doc): string[] => [...(asObject(doc.get("sprites"))?.keys() ?? [])];
export const spriteOf = (doc: Doc, name: string): JsonObject | undefined =>
  asObject(asObject(doc.get("sprites"))?.get(name));
export const isComposite = (sprite: JsonObject | undefined): boolean => sprite?.has("parts") === true;

function withSprite(doc: Doc, name: string, sprite: JsonValue): Doc {
  const sprites = asObject(doc.get("sprites")) ?? new Map();
  return withKey(doc, "sprites", withKey(sprites, name, sprite), ORDER.doc);
}

export function spriteNameProblem(doc: Doc, name: string, except?: string): string | null {
  if (!NAME_PATTERN.test(name))
    return "Use lowercase letters, digits and _, start with a letter, at most 32 characters.";
  if (name !== except && spriteOf(doc, name)) return "A sprite with this name exists.";
  return null;
}

/** A points sprite with no points yet: the engine reports it as empty until a pixel is drawn. */
export function addPointsSprite(doc: Doc, name: string): Doc {
  if (spriteNameProblem(doc, name)) return doc;
  return withSprite(doc, name, new Map<string, JsonValue>([["points", new Map()]]));
}

export function addCompositeSprite(doc: Doc, name: string): Doc {
  if (spriteNameProblem(doc, name)) return doc;
  return withSprite(doc, name, new Map<string, JsonValue>([["parts", []]]));
}

// Calls `change` for every sprite reference of the document (show entries and composite parts). A
// null result removes the entry.
function mapSpriteRefs(doc: Doc, change: (name: string) => string | null): Doc {
  const mapEntries = (entries: JsonValue[]): JsonValue[] => {
    let changed = false;
    const next: JsonValue[] = [];
    for (const entry of entries) {
      const name = typeof entry === "string" ? entry : asObject(entry)?.get("sprite");
      if (typeof name !== "string") {
        next.push(entry);
        continue;
      }
      const to = change(name);
      if (to === name) next.push(entry);
      else {
        changed = true;
        if (to === null) continue;
        next.push(typeof entry === "string" ? to : withKey(entry as JsonObject, "sprite", to));
      }
    }
    return changed ? next : entries;
  };

  const result = mapSprites(doc, "parts", (parts) => (isArray(parts) ? mapEntries(parts) : parts));
  return mapTimeline(result, (frame) => {
    const show = asList(frame.get("show"));
    if (!show) return frame;
    const mapped = mapEntries(show);
    return mapped === show ? frame : withKey(frame, "show", mapped);
  });
}

/** Renames a sprite and every show entry and composite part that names it. */
export function renameSprite(doc: Doc, from: string, to: string): Doc {
  const sprites = asObject(doc.get("sprites"));
  if (!sprites?.has(from) || from === to || spriteNameProblem(doc, to, from)) return doc;
  const renamed = withKey(doc, "sprites", renameKey(sprites, from, to));
  return mapSpriteRefs(renamed, (name) => (name === from ? to : name));
}

export function duplicateSprite(doc: Doc, name: string): { doc: Doc; name: string } {
  const sprites = asObject(doc.get("sprites"));
  const sprite = sprites?.get(name);
  if (!sprites || sprite === undefined) return { doc, name };
  const copy = uniqueName(`${name}_copy`, sprites.keys());
  const next: JsonObject = new Map();
  for (const [k, v] of sprites) {
    next.set(k, v);
    if (k === name) next.set(copy, sprite);
  }
  return { doc: withKey(doc, "sprites", next), name: copy };
}

/** How many show entries and parts name a sprite. */
export function countSpriteUses(doc: Doc, name: string): number {
  let count = 0;
  mapSpriteRefs(doc, (ref) => {
    if (ref === name) count++;
    return ref;
  });
  return count;
}

/** Deletes a sprite and the show entries and parts that name it. */
export function deleteSprite(doc: Doc, name: string): Doc {
  const sprites = asObject(doc.get("sprites"));
  if (!sprites?.has(name)) return doc;
  const without = withKey(doc, "sprites", withoutKey(sprites, name));
  return mapSpriteRefs(without, (ref) => (ref === name ? null : ref));
}

function editSprite(doc: Doc, name: string, change: (sprite: JsonObject) => JsonObject): Doc {
  const sprite = spriteOf(doc, name);
  if (!sprite) return doc;
  const next = change(sprite);
  return next === sprite ? doc : withSprite(doc, name, next);
}

export function setSpriteAt(doc: Doc, name: string, at: { x: number; y: number }): Doc {
  return editSprite(doc, name, (s) =>
    setField(s, "at", pos(clampCoord(at.x), clampCoord(at.y)), ORDER.sprite, pos(0, 0)),
  );
}

export function setSpritePivot(doc: Doc, name: string, pivot: { x: number; y: number } | null): Doc {
  return editSprite(doc, name, (s) =>
    setField(s, "pivot", pivot && pos(clampCoord(pivot.x), clampCoord(pivot.y)), ORDER.sprite),
  );
}

// ---------------------------------------------------------------- points

interface SpritePoint {
  x: number;
  y: number;
  color: string;
}

interface PointsView {
  at: { x: number; y: number };
  /** The color reference of each grid cell (index y * 16 + x), or null: points of the sprite at its home position. */
  cells: Array<string | null>;
  /** Points whose place falls outside the 16x16 canvas, in file order, in sprite coordinates. */
  outside: SpritePoint[];
}

/** Reads the points of a sprite for the grid, or returns null when they are not in a valid form. */
export function readPoints(sprite: JsonObject | undefined): PointsView | null {
  if (!sprite || isComposite(sprite)) return null;
  const at = readPos(sprite.get("at")) ?? (sprite.has("at") ? null : { x: 0, y: 0 });
  const points = sprite.get("points");
  if (!at || points === undefined) return null;
  const list: SpritePoint[] = [];
  if (isArray(points)) {
    for (const p of points) {
      const xy = isArray(p) && p.length === 3 ? readPos(p.slice(0, 2)) : null;
      const color = isArray(p) ? p[2] : undefined;
      if (!xy || typeof color !== "string") return null;
      list.push({ ...xy, color });
    }
  } else if (isObject(points)) {
    for (const [color, positions] of points) {
      if (!isArray(positions)) return null;
      for (const p of positions) {
        const xy = readPos(p);
        if (!xy) return null;
        list.push({ ...xy, color });
      }
    }
  } else return null;

  const cells: Array<string | null> = new Array<string | null>(GRID * GRID).fill(null);
  const outside: SpritePoint[] = [];
  for (const p of list) {
    const gx = p.x + at.x;
    const gy = p.y + at.y;
    if (gx < 0 || gy < 0 || gx >= GRID || gy >= GRID) outside.push(p);
    else cells[gy * GRID + gx] = p.color;
  }
  return { at, cells, outside };
}

/** Writes grid cells back as points grouped by color, in order of first appearance row by row; outside points follow. */
function writePoints(view: PointsView, cells: Array<string | null>): JsonObject {
  const groups = new Map<string, JsonArray>();
  const add = (color: string, x: number, y: number): void => {
    const group = groups.get(color);
    if (group) group.push(pos(x, y));
    else groups.set(color, [pos(x, y)]);
  };
  for (let gy = 0; gy < GRID; gy++)
    for (let gx = 0; gx < GRID; gx++) {
      const color = cells[gy * GRID + gx];
      if (color) add(color, gx - view.at.x, gy - view.at.y);
    }
  for (const p of view.outside) add(p.color, p.x, p.y);
  return groups as JsonObject;
}

/**
 * Sets cells of the sprite's grid: a color reference draws, null erases. Cells whose sprite
 * coordinate would leave the range -128 to 127 are ignored.
 */
export function paintCells(doc: Doc, name: string, changes: Map<number, string | null>): Doc {
  const sprite = spriteOf(doc, name);
  const view = readPoints(sprite);
  if (!sprite || !view || changes.size === 0) return doc;
  const cells = [...view.cells];
  let touched = false;
  for (const [index, color] of changes) {
    const gx = index % GRID;
    const gy = Math.floor(index / GRID);
    const x = gx - view.at.x;
    const y = gy - view.at.y;
    if (index < 0 || index >= GRID * GRID || x < MIN_COORD || x > MAX_COORD || y < MIN_COORD || y > MAX_COORD) continue;
    if (cells[index] !== color) touched = true;
    cells[index] = color;
  }
  if (!touched) return doc;
  return withSprite(doc, name, withKey(sprite, "points", writePoints(view, cells), ORDER.sprite));
}

// ---------------------------------------------------------------- composite parts

interface PartView {
  sprite: string;
  at: { x: number; y: number } | null;
}

export function readParts(sprite: JsonObject | undefined): PartView[] {
  const parts = asList(sprite?.get("parts")) ?? [];
  const views: PartView[] = [];
  for (const part of parts) {
    if (typeof part === "string") views.push({ sprite: part, at: null });
    else {
      const map = asObject(part);
      const name = map?.get("sprite");
      if (map && typeof name === "string") views.push({ sprite: name, at: readPos(map.get("at")) });
    }
  }
  return views;
}

function partValue(part: PartView): JsonValue {
  if (!part.at) return part.sprite;
  return new Map<string, JsonValue>([
    ["sprite", part.sprite],
    ["at", pos(clampCoord(part.at.x), clampCoord(part.at.y))],
  ]);
}

function editParts(doc: Doc, name: string, change: (parts: PartView[]) => PartView[]): Doc {
  return editSprite(doc, name, (s) => {
    if (!s.has("parts")) return s;
    return withKey(s, "parts", change(readParts(s)).map(partValue));
  });
}

export function addPart(doc: Doc, composite: string, sprite: string): Doc {
  return editParts(doc, composite, (parts) => [...parts, { sprite, at: null }]);
}
export function removePart(doc: Doc, composite: string, index: number): Doc {
  return editParts(doc, composite, (parts) => removeAt(parts, index));
}
export function movePart(doc: Doc, composite: string, index: number, delta: number): Doc {
  return editParts(doc, composite, (parts) => moveAt(parts, index, delta));
}
export function setPart(doc: Doc, composite: string, index: number, part: PartView): Doc {
  return editParts(doc, composite, (parts) => replaceAt(parts, index, part));
}

// ---------------------------------------------------------------- timeline

const NO_ITEMS: JsonValue[] = [];

function editList(list: JsonValue[], parent: Path, change: (items: JsonValue[]) => JsonValue[]): JsonValue[] {
  const [head, ...rest] = parent;
  if (head === undefined) return change(list);
  const item = asObject(list[head]);
  const steps = asList(item?.get("steps"));
  if (!item || !steps) return list;
  return replaceAt(list, head, withKey(item, "steps", editList(steps, rest, change)));
}

function editTimeline(doc: Doc, parent: Path, change: (items: JsonValue[]) => JsonValue[]): Doc {
  const timeline = asList(doc.get("timeline")) ?? NO_ITEMS;
  const next = editList(timeline, parent, change);
  return next === timeline ? doc : withKey(doc, "timeline", next, ORDER.doc);
}

const parentOf = (path: Path): Path => path.slice(0, -1);
const indexOf = (path: Path): number => path[path.length - 1] ?? -1;

export function itemAt(doc: Doc, path: Path): JsonObject | undefined {
  let list = asList(doc.get("timeline"));
  let item: JsonObject | undefined;
  for (const index of path) {
    item = asObject(list?.[index]);
    list = asList(item?.get("steps"));
  }
  return item;
}

export const isLoop = (item: JsonObject | undefined): boolean => item?.has("loop") === true;

function editItem(doc: Doc, path: Path, change: (item: JsonObject) => JsonObject): Doc {
  return editTimeline(doc, parentOf(path), (items) => {
    const item = asObject(items[indexOf(path)]);
    if (!item) return items;
    const next = change(item);
    return next === item ? items : replaceAt(items, indexOf(path), next);
  });
}

function newFrame(doc: Doc): JsonObject {
  const first = spriteNames(doc)[0];
  return new Map<string, JsonValue>([["show", first === undefined ? [] : [first]]]);
}

/** Adds a frame at the end of the list at `parent` (the timeline when empty), or after `after`. Returns the new item's path. */
export function addFrame(doc: Doc, parent: Path, after?: number): { doc: Doc; path: Path } {
  return insertItem(doc, parent, newFrame(doc), after);
}

export function addLoop(doc: Doc, parent: Path, after?: number): { doc: Doc; path: Path } {
  const loop = new Map<string, JsonValue>([
    ["loop", int(2)],
    ["steps", [newFrame(doc)]],
  ]);
  return insertItem(doc, parent, loop, after);
}

function insertItem(doc: Doc, parent: Path, item: JsonValue, after?: number): { doc: Doc; path: Path } {
  let index = 0;
  const next = editTimeline(doc, parent, (items) => {
    index = after === undefined ? items.length : Math.min(after + 1, items.length);
    return items.toSpliced(index, 0, item);
  });
  return { doc: next, path: [...parent, index] };
}

export function duplicateItem(doc: Doc, path: Path): { doc: Doc; path: Path } {
  const item = itemAt(doc, path);
  if (!item) return { doc, path };
  return insertItem(doc, parentOf(path), item, indexOf(path));
}

export function deleteItem(doc: Doc, path: Path): Doc {
  return editTimeline(doc, parentOf(path), (items) => removeAt(items, indexOf(path)));
}

/** Moves an item up (-1) or down (1) among its siblings. Returns the new path. */
export function moveItem(doc: Doc, path: Path, delta: number): { doc: Doc; path: Path } {
  const to = indexOf(path) + delta;
  const moved = editTimeline(doc, parentOf(path), (items) => moveAt(items, indexOf(path), delta));
  return moved === doc ? { doc, path } : { doc: moved, path: [...parentOf(path), to] };
}

/** Puts an item into a new loop of 2 repetitions. The loop takes the item's place. */
export function wrapInLoop(doc: Doc, path: Path): Doc {
  return editTimeline(doc, parentOf(path), (items) => {
    const item = items[indexOf(path)];
    if (item === undefined) return items;
    return replaceAt(
      items,
      indexOf(path),
      new Map<string, JsonValue>([
        ["loop", int(2)],
        ["steps", [item]],
      ]),
    );
  });
}

/** Replaces a loop by its steps. */
export function unwrapLoop(doc: Doc, path: Path): Doc {
  return editTimeline(doc, parentOf(path), (items) => {
    const steps = asList(asObject(items[indexOf(path)])?.get("steps"));
    if (!steps) return items;
    return items.toSpliced(indexOf(path), 1, ...steps);
  });
}

/** Sets `loop`, `ms` or `repeat` of an item; null removes the field. */
export function setItemNumber(doc: Doc, path: Path, key: "loop" | "ms" | "repeat", value: number | null): Doc {
  return editItem(doc, path, (item) =>
    setField(
      item,
      key,
      value === null ? null : int(value),
      key === "loop" ? ORDER.loop : ORDER.frame,
      key === "repeat" ? int(1) : undefined,
    ),
  );
}

export function readRecolor(item: JsonObject | undefined): Array<[string, string]> {
  const recolor = asObject(item?.get("recolor"));
  if (!recolor) return [];
  const pairs: Array<[string, string]> = [];
  for (const [from, to] of recolor) if (typeof to === "string") pairs.push([from, to]);
  return pairs;
}

/** Writes the recolor pairs of a frame. Pairs with the same first color collapse into the last one. */
export function setRecolor(doc: Doc, path: Path, pairs: Array<[string, string]>): Doc {
  return editItem(doc, path, (item) => {
    if (pairs.length === 0) return withoutKey(item, "recolor");
    const map: JsonObject = new Map();
    for (const [from, to] of pairs) map.set(from, to);
    return withKey(item, "recolor", map, ORDER.frame);
  });
}

// ---------------------------------------------------------------- show entries

interface RefView {
  sprite: string;
  at: { x: number; y: number } | null;
  move: { x: number; y: number } | null;
  wrap: boolean | null;
  rotate: number | null;
  spin: number | null;
  flip: string | null;
  pivot: { x: number; y: number } | null;
}

export type RefKey = Exclude<keyof RefView, "sprite">;

export function readShow(item: JsonObject | undefined): RefView[] {
  const show = asList(item?.get("show")) ?? [];
  return show.map((entry) => {
    if (typeof entry === "string")
      return { sprite: entry, at: null, move: null, wrap: null, rotate: null, spin: null, flip: null, pivot: null };
    const map = asObject(entry);
    const flip = map?.get("flip");
    const wrap = map?.get("wrap");
    const name = map?.get("sprite");
    return {
      sprite: typeof name === "string" ? name : "",
      at: readPos(map?.get("at")),
      move: readPos(map?.get("move")),
      wrap: typeof wrap === "boolean" ? wrap : null,
      rotate: asNumber(map?.get("rotate")),
      spin: asNumber(map?.get("spin")),
      flip: typeof flip === "string" ? flip : null,
      pivot: readPos(map?.get("pivot")),
    };
  });
}

function editShow(doc: Doc, path: Path, change: (show: JsonValue[]) => JsonValue[]): Doc {
  return editItem(doc, path, (item) => {
    const show = asList(item.get("show"));
    return show ? withKey(item, "show", change(show)) : item;
  });
}

export function addShowEntry(doc: Doc, path: Path, sprite: string): Doc {
  return editShow(doc, path, (show) => [...show, sprite]);
}
export function removeShowEntry(doc: Doc, path: Path, index: number): Doc {
  return editShow(doc, path, (show) => removeAt(show, index));
}
export function moveShowEntry(doc: Doc, path: Path, index: number, delta: number): Doc {
  return editShow(doc, path, (show) => moveAt(show, index, delta));
}

/**
 * Sets one field of a show entry; null removes it. An entry with no field but the
 * sprite is written as the sprite name.
 */
export function setShowField(
  doc: Doc,
  path: Path,
  index: number,
  key: "sprite" | RefKey,
  value: string | number | boolean | { x: number; y: number } | null,
): Doc {
  return editShow(doc, path, (show) => {
    const entry = show[index];
    if (entry === undefined) return show;
    let map = asObject(entry) ?? new Map<string, JsonValue>([["sprite", entry]]);
    const json: JsonValue | null =
      value === null
        ? null
        : typeof value === "object"
          ? pos(clampCoord(value.x), clampCoord(value.y))
          : typeof value === "number"
            ? int(value)
            : value;
    map = setField(map, key, json, ORDER.ref, key === "wrap" ? false : undefined);
    const onlySprite = map.size === 1 && typeof map.get("sprite") === "string";
    return replaceAt(show, index, onlySprite ? (map.get("sprite") as string) : map);
  });
}
