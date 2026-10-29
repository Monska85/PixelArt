// SPDX-License-Identifier: GPL-3.0-or-later

// The release manifest (docs/format/manifest-v1.md) as the web app reads it.

import { FILE_LIMITS, isValidId } from "../engine";
import { isCount, isRecord } from "../protocol/guards";

const MANIFEST_FORMAT = "pixelart-manifest/1";
const MAX_PAGE_BYTES = 8 * 1024;
const MAX_PAGES = 20;
const KINDS = ["animations", "playlists", "schedules", "play"] as const;
export type ContentKind = (typeof KINDS)[number];
interface PageReference {
  file: string;
  size: number;
  sha256: string;
}
type ContentPages = Partial<Record<ContentKind, PageReference[]>>;

export type PublishedKind = "animation" | "playlist" | "schedule" | "play";

/** An animation, playlist, schedule or play file of the release. Its address is derived from its ID, never taken from the manifest. */
export interface Published {
  id: string;
  name: string | null;
  version: number | null;
  size: number;
  sha256: string;
}

export interface Manifest {
  version: string;
  /** The content release the animations, playlists and schedules come from; null for a manifest that has none (older releases). */
  contentVersion: string | null;
  /** Whether the manifest lists firmware files: a content release alone has none, and its `version` is not a firmware's. */
  hasFirmware: boolean;
  animations: Published[];
  playlists: Published[];
  /** Empty for a manifest without `schedules` (older releases). */
  schedules: Published[];
  /** The play file, the release's server choice: empty for a manifest without `play` (older releases). */
  play: Published[];
  /** Present kinds replace their legacy lists, including when the page list is empty. */
  contentPages?: ContentPages;
}

/** The version the animations, playlists and schedules were released with: the content version, else the manifest's own. */
export const contentVersionOf = (manifest: Manifest): string => manifest.contentVersion ?? manifest.version;

/** The most a board stores per file (docs/protocol/protocol-v1.md); a larger published file cannot be installed. */
export const MAX_FILE_BYTES: Record<PublishedKind, number> = FILE_LIMITS;

const FOLDER: Record<PublishedKind, string> = {
  animation: "animations",
  playlist: "playlists",
  schedule: "schedules",
  play: "play",
};

/** Relative to the page, as the manifest's own paths are relative to the manifest. */
export const publishedPath = (kind: PublishedKind, id: string): string => `./${FOLDER[kind]}/${id}.json`;

export function parseEntries(value: unknown, kind: PublishedKind): Published[] {
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
  let contentPages: ContentPages | undefined;
  if ("content_pages" in document) {
    if (!isRecord(document.content_pages)) return null;
    contentPages = {};
    const seenPaths = new Set<string>();
    let count = 0;
    for (const [kind, raw] of Object.entries(document.content_pages)) {
      if (!KINDS.includes(kind as ContentKind) || !Array.isArray(raw)) return null;
      const refs: PageReference[] = [];
      for (const item of raw) {
        if (!isRecord(item)) return null;
        const { file, size, sha256 } = item;
        if (
          typeof file !== "string" ||
          !safePagePath(file) ||
          seenPaths.has(file) ||
          typeof size !== "number" ||
          !Number.isInteger(size) ||
          size < 1 ||
          size > MAX_PAGE_BYTES ||
          typeof sha256 !== "string" ||
          !/^[0-9a-f]{64}$/.test(sha256)
        )
          return null;
        seenPaths.add(file);
        refs.push({ file, size, sha256 });
        if (++count > MAX_PAGES) return null;
      }
      contentPages[kind as ContentKind] = refs;
    }
  }
  return {
    version: document.version,
    contentVersion: typeof contentVersion === "string" && contentVersion.length <= 64 ? contentVersion : null,
    hasFirmware: Array.isArray(firmware) && firmware.length > 0,
    animations: parseEntries(document.animations, "animation"),
    playlists: parseEntries(document.playlists, "playlist"),
    schedules: parseEntries(document.schedules, "schedule"),
    play: parseEntries(document.play, "play"),
    ...(contentPages ? { contentPages } : {}),
  };
}

function safePagePath(path: string): boolean {
  return (
    path.length > 0 &&
    path.length <= 160 &&
    path.split("/").every((part) => part !== "" && part !== "." && part !== ".." && /^[A-Za-z0-9._+-]+$/.test(part))
  );
}

const MAX_MANIFEST_BYTES = 1024 * 1024;

/** Reads `./manifest.json`, asking the server whether the copy is current. Any failure means nothing is published. */
export async function loadManifest(fetchFn: typeof fetch = fetch): Promise<Manifest | null> {
  try {
    const response = await fetchFn("./manifest.json", { cache: "no-cache", redirect: "error" });
    if (!response.ok) return null;
    const bytes = await readCapped(response, MAX_MANIFEST_BYTES);
    const manifest = bytes === null ? null : parseManifest(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!manifest) return null;
    if (!manifest.contentPages) return manifest;
    const { loadContentPages } = await import("./contentPages");
    return await loadContentPages(manifest, fetchFn);
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
