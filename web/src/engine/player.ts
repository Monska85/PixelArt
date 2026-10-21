// Port of lib/PixelEngine/src/player.cpp: walks the timeline and renders
// frames, applying the effects in the order of docs/format/pixelart-v1.md#effects.

import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  type Animation,
  type Frame,
  type FrameItem,
  type Item,
  type Ref,
  type Sprite,
} from "./types";

const floorMod = (a: number, b: number): number => ((a % b) + b) % b;

interface Level {
  items: Item[];
  pos: number;
  done: number;
  total: number;
}

// Where one sprite reference puts each pixel in repetition k: flip, rotation
// around the pivot, position and motion, then wrap or clip.
class Transform {
  private readonly quarterTurns: number;
  private readonly pivotX: number;
  private readonly pivotY: number;
  private readonly offsetX: number;
  private readonly offsetY: number;

  constructor(
    private readonly sprite: Sprite,
    private readonly ref: Ref,
    k: number,
  ) {
    this.quarterTurns = floorMod(ref.rotate + k * ref.spin, 360) / 90;
    const pivot = ref.pivot ?? sprite.pivot;
    if (pivot) {
      this.pivotX = pivot.x;
      this.pivotY = pivot.y;
    } else {
      // Center of the bounding box, rounded toward the top-left.
      this.pivotX = Math.floor((sprite.minX + sprite.maxX) / 2);
      this.pivotY = Math.floor((sprite.minY + sprite.maxY) / 2);
    }
    const base = ref.at ?? sprite.at;
    this.offsetX = base.x + k * ref.move.x;
    this.offsetY = base.y + k * ref.move.y;
  }

  /** Moves a sprite coordinate to the canvas, or returns null when it falls outside and wrap is off. */
  apply(px: number, py: number): number | null {
    let x = px;
    let y = py;
    if (this.ref.flipX) x = this.sprite.minX + this.sprite.maxX - x;
    if (this.ref.flipY) y = this.sprite.minY + this.sprite.maxY - y;
    for (let q = 0; q < this.quarterTurns; q++) {
      const turnedX = this.pivotX - (y - this.pivotY);
      const turnedY = this.pivotY + (x - this.pivotX);
      x = turnedX;
      y = turnedY;
    }
    x += this.offsetX;
    y += this.offsetY;
    if (this.ref.wrap) {
      x = floorMod(x, CANVAS_WIDTH);
      y = floorMod(y, CANVAS_HEIGHT);
    } else if (x < 0 || y < 0 || x >= CANVAS_WIDTH || y >= CANVAS_HEIGHT) {
      return null;
    }
    return y * CANVAS_WIDTH + x;
  }
}

/** Plays an animation frame by frame. */
export class Player {
  private stack: Level[] = [];
  private frame: FrameItem | null = null;
  private repetition = 0;
  private framePath: number[] = [];

  constructor(private readonly animation: Animation) {
    this.restart();
  }

  /** Starts again from the first frame. */
  restart(): void {
    this.stack = [{ items: this.animation.timeline, pos: 0, done: 0, total: 1 }];
    this.frame = null;
    this.repetition = 0;
    this.framePath = [];
  }

  /**
   * The timeline item that produced the frame returned last, as indices: the
   * position in the timeline, then the position in the steps of that loop, and
   * so on. Empty before the first frame.
   */
  get path(): readonly number[] {
    return this.framePath;
  }

  /** Renders the next frame, or returns null when the timeline is over. */
  next(): Frame | null {
    const k = this.advance();
    return k === null ? null : this.render(this.frame as FrameItem, k);
  }

  /** Moves past `count` frames without rendering them; returns how many existed. */
  skip(count: number): number {
    let skipped = 0;
    while (skipped < count && this.advance() !== null) skipped++;
    return skipped;
  }

  // Moves to the next repetition of the next frame and returns its number k, or null at the end.
  private advance(): number | null {
    for (;;) {
      if (this.frame && this.repetition < this.frame.repeat) {
        return this.repetition++;
      }
      this.frame = null;
      const level = this.stack[this.stack.length - 1];
      if (!level) return null;
      const item = level.items[level.pos];
      if (item) {
        level.pos++;
        if (item.kind === "loop") this.stack.push({ items: item.children, pos: 0, done: 0, total: item.count });
        else {
          this.frame = item;
          this.repetition = 0;
          this.framePath = this.stack.map((l) => l.pos - 1);
        }
        continue;
      }
      if (++level.done < level.total) {
        level.pos = 0;
        continue;
      }
      this.stack.pop();
    }
  }

  private render(item: FrameItem, k: number): Frame {
    const a = this.animation;
    const pixels = new Uint32Array(CANVAS_WIDTH * CANVAS_HEIGHT).fill(a.background ?? 0);

    // Every substitution reads the original color, so colors can swap.
    const recolor = Array.from({ length: 256 }, (_, i) => i);
    for (const r of item.recolor) recolor[r.from] = r.to;

    for (const ref of item.refs) {
      const transform = new Transform(a.sprites[ref.sprite] as Sprite, ref, k);
      this.walk(a.sprites[ref.sprite] as Sprite, 0, 0, (x, y, color) => {
        const index = transform.apply(x, y);
        if (index !== null) pixels[index] = a.colors[recolor[color] as number] as number;
      });
    }
    return { pixels, ms: item.ms };
  }

  // Calls plot for every point of a sprite in its own coordinates; parts of a
  // composite are shifted by their position in it.
  private walk(sprite: Sprite, dx: number, dy: number, plot: (x: number, y: number, color: number) => void): void {
    for (const p of sprite.points) plot(p.x + dx, p.y + dy, p.color);
    for (const part of sprite.parts) {
      const at = part.at ?? (this.animation.sprites[part.sprite] as Sprite).at;
      this.walk(this.animation.sprites[part.sprite] as Sprite, dx + at.x, dy + at.y, plot);
    }
  }
}
