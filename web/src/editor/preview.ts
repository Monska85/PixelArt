// Finding frames of an animation for the preview, without playing it.

import { Player, type Animation, type Frame } from "../engine";
import type { Path } from "./doc";

/** Frames searched at most when looking for the first frame of a timeline item. */
export const SEARCH_LIMIT = 1_000_000;

const startsWith = (path: readonly number[], prefix: Path): boolean =>
  prefix.length <= path.length && prefix.every((v, i) => path[i] === v);

/** The number (from 1) of the first frame produced by the item at `path` or, for a loop, inside it. */
export function firstFrameOf(animation: Animation, path: Path): number | null {
  const player = new Player(animation);
  for (let n = 1; n <= SEARCH_LIMIT; n++) {
    if (player.skip(1) === 0) return null;
    if (startsWith(player.path, path)) return n;
  }
  return null;
}

export interface FrameAt {
  frame: Frame;
  /** The timeline item that produced it. */
  path: readonly number[];
}

/** Frame number `n` (from 1), or null when the animation has fewer frames. */
export function frameAt(animation: Animation, n: number): FrameAt | null {
  const player = new Player(animation);
  if (player.skip(n - 1) < n - 1) return null;
  const frame = player.next();
  return frame ? { frame, path: [...player.path] } : null;
}
