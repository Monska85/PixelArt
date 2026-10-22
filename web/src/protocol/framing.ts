// Lines of the command protocol: "@PR <crc> <json>" (docs/protocol/protocol-v1.md#lines).

import { crc32, crc32Hex } from "./crc32";
import { isRecord } from "./guards";

export type Body = Record<string, unknown>;

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const MARKER = encoder.encode("@PR ");

/** JSON for a request: every character outside ASCII is a \uXXXX escape, so bytes equal characters. */
function requestJson(body: Body): string {
  return JSON.stringify(body).replace(/[\u0080-\uFFFF]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/** The protocol line for a request body, without the newline. */
export function encodeLine(body: Body): string {
  const payload = requestJson(body);
  return `@PR ${crc32Hex(encoder.encode(payload))} ${payload}`;
}

const isHexDigit = (b: number): boolean => (b >= 0x30 && b <= 0x39) || (b >= 0x61 && b <= 0x66);

/** The body of a protocol line, or null for a line to ignore: another kind of line, a damaged one. */
export function decodeLine(line: Uint8Array): Body | null {
  if (line.length < 14) return null;
  for (let i = 0; i < MARKER.length; i++) if (line[i] !== MARKER[i]) return null;
  if (line[12] !== 0x20) return null;
  let declared = 0;
  for (let i = 4; i < 12; i++) {
    const b = line[i] as number;
    if (!isHexDigit(b)) return null;
    declared = declared * 16 + (b <= 0x39 ? b - 0x30 : b - 0x57);
  }
  const payload = line.subarray(13);
  if (crc32(payload) !== declared) return null;
  let body: unknown;
  try {
    body = JSON.parse(decoder.decode(payload));
  } catch {
    return null;
  }
  return isRecord(body) ? body : null;
}
