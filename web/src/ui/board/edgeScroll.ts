// SPDX-License-Identifier: GPL-3.0-or-later

// How fast a list scrolls while a dragged item rests near its top or bottom edge. Pure functions, so the curve and
// its independence from the frame rate can be tested without a browser.

export const EDGE_SCROLL = {
  /** The edge zone is at most this tall, in pixels... */
  zone: 48,
  /** ...and at most this share of the scrolling area's height, whichever is smaller. */
  zoneShare: 0.15,
  /** Pixels per 60 Hz frame at the zone's outer limit... */
  slowest: 3,
  /** ...rising in a straight line to this at the very edge. */
  fastest: 14,
  /** The frame the speeds above are given for: 60 Hz. */
  frameMs: 1000 / 60,
  /** A drag that starts inside a zone waits this long before scrolling, so picking up an item there does not scroll. */
  startDelayMs: 300,
  /** A frame longer than this (a hidden tab, a busy page) counts as this long, so the list never jumps. */
  longestFrameMs: 100,
} as const;

/** The height of the edge zones of an area `height` pixels tall. */
export const edgeZone = (height: number): number => Math.min(EDGE_SCROLL.zone, EDGE_SCROLL.zoneShare * height);

/**
 * The scroll speed for a pointer at `y` in an area from `top` to `bottom`, in pixels per 60 Hz frame: negative near
 * the top edge, positive near the bottom, 0 outside the zones. A pointer past the edge scrolls at full speed.
 */
export function edgeSpeed(y: number, top: number, bottom: number): number {
  const zone = edgeZone(bottom - top);
  if (zone <= 0) return 0;
  const intoTop = top + zone - y;
  const intoBottom = y - (bottom - zone);
  const into = Math.max(intoTop, intoBottom);
  if (into < 0) return 0;
  const depth = Math.min(into / zone, 1);
  const speed = EDGE_SCROLL.slowest + (EDGE_SCROLL.fastest - EDGE_SCROLL.slowest) * depth;
  return intoTop >= intoBottom ? -speed : speed;
}

/**
 * Turns a speed and the time since the last frame into whole pixels to scroll now, carrying the fraction to the next
 * frame, so the distance per second is the same at 60 Hz, 120 Hz or any other rate.
 */
export function scrollDistance(speed: number, elapsedMs: number, carried: number): { pixels: number; carried: number } {
  const exact = carried + (speed * Math.min(elapsedMs, EDGE_SCROLL.longestFrameMs)) / EDGE_SCROLL.frameMs;
  const pixels = Math.trunc(exact);
  return { pixels, carried: exact - pixels };
}
