// SPDX-License-Identifier: GPL-3.0-or-later

import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  addColor,
  addFrame,
  addLoop,
  addPart,
  addPointsSprite,
  addShowEntry,
  colorNameProblem,
  countColorUses,
  countSpriteUses,
  deleteColor,
  deleteItem,
  deleteSprite,
  duplicateItem,
  duplicateSprite,
  itemAt,
  moveItem,
  newAnimation,
  paintCells,
  readParts,
  readPoints,
  renameColor,
  renameSprite,
  setItemNumber,
  setRecolor,
  setShowField,
  setSpriteAt,
  setTopField,
  spriteOf,
  unwrapLoop,
  wrapInLoop,
  type Doc,
} from "../src/editor/doc";
import { hasComments } from "../src/editor/comments";
import { parseDraftDocument } from "../src/ui/editor/drafts";
import { FrameCursor, firstFrameOf, frameAt } from "../src/editor/preview";
import { initialState, reduce, MAX_UNDO, type EditorState } from "../src/editor/state";
import { JsonNumber, Player, isObject, loadAnimation, type Animation } from "../src/engine";
import { frameCount } from "../src/engine/player";
import { readYaml } from "../src/yaml/read";
import { jsonBytes, writeJson } from "../src/yaml/writeJson";
import { writeYaml } from "../src/yaml/writeYaml";
import { REPO } from "./helpers";

const doc = (source: string): Doc => {
  const read = readYaml(source);
  if (!read.ok || !isObject(read.value)) throw new Error("bad test document");
  return read.value;
};
const json = (d: Doc): string => writeJson(d);
const load = (d: Doc) => loadAnimation(jsonBytes(d));
const errors = (d: Doc) => load(d).diagnostics.filter((x) => x.severity === "error");

const SAMPLE = `
format: pixelart/1
name: Test
canvas: { width: 16, height: 16 }
background: night
palette:
  night: "#000011"
  red: "#ff0000"
  blue: "#0000ff"
sprites:
  a:
    at: [2, 3]
    points:
      red: [[0, 0], [1, 0]]
      blue: [[0, 1]]
  b:
    points:
      - [0, 0, red]
      - [1, 0, "#ff0000"]
  both:
    parts: [a, { sprite: b, at: [5, 5] }]
timeline:
  - loop: 2
    steps:
      - show: [a, { sprite: b, move: [1, 0] }]
        repeat: 3
        recolor: { red: blue, blue: red }
      - show: [both]
  - show: [a]
`;

describe("template", () => {
  it("is a valid animation", () => {
    expect(errors(newAnimation())).toEqual([]);
    expect(load(newAnimation()).animation).not.toBeNull();
  });
});

describe("palette", () => {
  it("renames a color everywhere, group keys and recolor pairs included, keeping order", () => {
    const next = renameColor(doc(SAMPLE), "red", "crimson");
    const text = json(next);
    expect(text).not.toContain('"red"');
    expect(text).toContain('"crimson":[[0,0],[1,0]]');
    expect(text).toContain(',"crimson"]');
    expect(text).toContain('"recolor":{"crimson":"blue","blue":"crimson"}');
    expect([...(next.get("palette") as Map<string, unknown>).keys()]).toEqual(["night", "crimson", "blue"]);
    expect(errors(next)).toEqual([]);
  });

  it("renames the background", () => {
    expect(next("night", "dusk").get("background")).toBe("dusk");
    function next(from: string, to: string) {
      return renameColor(doc(SAMPLE), from, to);
    }
  });

  it("refuses a name that exists or is not valid", () => {
    const d = doc(SAMPLE);
    expect(renameColor(d, "red", "blue")).toBe(d);
    expect(renameColor(d, "red", "Red")).toBe(d);
    expect(colorNameProblem(d, "blue")).not.toBeNull();
    expect(colorNameProblem(d, "red", "red")).toBeNull();
  });

  it("deletes a color and writes its hex where it was used", () => {
    const d = doc(SAMPLE);
    expect(countColorUses(d, "red")).toBe(4);
    const next = deleteColor(d, "red");
    const text = json(next);
    expect(text).not.toContain('"red"');
    expect(text).toContain('"recolor":{"#ff0000":"blue","blue":"#ff0000"}');
    // The group "red" and the existing "#ff0000" entries of sprite b: merged for the grouped form.
    expect(errors(next)).toEqual([]);
    expect(countColorUses(next, "red")).toBe(0);
  });

  it("merges points groups that become the same color", () => {
    const d = doc(
      "format: pixelart/1\nname: x\ncanvas: {width: 16, height: 16}\npalette: {red: '#ff0000'}\nsprites:\n  a:\n    points:\n      red: [[0, 0]]\n      '#ff0000': [[1, 0]]\ntimeline:\n  - show: [a]\n",
    );
    expect(json(deleteColor(d, "red"))).toContain('"points":{"#ff0000":[[0,0],[1,0]]}');
  });

  it("adds a color at the end of the palette", () => {
    const next = addColor(doc(SAMPLE), "green", "#00FF00");
    expect(json(next)).toContain('"green":"#00ff00"}');
  });

  it("creates a palette when there is none", () => {
    const d = doc("format: pixelart/1\nname: x\ncanvas: {width: 16, height: 16}\nsprites: {}\ntimeline: []\n");
    expect([...next(d).keys()]).toEqual(["format", "name", "canvas", "palette", "sprites", "timeline"]);
    function next(x: Doc) {
      return addColor(x, "red", "#ff0000");
    }
  });
});

