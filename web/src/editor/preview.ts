// SPDX-License-Identifier: GPL-3.0-or-later

// Finding frames of an animation for the preview, without playing it.

import { Player, type Animation, type Frame } from "../engine";
import type { Path } from "./doc";

/** Frames searched at most when looking for the first frame of a timeline item. */
const SEARCH_LIMIT = 1_000_000;

const startsWith = (path: readonly number[], prefix: Path): boolean =>
  prefix.length <= path.length && prefix.every((v, i) => path[i] === v);

export interface FrameAt {
  frame: Frame;
  /** The timeline item that produced it. */
  path: readonly number[];
}

/**
 * Reads the frames of one animation through one Player that keeps its place: asking for the frame after the last
 * one asked for costs one step, so a long animation plays in linear time. Only a frame before the current one
 * (the wraparound, a new selection) starts again from the first frame.
 */
export class FrameCursor {
  private player: Player;
  /** The number (from 1) of the frame the player is at, 0 before the first. */
  private position = 0;

  constructor(animation: Animation) {
    this.player = new Player(animation);
  }

  private restart(): void {
    this.player.restart();
    this.position = 0;
  }

  /** The number (from 1) of the first frame produced by the item at `path` or, for a loop, inside it. */
  firstFrameOf(path: Path): number | null {
    this.restart();
    for (let n = 1; n <= SEARCH_LIMIT; n++) {
      if (this.player.skip(1) === 0) {
        this.restart();
        return null;
      }
      this.position = n;
      if (startsWith(this.player.path, path)) return n;
    }
    this.restart();
    return null;
  }

  /** Frame number `n` (from 1), or null when the animation has fewer frames. */
  frameAt(n: number): FrameAt | null {
    if (n < 1) return null;
    if (n < this.position) this.restart();
    const behind = n - this.position;
    if (behind > 0) {
      // The player moves to frame n - 1 here, and next() then renders frame n.
      const skipped = this.player.skip(behind - 1);
      const frame = skipped === behind - 1 ? this.player.next() : null;
      if (!frame) {
        this.restart();
        return null;
      }
      this.position = n;
      return { frame, path: [...this.player.path] };
    }
    const frame = this.player.current();
    return frame ? { frame, path: [...this.player.path] } : null;
  }
}

/** The number (from 1) of the first frame produced by the item at `path` or, for a loop, inside it. */
export const firstFrameOf = (animation: Animation, path: Path): number | null =>
  new FrameCursor(animation).firstFrameOf(path);

/** Frame number `n` (from 1), or null when the animation has fewer frames. */
export const frameAt = (animation: Animation, n: number): FrameAt | null => new FrameCursor(animation).frameAt(n);
