// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from "vitest";
import { readFilesOpen, writeFilesOpen } from "../src/ui/board/filesSection";
import { BOARD_FILES_KEY } from "../src/ui/storage";

function stubStorage(initial?: string): Map<string, string> {
  const store = new Map<string, string>(initial === undefined ? [] : [[BOARD_FILES_KEY, initial]]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  });
  return store;
}

describe("the Files section state", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is closed by default", () => {
    stubStorage();
    expect(readFilesOpen()).toBe(false);
  });

  it("stores open and closed and reads them back", () => {
    const store = stubStorage();
    writeFilesOpen(true);
    expect(store.get(BOARD_FILES_KEY)).toBe("open");
    expect(readFilesOpen()).toBe(true);
    writeFilesOpen(false);
    expect(store.get(BOARD_FILES_KEY)).toBe("closed");
    expect(readFilesOpen()).toBe(false);
  });

  it("reads only open as open", () => {
    for (const value of ["closed", "", "true", "OPEN", "1"]) {
      stubStorage(value);
      expect(readFilesOpen(), value).toBe(false);
    }
  });

  it("is closed, and writing does not throw, when the storage is blocked", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(readFilesOpen()).toBe(false);
    expect(() => writeFilesOpen(true)).not.toThrow();
  });
});