describe("sprites", () => {
  it("renames a sprite in show entries and parts, both forms", () => {
    const next = renameSprite(doc(SAMPLE), "b", "bee");
    const text = json(next);
    expect(text).toContain('"bee":{');
    expect(text).toContain('{"sprite":"bee","move":[1,0]}');
    expect(text).toContain('{"sprite":"bee","at":[5,5]}');
    expect(text).not.toContain('"b"');
    expect(errors(next)).toEqual([]);
  });

  it("renames a sprite named by a plain string", () => {
    const next = renameSprite(doc(SAMPLE), "a", "alpha");
    expect(json(next)).toContain('"parts":["alpha"');
    expect(json(next)).toContain('"show":["alpha"');
    expect(errors(next)).toEqual([]);
  });

  it("duplicates a sprite after the original with a new name", () => {
    const { doc: next, name } = duplicateSprite(doc(SAMPLE), "a");
    expect(name).toBe("a_copy");
    expect([...(next.get("sprites") as Map<string, unknown>).keys()]).toEqual(["a", "a_copy", "b", "both"]);
    expect(duplicateSprite(next, "a").name).toBe("a_copy_2");
  });

  it("counts uses and deletes a sprite with its references", () => {
    const d = doc(SAMPLE);
    expect(countSpriteUses(d, "b")).toBe(2);
    const next = deleteSprite(d, "b");
    expect(countSpriteUses(next, "b")).toBe(0);
    expect(json(next)).toContain('"parts":["a"]');
    expect(json(next)).toContain('"show":["a"]');
  });

  it("adds an empty points sprite that the engine reports", () => {
    const next = addPointsSprite(doc(SAMPLE), "c");
    expect(spriteOf(next, "c")?.get("points")).toEqual(new Map());
    expect(load(next).diagnostics.some((x) => x.code === "empty_sprite")).toBe(true);
  });

  it("keeps the home position when it equals the default only if the file had it", () => {
    const d = doc(SAMPLE);
    expect(json(setSpriteAt(d, "a", { x: 0, y: 0 }))).toContain('"a":{"at":[0,0],"points"');
    expect(spriteOf(setSpriteAt(d, "b", { x: 0, y: 0 }), "b")?.has("at")).toBe(false);
    expect(spriteOf(setSpriteAt(d, "b", { x: 3, y: 4 }), "b")?.get("at")).toEqual([
      JsonNumber.int(3),
      JsonNumber.int(4),
    ]);
  });

  it("adds, moves and removes parts, writing the plain name without a position", () => {
    const d = addPart(doc(SAMPLE), "both", "a");
    expect(readParts(spriteOf(d, "both")).map((p) => p.sprite)).toEqual(["a", "b", "a"]);
    expect(json(d)).toContain('"parts":["a",{"sprite":"b","at":[5,5]},"a"]');
  });
});

