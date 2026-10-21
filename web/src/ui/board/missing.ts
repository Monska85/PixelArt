// Which animations a stored playlist names that the board does not store, and where each could come from.

import type { Manifest, Published } from "../../release/manifest";

/** The animations of `named` that are not among the stored IDs, in order. */
export function missingAnimations(named: readonly string[], stored: ReadonlySet<string>): string[] {
  return named.filter((name) => !stored.has(name));
}

export interface MissingSplit {
  /** Published in the Library: the queue can send them. */
  installable: Published[];
  /** Published nowhere: the Library cannot bring them. */
  unavailable: string[];
}

/** Sorts missing animations by whether the published release has them. No release: none is installable. */
export function splitMissing(missing: readonly string[], library: Manifest | null): MissingSplit {
  const installable: Published[] = [];
  const unavailable: string[] = [];
  for (const name of missing) {
    const published = library?.animations.find((e) => e.id === name);
    if (published) installable.push(published);
    else unavailable.push(name);
  }
  return { installable, unavailable };
}

/**
 * The missing animations of each playlist whose content is known. `stored` null (the animation list is not known)
 * says nothing about any playlist: an unknown list never makes an animation missing.
 */
export function missingByPlaylist(
  contents: ReadonlyMap<string, readonly string[]>,
  stored: ReadonlySet<string> | null,
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  if (stored === null) return result;
  for (const [id, named] of contents) {
    const missing = missingAnimations(named, stored);
    if (missing.length > 0) result.set(id, missing);
  }
  return result;
}

/** How many missing names a tooltip or note spells out before it says "and N more". */
export const MISSING_NAMES_SHOWN = 10;

/** The first `limit` names and how many were left out. */
export function capNames(
  names: readonly string[],
  limit: number = MISSING_NAMES_SHOWN,
): { shown: string[]; more: number } {
  return { shown: names.slice(0, limit), more: Math.max(0, names.length - limit) };
}

/** Names joined for a sentence: at most `limit`, then "and N more". */
export function nameList(names: readonly string[], limit: number = MISSING_NAMES_SHOWN): string {
  const { shown, more } = capNames(names, limit);
  return more > 0 ? `${shown.join(", ")} and ${more} more` : shown.join(", ");
}
