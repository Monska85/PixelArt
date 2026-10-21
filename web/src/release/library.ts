// The animation library: what is published, and how it compares with what a board stores.

import { sha256Hex, type Entry } from "../protocol";
import { MAX_FILE_BYTES, publishedPath, readCapped, type Published, type PublishedKind } from "./manifest";

/**
 * - `unknown`: no board is connected.
 * - `missing`: the board has no file with that ID.
 * - `same`: the stored file has the published SHA-256.
 * - `different`: the stored file has another SHA-256.
 */
export type LibraryState = "unknown" | "missing" | "same" | "different";

export function libraryState(published: Published, stored: Entry[] | null): LibraryState {
  if (stored === null) return "unknown";
  const entry = stored.find((e) => e.id === published.id);
  if (!entry) return "missing";
  return entry.sha256 !== null && entry.sha256.toLowerCase() === published.sha256 ? "same" : "different";
}

/** The published file, checked against the size and SHA-256 of the manifest. Throws a readable error otherwise. */
export async function downloadPublished(
  kind: PublishedKind,
  entry: Published,
  fetchFn: typeof fetch = fetch,
): Promise<Uint8Array> {
  const label = `${kind} ${entry.id}`;
  let bytes: Uint8Array | null;
  try {
    const response = await fetchFn(publishedPath(kind, entry.id), { cache: "no-cache" });
    if (!response.ok) throw new Error(`the server answered ${response.status}`);
    bytes = await readCapped(response, Math.min(entry.size, MAX_FILE_BYTES[kind]));
  } catch (error) {
    throw new Error(`Cannot download ${label}: ${error instanceof Error ? error.message : "the request failed"}.`, {
      cause: error,
    });
  }
  if (bytes === null || bytes.length !== entry.size)
    throw new Error(`The downloaded ${label} does not have the size ${entry.size} that the manifest lists.`);
  if ((await sha256Hex(bytes)) !== entry.sha256)
    throw new Error(`The downloaded ${label} does not match the SHA-256 of the manifest.`);
  return bytes;
}
