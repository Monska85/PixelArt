// JSON text byte-equal to Python's json.dumps(doc, separators=(",", ":"),
// ensure_ascii=False), which `tools/pixelart.py build` uses for the board's files.

import { JsonNumber, type JsonValue } from "../engine";

/** Python's repr(float), which json.dumps uses, with its Infinity and NaN names. */
export function pythonFloat(x: number): string {
  if (Number.isNaN(x)) return "NaN";
  if (x === Infinity) return "Infinity";
  if (x === -Infinity) return "-Infinity";
  if (x === 0) return Object.is(x, -0) ? "-0.0" : "0.0";
  const sign = x < 0 ? "-" : "";
  const [mantissa = "", exponentText = "0"] = Math.abs(x).toExponential().split("e");
  const digits = mantissa.replace(".", "");
  const exponent = parseInt(exponentText, 10);
  if (exponent >= -4 && exponent < 16) {
    if (exponent >= 0) {
      const whole = digits.padEnd(exponent + 1, "0");
      return `${sign}${whole.slice(0, exponent + 1)}.${whole.slice(exponent + 1) || "0"}`;
    }
    return `${sign}0.${"0".repeat(-exponent - 1)}${digits}`;
  }
  const fraction = digits.length > 1 ? `.${digits.slice(1)}` : "";
  const magnitude = Math.abs(exponent).toString().padStart(2, "0");
  return `${sign}${digits[0]}${fraction}e${exponent < 0 ? "-" : "+"}${magnitude}`;
}

const ESCAPES: Record<string, string> = {
  '"': '\\"',
  "\\": "\\\\",
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
  "\b": "\\b",
  "\f": "\\f",
};

function jsonString(text: string): string {
  // eslint-disable-next-line no-control-regex -- json.dumps escapes exactly these characters
  return `"${text.replace(/["\\\u0000-\u001f]/g, (c) => ESCAPES[c] ?? `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`)}"`;
}

export function jsonNumber(n: JsonNumber): string {
  return n.integer ? (n.text ?? String(n.value)) : pythonFloat(n.value);
}

export function writeJson(value: JsonValue): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return jsonString(value);
  if (value instanceof JsonNumber) return jsonNumber(value);
  if (Array.isArray(value)) return `[${value.map(writeJson).join(",")}]`;
  return `{${[...value].map(([k, v]) => `${jsonString(k)}:${writeJson(v)}`).join(",")}}`;
}

/** The bytes the board stores for a document. */
export function jsonBytes(value: JsonValue): Uint8Array {
  return new TextEncoder().encode(writeJson(value));
}
