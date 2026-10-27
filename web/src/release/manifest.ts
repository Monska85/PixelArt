// SPDX-License-Identifier: GPL-3.0-or-later

// The release manifest (docs/format/manifest-v1.md) as the web app reads it.

import { FILE_LIMITS, isValidId } from "../engine";
import { isCount, isRecord } from "../protocol/guards";

const MANIFEST_FORMAT = "pixelart-manifest/1";

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
  /** The content release the animations and playlists come from; null for a manifest that has none (older releases). */
  contentVersion: string | null;
  /** Whether the manifest lists firmware files: a content release alone has none, and its `version` is not a firmware's. */
  hasFirmware: boolean;
  animations: Published[];
  playlists: Published[];
}

/** The version the animations and playlists were released with: the content version, else the manifest's own. */
export const contentVersionOf = (manifest: Manifest): string => manifest.contentVersion ?? manifest.version;

/** The most a board stores per file (docs/protocol/protocol-v1.md); a larger published file cannot be installed. */
export const MAX_FILE_BYTES: Record<PublishedKind, number> = FILE_LIMITS;

const FOLDER: Record<PublishedKind, string> = { animation: "animations", playlist: "playlists" };

/** Relative to the page, as the manifest's own paths are relative to the manifest. */
export const publishedPath = (kind: PublishedKind, id: string): string => `./${FOLDER[kind]}/${id}.json`;

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
      version: isCount(version) ? version : null,
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
  const { content_version: contentVersion, firmware } = document;
  return {
    version: document.version,
    contentVersion: typeof contentVersion === "string" && contentVersion.length <= 64 ? contentVersion : null,
    hasFirmware: Array.isArray(firmware) && firmware.length > 0,
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
  const parts: Uint8Array<ArrayBuffer>[] = [];
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
  return new Uint8Array(await new Blob(parts).arrayBuffer());
}
