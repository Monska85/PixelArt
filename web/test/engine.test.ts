// SPDX-License-Identifier: GPL-3.0-or-later

// Cases beyond the conformance suite: the JSON reader and the loaders' edges.

import { describe, expect, it } from "vitest";
import {
  JsonNumber,
  Player,
  effectiveBrightness,
  isObject,
  loadAnimation,
  loadPlaylist,
  parseStrictJson,
} from "../src/engine";
import { text } from "./helpers";

const parse = (s: string, depth = 32) => parseStrictJson(text(s), depth);
const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);

const base = (extra: Record<string, unknown> = {}, sprites: unknown = { a: { points: [[1, 1, "#ffffff"]] } }): string =>
  JSON.stringify({
    format: "pixelart/1",
    name: "x",
    canvas: { width: 16, height: 16 },
    sprites,
    timeline: [{ show: ["a"] }],
    ...extra,
  });

const codes = (source: string): string[] =>
  loadAnimation(text(source)).diagnostics.map((d) => `${d.severity}:${d.code}@${d.where}`);

describe("strict JSON reader", () => {
  it.each([
    ["a single quote", "{'a':1}"],
    ["an unquoted key", "{a:1}"],
    ["a leading plus", '{"a":+1}'],
    ["a leading zero", '{"a":01}'],
    ["a leading dot", '{"a":.5}'],
    ["a trailing dot", '{"a":1.}'],
    ["an exponent without digits", '{"a":1e}'],
    ["a trailing comma in an object", '{"a":1,}'],
    ["a trailing comma in an array", "[1,]"],
    ["a comment", '{"a":1}//x'],
    ["trailing data", '{"a":1} x'],
    ["two documents", "{}{}"],
    ["a raw tab in a string", '{"a":"x\ty"}'],
    ["a raw newline in a string", '{"a":"x\ny"}'],
    ["an escaped NUL", '{"a":"x\\u0000y"}'],
    ["an escaped NUL in a key", '{"a\\u0000":1}'],
    ["a raw NUL", '{"a":"x\u0000y"}'],
    ["an invalid escape", '{"a":"\\x"}'],
    ["a short unicode escape", '{"a":"\\u12"}'],
    ["a lone high surrogate escape", '{"a":"\\ud800"}'],
    ["a lone low surrogate escape", '{"a":"\\udc00"}'],
    ["a high surrogate followed by a letter", '{"a":"\\ud800x"}'],
    ["an unterminated string", '{"a":"x'],
    ["an empty document", ""],
    ["only spaces", "   "],
    ["a missing colon", '{"a" 1}'],
    ["NaN", '{"a":NaN}'],
    ["a truncated literal", '{"a":tru}'],
  ])("rejects %s", (_name, source) => {
    expect(parse(source).ok).toBe(false);
  });

  it("rejects a byte order mark", () => {
    expect(parseStrictJson(bytes(0xef, 0xbb, 0xbf, 0x7b, 0x7d), 32).ok).toBe(false);
  });

  it.each([
    ["a lone continuation byte", [0x7b, 0x22, 0x80, 0x22, 0x7d]],
    ["an overlong form", [0x7b, 0x22, 0xc0, 0xaf, 0x22, 0x7d]],
    ["a UTF-8 encoded surrogate", [0x7b, 0x22, 0xed, 0xa0, 0x80, 0x22, 0x7d]],
    ["a value above U+10FFFF", [0x7b, 0x22, 0xf4, 0x90, 0x80, 0x80, 0x22, 0x7d]],
    ["a truncated sequence", [0x7b, 0x22, 0xe2, 0x82, 0x22, 0x7d]],
  ])("rejects invalid UTF-8: %s", (_name, values) => {
    expect(parseStrictJson(bytes(...values), 32).ok).toBe(false);
  });

  it("accepts valid text and escapes", () => {
    const result = parse('{"a":"café 中 \\u00e9 \\ud83d\\ude00 \\n \\/"}');
    expect(result.ok && isObject(result.value) && result.value.get("a")).toBe("café 中 é \u{1f600} \n /");
  });

  it("allows 32 levels and refuses 33", () => {
    expect(parse("[".repeat(32) + "]".repeat(32), 32).ok).toBe(true);
    expect(parse("[".repeat(33) + "]".repeat(33), 32).ok).toBe(false);
    expect(parse("[".repeat(10) + "]".repeat(10), 10).ok).toBe(true);
    expect(parse("[".repeat(11) + "]".repeat(11), 10).ok).toBe(false);
  });

  it("keeps the first position and the last value of a repeated key", () => {
    const result = parse('{"a":1,"b":2,"a":3}');
    expect(
      result.ok && isObject(result.value) && [...result.value].map(([k, v]) => `${k}=${(v as JsonNumber).value}`),
    ).toEqual(["a=3", "b=2"]);
  });

  it("keeps keys that look like integers in their order", () => {
    const result = parse('{"b":1,"2":2,"1":3}');
    expect(result.ok && isObject(result.value) && [...result.value.keys()]).toEqual(["b", "2", "1"]);
  });

  it("tells integers from other numbers", () => {
    const flags = (s: string): boolean => {
      const r = parse(`[${s}]`);
      if (!r.ok || !Array.isArray(r.value)) throw new Error("not parsed");
      return (r.value[0] as JsonNumber).integer;
    };
    expect(flags("5")).toBe(true);
    expect(flags("-0")).toBe(true);
    expect(flags("100.0")).toBe(false);
    expect(flags("1e2")).toBe(false);
    expect(flags("1E+2")).toBe(false);
    expect(flags("0.5")).toBe(false);
    expect(flags("9223372036854775807")).toBe(true);
    expect(flags("-9223372036854775808")).toBe(true);
    expect(flags("9223372036854775808")).toBe(false);
    expect(flags("-9223372036854775809")).toBe(false);
    expect(flags("1e999")).toBe(false);
  });

  it("reads -0 as the integer 0", () => {
    const r = parse("[-0]");
    expect(r.ok && Object.is((r.value as JsonNumber[])[0]?.value, 0)).toBe(true);
  });
});

