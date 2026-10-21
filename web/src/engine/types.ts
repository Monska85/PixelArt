export const CANVAS_WIDTH = 16;
export const CANVAS_HEIGHT = 16;

// Limits of docs/format/pixelart-v1.md and docs/format/playlist-v1.md.
export const MAX_FILE_SIZE = 64 * 1024;
export const MAX_PALETTE = 256;
export const MAX_COLORS = 256;
export const MAX_SPRITES = 64;
export const MAX_POINTS = 4096;
export const MAX_DRAWN_POINTS = 4096;
export const MAX_DIAGNOSTICS = 32;
export const MAX_COMPOSITE_DEPTH = 4;
export const MAX_LOOP_DEPTH = 4;
export const MAX_TIMELINE_ITEMS = 1024;
export const MAX_SHOW = 32;
export const MAX_PARTS = 64;
export const MAX_COUNT = 10000;
export const MIN_MS = 20;
export const MAX_MS = 60000;
export const MIN_COORD = -128;
export const MAX_COORD = 127;
export const DEFAULT_FRAME_MS = 500;

export const MAX_PLAYLIST_FILE_SIZE = 16 * 1024;
export const MAX_PLAYLIST_ITEMS = 256;
export const MAX_PLAYLIST_REPEAT = 1000;

export type Severity = "error" | "warning";

export interface Diagnostic {
  severity: Severity;
  code: string;
  where: string;
  message: string;
}

/** Color as 0xRRGGBB. */
export type Rgb = number;

/** One rendered frame: 256 colors, row by row (index y * 16 + x), and its duration. */
export interface Frame {
  pixels: Uint32Array;
  ms: number;
}

export interface Pos {
  x: number;
  y: number;
}

export interface Point {
  x: number;
  y: number;
  color: number;
}

export interface Part {
  sprite: number;
  at: Pos | null;
}

export interface Sprite {
  name: string;
  at: Pos;
  pivot: Pos | null;
  points: Point[];
  parts: Part[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  drawnPoints: number;
}

export interface Ref {
  sprite: number;
  at: Pos | null;
  move: Pos;
  wrap: boolean;
  rotate: number;
  spin: number;
  flipX: boolean;
  flipY: boolean;
  pivot: Pos | null;
}

export interface FrameItem {
  kind: "frame";
  repeat: number;
  ms: number;
  refs: Ref[];
  recolor: { from: number; to: number }[];
}

export interface LoopItem {
  kind: "loop";
  count: number;
  children: Item[];
}

export type Item = FrameItem | LoopItem;

export interface Animation {
  name: string;
  version: number;
  /** Percentage of the board brightness, 1 to 100. */
  brightness: number;
  background: number | null;
  /** Distinct colors, indexed by Point.color. */
  colors: Rgb[];
  sprites: Sprite[];
  timeline: Item[];
}

export interface AnimationResult {
  /** The animation, or null when the file has errors. */
  animation: Animation | null;
  /** Errors and warnings, at most 32. */
  diagnostics: Diagnostic[];
}

export interface PlaylistItem {
  animation: string;
  repeat: number;
}

export interface PlaylistResult {
  /** The enabled items in order, or null when the file has errors. */
  items: PlaylistItem[] | null;
  diagnostics: Diagnostic[];
}

/** True if `id` is a valid animation or playlist ID (file name without extension). */
export function isValidId(id: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,31}$/.test(id);
}

/**
 * Brightness the LEDs receive for a board brightness (0 to 255) and an
 * animation's percentage (1 to 100): docs/format/pixelart-v1.md#brightness.
 */
export function effectiveBrightness(board: number, percent: number): number {
  if (board === 0) return 0;
  const value = Math.floor((board * percent + 50) / 100);
  return value === 0 ? 1 : value;
}
