// JSON to YAML: block style for mappings and sequences, flow style for points
// and coordinate pairs, every text that is not a plain word in double quotes
// (so every hex color is quoted).

import { JsonNumber, type JsonValue } from "../engine";
import { jsonNumber } from "./writeJson";

const WIDTH = 100;
const PLAIN = /^[A-Za-z_][A-Za-z0-9_ .\-/()+]*$/;
// Words that YAML 1.1 reads as something other than text.
const RESERVED = /^(y|n|yes|no|true|false|on|off|null)$/i;

function quote(text: string): string {
  let out = '"';
  for (const c of text) {
    const code = c.codePointAt(0) as number;
    if (c === '"') out += '\\"';
    else if (c === "\\") out += "\\\\";
    else if (c === "\n") out += "\\n";
    else if (c === "\t") out += "\\t";
    else if (c === "\r") out += "\\r";
    else if (code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029 || code === 0xfeff)
      out += `\\u${code.toString(16).padStart(4, "0")}`;
    else out += c;
  }
  return `${out}"`;
}

function text(value: string): string {
  return PLAIN.test(value) && !value.endsWith(" ") && !RESERVED.test(value) ? value : quote(value);
}

function scalar(value: string | boolean | null | JsonNumber): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return text(value);
  if (value.integer) return jsonNumber(value);
  if (Number.isNaN(value.value)) return ".nan";
  if (!Number.isFinite(value.value)) return value.value > 0 ? ".inf" : "-.inf";
  const written = jsonNumber(value);
  return written.includes(".") ? written : written.replace("e", ".0e");
}

type Scalar = string | boolean | null | JsonNumber;
const isScalar = (v: JsonValue): v is Scalar => !Array.isArray(v) && !(v instanceof Map);

// Sequences of scalars (a coordinate pair, a list of names) and sequences of
// such sequences (a list of points) are written in flow style.
function isFlowSequence(v: JsonValue): v is JsonValue[] {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    (v.every(isScalar) || v.every((item) => Array.isArray(item) && item.length > 0 && item.every(isScalar)))
  );
}

function flowItem(v: JsonValue): string {
  return isScalar(v) ? scalar(v) : `[${(v as JsonValue[]).map(flowItem).join(", ")}]`;
}

// `prefix` is what precedes the flow sequence on its line, `indent` the indentation of that line.
function flow(items: JsonValue[], prefix: string, indent: number): string[] {
  const tokens = items.map(flowItem);
  const single = `${prefix}[${tokens.join(", ")}]`;
  if (single.length <= WIDTH) return [single];
  const lines: string[] = [];
  const pad = " ".repeat(indent + 4);
  let line = "";
  for (const [i, token] of tokens.entries()) {
    const piece = i < tokens.length - 1 ? `${token},` : `${token}]`;
    if (line !== "" && pad.length + line.length + 1 + piece.length > WIDTH) {
      lines.push(pad + line);
      line = piece;
    } else line = line === "" ? piece : `${line} ${piece}`;
  }
  lines.push(pad + line);
  return [`${prefix}[`, ...lines];
}

function emptyOrScalar(v: JsonValue): string | null {
  if (isScalar(v)) return scalar(v);
  if (Array.isArray(v) && v.length === 0) return "[]";
  if (v instanceof Map && v.size === 0) return "{}";
  return null;
}

function mapLines(map: Map<string, JsonValue>, indent: number, top: boolean): string[] {
  const pad = " ".repeat(indent);
  const lines: string[] = [];
  for (const [key, value] of map) {
    const head = `${text(key)}:`;
    const simple = emptyOrScalar(value);
    if (simple !== null) lines.push(`${pad}${head} ${simple}`);
    else if (isFlowSequence(value)) lines.push(...flow(value, `${pad}${head} `, indent));
    else {
      if (top) lines.push("");
      lines.push(`${pad}${head}`);
      lines.push(...blockLines(value, indent + 2));
    }
  }
  return lines;
}

function seqLines(items: JsonValue[], indent: number): string[] {
  const pad = " ".repeat(indent);
  const lines: string[] = [];
  for (const item of items) {
    const simple = emptyOrScalar(item);
    if (simple !== null) lines.push(`${pad}- ${simple}`);
    else if (isFlowSequence(item)) lines.push(...flow(item, `${pad}- `, indent));
    else {
      const inner = blockLines(item, indent + 2);
      inner[0] = `${pad}- ${(inner[0] as string).slice(indent + 2)}`;
      lines.push(...inner);
    }
  }
  return lines;
}

function blockLines(value: JsonValue, indent: number): string[] {
  return Array.isArray(value) ? seqLines(value, indent) : mapLines(value as Map<string, JsonValue>, indent, false);
}

/** YAML text for a document, ending in a newline. */
export function writeYaml(value: JsonValue): string {
  const simple = emptyOrScalar(value);
  if (simple !== null) return `${simple}\n`;
  if (isFlowSequence(value)) return `${flow(value, "", 0).join("\n")}\n`;
  const lines = Array.isArray(value) ? seqLines(value, 0) : mapLines(value as Map<string, JsonValue>, 0, true);
  if (lines[0] === "") lines.shift();
  return `${lines.join("\n")}\n`;
}
