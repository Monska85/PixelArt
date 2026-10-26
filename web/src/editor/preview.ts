// SPDX-License-Identifier: GPL-3.0-or-later

// Finding frames of an animation for the preview, without playing it.

import { Player, type Animation, type Frame, type Item } from "../engine";
import { frameCount, itemFrames } from "../engine/player";
import type { Path } from "./doc";

export interface FrameAt {
  frame: Frame;
  /** The timeline item that produced it. */
  path: readonly number[];
}

/**
 * Reads the frames of one animation through one Player that keeps its place. Frame numbers are bigints: nested loops
 * reach 10^20 frames, past what a number holds exactly. Asking for the frame after the last one asked for costs one
 * step, so a long animation plays in linear time. Any other frame (the wraparound, a new selection, a jump) is
 * reached by Player.seek from the frame counts of the timeline, without walking the frames in between.
 */
export class FrameCursor {
  private player: Player;
  /** The number (from 1) of the frame the player is at, 0 before the first. */
  private position = 0n;

  constructor(private readonly animation: Animation) {
    this.player = new Player(animation);
  }

  private restart(): void {
    this.player.restart();
    this.position = 0n;
  }

  /**
   * The number (from 1) of the first frame produced by the item at `path` or, for a loop, inside it. It is worked
   * out from the frame counts of what comes before the item, with every enclosing loop in its first pass.
   */
  firstFrameOf(path: Path): bigint | null {
    if (path.length === 0) return frameCount(this.animation.timeline) > 0n ? 1n : null;
    let items: readonly Item[] = this.animation.timeline;
    let before = 0n;
    for (const [depth, index] of path.entries()) {
      const item = items[index];
      if (!item) return null;
      before += frameCount(items.slice(0, index));
      if (depth === path.length - 1) return itemFrames(item) > 0n ? before + 1n : null;
      if (item.kind !== "loop") return null;
      items = item.children;
    }
    return null;
  }

  /** Frame number `n` (from 1), or null when the animation has fewer frames. */
  frameAt(n: bigint): FrameAt | null {
    if (n < 1n) return null;
    if (n < this.position) this.restart();
    if (n > this.position) {
      // One step for the next frame; a jump moves to frame n - 1 from the frame counts, and next() renders n.
      if (n > this.position + 1n && !this.player.seek(n - 1n)) {
        this.restart();
        return null;
      }
      const frame = this.player.next();
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
export const firstFrameOf = (animation: Animation, path: Path): bigint | null =>
  new FrameCursor(animation).firstFrameOf(path);

/** Frame number `n` (from 1), or null when the animation has fewer frames. */
export const frameAt = (animation: Animation, n: bigint): FrameAt | null => new FrameCursor(animation).frameAt(n);