describe("points on the grid", () => {
  const cellsOf = (d: Doc, name: string) => readPoints(spriteOf(d, name));

  it("reads cells at the home position and lists points outside the canvas", () => {
    const d = doc(
      "format: pixelart/1\nname: x\ncanvas: {width: 16, height: 16}\npalette: {red: '#ff0000'}\nsprites:\n  a:\n    at: [14, 0]\n    points:\n      red: [[0, 0], [1, 0], [2, 0], [-20, 1]]\ntimeline: []\n",
    );
    const view = cellsOf(d, "a");
    expect(view?.cells[14]).toBe("red");
    expect(view?.cells[15]).toBe("red");
    expect(view?.outside.map((p) => [p.x, p.y])).toEqual([
      [2, 0],
      [-20, 1],
    ]);
  });

  it("writes points grouped by color in order of first appearance, row by row", () => {
    const d = doc(
      "format: pixelart/1\nname: x\ncanvas: {width: 16, height: 16}\npalette: {red: '#ff0000', blue: '#0000ff'}\nsprites:\n  a:\n    points:\n      - [5, 5, blue]\n      - [0, 0, red]\ntimeline: []\n",
    );
    // Row 0 has red at x=3; row 5 has blue at x=5 and red at x=6. First appearance: red, then blue.
    const next = paintCells(
      d,
      "a",
      new Map([
        [3, "red"],
        [5 * 16 + 6, "red"],
      ]),
    );
    expect(json(spriteOf(next, "a") as Doc)).toBe('{"points":{"red":[[0,0],[3,0],[6,5]],"blue":[[5,5]]}}');
  });

  it("scans left to right inside a row", () => {
    const d = addPointsSprite(
      doc("format: pixelart/1\nname: x\ncanvas: {width: 16, height: 16}\nsprites: {}\ntimeline: []\n"),
      "a",
    );
    const next = paintCells(
      d,
      "a",
      new Map([
        [9, "blue"],
        [2, "red"],
        [20, "blue"],
      ]),
    );
    expect(json(spriteOf(next, "a") as Doc)).toBe('{"points":{"red":[[2,0]],"blue":[[9,0],[4,1]]}}');
  });

  it("converts the list form to the grouped form when painted", () => {
    const d = doc(SAMPLE);
    const next = paintCells(d, "b", new Map([[2, "red"]]));
    expect(json(spriteOf(next, "b") as Doc)).toBe('{"points":{"red":[[0,0],[2,0]],"#ff0000":[[1,0]]}}');
  });

  it("paints relative to the home position and erases", () => {
    const d = doc(SAMPLE);
    const next = paintCells(
      d,
      "a",
      new Map([
        [3 * 16 + 4, "blue"],
        [3 * 16 + 2, null],
      ]),
    );
    expect(json(spriteOf(next, "a") as Doc)).toBe('{"at":[2,3],"points":{"red":[[1,0]],"blue":[[2,0],[0,1]]}}');
  });

  it("keeps points outside the canvas when painting", () => {
    const d = doc(
      "format: pixelart/1\nname: x\ncanvas: {width: 16, height: 16}\npalette: {red: '#ff0000'}\nsprites:\n  a:\n    points:\n      red: [[0, 0], [40, 0]]\ntimeline: []\n",
    );
    const next = paintCells(d, "a", new Map([[1, "red"]]));
    expect(json(spriteOf(next, "a") as Doc)).toBe('{"points":{"red":[[0,0],[1,0],[40,0]]}}');
  });

  it("does not paint where the sprite coordinate would leave the range", () => {
    const d = setSpriteAt(addPointsSprite(newAnimation(), "z"), "z", { x: -128, y: 0 });
    expect(paintCells(d, "z", new Map([[15, "red"]]))).toBe(d);
  });

  it("refuses points it cannot read", () => {
    const d = doc("format: pixelart/1\nname: x\nsprites:\n  a:\n    points: nope\ntimeline: []\n");
    expect(cellsOf(d, "a")).toBeNull();
    expect(paintCells(d, "a", new Map([[0, "red"]]))).toBe(d);
  });
});

