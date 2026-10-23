// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { summarizeStorage } from "../src/ui/board/storage";

const TOTAL = 983_040; // 240 blocks of 4,096 bytes, the board's file system

describe("the storage summary", () => {
  it("counts the free space, the files and the animations that would still fit", () => {
    // Two animations take 1 block and 2 blocks (4,096 and 8,192 bytes), on average 6,144 bytes. 15 blocks are used.
    const s = summarizeStorage({ total: TOTAL, used: 61_440 }, [{ size: 1 }, { size: 4_097 }], [{}]);
    expect(s).toMatchObject({ total: TOTAL, used: 61_440, free: 921_600, percent: 6, animations: 2, playlists: 1 });
    expect(s.averageAnimation).toBe(6_144);
    expect(s.estimate).toBe(150); // 921,600 / 6,144
    expect(s.full).toBe(false);
    expect(s.low).toBe(false);
  });

  it("rounds the estimate down and the sizes up to whole blocks", () => {
    // 10,000 bytes take 3 blocks (12,288). 100,000 bytes free: 8 animations fit (98,304) and 8.13 rounds down.
    const s = summarizeStorage({ total: 200_000, used: 100_000 }, [{ size: 10_000 }], []);
    expect(s.averageAnimation).toBe(12_288);
    expect(s.estimate).toBe(8);
  });

  it("has no estimate without a stored animation", () => {
    const s = summarizeStorage({ total: TOTAL, used: 4_096 }, [], [{}, {}]);
    expect(s).toMatchObject({
      animations: 0,
      playlists: 2,
      averageAnimation: null,
      estimate: null,
      full: false,
      low: false,
    });
  });

  it("warns when less than one average animation is left", () => {
    // The average is 8,192 and 8,191 bytes are free.
    const low = summarizeStorage({ total: 16_384 + 8_191, used: 16_384 }, [{ size: 8_000 }, { size: 8_000 }], []);
    expect(low.free).toBe(8_191);
    expect(low.low).toBe(true);
    expect(low.full).toBe(false);
    expect(low.estimate).toBe(0);
    // Exactly one fits.
    const one = summarizeStorage({ total: 16_384 + 8_192, used: 16_384 }, [{ size: 8_000 }, { size: 8_000 }], []);
    expect(one.low).toBe(false);
    expect(one.estimate).toBe(1);
  });

  it("is full when not even one block is free, with or without stored animations", () => {
    const withFiles = summarizeStorage({ total: 8_192, used: 8_192 }, [{ size: 100 }], []);
    expect(withFiles).toMatchObject({ free: 0, percent: 100, full: true, low: true, estimate: 0 });
    const empty = summarizeStorage({ total: 4_095, used: 0 }, [], []);
    expect(empty).toMatchObject({ full: true, low: true, estimate: null });
    // Without an animation, one block is what a file needs.
    expect(summarizeStorage({ total: 4_096, used: 0 }, [], []).low).toBe(false);
  });

  it("keeps odd numbers from the board inside the total", () => {
    expect(summarizeStorage({ total: 1_000, used: 5_000 }, [], [])).toMatchObject({
      used: 1_000,
      free: 0,
      percent: 100,
    });
    expect(summarizeStorage({ total: 0, used: 0 }, [], [])).toMatchObject({ free: 0, percent: 100, full: true });
  });
});
