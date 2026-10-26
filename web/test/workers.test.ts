// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { workers } from "../playwright.workers";

describe("the Playwright workers from PIXELART_JOBS", () => {
  it("takes a positive whole number", () => {
    expect(workers("1")).toBe(1);
    expect(workers("4")).toBe(4);
    expect(workers("8")).toBe(8);
    expect(workers("3.9")).toBe(3);
  });

  it("falls back to 2 for a missing, empty, non-numeric, zero or negative value", () => {
    for (const value of [undefined, "", " ", "abc", "0", "0.5", "-3", "NaN", "Infinity"])
      expect(workers(value), String(value)).toBe(2);
  });
});
