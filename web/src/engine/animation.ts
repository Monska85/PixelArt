// Port of lib/PixelEngine/src/animation_loader.cpp: same checks, same codes,
// same places, same order of diagnostics.

import {
  ANIMATION_JSON_DEPTH,
  codePointLength,
  isArray,
  isInteger,
  isObject,
  parseStrictJson,
  type JsonObject,
  type JsonValue,
} from "./json";
import {
  DEFAULT_FRAME_MS,
  MAX_COLORS,
  MAX_COMPOSITE_DEPTH,
  MAX_COORD,
  MAX_COUNT,
  MAX_DIAGNOSTICS,
  MAX_DRAWN_POINTS,
  MAX_FILE_SIZE,
  MAX_LOOP_DEPTH,
  MAX_MS,
  MAX_PALETTE,
  MAX_PARTS,
  MAX_POINTS,
  MAX_SHOW,
  MAX_SPRITES,
  MAX_TIMELINE_ITEMS,
  MIN_COORD,
  NAME_PATTERN,
  HEX_PATTERN,
  MIN_MS,
  type Animation,
  type AnimationResult,
  type Diagnostic,
  type FrameItem,
  type Item,
  type LoopItem,
  type Part,
  type Pos,
  type Ref,
  type Rgb,
  type Severity,
  type Sprite,
} from "./types";

const isName = (s: string): boolean => NAME_PATTERN.test(s);
const parseHex = (s: string): Rgb | null => (HEX_PATTERN.test(s) ? parseInt(s.slice(1), 16) : null);
const indexPath = (base: string, i: number): string => `${base}[${i}]`;
const keyPath = (base: string, key: string): string => (base === "" ? key : `${base}.${key}`);
const isNull = (value: JsonValue | undefined): boolean => value === undefined || value === null;

class Loader {
  readonly diagnostics: Diagnostic[] = [];
  private errorCount = 0;
  private failed = false;
  private pointsFullReported = false;
  private colorsFullReported = false;
  private itemsFullReported = false;
  private spritesOk = false;
  private frameMs = DEFAULT_FRAME_MS;
  private totalPoints = 0;
  private totalItems = 0;
  private palette = new Map<string, Rgb>();
  private paletteUsed = new Set<string>();
  private spriteIndex = new Map<string, number>();
  private spriteUsed: boolean[] = [];
  private rotatedDefaultPivot = new Set<number>();
  private compositeDepth: number[] = [];

  private name = "";
  private version = 1;
  private brightness = 100;
  private background: number | null = null;
  private colors: Rgb[] = [];
  private sprites: Sprite[] = [];
  private timeline: Item[] = [];

  private error(code: string, where: string, message: string): void {
    this.failed = true;
    this.errorCount++;
    this.report("error", code, where, message);
  }

  private warning(code: string, where: string, message: string): void {
    this.report("warning", code, where, message);
  }

  // At most MAX_DIAGNOSTICS entries. When the list is full, an error replaces
  // the latest warning, so a rejected file always reports a reason.
  private report(severity: Severity, code: string, where: string, message: string): void {
    const list = this.diagnostics;
    if (list.length < MAX_DIAGNOSTICS) {
      list.push({ severity, code, where, message });
      return;
    }
    if (severity !== "error") return;
    for (let i = list.length; i > 0; i--) {
      if (list[i - 1]?.severity === "warning") {
        list.splice(i - 1, 1);
        list.push({ severity, code, where, message });
        return;
      }
    }
  }

  private checkKeys(object: JsonObject, allowed: string[], where: string): boolean {
    let ok = true;
    for (const key of object.keys()) {
      if (!allowed.includes(key)) {
        this.error("structure", keyPath(where, key), `unknown field "${key}"`);
        ok = false;
      }
    }
    return ok;
  }

  private getInt(value: JsonValue | undefined, min: number, max: number, where: string): number | null {
    if (!isInteger(value) || value.value < min || value.value > max) {
      this.error("structure", where, `must be an integer from ${min} to ${max}`);
      return null;
    }
    return value.value;
  }

