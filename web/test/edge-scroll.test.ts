import { describe, expect, it } from "vitest";
import { EDGE_SCROLL, edgeSpeed, edgeZone, scrollDistance } from "../src/ui/board/edgeScroll";

describe("the edge zone", () => {
  it("is 48 px, or 15 % of a short area", () => {
    expect(edgeZone(600)).toBe(48);
    expect(edgeZone(200)).toBe(30);
  });
});

describe("the edge scroll speed", () => {
  // An area from 100 to 700: zones of 48 px, from 100 to 148 at the top and from 652 to 700 at the bottom.
  const speed = (y: number) => edgeSpeed(y, 100, 700);

  it("is 0 outside the zones", () => {
    expect(speed(400)).toBe(0);
    expect(speed(149)).toBe(0);
    expect(speed(651)).toBe(0);
  });

  it("starts slow at the zone's outer limit and reaches its top speed at the edge", () => {
    expect(speed(652)).toBe(EDGE_SCROLL.slowest);
    expect(speed(700)).toBe(EDGE_SCROLL.fastest);
    expect(EDGE_SCROLL.slowest).toBeGreaterThanOrEqual(2);
    expect(EDGE_SCROLL.slowest).toBeLessThanOrEqual(4);
    expect(EDGE_SCROLL.fastest).toBeGreaterThanOrEqual(12);
    expect(EDGE_SCROLL.fastest).toBeLessThanOrEqual(16);
  });

  it("grows in proportion to how deep the pointer is", () => {
    const halfway = speed(676);
    expect(halfway).toBeCloseTo((EDGE_SCROLL.slowest + EDGE_SCROLL.fastest) / 2);
    const depths = [652, 660, 670, 680, 690, 700].map(speed);
    for (let i = 1; i < depths.length; i++) expect(depths[i]!).toBeGreaterThan(depths[i - 1]!);
  });

  it("scrolls up near the top, at full speed past the edge", () => {
    expect(speed(148)).toBe(-EDGE_SCROLL.slowest);
    expect(speed(100)).toBe(-EDGE_SCROLL.fastest);
    expect(speed(40)).toBe(-EDGE_SCROLL.fastest);
    expect(speed(760)).toBe(EDGE_SCROLL.fastest);
  });

  it("uses the smaller zone of a short area", () => {
    // 200 px tall: zones of 30 px.
    expect(edgeSpeed(269, 100, 300)).toBe(0);
    expect(edgeSpeed(270, 100, 300)).toBe(EDGE_SCROLL.slowest);
  });
});

describe("the edge scroll distance", () => {
  /** Scrolls for one second at `speed`, at `hz` frames per second, and returns the pixels scrolled. */
  function oneSecond(speed: number, hz: number): number {
    let carried = 0;
    let total = 0;
    for (let frame = 0; frame < hz; frame++) {
      const step = scrollDistance(speed, 1000 / hz, carried);
      carried = step.carried;
      total += step.pixels;
    }
    return total;
  }

  it("is the same per second at 60 Hz and at 120 Hz", () => {
    for (const speed of [EDGE_SCROLL.slowest, 7.5, EDGE_SCROLL.fastest, -EDGE_SCROLL.fastest]) {
      const at60 = oneSecond(speed, 60);
      expect(at60).toBe(Math.trunc(speed * 60));
      expect(Math.abs(oneSecond(speed, 120) - at60)).toBeLessThanOrEqual(1);
      expect(Math.abs(oneSecond(speed, 144) - at60)).toBeLessThanOrEqual(1);
    }
  });

  it("carries fractions, so a slow speed at a high rate still moves", () => {
    // 3 px per 60 Hz frame is 1.5 px per 120 Hz frame: 1, then 2, then 1...
    const first = scrollDistance(3, 1000 / 120, 0);
    const second = scrollDistance(3, 1000 / 120, first.carried);
    expect(first.pixels + second.pixels).toBe(3);
  });

  it("caps a long frame, so the list never jumps after a pause", () => {
    expect(scrollDistance(EDGE_SCROLL.fastest, 5000, 0).pixels).toBe(
      Math.trunc((EDGE_SCROLL.fastest * EDGE_SCROLL.longestFrameMs) / EDGE_SCROLL.frameMs),
    );
  });
});
