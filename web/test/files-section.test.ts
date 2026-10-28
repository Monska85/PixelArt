// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlayMode } from "../src/engine";
import type { Entry, PlayStatus, Settings } from "../src/protocol";
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

  it("shows the active playlist's ID without a flag while the names are not known", () => {
    expect(summarize({ animations: two, playlists: one, settings: settings("p"), playlistNames: null })).toBe(
      "2 animations, 1 playlist, active playlist: p",
    );
  });
});

describe("the Files card summary on a firmware that knows schedules", () => {
  const two = known("a", "b");
  const one = known("p");
  const names = new Map<string, string | null>([["p", "Christmas"]]);
  const choice = (play: PlayMode): Settings => ({ brightness: 50, playlist: "p", play, playlists: ["p"] });
  const playing = (id: string | null, mode: PlayMode = "auto"): PlayStatus => ({
    mode,
    source: { auto: "server", playlists: "playlists", schedule: "schedule" }[mode] as PlayStatus["source"],
    schedule: mode === "playlists" ? null : "s",
    reason: mode === "playlists" ? "playlists" : "schedule",
    entry: 0,
    playlists: ["p"],
    playing: id,
    serverChoice: null,
  });

  it("counts the schedules, in the singular for one", () => {
    expect(
      summarize({ animations: two, playlists: one, schedules: known("s"), settings: null, playlistNames: null }),
    ).toBe("2 animations, 1 playlist, 1 schedule");
    expect(
      summarize({ animations: two, playlists: one, schedules: known(), settings: null, playlistNames: null }),
    ).toBe("2 animations, 1 playlist, 0 schedules");
  });

  it("waits for the schedules and reports them unreadable like the other lists", () => {
    const base = { animations: two, playlists: one, settings: null, playlistNames: null };
    expect(summarize({ ...base, schedules: { status: "loading" } })).toBe("Reading the files from the board...");
    expect(summarize({ ...base, schedules: { status: "unknown", error: new Error("x") } })).toBe(
      "Could not read the files from the board.",
    );
  });

  it("names the choice alone while the board has not said what it plays", () => {
    const base = { animations: two, playlists: one, schedules: known("s"), playlistNames: names, play: null };
    expect(summarize({ ...base, settings: choice("auto") })).toBe("2 animations, 1 playlist, 1 schedule, Automatic");
    expect(summarize({ ...base, settings: choice("playlists") })).toBe(
      "2 animations, 1 playlist, 1 schedule, My choice, playlists",
    );
    expect(summarize({ ...base, settings: choice("schedule") })).toBe(
      "2 animations, 1 playlist, 1 schedule, My choice, schedule",
    );
  });

  it("names the playlist the board plays, by its name, else its ID", () => {
    const base = { animations: two, playlists: one, schedules: known("s"), settings: choice("auto") };
    expect(summarize({ ...base, playlistNames: names, play: playing("p") })).toBe(
      "2 animations, 1 playlist, 1 schedule, Automatic: playing Christmas",
    );
    expect(summarize({ ...base, playlistNames: null, play: playing("p") })).toBe(
      "2 animations, 1 playlist, 1 schedule, Automatic: playing p",
    );
    expect(
      summarize({ ...base, settings: choice("playlists"), playlistNames: names, play: playing("p", "playlists") }),
    ).toBe("2 animations, 1 playlist, 1 schedule, My choice, playlists: playing Christmas");
    expect(
      summarize({ ...base, settings: choice("schedule"), playlistNames: names, play: playing("p", "schedule") }),
    ).toBe("2 animations, 1 playlist, 1 schedule, My choice, schedule: playing Christmas");
  });

  it("names the choice alone while the status still says what the other choice played", () => {
    const base = { animations: two, playlists: one, schedules: known("s"), playlistNames: names };
    expect(summarize({ ...base, settings: choice("playlists"), play: playing("p") })).toBe(
      "2 animations, 1 playlist, 1 schedule, My choice, playlists",
    );
  });

  it("keeps the active playlist wording without the schedules, whatever the settings carry", () => {
    expect(summarize({ animations: two, playlists: one, settings: choice("auto"), playlistNames: names })).toBe(
      "2 animations, 1 playlist, active playlist: Christmas",
    );
  });

  it("says every animation plays when the board plays no playlist", () => {
    const base = { animations: two, playlists: one, schedules: known("s"), settings: choice("auto") };
    expect(summarize({ ...base, playlistNames: names, play: playing(null) })).toBe(
      "2 animations, 1 playlist, 1 schedule, Automatic: every animation plays",
    );
  });
});