  private getPosition(value: JsonValue | undefined, where: string): Pos | null {
    if (!isArray(value) || value.length !== 2) {
      this.error("structure", where, "must be [x, y]");
      return null;
    }
    const x = this.getInt(value[0], MIN_COORD, MAX_COORD, indexPath(where, 0));
    const y = this.getInt(value[1], MIN_COORD, MAX_COORD, indexPath(where, 1));
    return x !== null && y !== null ? { x, y } : null;
  }

  private getString(
    value: JsonValue | undefined,
    maxLength: number,
    allowEmpty: boolean,
    where: string,
  ): string | null {
    if (typeof value !== "string" || (!allowEmpty && value === "") || codePointLength(value) > maxLength) {
      this.error("structure", where, `must be a text of ${allowEmpty ? 0 : 1} to ${maxLength} characters`);
      return null;
    }
    return value;
  }

  private addColor(rgb: Rgb, where: string): number | null {
    const found = this.colors.indexOf(rgb);
    if (found >= 0) return found;
    if (this.colors.length >= MAX_COLORS) {
      if (!this.colorsFullReported) this.error("limit_exceeded", where, `more than ${MAX_COLORS} different colors`);
      this.colorsFullReported = true;
      return null;
    }
    this.colors.push(rgb);
    return this.colors.length - 1;
  }

  private colorFromString(text: string, where: string): number | null {
    const hex = parseHex(text);
    if (hex !== null) return this.addColor(hex, where);
    const named = this.palette.get(text);
    if (named === undefined) {
      this.error("unknown_color", where, `unknown color "${text}": not a palette name or a "#rrggbb" value`);
      return null;
    }
    this.paletteUsed.add(text);
    return this.addColor(named, where);
  }

  private getColor(value: JsonValue | undefined, where: string): number | null {
    if (typeof value !== "string") {
      this.error("unknown_color", where, 'a color must be a palette name or a "#rrggbb" text');
      return null;
    }
    return this.colorFromString(value, where);
  }

  private parsePalette(value: JsonValue | undefined): void {
    if (isNull(value)) return;
    if (!isObject(value)) {
      this.error("structure", "palette", 'must be an object of name: "#rrggbb"');
      return;
    }
    if (value.size > MAX_PALETTE) this.error("limit_exceeded", "palette", `more than ${MAX_PALETTE} entries`);
    for (const [key, entry] of value) {
      const where = keyPath("palette", key);
      const rgb = typeof entry === "string" ? parseHex(entry) : null;
      if (!isName(key))
        this.error("structure", where, "invalid name: use lowercase letters, digits and _, starting with a letter");
      else if (rgb === null) this.error("structure", where, 'must be a "#rrggbb" value');
      else this.palette.set(key, rgb);
    }
  }

  private parseSprites(value: JsonValue | undefined): void {
    if (!isObject(value) || value.size === 0) {
      this.error("structure", "sprites", "must be an object with at least one sprite");
      return;
    }
    if (value.size > MAX_SPRITES) {
      this.error("limit_exceeded", "sprites", `more than ${MAX_SPRITES} sprites`);
      return;
    }
    // Names first, so parts can refer to sprites defined later in the file.
    for (const key of value.keys()) {
      if (!isName(key)) {
        this.error(
          "structure",
          keyPath("sprites", key),
          "invalid name: use lowercase letters, digits and _, starting with a letter",
        );
        continue;
      }
      this.spriteIndex.set(key, this.sprites.length);
      this.sprites.push({
        name: key,
        at: { x: 0, y: 0 },
        pivot: null,
        points: [],
        parts: [],
        minX: 0,
        minY: 0,
        maxX: 0,
        maxY: 0,
        drawnPoints: 0,
      });
    }
    this.spriteUsed = this.sprites.map(() => false);

    const errorsBefore = this.errorCount;
    for (const [key, entry] of value) {
      const index = this.spriteIndex.get(key);
      const sprite = index === undefined ? undefined : this.sprites[index];
      if (sprite) this.parseSprite(sprite, entry, keyPath("sprites", key));
    }
    this.spritesOk = this.errorCount === errorsBefore && this.checkSpriteGraph();
  }

