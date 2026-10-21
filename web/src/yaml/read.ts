// Reads YAML the way tools/pixelart.py does (PyYAML SafeLoader with a strict
// mapping constructor), so a file gives the same JSON in the app and on the
// command line.

import { isAlias, isMap, isNode, isPair, isScalar, isSeq, parseDocument, type Document, type Node } from "yaml";
import { JsonNumber, type JsonObject, type JsonValue } from "../engine/json";
import { resolvePlain } from "./pyyaml";

export const MAX_YAML_BYTES = 256 * 1024;
/** Most nodes that aliases may produce in one document, all expansions together. */
export const MAX_ALIAS_NODES = 100_000;

export type YamlResult = { ok: true; value: JsonValue } | { ok: false; message: string; line?: number };

class YamlFailure extends Error {
  constructor(
    message: string,
    readonly line?: number,
  ) {
    super(message);
  }
}

const STANDARD_TAGS = new Set(
  ["str", "int", "float", "bool", "null", "map", "seq"].map((name) => `tag:yaml.org,2002:${name}`),
);

class Converter {
  private aliasDepth = 0;
  private aliasNodes = 0;
  private readonly inProgress = new Set<Node>();
  // resolve() walks the whole document; an alias inside an expanded anchor is met many times.
  private readonly resolved = new Map<Node, Node | undefined>();

  constructor(
    private readonly doc: Document.Parsed,
    private readonly text: string,
  ) {}

  private line(node: Node): number | undefined {
    const offset = node.range?.[0];
    if (offset === undefined) return undefined;
    let line = 1;
    for (let i = 0; i < offset; i++) if (this.text.charCodeAt(i) === 10) line++;
    return line;
  }

  private fail(message: string, node: Node): never {
    throw new YamlFailure(message, this.line(node));
  }

  convert(node: unknown): JsonValue {
    if (!isNode(node)) throw new YamlFailure("the document is empty");
    if (isAlias(node)) {
      if (!this.resolved.has(node)) this.resolved.set(node, node.resolve(this.doc));
      const target = this.resolved.get(node);
      if (!target) this.fail(`unknown anchor "${node.source}"`, node);
      if (this.inProgress.has(target)) this.fail("an alias contains itself", node);
      this.aliasDepth++;
      try {
        return this.convert(target);
      } finally {
        this.aliasDepth--;
      }
    }
    if (this.aliasDepth > 0 && ++this.aliasNodes > MAX_ALIAS_NODES) this.fail("aliases expand to too many nodes", node);
    if (node.tag !== undefined && !STANDARD_TAGS.has(node.tag)) this.fail(`tag ${node.tag} is not supported`, node);
    this.inProgress.add(node);
    try {
      if (isScalar(node)) return this.scalar(node.value, node);
      if (isSeq(node)) return node.items.map((item) => this.convert(item));
      if (isMap(node)) return this.map(node);
    } finally {
      this.inProgress.delete(node);
    }
    return this.fail("unsupported YAML node", node);
  }

  private scalar(value: unknown, node: Node & { type?: string; source?: string }): JsonValue {
    if (node.type === "PLAIN" && node.tag === undefined) {
      const resolved = resolvePlain(typeof value === "string" ? value : (node.source ?? ""));
      switch (resolved.kind) {
        case "null":
          return null;
        case "bool":
          return resolved.value;
        case "int":
          return new JsonNumber(Number(resolved.value), true, resolved.value.toString());
        case "float":
          return JsonNumber.float(resolved.value);
        case "string":
          return typeof value === "string" ? value : (node.source ?? "");
        case "unsupported":
          return this.fail(`${resolved.what} has no JSON form`, node);
      }
    }
    if (value === null || typeof value === "boolean" || typeof value === "string") return value;
    // An explicit standard tag: the YAML 1.1 schema reads integers as bigint and other numbers as floats.
    if (typeof value === "bigint") return new JsonNumber(Number(value), true, value.toString());
    if (typeof value === "number") return JsonNumber.float(value);
    return this.fail("this value has no JSON form (binary data is not supported)", node);
  }

  private map(node: Node & { items: unknown[] }): JsonObject {
    const object: JsonObject = new Map();
    for (const pair of node.items) {
      if (!isPair(pair)) this.fail("unsupported YAML node", node);
      let key: unknown = pair.key;
      if (isAlias(key)) key = key.resolve(this.doc);
      const keyNode = isNode(key) ? key : node;
      const name = isScalar(key) ? this.scalar(key.value, key) : undefined;
      if (typeof name !== "string")
        this.fail("a key is not text (YAML reads words like on, off, yes, no as true/false: quote them)", keyNode);
      if (object.has(name)) this.fail(`duplicate key '${name}'`, keyNode);
      object.set(name, this.convert(pair.value));
    }
    return object;
  }
}

/** Reads one YAML document with YAML 1.1 rules into JSON values. */
export function readYaml(text: string): YamlResult {
  if (new TextEncoder().encode(text).length > MAX_YAML_BYTES) {
    return { ok: false, message: `the YAML text is larger than ${MAX_YAML_BYTES / 1024} KiB` };
  }
  try {
    const doc = parseDocument(text, {
      version: "1.1",
      schema: "yaml-1.1",
      intAsBigInt: true,
      merge: false,
      uniqueKeys: false,
    });
    const problem = doc.errors[0] ?? doc.warnings[0];
    if (problem)
      return { ok: false, message: problem.message.split("\n")[0] ?? "invalid YAML", line: problem.linePos?.[0].line };
    return { ok: true, value: new Converter(doc, text).convert(doc.contents) };
  } catch (error) {
    if (error instanceof YamlFailure) return { ok: false, message: error.message, line: error.line };
    return { ok: false, message: error instanceof Error ? error.message : "invalid YAML" };
  }
}
