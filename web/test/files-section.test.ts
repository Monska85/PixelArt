// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Entry } from "../src/protocol";
import type { BoardFileList } from "../src/ui/fileLists";
import { readFilesOpen, summarize, writeFilesOpen } from "../src/ui/board/filesSection";
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

const entry = (id: string): Entry => ({ id, size: 1, sha256: null, name: null, version: null });
const known = (...ids: string[]): BoardFileList => ({
  status: "known",
  entries: ids.map(entry),
  staleSince: null,
});
const settings = (playlist: string) => ({ brightness: 50, playlist });

describe("the Files card summary", () => {
  const two = known("a", "b");
  const one = known("p");

  it("says the files could not be read when a list is unknown", () => {
    const unknown: BoardFileList = { status: "unknown", error: new Error("x") };
    expect(summarize({ animations: unknown, playlists: one, settings: null, playlistNames: null })).toBe(
      "Could not read the files from the board.",
    );
    expect(summarize({ animations: two, playlists: unknown, settings: null, playlistNames: null })).toBe(
      "Could not read the files from the board.",
    );
  });

  it("says it is reading while a list is loading", () => {
    const loading: BoardFileList = { status: "loading" };
    expect(summarize({ animations: loading, playlists: one, settings: null, playlistNames: null })).toBe(
      "Reading the files from the board...",
    );
    expect(summarize({ animations: two, playlists: loading, settings: null, playlistNames: null })).toBe(
      "Reading the files from the board...",
    );
  });

  it("gives only the counts when the settings are not known", () => {
    expect(summarize({ animations: two, playlists: one, settings: null, playlistNames: null })).toBe(
      "2 animations, 1 playlist",
    );
  });

  it("uses the singular for one animation and one playlist", () => {
    expect(summarize({ animations: known("a"), playlists: one, settings: null, playlistNames: null })).toBe(
      "1 animation, 1 playlist",
    );
  });

  it("says every animation plays when no playlist is set", () => {
    expect(summarize({ animations: two, playlists: one, settings: settings(""), playlistNames: new Map() })).toBe(
      "2 animations, 1 playlist, no active playlist: every animation plays",
    );
  });

  it("flags an active playlist that is not stored", () => {
    expect(summarize({ animations: two, playlists: one, settings: settings("gone"), playlistNames: new Map() })).toBe(
      "2 animations, 1 playlist, active playlist: gone (not stored)",
    );
  });

  it("names a stored active playlist by its name", () => {
    const names = new Map<string, string | null>([["p", "Christmas"]]);
    expect(summarize({ animations: two, playlists: one, settings: settings("p"), playlistNames: names })).toBe(
      "2 animations, 1 playlist, active playlist: Christmas",
    );
  });

  it("falls back to the ID for a stored active playlist without a name", () => {
    const names = new Map<string, string | null>([["p", null]]);
    expect(summarize({ animations: two, playlists: one, settings: settings("p"), playlistNames: names })).toBe(
      "2 animations, 1 playlist, active playlist: p",
    );
  });
});