describe("timeline", () => {
  const timeline = (d: Doc) => json(new Map([["timeline", d.get("timeline") as never]]));

  it("adds a frame showing the first sprite, in a loop or at the end", () => {
    const d = doc(SAMPLE);
    const top = addFrame(d, []);
    expect(top.path).toEqual([2]);
    expect(json(itemAt(top.doc, [2]) as Doc)).toBe('{"show":["a"]}');
    const inside = addFrame(d, [0], 0);
    expect(inside.path).toEqual([0, 1]);
    expect(errors(inside.doc)).toEqual([]);
    const loop = addLoop(d, [], 0);
    expect(loop.path).toEqual([1]);
    expect(json(itemAt(loop.doc, [1]) as Doc)).toBe('{"loop":2,"steps":[{"show":["a"]}]}');
  });

  it("duplicates and deletes", () => {
    const d = doc(SAMPLE);
    const copy = duplicateItem(d, [0, 0]);
    expect(copy.path).toEqual([0, 1]);
    expect(json(itemAt(copy.doc, [0, 1]) as Doc)).toBe(json(itemAt(d, [0, 0]) as Doc));
    expect((itemAt(deleteItem(d, [0]), [0]) as Doc).has("show")).toBe(true);
  });

  it("moves an item among its siblings and reports the new path", () => {
    const d = doc(SAMPLE);
    const moved = moveItem(d, [0, 0], 1);
    expect(moved.path).toEqual([0, 1]);
    expect(itemAt(moved.doc, [0, 0])?.get("show")).toEqual(["both"]);
    expect(moveItem(d, [0], -1).doc).toBe(d);
    expect(moveItem(d, [1], 1).doc).toBe(d);
  });

  it("wraps an item in a loop and unwraps it again", () => {
    const d = doc(SAMPLE);
    const wrapped = wrapInLoop(d, [1]);
    expect(json(itemAt(wrapped, [1]) as Doc)).toBe('{"loop":2,"steps":[{"show":["a"]}]}');
    expect(json(unwrapLoop(wrapped, [1]))).toBe(json(d));
    const inner = unwrapLoop(d, [0]);
    expect((inner.get("timeline") as unknown[]).length).toBe(3);
  });

  it("writes optional numbers only when set, keeps defaults the file had", () => {
    const d = doc(SAMPLE);
    expect(itemAt(setItemNumber(d, [1], "repeat", 1), [1])?.has("repeat")).toBe(false);
    expect(itemAt(setItemNumber(d, [0, 0], "repeat", 1), [0, 0])?.get("repeat")).toEqual(JsonNumber.int(1));
    expect(itemAt(setItemNumber(d, [0, 0], "repeat", null), [0, 0])?.has("repeat")).toBe(false);
    expect(json(itemAt(setItemNumber(d, [1], "ms", 100), [1]) as Doc)).toBe('{"show":["a"],"ms":100}');
    // A new repeat is placed before recolor, the order of the format.
    const withRepeat = setItemNumber(setRecolor(d, [1], [["red", "blue"]]), [1], "repeat", 4);
    expect(json(itemAt(withRepeat, [1]) as Doc)).toBe('{"show":["a"],"repeat":4,"recolor":{"red":"blue"}}');
    expect(json(itemAt(setItemNumber(d, [0], "loop", 5), [0]) as Doc)).toContain('"loop":5');
  });

  it("writes a show entry as the plain name when it has no other field", () => {
    const d = doc(SAMPLE);
    const withMove = setShowField(d, [1], 0, "move", { x: 1, y: 0 });
    expect(itemAt(withMove, [1])?.get("show")).toEqual([
      new Map<string, unknown>([
        ["sprite", "a"],
        ["move", [JsonNumber.int(1), JsonNumber.int(0)]],
      ]),
    ]);
    const back = setShowField(withMove, [1], 0, "move", null);
    expect(itemAt(back, [1])?.get("show")).toEqual(["a"]);
  });

  it("orders the reference fields of the format and omits wrap false", () => {
    let d = doc(SAMPLE);
    d = setShowField(d, [1], 0, "flip", "x");
    d = setShowField(d, [1], 0, "rotate", 90);
    d = setShowField(d, [1], 0, "at", { x: 1, y: 2 });
    d = setShowField(d, [1], 0, "wrap", true);
    expect(json(itemAt(d, [1]) as Doc)).toBe('{"show":[{"sprite":"a","at":[1,2],"wrap":true,"rotate":90,"flip":"x"}]}');
    const off = setShowField(doc(SAMPLE), [1], 0, "wrap", false);
    expect(itemAt(off, [1])?.get("show")).toEqual(["a"]);
  });

  it("changes sprites and the recolor pairs of a frame", () => {
    let d = doc(SAMPLE);
    d = addShowEntry(d, [1], "b");
    expect(itemAt(d, [1])?.get("show")).toEqual(["a", "b"]);
    d = setRecolor(d, [1], []);
    expect(itemAt(d, [1])?.has("recolor")).toBe(false);
    expect(timeline(d)).toContain('"show":["a","b"]');
  });
});

