import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadAnimation, loadPlaylist } from "../src/engine";
import { readYaml } from "../src/yaml/read";
import { jsonBytes, pythonFloat, writeJson } from "../src/yaml/writeJson";
import { writeYaml } from "../src/yaml/writeYaml";
import { REPO } from "./helpers";

const read = (source: string) => {
  const result = readYaml(source);
  if (!result.ok) throw new Error(result.message);
  return result.value;
};
const toJson = (source: string): string => writeJson(read(source));

describe("repository files", () => {
  for (const kind of ["animations", "playlists"]) {
    const sources = readdirSync(`${REPO}${kind}`).filter((n) => n.endsWith(".yaml") || n.endsWith(".yml"));
    it(`${kind} has sources`, () => expect(sources.length).toBeGreaterThan(0));
    it.each(sources)(`${kind}/%s converts to the bytes of make data`, (name) => {
      const id = name.replace(/\.ya?ml$/, "");
      const board = `${REPO}data/${kind}/${id}.json`;
      expect(existsSync(board), `${board} is missing: run make data`).toBe(true);
      const converted = jsonBytes(read(readFileSync(`${REPO}${kind}/${name}`, "utf8")));
      expect(Buffer.from(converted).equals(readFileSync(board))).toBe(true);
    });
    it.each(sources)(`${kind}/%s survives JSON to YAML and back`, (name) => {
      const value = read(readFileSync(`${REPO}${kind}/${name}`, "utf8"));
      expect(toJson(writeYaml(value))).toBe(writeJson(value));
    });
  }
});

describe("YAML 1.1 rules", () => {
  it("reads yes, no, on and off as booleans", () => {
    expect(toJson("a: yes\nb: no\nc: on\nd: off\ne: 'yes'")).toBe('{"a":true,"b":false,"c":true,"d":false,"e":"yes"}');
  });
  it("keeps the YAML 1.1 number forms", () => {
    expect(toJson("a: 0x1F\nb: 1_000\nc: 0b11\nd: 012\ne: 1:30")).toBe('{"a":31,"b":1000,"c":3,"d":10,"e":90}');
  });
  it("resolves numbers and words like PyYAML does", () => {
    expect(toJson("a: 1e3\nb: 1.0e3\nc: 1.0e+3\nd: y\ne: n\nf: 08\ng: 1__0\nh: .5\ni: -.inf\nj: 0o17")).toBe(
      '{"a":"1e3","b":"1.0e3","c":1000.0,"d":"y","e":"n","f":"08","g":10,"h":0.5,"i":-Infinity,"j":"0o17"}',
    );
  });
  it("keeps integers beyond 2^53 exact", () => {
    expect(toJson("a: 12345678901234567890")).toBe('{"a":12345678901234567890}');
  });
  it("keeps floats as floats", () => {
    expect(toJson("a: 100.0\nb: 1.5\nc: 1.0e+3")).toBe('{"a":100.0,"b":1.5,"c":1000.0}');
  });
  it("makes the engine refuse a float where an integer is required", () => {
    const json = toJson(
      "format: pixelart/1\nname: x\ncanvas: {width: 16, height: 16}\nframe_ms: 100.0\nsprites:\n  a: {points: [[1, 1, '#ffffff']]}\ntimeline:\n  - show: [a]\n",
    );
    const result = loadAnimation(new TextEncoder().encode(json));
    expect(result.animation).toBeNull();
    expect(result.diagnostics.some((d) => d.code === "structure" && d.where === "frame_ms")).toBe(true);
  });
  it("writes characters outside ASCII as they are, with json.dumps escapes", () => {
    expect(toJson('a: "caf\u00e9 \\"q\\" \\\\ \\n \\t \\u0001 \\u007f"')).toBe(
      '{"a":"caf\u00e9 \\"q\\" \\\\ \\n \\t \\u0001 \u007f"}',
    );
  });
  it("keeps the order of the keys of the text", () => {
    expect(toJson("z: 1\n1x: 2\na: 3")).toBe('{"z":1,"1x":2,"a":3}');
  });
  it("keeps null, empty lists and empty maps", () => {
    expect(toJson("a: ~\nb: []\nc: {}")).toBe('{"a":null,"b":[],"c":{}}');
  });
  it("follows aliases", () => {
    expect(toJson("a: &x [1, 2]\nb: *x")).toBe('{"a":[1,2],"b":[1,2]}');
  });
});

