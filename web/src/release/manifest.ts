// The release manifest (docs/format/manifest-v1.md) as the web app reads it.

import { isValidId } from "../engine";

export const MANIFEST_FORMAT = "pixelart-manifest/1";

export type PublishedKind = "animation" | "playlist";

/** An animation or playlist of the release. Its address is derived from its ID, never taken from the manifest. */
export interface Published {
  id: string;
  name: string | null;
  version: number | null;
  size: number;
  sha256: string;
}

export interface Manifest {
  version: string;
  animations: Published[];
  playlists: Published[];
}

/** The most a board stores per file (docs/protocol/protocol-v1.md); a larger published file cannot be installed. */
export const MAX_FILE_BYTES: Record<PublishedKind, number> = { animation: 64 * 1024, playlist: 16 * 1024 };

const FOLDER: Record<PublishedKind, string> = { animation: "animations", playlist: "playlists" };

/** Relative to the page, as the manifest's own paths are relative to the manifest. */
export const publishedPath = (kind: PublishedKind, id: string): string => `./${FOLDER[kind]}/${id}.json`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function parseEntries(value: unknown, kind: PublishedKind): Published[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: Published[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const { id, name, version, file, size, sha256 } = raw;
    if (typeof id !== "string" || !isValidId(id) || seen.has(id)) continue;
    // The file must be where the layout puts it: nothing else is ever fetched.
    if (file !== `${FOLDER[kind]}/${id}.json`) continue;
    if (typeof size !== "number" || !Number.isInteger(size) || size < 1 || size > MAX_FILE_BYTES[kind]) continue;
    if (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256)) continue;
    seen.add(id);
    out.push({
      id,
      name: typeof name === "string" && name !== "" ? name : null,
      version: typeof version === "number" && Number.isInteger(version) && version >= 0 ? version : null,
      size,
      sha256,
    });
  }
  return out;
}

/** The manifest in `text`, or null when it is not valid JSON or not a `pixelart-manifest/1`: nothing is published. */
export function parseManifest(text: string): Manifest | null {
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(document) || document.format !== MANIFEST_FORMAT) return null;
  if (typeof document.version !== "string" || document.version.length > 64) return null;
  return {
    version: document.version,
    animations: parseEntries(document.animations, "animation"),
    playlists: parseEntries(document.playlists, "playlist"),
  };
}

const MAX_MANIFEST_BYTES = 1024 * 1024;

/** Reads `./manifest.json`, asking the server whether the copy is current. Any failure means nothing is published. */
export async function loadManifest(fetchFn: typeof fetch = fetch): Promise<Manifest | null> {
  try {
    const response = await fetchFn("./manifest.json", { cache: "no-cache" });
    if (!response.ok) return null;
    const bytes = await readCapped(response, MAX_MANIFEST_BYTES);
    return bytes === null ? null : parseManifest(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

/** The body of a response, or null when it is longer than `limit`. */
export async function readCapped(response: Response, limit: number): Promise<Uint8Array | null> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!response.body) {
    const all = new Uint8Array(await response.arrayBuffer());
    return all.length > limit ? null : all;
  }
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