describe("animation loader", () => {
  it("accepts 128 characters in a name and refuses 129, counting code points", () => {
    expect(loadAnimation(text(base({ name: "\u{1f600}".repeat(128) }))).animation).not.toBeNull();
    expect(codes(base({ name: "\u{1f600}".repeat(129) }))).toContain("error:structure@name");
    expect(loadAnimation(text(base({ name: "é".repeat(128) }))).animation).not.toBeNull();
  });

  it("refuses a float where an integer is required", () => {
    expect(codes(base().replace('"width":16', '"width":16.0'))).toContain("error:structure@canvas");
    expect(codes(base().replace('"width":16', '"width":1.6e1'))).toContain("error:structure@canvas");
    expect(codes(base({ frame_ms: 1e2 }).replace('"frame_ms":100', '"frame_ms":1e2'))).toContain(
      "error:structure@frame_ms",
    );
    expect(codes(base().replace("[1,1,", "[1.0,1,"))).toContain("error:structure@sprites.a.points[0][0]");
  });

  it("refuses a canvas with another key", () => {
    expect(codes(base().replace('"height":16', '"height":16,"depth":1'))).toContain("error:structure@canvas");
  });

  it("accepts a version up to 2147483647 and refuses a larger one", () => {
    expect(loadAnimation(text(base({ version: 2147483647 }))).animation?.version).toBe(2147483647);
    expect(codes(base({ version: 2147483648 }))).toContain("error:structure@version");
    expect(codes(base({ version: 0 }))).toContain("error:structure@version");
  });

  it("treats a present null as an error in every optional field, unlike an absent field", () => {
    expect(loadAnimation(text(base())).animation).not.toBeNull();
    for (const key of ["brightness", "version", "author", "description", "frame_ms", "palette", "name"])
      expect(codes(base({ [key]: null })), key).toContain(`error:structure@${key}`);
    expect(codes(base({ background: null }))).toContain("error:unknown_color@background");
  });

  it("treats a present null as an error in the optional fields of sprites, frames and references", () => {
    const sprite = (extra: object) => ({ a: { points: [[1, 1, "#ff0000"]], ...extra } });
    for (const key of ["at", "pivot"])
      expect(codes(base({ sprites: sprite({ [key]: null }) })), key).toContain(`error:structure@sprites.a.${key}`);
    for (const key of ["at", "move", "pivot", "wrap", "rotate", "spin", "flip"])
      expect(codes(base({ timeline: [{ show: [{ sprite: "a", [key]: null }] }] })), key).toContain(
        `error:structure@timeline[0].show[0].${key}`,
      );
    for (const key of ["ms", "repeat", "recolor"])
      expect(codes(base({ timeline: [{ show: ["a"], [key]: null }] })), key).toContain(
        `error:structure@timeline[0].${key}`,
      );
  });

  it("treats a null required field as missing", () => {
    expect(loadAnimation(text(base({ timeline: null }))).diagnostics[0]).toMatchObject({
      code: "structure",
      where: "timeline",
    });
  });

  it("reports a file over 64 KiB and not valid JSON", () => {
    expect(loadAnimation(new Uint8Array(65537)).diagnostics[0]).toMatchObject({ code: "limit_exceeded", where: "" });
    expect(loadAnimation(text("{")).diagnostics).toEqual([expect.objectContaining({ code: "structure", where: "" })]);
    expect(loadAnimation(text("[]")).diagnostics[0]).toMatchObject({ code: "structure", where: "" });
    expect(loadAnimation(text('{"format":5}')).diagnostics[0]).toMatchObject({
      code: "format_unsupported",
      where: "format",
    });
  });

  it("keeps 32 diagnostics, replacing the latest warning by an error", () => {
    const sprites: Record<string, unknown> = {};
    for (let i = 0; i < 40; i++)
      sprites[`s${String(i).padStart(2, "0")}`] = {
        points: [
          [1, 1, "#ffffff"],
          [1, 1, "#ffffff"],
        ],
      };
    const result = loadAnimation(text(base({}, sprites).replace('["a"]', '["missing"]')));
    expect(result.animation).toBeNull();
    expect(result.diagnostics).toHaveLength(32);
    expect(result.diagnostics.slice(0, 31).every((d) => d.code === "duplicate_point")).toBe(true);
    expect(result.diagnostics[31]).toMatchObject({ severity: "error", code: "unknown_sprite" });
  });

  it("keeps 32 diagnostics when every one of them is an error", () => {
    const timeline = Array.from({ length: 40 }, () => ({ show: ["a"], ms: 5 }));
    const result = loadAnimation(text(base({ timeline })));
    expect(result.diagnostics).toHaveLength(32);
    expect(result.diagnostics.every((d) => d.severity === "error")).toBe(true);
  });

  it("orders final warnings: pivot, unused sprites, unused colors by name", () => {
    const source = base(
      { palette: { zeta: "#010101", alpha: "#020202", mid: "#030303" } },
      {
        a: {
          points: [
            [0, 0, "#ffffff"],
            [1, 0, "#ffffff"],
          ],
        },
        spare: { points: [[0, 0, "#ffffff"]] },
      },
    ).replace('{"show":["a"]}', '{"show":[{"sprite":"a","rotate":90}]}');
    expect(codes(source)).toEqual([
      "warning:pivot_rounded@sprites.a",
      "warning:unused_sprite@sprites.spare",
      "warning:unused_color@palette.alpha",
      "warning:unused_color@palette.mid",
      "warning:unused_color@palette.zeta",
    ]);
  });

  it("warns once about duplicate points, naming the smallest position", () => {
    const sprites = {
      a: {
        points: [
          [5, 5, "#ffffff"],
          [2, 9, "#ffffff"],
          [5, 5, "#ffffff"],
          [2, 9, "#ffffff"],
        ],
      },
    };
    const result = loadAnimation(text(base({}, sprites)));
    const dup = result.diagnostics.filter((d) => d.code === "duplicate_point");
    expect(dup).toHaveLength(1);
    expect(dup[0]?.message).toContain("[2, 9]");
  });

  it("emits no final warnings when the load fails", () => {
    const result = loadAnimation(text(base({ palette: { unused: "#000000" } }).replace('"name":"x"', '"name":""')));
    expect(result.diagnostics.map((d) => d.code)).toEqual(["structure"]);
  });

  it("counts drawn pixels without overflowing on a deep composite tree", () => {
    const sprites: Record<string, unknown> = {
      l0: { points: Array.from({ length: 40 }, (_, i) => [i % 16, Math.floor(i / 16), "#ffffff"]) },
    };
    for (let i = 1; i <= 3; i++) sprites[`l${i}`] = { parts: Array.from({ length: 64 }, () => `l${i - 1}`) };
    const source = base({}, sprites).replace('["a"]', '["l3"]');
    expect(codes(source)).toContain("error:limit_exceeded@timeline[0].show");
  });
});