describe("refused YAML", () => {
  const refused: [string, string][] = [
    ["a duplicate key", "a: 1\na: 2"],
    ["a duplicate key in a nested mapping", "m:\n  a: 1\n  b: 2\n  a: 3"],
    ["a key that is not text", "1: a"],
    ["a boolean key", "on: a"],
    ["a null key", "~: a"],
    ["a custom tag", "a: !foo bar"],
    ["a timestamp", "a: 2001-12-14"],
    ["binary data", "a: !!binary aGk="],
    ["a merge key", "a: &x {b: 1}\nc:\n  <<: *x"],
    ["a syntax error", "a: [1, 2"],
    ["an alias to an unknown anchor", "a: *nope"],
    ["an alias that contains itself", "a: &x [*x]"],
    ["an empty document", ""],
  ];
  it.each(refused)("%s", (_name, source) => {
    expect(readYaml(source).ok).toBe(false);
  });

  it("reports the line of a duplicate key", () => {
    const result = readYaml("a: 1\nb: 2\na: 3");
    expect(result).toMatchObject({ ok: false, line: 3 });
  });

  it("stops nested aliases that double at every level", () => {
    const rows = ["l0: &l0 [x, x]"];
    for (let i = 1; i < 40; i++) rows.push(`l${i}: &l${i} [*l${i - 1}, *l${i - 1}]`);
    const result = readYaml(rows.join("\n"));
    expect(result).toMatchObject({ ok: false, message: "aliases expand to too many nodes" });
  });

  it("stops a wide anchored list that is referenced thousands of times, and fast", () => {
    const rows = [`wide: &w [${Array.from({ length: 2000 }, (_, i) => i).join(", ")}]`];
    for (let i = 0; i < 3000; i++) rows.push(`r${i}: *w`);
    const started = Date.now();
    const result = readYaml(rows.join("\n"));
    expect(result).toMatchObject({ ok: false, message: "aliases expand to too many nodes" });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("allows aliases that stay within the budget", () => {
    const rows = ["wide: &w [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]"];
    for (let i = 0; i < 100; i++) rows.push(`r${i}: *w`);
    expect(readYaml(rows.join("\n")).ok).toBe(true);
  });

  it("refuses text over 256 KiB", () => {
    expect(readYaml(`a: ${"x".repeat(256 * 1024)}`).ok).toBe(false);
    expect(readYaml(`a: ${"x".repeat(256 * 1024 - 10)}`).ok).toBe(true);
  });
});

describe("Python float text", () => {
  it.each([
    [100.0, "100.0"],
    [1e16, "1e+16"],
    [1e15, "1000000000000000.0"],
    [123456789012345.0, "123456789012345.0"],
    [0.0001, "0.0001"],
    [0.00001, "1e-05"],
    [1.5e-7, "1.5e-07"],
    [1e22, "1e+22"],
    [1e23, "1e+23"],
    [0.1, "0.1"],
    [-2.5, "-2.5"],
    [3.14159, "3.14159"],
    [1e100, "1e+100"],
    [5e-324, "5e-324"],
    [1.7976931348623157e308, "1.7976931348623157e+308"],
    [123456.789, "123456.789"],
    [1.2345678901234568e16, "1.2345678901234568e+16"],
    [0, "0.0"],
    [-0, "-0.0"],
    [Infinity, "Infinity"],
    [NaN, "NaN"],
  ])("%s is written as %s", (value, expected) => {
    expect(pythonFloat(value)).toBe(expected);
  });
});

describe("JSON to YAML", () => {
  it("quotes every hex color, in values and as keys", () => {
    const yaml = writeYaml(read('colors: {"#ff0000": [[1, 2]]}\nbg: "#00ff00"\nname: red'));
    expect(yaml).toContain('"#ff0000": [[1, 2]]');
    expect(yaml).toContain('bg: "#00ff00"');
    expect(yaml).toContain("name: red");
  });
  it("writes points and pairs in flow style and mappings in block style", () => {
    const yaml = writeYaml(read("a:\n  b:\n    - [1, 2, '#ffffff']\n    - {c: 1, d: [x, z]}\n"));
    expect(yaml).toBe('a:\n  b:\n    - [1, 2, "#ffffff"]\n    - c: 1\n      d: [x, z]\n');
  });
  it("quotes words that YAML 1.1 would read as something else", () => {
    const yaml = writeYaml(read("a: 'yes'\nb: 'on'\nc: '12'\nd: 'null'\ne: ''\nf: 'a: b'"));
    expect(yaml).toBe('a: "yes"\nb: "on"\nc: "12"\nd: "null"\ne: ""\nf: "a: b"\n');
  });
  it("round-trips floats, nested sequences and wrapped flow lists", () => {
    const points = Array.from({ length: 60 }, (_, i) => `[${i}, ${i}]`).join(", ");
    const source = `f: 100.0\ng: 1.0e+20\nl: [[1, [2, 3]], [4]]\np:\n  white: [${points}]\n`;
    const value = read(source);
    expect(toJson(writeYaml(value))).toBe(writeJson(value));
  });
  it("round-trips a playlist through the engine", () => {
    const source = readFileSync(`${REPO}playlists/default.yaml`, "utf8");
    const again = jsonBytes(read(writeYaml(read(source))));
    expect(loadPlaylist(again).items?.length).toBeGreaterThan(0);
  });
});