  private parseSprite(sprite: Sprite, value: JsonValue, where: string): void {
    if (!isObject(value)) {
      this.error("structure", where, "a sprite must be an object");
      return;
    }
    this.checkKeys(value, ["at", "pivot", "points", "parts"], where);
    const at = value.get("at");
    if (!isNull(at)) {
      const pos = this.getPosition(at, keyPath(where, "at"));
      if (pos) sprite.at = pos;
    }
    const pivot = value.get("pivot");
    if (!isNull(pivot)) {
      const pos = this.getPosition(pivot, keyPath(where, "pivot"));
      if (pos) sprite.pivot = pos;
    }
    const points = value.get("points");
    const parts = value.get("parts");
    const hasPoints = !isNull(points);
    const hasParts = !isNull(parts);
    if (hasPoints === hasParts) this.error("structure", where, 'a sprite needs either "points" or "parts", not both');
    else if (hasPoints) this.parsePoints(sprite, points, keyPath(where, "points"));
    else this.parseParts(sprite, parts, keyPath(where, "parts"));
  }

  private addPointsBudget(count: number, where: string): boolean {
    if (this.totalPoints + count > MAX_POINTS) {
      if (!this.pointsFullReported)
        this.error("limit_exceeded", where, `more than ${MAX_POINTS} points in the animation`);
      this.pointsFullReported = true;
      return false;
    }
    this.totalPoints += count;
    return true;
  }

  // Reports the first position (in x, then y order) that two points share.
  private warnDuplicatePoints(sprite: Sprite, where: string): void {
    const keys = sprite.points.map((p) => (p.x + 128) * 256 + (p.y + 128)).sort((a, b) => a - b);
    for (let i = 1; i < keys.length; i++) {
      const key = keys[i];
      if (key !== undefined && key === keys[i - 1]) {
        const x = Math.floor(key / 256) - 128;
        const y = (key % 256) - 128;
        this.warning("duplicate_point", where, `two points share position [${x}, ${y}]; the later one wins`);
        return;
      }
    }
  }

  private parsePoints(sprite: Sprite, value: JsonValue | undefined, where: string): void {
    if (isArray(value)) {
      if (value.length === 0) this.error("empty_sprite", where, "a sprite needs at least one point");
      if (!this.addPointsBudget(value.length, where)) return;
      value.forEach((p, i) => {
        const at = indexPath(where, i);
        if (!isArray(p) || p.length !== 3) {
          this.error("structure", at, "a point must be [x, y, color]");
          return;
        }
        const x = this.getInt(p[0], MIN_COORD, MAX_COORD, indexPath(at, 0));
        const y = this.getInt(p[1], MIN_COORD, MAX_COORD, indexPath(at, 1));
        const color = this.getColor(p[2], indexPath(at, 2));
        if (x !== null && y !== null && color !== null) sprite.points.push({ x, y, color });
      });
    } else if (isObject(value)) {
      if (value.size === 0) this.error("empty_sprite", where, "a sprite needs at least one point");
      for (const [key, positions] of value) {
        const at = keyPath(where, key);
        if (!isArray(positions) || positions.length === 0) {
          this.error("structure", at, "must be a non-empty list of [x, y]");
          continue;
        }
        if (!this.addPointsBudget(positions.length, where)) return;
        const color = this.colorFromString(key, at);
        positions.forEach((p, i) => {
          const pos = this.getPosition(p, indexPath(at, i));
          if (pos && color !== null) sprite.points.push({ x: pos.x, y: pos.y, color });
        });
      }
    } else {
      this.error("structure", where, "must be a list of [x, y, color] or an object of color: [[x, y], ...]");
      return;
    }
    this.warnDuplicatePoints(sprite, where);
  }

