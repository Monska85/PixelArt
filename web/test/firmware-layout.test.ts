// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import type { BoardInfo } from "../src/protocol/client";
import { OLD_LAYOUT_STORAGE_BYTES, onOldLayout } from "../src/ui/firmware/layout";

const info = (storage: BoardInfo["storage"]): BoardInfo => ({ storage }) as BoardInfo;

describe("the old flash layout", () => {
  it("is the file system of the Arduino default table for 4 MB, 1,441,792 bytes", () => {
    expect(OLD_LAYOUT_STORAGE_BYTES).toBe(1_441_792);
  });

  it("is recognised by the size of the file system only", () => {
    expect(onOldLayout(info({ total: 1_441_792, used: 0 }))).toBe(true);
    expect(onOldLayout(info({ total: 983_040, used: 0 }))).toBe(false);
    expect(onOldLayout(info({ total: 1_441_791, used: 0 }))).toBe(false);
    expect(onOldLayout(info(null))).toBe(false);
    expect(onOldLayout(null)).toBe(false);
  });
});
