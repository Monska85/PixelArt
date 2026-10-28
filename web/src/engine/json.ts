// SPDX-License-Identifier: GPL-3.0-or-later

// Strict JSON reader (RFC 8259) that keeps integers and other numbers apart,
// which JSON.parse cannot do: `1.0` is not an integer in the formats.

/** A JSON number. `integer` is true for a token without fraction or exponent that fits in int64. */
export class JsonNumber {
  constructor(
    readonly value: number,
    readonly integer: boolean,
    /** The exact decimal text of an integer, kept for values beyond 2^53. */
    readonly text?: string,
  ) {}

  static int(value: number): JsonNumber {
    return new JsonNumber(value, true);
  }

  static float(value: number): JsonNumber {
    return new JsonNumber(value, false);
  }
}

export type JsonObject = Map<string, JsonValue>;
export type JsonArray = JsonValue[];
export type JsonValue = null | boolean | string | JsonNumber | JsonArray | JsonObject;

/**
 * How many containers may nest in a stored file: the NestingLimit that lib/PixelEngine
 * passes to ArduinoJson (MAX_JSON_DEPTH in animation_loader.cpp, playlist.cpp and schedule.cpp).
 */
export const ANIMATION_JSON_DEPTH = 32;
export const PLAYLIST_JSON_DEPTH = 10;
export const SCHEDULE_JSON_DEPTH = 10;

type JsonResult = { ok: true; value: JsonValue } | { ok: false; reason: string };

const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;

class Failure extends Error {}

// The decoder rejects every byte sequence that is not UTF-8 as RFC 3629 defines
// it (overlong forms, surrogates, values above U+10FFFF). A BOM stays in the
// text and is then refused as an unexpected character.
function decode(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new Failure("invalid UTF-8");
  }
}

class Reader {
  private pos = 0;

  constructor(
    private readonly text: string,
    private readonly maxDepth: number,
  ) {}

  parse(): JsonValue {
    this.skipSpace();
    const value = this.value(0);
    this.skipSpace();
    if (this.pos < this.text.length) throw new Failure("data after the end of the document");
    return value;
  }

  private skipSpace(): void {
    for (; this.pos < this.text.length; this.pos++) {
      const c = this.text.charCodeAt(this.pos);
      if (c !== 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) return;
    }
  }

  private value(depth: number): JsonValue {
    if (this.pos >= this.text.length) throw new Failure("unexpected end of the document");
    const c = this.text[this.pos];
    if (c === "{") return this.object(depth + 1);
    if (c === "[") return this.array(depth + 1);
    if (c === '"') return this.string();
    if (c === "-" || (c !== undefined && c >= "0" && c <= "9")) return this.number();
    for (const [word, value] of [
      ["true", true],
      ["false", false],
      ["null", null],
    ] as const) {
      if (this.text.startsWith(word, this.pos)) {
        this.pos += word.length;
        return value;
      }
    }
    throw new Failure("unexpected character");
  }

  private object(depth: number): JsonObject {
    if (depth > this.maxDepth) throw new Failure("nested too deeply");
    this.pos++;
    // A Map keeps the position of the first occurrence of a repeated key and the value of the last.
    const object: JsonObject = new Map();
    this.skipSpace();
    if (this.text[this.pos] === "}") {
      this.pos++;
      return object;
    }
    for (;;) {
      this.skipSpace();
      if (this.text[this.pos] !== '"') throw new Failure("object keys must be double-quoted strings");
      const key = this.string();
      this.skipSpace();
      if (this.text[this.pos] !== ":") throw new Failure("expected ':' after a key");
      this.pos++;
      this.skipSpace();
      object.set(key, this.value(depth));
      this.skipSpace();
      const next = this.text[this.pos++];
      if (next === "}") return object;
      if (next !== ",") throw new Failure("unexpected character after a value");
    }
  }