describe("top level fields", () => {
  it("keeps the order of the fields and puts new ones where the format has them", () => {
    let d = doc(SAMPLE);
    d = setTopField(d, "author", "me");
    d = setTopField(d, "brightness", JsonNumber.int(50), JsonNumber.int(100));
    d = setTopField(d, "frame_ms", JsonNumber.int(500), JsonNumber.int(500));
    expect([...d.keys()]).toEqual([
      "format",
      "name",
      "author",
      "canvas",
      "brightness",
      "background",
      "palette",
      "sprites",
      "timeline",
    ]);
  });
});

describe("undo and redo", () => {
  const edit = (state: EditorState, doc: Doc, group?: string) =>
    reduce(state, { type: "edit", doc, ...(group !== undefined && { group }) });
  const named = (n: number): Doc => setTopField(newAnimation(), "name", `n${n}`);

  it("goes back and forth at least 100 steps", () => {
    let state = initialState();
    for (let i = 1; i <= 120; i++) state = edit(state, named(i));
    expect(state.past.length).toBe(120);
    for (let i = 0; i < 110; i++) state = reduce(state, { type: "undo" });
    expect(state.doc.get("name")).toBe("n10");
    for (let i = 0; i < 110; i++) state = reduce(state, { type: "redo" });
    expect(state.doc.get("name")).toBe("n120");
    expect(reduce(state, { type: "redo" })).toBe(state);
  });

  it("keeps a bounded history", () => {
    let state = initialState();
    for (let i = 1; i <= MAX_UNDO + 50; i++) state = edit(state, named(i));
    expect(state.past.length).toBe(MAX_UNDO);
  });

  it("drops the redo steps after a new edit", () => {
    let state = edit(initialState(), named(1));
    state = reduce(state, { type: "undo" });
    expect(state.future.length).toBe(1);
    state = edit(state, named(2));
    expect(state.future.length).toBe(0);
  });

  it("makes edits of one group a single step", () => {
    let state = edit(initialState(), named(0));
    state = edit(state, named(1), "color");
    state = edit(state, named(2), "color");
    state = edit(state, named(3), "color");
    expect(state.past.length).toBe(2);
    state = reduce(state, { type: "undo" });
    expect(state.doc.get("name")).toBe("n0");
  });

  it("does nothing for an unchanged document", () => {
    const state = initialState();
    expect(edit(state, state.doc)).toBe(state);
  });

  it("clears the changed mark only for the document that was saved", () => {
    const first = edit(initialState(), named(1));
    expect(first.dirty).toBe(true);
    const copy = (doc: Doc) => ({ kind: "board", name: "x", at: 1, json: writeJson(doc) }) as const;
    expect(reduce(first, { type: "saved", doc: first.doc, copy: copy(first.doc) }).dirty).toBe(false);
    // An edit made while the upload of `first.doc` ran leaves the new document unsaved.
    const second = edit(first, named(2));
    expect(reduce(second, { type: "saved", doc: first.doc, copy: copy(first.doc) }).dirty).toBe(true);
  });
});

