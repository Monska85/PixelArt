// SPDX-License-Identifier: GPL-3.0-or-later

// Hydrates a declared published catalog only after the main manifest passes validation.
import { sha256Hex } from "../protocol";
import { isCount, isRecord } from "../protocol/guards";
import {
  parseEntries,
  readCapped,
  withFetchTimeout,
  type ContentKind,
  type Manifest,
  type Published,
  type PublishedKind,
} from "./manifest";

const PAGE_FORMAT = "pixelart-content-page/1";
const MAX_PAGE_BYTES = 8 * 1024;
const MAX_PAGE_ENTRIES = 32;
const MAX_PUBLISHED_FILES = 320;
const KINDS = ["animations", "playlists", "schedules", "play"] as const;

function parsePage(text: string, kind: ContentKind): Published[] | null {
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    return null;
  }
  if (
    !isRecord(document) ||
    document.format !== PAGE_FORMAT ||
    document.kind !== kind ||
    !Array.isArray(document.entries)
  )
    return null;
  if (Object.keys(document).some((key) => !["format", "kind", "entries"].includes(key))) return null;
  if (document.entries.length < 1 || document.entries.length > MAX_PAGE_ENTRIES) return null;
  const singular: PublishedKind =
    kind === "animations"
      ? "animation"
      : kind === "playlists"
        ? "playlist"
        : kind === "schedules"
          ? "schedule"
          : "play";
  for (const entry of document.entries) {
    if (!isRecord(entry)) return null;
    const allowed =
      kind === "animations"
        ? ["id", "name", "version", "file", "size", "sha256"]
        : kind === "play"
          ? ["id", "file", "size", "sha256"]
          : ["id", "name", "file", "size", "sha256"];
    if (Object.keys(entry).some((key) => !allowed.includes(key))) return null;
    if (
      kind === "animations" &&
      (typeof entry.name !== "string" ||
        entry.name.length === 0 ||
        [...entry.name].length > 128 ||
        !isCount(entry.version) ||
        entry.version < 1 ||
        entry.version > 2147483647)
    )
      return null;
    if (
      (kind === "playlists" || kind === "schedules") &&
      "name" in entry &&
      (typeof entry.name !== "string" || entry.name.length === 0 || [...entry.name].length > 128)
    )
      return null;
  }
  const parsed = parseEntries(document.entries, singular);
  return parsed.length === document.entries.length ? parsed : null;
}

/** Replaces each declared kind with verified page entries. A failure rejects the full catalog. */
export async function loadContentPages(manifest: Manifest, fetchFn: typeof fetch): Promise<Manifest | null> {
  let total = KINDS.reduce((sum, kind) => sum + (manifest.contentPages?.[kind] ? 0 : manifest[kind].length), 0);
  const pages = manifest.contentPages;
  if (!pages) return manifest;
  for (const kind of KINDS) {
    const refs = pages[kind];
    if (!refs) continue;
    const entries: Published[] = [];
    const seen = new Set<string>();
    for (const ref of refs) {
      const body = await withFetchTimeout(async (signal) => {
        const pageResponse = await fetchFn(`./${ref.file}`, { cache: "no-cache", redirect: "error", signal });
        return pageResponse.ok ? await readCapped(pageResponse, Math.min(ref.size, MAX_PAGE_BYTES)) : null;
      });
      if (body === null || body.length !== ref.size || (await sha256Hex(body)) !== ref.sha256) return null;
      const parsed = parsePage(new TextDecoder("utf-8", { fatal: true }).decode(body), kind);
      if (parsed === null) return null;
      for (const entry of parsed) {
        if (seen.has(entry.id)) return null;
        seen.add(entry.id);
        entries.push(entry);
      }
      if (total + entries.length > MAX_PUBLISHED_FILES) return null;
    }
    manifest[kind] = entries;
    total += entries.length;
  }
  return manifest;
}