describe("playlist loader", () => {
  const playlist = (items: unknown, extra: Record<string, unknown> = {}): Uint8Array =>
    text(JSON.stringify({ format: "pixelart-playlist/1", canvas: { width: 16, height: 16 }, items, ...extra }));

  it("returns the enabled items with their repeat", () => {
    const result = loadPlaylist(
      playlist([{ animation: "a" }, { animation: "b", repeat: 3 }, { animation: "c", enabled: false }]),
    );
    expect(result.items).toEqual([
      { animation: "a", repeat: 1 },
      { animation: "b", repeat: 3 },
    ]);
  });

  it("treats a present null repeat, enabled or name as an error", () => {
    expect(loadPlaylist(playlist([{ animation: "a", repeat: null }])).diagnostics).toEqual([
      expect.objectContaining({ code: "structure", where: "items[0].repeat" }),
    ]);
    expect(loadPlaylist(playlist([{ animation: "a", enabled: null }])).diagnostics).toEqual([
      expect.objectContaining({ code: "structure", where: "items[0].enabled" }),
    ]);
  });

  it("reports the places of the errors", () => {
    const source = JSON.stringify({
      format: "pixelart-playlist/1",
      canvas: { width: 16, height: 16 },
      items: [
        5,
        { animation: "A" },
        { animation: "a", repeat: 1 },
        { animation: "a", repeat: 1001 },
        { animation: "a", enabled: 1, x: 1 },
      ],
    }).replace('"repeat":1}', '"repeat":1.0}');
    const result = loadPlaylist(text(source));
    expect(result.items).toBeNull();
    expect(result.diagnostics.map((d) => d.where)).toEqual([
      "items[0]",
      "items[1].animation",
      "items[2].repeat",
      "items[3].repeat",
      "items[4].x",
      "items[4].enabled",
    ]);
  });

  it("keeps at most 32 errors", () => {
    const result = loadPlaylist(playlist(Array.from({ length: 100 }, () => 5)));
    expect(result.diagnostics).toHaveLength(32);
  });

  it("refuses more than 256 items and a depth over 10", () => {
    expect(
      loadPlaylist(playlist(Array.from({ length: 257 }, () => ({ animation: "a" })))).diagnostics[0],
    ).toMatchObject({ code: "limit_exceeded", where: "items" });
    expect(
      loadPlaylist(playlist([{ animation: "a" }], { deep: JSON.parse("[".repeat(10) + "]".repeat(10)) }))
        .diagnostics[0],
    ).toMatchObject({ code: "structure", where: "" });
  });
});

describe("player and brightness", () => {
  it("fills with the background and plays every repeat", () => {
    const result = loadAnimation(
      text(
        base({ background: "#000033", frame_ms: 100 }).replace('{"show":["a"]}', '{"show":["a"],"repeat":3,"ms":40}'),
      ),
    );
    const player = new Player(result.animation!);
    const frames = [];
    for (let f = player.next(); f; f = player.next()) frames.push(f);
    expect(frames.map((f) => f.ms)).toEqual([40, 40, 40]);
    expect(frames[0]?.pixels[0]).toBe(0x000033);
    expect(frames[0]?.pixels[17]).toBe(0xffffff);
  });

  it.each([
    [0, 100, 0],
    [0, 1, 0],
    [255, 100, 255],
    [255, 1, 3],
    [1, 1, 1],
    [10, 1, 1],
    [50, 50, 25],
    [51, 50, 26],
    [200, 99, 198],
  ])("effective brightness of board %i at %i percent is %i", (board, percent, expected) => {
    expect(effectiveBrightness(board, percent)).toBe(expected);
  });
});