describe("YAML tab", () => {
  const text = (state: EditorState, source: string) => reduce(state, { type: "text", text: source });

  it("replaces the document with valid text and keeps the text, comments included", () => {
    const source = writeYaml(newAnimation()).replace("name: New animation", "name: Renamed # my note");
    const state = text(initialState(), source);
    expect(state.doc.get("name")).toBe("Renamed");
    expect(state.text).toBe(source);
    expect(state.textError).toBeNull();
    expect(state.userText).toBe(true);
    expect(state.commentsDropped).toBe(false);
  });

  it("keeps the last valid document and reports the line of a parse error", () => {
    const good = text(initialState(), "format: pixelart/1\nname: A\n");
    const bad = text(good, "format: pixelart/1\nname: [oops\n");
    expect(bad.doc).toBe(good.doc);
    expect(bad.textError?.message).toBeTruthy();
    expect(bad.textError?.line).toBeGreaterThan(0);
    expect(bad.text).toBe("format: pixelart/1\nname: [oops\n");
    const notMapping = text(good, "- a\n- b\n");
    expect(notMapping.doc).toBe(good.doc);
    expect(notMapping.textError?.message).toMatch(/mapping/);
  });

  it("rewrites the text on a visual change and says the comments were dropped", () => {
    let state = text(initialState(), "format: pixelart/1 # keep me\nname: A\n");
    expect(state.userText).toBe(true);
    state = reduce(state, { type: "edit", doc: setTopField(state.doc, "name", "B") });
    expect(state.text).not.toContain("keep me");
    expect(state.text).toContain("name: B");
    expect(state.commentsDropped).toBe(true);
    expect(state.userText).toBe(false);
  });

  it("does not report dropped comments when there were none", () => {
    const state = reduce(initialState(), { type: "edit", doc: setTopField(newAnimation(), "name", "B") });
    expect(state.commentsDropped).toBe(false);
  });

  it("makes typing in the tab one undo step and restores the previous document", () => {
    let state = initialState();
    const before = state.doc;
    state = text(state, "format: pixelart/1\nname: A\n");
    state = text(state, "format: pixelart/1\nname: AB\n");
    state = text(state, "format: pixelart/1\nname: ABC\n");
    expect(state.past.length).toBe(1);
    state = reduce(state, { type: "undo" });
    expect(state.doc).toBe(before);
    expect(state.textError).toBeNull();
  });

  it("detects comments", () => {
    expect(hasComments("a: 1 # x\n")).toBe(true);
    expect(hasComments("# top\na: 1\n")).toBe(true);
    expect(hasComments('a: "#ff0000"\nb:\n  - [1, 2]\n')).toBe(false);
  });

  it.each([
    ["an end-of-line comment", "a: 1 # x\n", true],
    ["a comment at the top", "# top\na: 1\n", true],
    ["a comment in a flow map", "a: {b: 1, # x\n  c: 2}\n", true],
    ["a comment after a block scalar", "a: |\n  text\n# after\nb: 1\n", true],
    ["a comment after a directive", "%YAML 1.2 # x\n---\na: 1\n", true],
    ["a comment after an anchor", "a: &x # note\n  b: 1\n", true],
    ["a comment in a sequence item", "a:\n  - 1 # one\n  - 2\n", true],
    ["# in a single-quoted scalar", "a: '# not a comment'\n", false],
    ["# in a double-quoted scalar", 'a: "# not a comment"\n', false],
    ["# inside a plain scalar", "a: b#c\n", false],
    ["# in a literal block scalar", "a: |\n  # not a comment\n  text\n", false],
    ["# in a folded block scalar", "a: >\n  # not a comment\n", false],
    ["# in a plain multi-word scalar", "a: b #c\n", true],
    ["no # at all", "a: 1\nb: [1, 2]\n", false],
  ])("finds %s", (_, text, expected) => {
    expect(hasComments(text)).toBe(expected);
  });
});

describe("YAML round trip", () => {
  it("writes the document with hex colors quoted and the order of the fields kept", () => {
    const d = doc(SAMPLE);
    const yaml = writeYaml(d);
    expect(yaml).toContain('night: "#000011"');
    expect(yaml.indexOf("background")).toBeLessThan(yaml.indexOf("palette"));
    const back = readYaml(yaml);
    expect(back.ok && writeJson(back.value)).toBe(json(d));
  });

  it.each(["beating_heart", "snow_globe", "default_heart"])(
    "gives the same JSON for %s after a visual edit and a rewrite",
    (id) => {
      let source: string;
      try {
        source = readFileSync(`${REPO}animations/${id}.yaml`, "utf8");
      } catch {
        return;
      }
      const d = doc(source);
      const edited = setTopField(d, "author", "someone");
      const back = readYaml(writeYaml(edited));
      expect(back.ok && writeJson(back.value)).toBe(json(edited));
      expect(errors(edited)).toEqual([]);
    },
  );
});

describe("player item tracking", () => {
  it("reports the timeline item of each frame and leaves the frames unchanged", () => {
    const animation = load(doc(SAMPLE)).animation;
    if (!animation) throw new Error("invalid sample");
    const player = new Player(animation);
    const seen: string[] = [];
    for (let frame = player.next(); frame; frame = player.next()) seen.push(player.path.join("."));
    // The loop plays its two items twice: three repetitions of 0.0, one of 0.1; then item 1.
    expect(seen).toEqual(["0.0", "0.0", "0.0", "0.1", "0.0", "0.0", "0.0", "0.1", "1"]);
    const plain = new Player(animation);
    const count = plain.skip(100);
    expect(count).toBe(9);
  });

  it("finds the first frame of an item or loop and the frame at a number", () => {
    const animation = load(doc(SAMPLE)).animation;
    if (!animation) throw new Error("invalid sample");
    expect(firstFrameOf(animation, [0])).toBe(1n);
    expect(firstFrameOf(animation, [0, 1])).toBe(4n);
    expect(firstFrameOf(animation, [1])).toBe(9n);
    expect(firstFrameOf(animation, [5])).toBeNull();
    expect(frameAt(animation, 4n)?.path).toEqual([0, 1]);
    expect(frameAt(animation, 10n)).toBeNull();
    const direct = new Player(animation);
    direct.skip(3);
    expect(frameAt(animation, 4n)?.frame.pixels).toEqual(direct.next()?.pixels);
  });
});