  private parseParts(sprite: Sprite, value: JsonValue | undefined, where: string): void {
    if (!isArray(value)) {
      this.error("structure", where, "must be a list of sprite names");
      return;
    }
    if (value.length === 0) {
      this.error("empty_sprite", where, "a composite sprite needs at least one part");
      return;
    }
    if (value.length > MAX_PARTS) {
      this.error("limit_exceeded", where, `more than ${MAX_PARTS} parts`);
      return;
    }
    value.forEach((p, i) => {
      const at = indexPath(where, i);
      let name: string;
      let partAt: Pos | null = null;
      if (typeof p === "string") {
        name = p;
      } else if (isObject(p)) {
        this.checkKeys(p, ["sprite", "at"], at);
        const named = p.get("sprite");
        if (typeof named !== "string") {
          this.error("structure", keyPath(at, "sprite"), "must be a sprite name");
          return;
        }
        name = named;
        const posValue = p.get("at");
        if (!isNull(posValue)) partAt = this.getPosition(posValue, keyPath(at, "at"));
      } else {
        this.error("structure", at, "must be a sprite name or { sprite, at }");
        return;
      }
      const index = this.findSprite(name, at);
      if (index !== null) {
        const part: Part = { sprite: index, at: partAt };
        sprite.parts.push(part);
        this.spriteUsed[index] = true;
      }
    });
  }

  private findSprite(name: string, where: string): number | null {
    const found = this.spriteIndex.get(name);
    if (found === undefined) {
      this.error("unknown_sprite", where, `unknown sprite "${name}"`);
      return null;
    }
    return found;
  }

  private visitForCycles(index: number, state: number[]): boolean {
    if (state[index] === 2) return true;
    const sprite = this.sprites[index] as Sprite;
    if (state[index] === 1) {
      this.error(
        "sprite_cycle",
        keyPath("sprites", sprite.name),
        `sprite "${sprite.name}" contains itself through its parts`,
      );
      return false;
    }
    state[index] = 1;
    for (const part of sprite.parts) if (!this.visitForCycles(part.sprite, state)) return false;
    state[index] = 2;
    return true;
  }

  private partPosition(part: Part): Pos {
    return part.at ?? (this.sprites[part.sprite] as Sprite).at;
  }

  // Bounding box and drawn points of a sprite; returns its composite depth.
  // Runs after the cycle check, so it terminates.
  private computeBounds(index: number): number {
    const known = this.compositeDepth[index];
    if (known !== undefined && known >= 0) return known;
    const s = this.sprites[index] as Sprite;
    let depth = 0;
    let first = true;
    const extend = (minX: number, minY: number, maxX: number, maxY: number): void => {
      if (first || minX < s.minX) s.minX = minX;
      if (first || minY < s.minY) s.minY = minY;
      if (first || maxX > s.maxX) s.maxX = maxX;
      if (first || maxY > s.maxY) s.maxY = maxY;
      first = false;
    };
    for (const p of s.points) extend(p.x, p.y, p.x, p.y);
    // Saturates just above the limit, like the C++ engine.
    let drawn = s.points.length;
    for (const part of s.parts) {
      depth = Math.max(depth, this.computeBounds(part.sprite) + 1);
      const child = this.sprites[part.sprite] as Sprite;
      const offset = this.partPosition(part);
      extend(child.minX + offset.x, child.minY + offset.y, child.maxX + offset.x, child.maxY + offset.y);
      drawn = Math.min(drawn + child.drawnPoints, MAX_DRAWN_POINTS + 1);
    }
    s.drawnPoints = Math.min(drawn, MAX_DRAWN_POINTS + 1);
    this.compositeDepth[index] = depth;
    return depth;
  }

  private checkSpriteGraph(): boolean {
    const state = this.sprites.map(() => 0);
    for (let i = 0; i < this.sprites.length; i++) if (!this.visitForCycles(i, state)) return false;
    this.compositeDepth = this.sprites.map(() => -1);
    let ok = true;
    for (let i = 0; i < this.sprites.length; i++) {
      if (this.computeBounds(i) > MAX_COMPOSITE_DEPTH) {
        const name = (this.sprites[i] as Sprite).name;
        this.error(
          "limit_exceeded",
          keyPath("sprites", name),
          `composite sprites nested more than ${MAX_COMPOSITE_DEPTH} levels deep`,
        );
        ok = false;
      }
    }
    return ok;
  }

  // Returns [ok, position]: an absent value is ok with no position.
  private optionalPosition(object: JsonObject, key: string, where: string): [boolean, Pos | null] {
    const value = object.get(key);
    if (isNull(value)) return [true, null];
    const pos = this.getPosition(value, keyPath(where, key));
    return [pos !== null, pos];
  }