  private array(depth: number): JsonArray {
    if (depth > this.maxDepth) throw new Failure("nested too deeply");
    this.pos++;
    const array: JsonArray = [];
    this.skipSpace();
    if (this.text[this.pos] === "]") {
      this.pos++;
      return array;
    }
    for (;;) {
      this.skipSpace();
      array.push(this.value(depth));
      this.skipSpace();
      const next = this.text[this.pos++];
      if (next === "]") return array;
      if (next !== ",") throw new Failure("unexpected character after a value");
    }
  }

  private string(): string {
    const text = this.text;
    let out = "";
    let start = ++this.pos;
    for (;;) {
      if (this.pos >= text.length) throw new Failure("unterminated string");
      const code = text.charCodeAt(this.pos);
      if (code === 0x22) break;
      if (code < 0x20) throw new Failure("control character inside a string");
      if (code !== 0x5c) {
        this.pos++;
        continue;
      }
      out += text.slice(start, this.pos);
      const escape = text[this.pos + 1];
      this.pos += 2;
      switch (escape) {
        case '"':
        case "\\":
        case "/":
          out += escape;
          break;
        case "b":
          out += "\b";
          break;
        case "f":
          out += "\f";
          break;
        case "n":
          out += "\n";
          break;
        case "r":
          out += "\r";
          break;
        case "t":
          out += "\t";
          break;
        case "u": {
          const hex = text.slice(this.pos, this.pos + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new Failure("invalid escape");
          const unit = parseInt(hex, 16);
          if (unit === 0) throw new Failure("U+0000 is not allowed in a string");
          this.pos += 4;
          if (unit >= 0xd800 && unit <= 0xdbff) {
            // A high surrogate must be followed by an escaped low surrogate.
            const low = /^\\u([dD][c-fC-F][0-9a-fA-F]{2})/.exec(text.slice(this.pos, this.pos + 6));
            if (!low?.[1]) throw new Failure("unpaired surrogate escape");
            out += String.fromCharCode(unit, parseInt(low[1], 16));
            this.pos += 6;
          } else if (unit >= 0xdc00 && unit <= 0xdfff) {
            throw new Failure("unpaired surrogate escape");
          } else {
            out += String.fromCharCode(unit);
          }
          break;
        }
        default:
          throw new Failure("invalid escape");
      }
      start = this.pos;
    }
    out += text.slice(start, this.pos);
    this.pos++;
    return out;
  }

  private number(): JsonNumber {
    const match = /-?(?:0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?/y;
    match.lastIndex = this.pos;
    const found = match.exec(this.text);
    if (!found) throw new Failure("invalid number");
    const token = found[0];
    this.pos += token.length;
    // -0 is the integer 0. Integers outside int64 are not integers for the formats.
    if (
      found[1] === undefined &&
      found[2] === undefined &&
      (token.length < 19 || (BigInt(token) >= INT64_MIN && BigInt(token) <= INT64_MAX))
    )
      return new JsonNumber(Number(token) + 0, true, token.length > 15 ? BigInt(token).toString() : undefined);
    return new JsonNumber(Number(token), false);
  }
}

/** Reads one strict JSON document. `maxDepth` is how many containers may nest. */
export function parseStrictJson(bytes: Uint8Array, maxDepth: number): JsonResult {
  try {
    const value = new Reader(decode(bytes), maxDepth).parse();
    return { ok: true, value };
  } catch (error) {
    if (error instanceof Failure) return { ok: false, reason: error.message };
    throw error;
  }
}

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return value instanceof Map;
}

export function isArray(value: JsonValue | undefined): value is JsonArray {
  return Array.isArray(value);
}

export function isInteger(value: JsonValue | undefined): value is JsonNumber {
  return value instanceof JsonNumber && value.integer;
}

/** Number of Unicode code points, the unit of the formats' text limits. */
export function codePointLength(text: string): number {
  // The string iterator yields a surrogate pair as one item, and a lone surrogate as one item too.
  return [...text].length;
}