describe("FrameCursor", () => {
  const sample = (): Animation => {
    const animation = load(doc(SAMPLE)).animation;
    if (!animation) throw new Error("invalid sample");
    return animation;
  };

  it("steps through every frame like a search from the start, then wraps and goes back", () => {
    const animation = sample();
    const cursor = new FrameCursor(animation);
    for (let n = 1n; n <= 9n; n++) {
      const stepped = cursor.frameAt(n);
      const searched = frameAt(animation, n);
      expect(stepped?.path).toEqual(searched?.path);
      expect(stepped?.frame).toEqual(searched?.frame);
    }
    expect(cursor.frameAt(10n)).toBeNull();
    expect(cursor.frameAt(1n)?.frame).toEqual(frameAt(animation, 1n)?.frame);
    expect(cursor.frameAt(5n)?.frame).toEqual(frameAt(animation, 5n)?.frame);
    expect(cursor.frameAt(2n)?.frame).toEqual(frameAt(animation, 2n)?.frame);
    expect(cursor.frameAt(2n)?.path).toEqual(frameAt(animation, 2n)?.path);
    expect(cursor.frameAt(0n)).toBeNull();
  });

  it("plays in one step per frame: sequential frames skip nothing", () => {
    const cursor = new FrameCursor(sample());
    const skip = vi.spyOn(Player.prototype, "skip");
    try {
      for (let n = 1n; n <= 9n; n++) cursor.frameAt(n);
      expect(skip.mock.calls.every(([count]) => count === 0)).toBe(true);
    } finally {
      skip.mockRestore();
    }
  });

  it("shows the first frame of a selected item without searching again", () => {
    const animation = sample();
    const cursor = new FrameCursor(animation);
    const first = cursor.firstFrameOf([0, 1]);
    expect(first).toBe(4n);
    const expected = frameAt(animation, 4n)?.frame;
    const skip = vi.spyOn(Player.prototype, "skip");
    try {
      expect(cursor.frameAt(first as bigint)?.frame).toEqual(expected);
      expect(skip).not.toHaveBeenCalled();
    } finally {
      skip.mockRestore();
    }
    expect(cursor.frameAt(5n)?.frame).toEqual(frameAt(animation, 5n)?.frame);
  });
});