  // A non-integer angle is `structure`; an integer that is not a quarter turn is `invalid_angle`.
  private parseAngle(value: JsonValue | undefined, where: string): number | null {
    if (!isInteger(value)) {
      this.error("structure", where, "must be an integer number of degrees");
      return null;
    }
    const degrees = value.value;
    if (degrees % 90 !== 0 || degrees < -270 || degrees > 270) {
      this.error("invalid_angle", where, "must be one of -270, -180, -90, 0, 90, 180, 270");
      return null;
    }
    return degrees;
  }

  private parseRef(value: JsonValue, where: string): Ref | null {
    const ref: Ref = {
      sprite: 0,
      at: null,
      move: { x: 0, y: 0 },
      wrap: false,
      rotate: 0,
      spin: 0,
      flipX: false,
      flipY: false,
      pivot: null,
    };
    if (typeof value === "string") {
      const index = this.findSprite(value, where);
      if (index === null) return null;
      ref.sprite = index;
      return ref;
    }
    if (!isObject(value)) {
      this.error("structure", where, "must be a sprite name or { sprite, ... }");
      return null;
    }
    const named = value.get("sprite");
    if (typeof named !== "string") {
      this.error("structure", keyPath(where, "sprite"), "must be a sprite name");
      return null;
    }
    let ok = this.checkKeys(value, ["sprite", "at", "move", "wrap", "rotate", "spin", "flip", "pivot"], where);
    const index = this.findSprite(named, keyPath(where, "sprite"));
    if (index === null) ok = false;
    else ref.sprite = index;
    const [atOk, at] = this.optionalPosition(value, "at", where);
    const [moveOk, move] = this.optionalPosition(value, "move", where);
    const [pivotOk, pivot] = this.optionalPosition(value, "pivot", where);
    if (!atOk || !moveOk || !pivotOk) ok = false;
    ref.at = at;
    ref.pivot = pivot;
    if (move) ref.move = move;

    const wrap = value.get("wrap");
    if (!isNull(wrap)) {
      if (typeof wrap === "boolean") ref.wrap = wrap;
      else {
        this.error("structure", keyPath(where, "wrap"), "must be true or false");
        ok = false;
      }
    }
    const rotate = value.get("rotate");
    if (!isNull(rotate)) {
      const degrees = this.parseAngle(rotate, keyPath(where, "rotate"));
      if (degrees === null) ok = false;
      else ref.rotate = degrees;
    }
    const spin = value.get("spin");
    if (!isNull(spin)) {
      const degrees = this.parseAngle(spin, keyPath(where, "spin"));
      if (degrees === null) ok = false;
      else ref.spin = degrees;
    }
    const flip = value.get("flip");
    if (!isNull(flip)) {
      const f = typeof flip === "string" ? flip : "";
      if (f === "x") ref.flipX = true;
      else if (f === "y") ref.flipY = true;
      else if (f === "xy") ref.flipX = ref.flipY = true;
      else {
        this.error("structure", keyPath(where, "flip"), 'must be "x", "y" or "xy"');
        ok = false;
      }
    }
    return ok ? ref : null;
  }

