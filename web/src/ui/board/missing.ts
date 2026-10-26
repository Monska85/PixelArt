// SPDX-License-Identifier: GPL-3.0-or-later

// Which animations a stored playlist names that the board does not store, and where each could come from.

import type { Manifest, Published } from "../../release/manifest";

/** The animations of `named` that are not among the stored IDs, in order. */
export function missingAnimations(named: readonly string[], stored: ReadonlySet<string>): string[] {
  return named.filter((name) => !stored.has(name));
}

interface MissingSplit {
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
const MISSING_NAMES_SHOWN = 10;

/** The first MISSING_NAMES_SHOWN names and how many were left out. */
export function capNames(names: readonly string[]): { shown: string[]; more: number } {
  return { shown: names.slice(0, MISSING_NAMES_SHOWN), more: Math.max(0, names.length - MISSING_NAMES_SHOWN) };
}

/** Names joined for a sentence: at most MISSING_NAMES_SHOWN, then "and N more". */
export function nameList(names: readonly string[]): string {
  const { shown, more } = capNames(names);
  return more > 0 ? `${shown.join(", ")} and ${more} more` : shown.join(", ");
}