describe("seeking in a long timeline", () => {
  // 101 passes of one frame repeated 10000 times, then two more items. The first frame of the item after the
  // loop is 101 * 10000 + 1 = 1010001, worked out by hand; the frame after it is the second item.
  const LONG = `
format: pixelart/1
name: Long
canvas: { width: 16, height: 16 }
palette:
  red: "#ff0000"
sprites:
  a:
    points:
      red: [[0, 0]]
timeline:
  - loop: 101
    steps:
      - show: [a]
        repeat: 10000
  - show: [a]
  - show: [a]
    repeat: 2
`;

  it("shows the first frame of an item far beyond a million frames, without stepping to it", () => {
    const animation = load(doc(LONG)).animation;
    if (!animation) throw new Error("invalid long sample");
    const cursor = new FrameCursor(animation);
    const skip = vi.spyOn(Player.prototype, "skip");
    const next = vi.spyOn(Player.prototype, "next");
    try {
      expect(cursor.firstFrameOf([0])).toBe(1n);
      expect(cursor.firstFrameOf([0, 0])).toBe(1n);
      expect(cursor.firstFrameOf([1])).toBe(1_010_001n);
      expect(cursor.firstFrameOf([2])).toBe(1_010_002n);
      const at = cursor.frameAt(1_010_001n);
      expect(at?.path).toEqual([1]);
      expect(cursor.frameAt(1_010_000n)?.path).toEqual([0, 0]);
      expect(cursor.frameAt(1_010_002n)?.path).toEqual([2]);
      expect(cursor.frameAt(1_010_003n)?.path).toEqual([2]);
      expect(cursor.frameAt(1_010_004n)).toBeNull();
      expect(skip).not.toHaveBeenCalled();
      expect(next.mock.calls.length).toBeLessThan(10);
    } finally {
      skip.mockRestore();
      next.mockRestore();
    }
  });

  it("seeks to the same place as stepping, for every frame of the sample", () => {
    const animation = load(doc(SAMPLE)).animation;
    if (!animation) throw new Error("invalid sample");
    for (let n = 0n; n <= 9n; n++) {
      const stepped = new Player(animation);
      stepped.skip(Number(n));
      const seeked = new Player(animation);
      expect(seeked.seek(n)).toBe(true);
      expect(seeked.path).toEqual(stepped.path);
      expect(seeked.current()).toEqual(stepped.current());
      expect(seeked.next()).toEqual(stepped.next());
    }
    expect(new Player(animation).seek(10n)).toBe(false);
  });

  // Four nested loops of 10000 passes around a frame repeated 10000 times play 10^4 * 10^4 * 10^4 * 10^4 * 10^4 = 10^20
  // frames, far past 2^53 = 9007199254740992. The two items after them start at 10^20 + 1 and 10^20 + 2.
  const HUGE = `
format: pixelart/1
name: Huge
canvas: { width: 16, height: 16 }
palette:
  red: "#ff0000"
sprites:
  a:
    points:
      red: [[0, 0]]
timeline:
  - loop: 10000
    steps:
      - loop: 10000
        steps:
          - loop: 10000
            steps:
              - loop: 10000
                steps:
                  - show: [a]
                    repeat: 10000
  - show: [a]
  - show: [a]
    repeat: 2
`;

  it("counts and seeks exactly across the safe-integer boundary", () => {
    const animation = load(doc(HUGE)).animation;
    if (!animation) throw new Error("invalid huge sample");
    const total = 10n ** 20n;
    expect(frameCount(animation.timeline)).toBe(total + 3n);
    const cursor = new FrameCursor(animation);
    expect(cursor.firstFrameOf([1])).toBe(total + 1n);
    expect(cursor.firstFrameOf([2])).toBe(total + 2n);
    expect(cursor.firstFrameOf([0, 0, 0, 0, 0])).toBe(1n);
    expect(cursor.frameAt(total + 1n)?.path).toEqual([1]);
    expect(cursor.frameAt(total)?.path).toEqual([0, 0, 0, 0, 0]);
    expect(cursor.frameAt(total + 2n)?.path).toEqual([2]);
    expect(cursor.frameAt(total + 3n)?.path).toEqual([2]);
    expect(cursor.frameAt(total + 4n)).toBeNull();
    // A frame just past 2^53 is still inside the first item, not on a rounded neighbor.
    expect(cursor.frameAt(2n ** 53n + 1n)?.path).toEqual([0, 0, 0, 0, 0]);
    const seeked = new Player(animation);
    expect(seeked.seek(total + 1n)).toBe(true);
    expect(seeked.path).toEqual([1]);
    expect(seeked.seek(total + 4n)).toBe(false);
  });

  it("seeks to the same place as stepping through nested loops", () => {
    const nested = `
format: pixelart/1
name: Nested
canvas: { width: 16, height: 16 }
palette:
  red: "#ff0000"
sprites:
  a:
    points:
      red: [[0, 0]]
timeline:
  - loop: 3
    steps:
      - loop: 2
        steps:
          - show: [a]
            repeat: 2
          - show: [a]
      - show: [a]
        repeat: 2
  - show: [a]
`;
    const animation = load(doc(nested)).animation;
    if (!animation) throw new Error("invalid nested sample");
    // Each pass of the outer loop plays (2 + 1) * 2 + 2 = 8 frames, three passes make 24, the last item one more.
    expect(frameCount(animation.timeline)).toBe(25n);
    for (let n = 0n; n <= 25n; n++) {
      const stepped = new Player(animation);
      stepped.skip(Number(n));
      const seeked = new Player(animation);
      expect(seeked.seek(n)).toBe(true);
      expect(seeked.path).toEqual(stepped.path);
      expect(seeked.next()).toEqual(stepped.next());
    }
    expect(new Player(animation).seek(26n)).toBe(false);
  });
});

describe("parseDraftDocument", () => {
  it("reads a draft nested deeper than the engine accepts, and refuses what is not an object", () => {
    const deep = (levels: number): string => '{"timeline":['.repeat(levels) + "1" + "]}".repeat(levels);
    expect(parseDraftDocument(deep(40))).not.toBeNull();
    expect(parseDraftDocument(deep(400))).toBeNull();
    expect(parseDraftDocument("[1]")).toBeNull();
    expect(parseDraftDocument("{oops")).toBeNull();
  });
});