  private parseFrame(object: JsonObject, where: string): FrameItem {
    const item: FrameItem = { kind: "frame", repeat: 1, ms: this.frameMs, refs: [], recolor: [] };
    this.checkKeys(object, ["show", "ms", "repeat", "recolor"], where);
    const ms = object.get("ms");
    if (!isNull(ms)) {
      const value = this.getInt(ms, MIN_MS, MAX_MS, keyPath(where, "ms"));
      if (value !== null) item.ms = value;
    }
    const repeat = object.get("repeat");
    if (!isNull(repeat)) {
      const value = this.getInt(repeat, 1, MAX_COUNT, keyPath(where, "repeat"));
      if (value !== null) item.repeat = value;
    }

    const show = object.get("show");
    const showWhere = keyPath(where, "show");
    if (!isArray(show)) this.error("structure", showWhere, "must be a list of sprites");
    else if (show.length > MAX_SHOW) this.error("limit_exceeded", showWhere, `more than ${MAX_SHOW} sprites`);
    else {
      show.forEach((entry, i) => {
        const at = indexPath(showWhere, i);
        const ref = this.parseRef(entry, at);
        if (!ref) return;
        if (item.repeat === 1 && (ref.move.x !== 0 || ref.move.y !== 0 || ref.spin !== 0))
          this.warning("no_effect", at, '"move" and "spin" only change the sprite when the frame has "repeat"');
        const target = this.sprites[ref.sprite] as Sprite;
        if ((ref.rotate !== 0 || ref.spin !== 0) && !ref.pivot && !target.pivot)
          this.rotatedDefaultPivot.add(ref.sprite);
        this.spriteUsed[ref.sprite] = true;
        item.refs.push(ref);
      });
      this.checkDrawnPoints(item, showWhere);
    }

    const recolor = object.get("recolor");
    if (isNull(recolor)) return item;
    const recolorWhere = keyPath(where, "recolor");
    if (!isObject(recolor) || recolor.size === 0) {
      this.error("structure", recolorWhere, "must be an object of color: color");
      return item;
    }
    if (recolor.size > MAX_COLORS) {
      this.error("limit_exceeded", recolorWhere, `more than ${MAX_COLORS} substitutions`);
      return item;
    }
    for (const [key, target] of recolor) {
      const at = keyPath(recolorWhere, key);
      const from = this.colorFromString(key, at);
      const to = this.getColor(target, at);
      if (from !== null && to !== null) item.recolor.push({ from, to });
    }
    return item;
  }

  // Bounds the work of one frame: composites can repeat a part at every nesting level.
  private checkDrawnPoints(item: FrameItem, where: string): void {
    if (!this.spritesOk) return;
    let drawn = 0;
    for (const ref of item.refs) drawn += (this.sprites[ref.sprite] as Sprite).drawnPoints;
    if (drawn > MAX_DRAWN_POINTS)
      this.error(
        "limit_exceeded",
        where,
        `draws more than ${MAX_DRAWN_POINTS} pixels in one frame (composite sprites count every part)`,
      );
  }

  private parseLoop(object: JsonObject, where: string, depth: number): LoopItem {
    const item: LoopItem = { kind: "loop", count: 1, children: [] };
    this.checkKeys(object, ["loop", "steps"], where);
    const count = this.getInt(object.get("loop"), 1, MAX_COUNT, keyPath(where, "loop"));
    if (count !== null) item.count = count;
    if (depth > MAX_LOOP_DEPTH) {
      this.error("limit_exceeded", where, `loops nested more than ${MAX_LOOP_DEPTH} levels deep`);
      return item;
    }
    const steps = object.get("steps");
    if (!isArray(steps) || steps.length === 0) {
      this.error("structure", keyPath(where, "steps"), "must be a non-empty list of frames and loops");
      return item;
    }
    this.parseItems(steps, keyPath(where, "steps"), depth, item.children);
    return item;
  }

  private parseItems(value: JsonValue[], where: string, depth: number, out: Item[]): void {
    for (let i = 0; i < value.length; i++) {
      const entry = value[i] as JsonValue;
      const at = indexPath(where, i);
      if (++this.totalItems > MAX_TIMELINE_ITEMS) {
        if (!this.itemsFullReported) this.error("limit_exceeded", at, `more than ${MAX_TIMELINE_ITEMS} timeline items`);
        this.itemsFullReported = true;
        return;
      }
      const isLoop = isObject(entry) && !isNull(entry.get("loop"));
      const isFrame = isObject(entry) && !isNull(entry.get("show"));
      if (!isObject(entry) || isLoop === isFrame) {
        this.error("structure", at, 'an item is either a frame ("show") or a loop ("loop" and "steps")');
        continue;
      }
      out.push(isLoop ? this.parseLoop(entry, at, depth + 1) : this.parseFrame(entry, at));
    }
  }

  private finalWarnings(): void {
    for (const index of [...this.rotatedDefaultPivot].sort((a, b) => a - b)) {
      const s = this.sprites[index] as Sprite;
      if ((s.minX + s.maxX) % 2 !== 0 || (s.minY + s.maxY) % 2 !== 0)
        this.warning(
          "pivot_rounded",
          keyPath("sprites", s.name),
          'the center falls between two pixels, so the sprite shifts by one pixel when it turns; set "pivot"',
        );
    }
    this.sprites.forEach((s, i) => {
      if (!this.spriteUsed[i])
        this.warning("unused_sprite", keyPath("sprites", s.name), `sprite "${s.name}" is never shown`);
    });
    // Byte order of the names, which are all ASCII.
    for (const name of [...this.palette.keys()].sort()) {
      if (!this.paletteUsed.has(name))
        this.warning("unused_color", keyPath("palette", name), `color "${name}" is never used`);
    }
  }

  run(bytes: Uint8Array): Animation | null {
    if (bytes.length > MAX_FILE_SIZE) {
      this.error("limit_exceeded", "", `file larger than ${MAX_FILE_SIZE / 1024} KiB`);
      return null;
    }
    const parsed = parseStrictJson(bytes, ANIMATION_JSON_DEPTH);
    if (!parsed.ok) {
      this.error("structure", "", `not valid JSON: ${parsed.reason}`);
      return null;
    }
    const root = parsed.value;
    if (!isObject(root)) {
      this.error("structure", "", "the document must be an object");
      return null;
    }
    const format = root.get("format");
    if (format !== "pixelart/1") {
      this.error("format_unsupported", "format", `unsupported format "${typeof format === "string" ? format : ""}"`);
      return null;
    }

    this.checkKeys(
      root,
      [
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
      "",
    );
    for (const key of ["name", "canvas", "sprites", "timeline"])
      if (isNull(root.get(key))) this.error("structure", key, `missing required field "${key}"`);

    const name = root.get("name");
    if (!isNull(name)) {
      const text = this.getString(name, 128, false, "name");
      if (text !== null) this.name = text;
    }
    const version = root.get("version");
    if (!isNull(version)) {
      const value = this.getInt(version, 1, 0x7fffffff, "version");
      if (value !== null) this.version = value;
    }
    const author = root.get("author");
    if (!isNull(author)) this.getString(author, 128, true, "author");
    const description = root.get("description");
    if (!isNull(description)) this.getString(description, 512, true, "description");
    const canvas = root.get("canvas");
    if (!isNull(canvas)) {
      const width = isObject(canvas) ? canvas.get("width") : undefined;
      const height = isObject(canvas) ? canvas.get("height") : undefined;
      if (
        !isObject(canvas) ||
        canvas.size !== 2 ||
        !isInteger(width) ||
        !isInteger(height) ||
        width.value !== 16 ||
        height.value !== 16
      )
        this.error("structure", "canvas", "must be { width: 16, height: 16 }");
    }
    const frameMs = root.get("frame_ms");
    if (!isNull(frameMs)) {
      const value = this.getInt(frameMs, MIN_MS, MAX_MS, "frame_ms");
      if (value !== null) this.frameMs = value;
    }
    // A present null is an error, unlike the optional fields above that ignore it.
    if (root.has("brightness")) {
      const value = this.getInt(root.get("brightness"), 1, 100, "brightness");
      if (value !== null) this.brightness = value;
    }

    this.parsePalette(root.get("palette"));
    const background = root.get("background");
    if (!isNull(background)) this.background = this.getColor(background, "background");
    const sprites = root.get("sprites");
    if (!isNull(sprites)) this.parseSprites(sprites);

    const timeline = root.get("timeline");
    if (!isNull(timeline)) {
      if (!isArray(timeline) || timeline.length === 0)
        this.error("structure", "timeline", "must be a non-empty list of frames and loops");
      else if (this.spriteIndex.size === 0 && !this.failed)
        this.error("structure", "sprites", "must define at least one sprite");
      else this.parseItems(timeline, "timeline", 0, this.timeline);
    }

    if (this.failed || !this.spritesOk) return null;
    this.finalWarnings();
    return {
      name: this.name,
      version: this.version,
      brightness: this.brightness,
      background: this.background === null ? null : (this.colors[this.background] as Rgb),
      colors: this.colors,
      sprites: this.sprites,
      timeline: this.timeline,
    };
  }
}

/** Parses and validates a pixelart/1 file. The input is the file's bytes. */
export function loadAnimation(bytes: Uint8Array): AnimationResult {
  const loader = new Loader();
  const animation = loader.run(bytes);
  return { animation, diagnostics: loader.diagnostics };
}
