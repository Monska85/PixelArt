// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { capNames, missingAnimations, missingByPlaylist, nameList, splitMissing } from "../src/ui/board/missing";
import type { Manifest } from "../src/release/manifest";
import { ReadFailures, readNames } from "../src/ui/board/usePlaylistAnimations";
import type { BoardClient, Entry } from "../src/protocol";

const published = (id: string) => ({ id, name: null, version: null, size: 1, sha256: "0".repeat(64) });
const library = (...ids: string[]): Manifest =>
  ({ version: "1.0.0", animations: ids.map(published), playlists: [] }) as unknown as Manifest;

describe("missingAnimations", () => {
  it("keeps the named animations that are not stored, in order", () => {
    expect(missingAnimations(["a", "b", "c"], new Set(["b"]))).toEqual(["a", "c"]);
  });
  it("finds nothing missing when everything is stored", () => {
    expect(missingAnimations(["a"], new Set(["a", "z"]))).toEqual([]);
  });
});

describe("splitMissing", () => {
  it("separates the published animations from the ones the Library lacks", () => {
    const split = splitMissing(["a", "b", "c"], library("a", "c"));
    expect(split.installable.map((e) => e.id)).toEqual(["a", "c"]);
    expect(split.unavailable).toEqual(["b"]);
  });
  it("installs nothing without a release", () => {
    const split = splitMissing(["a"], null);
    expect(split.installable).toEqual([]);
    expect(split.unavailable).toEqual(["a"]);
  });
});

describe("missingByPlaylist", () => {
  const contents = new Map([
    ["one", ["a", "b"]],
    ["two", ["a"]],
  ]);
  it("lists the missing animations of each playlist and leaves out the complete ones", () => {
    const result = missingByPlaylist(contents, new Set(["a"]));
    expect([...result]).toEqual([["one", ["b"]]]);
  });
  it("never says anything while the stored animations are not known", () => {
    expect(missingByPlaylist(contents, null).size).toBe(0);
  });
  it("says nothing about a playlist whose content is not known", () => {
    expect(missingByPlaylist(new Map(), new Set()).size).toBe(0);
  });
});

describe("reading playlist contents", () => {
  const entry = { id: "p", size: 1, sha256: "a".repeat(64) } as unknown as Entry;
  const client = {} as BoardClient;
  const list = [entry];
  const key = "p:" + "a".repeat(64);
  const failing = () => Promise.reject(new Error("transient"));

  it("retries a failed read after a pause, and the badge data appears", async () => {
    const failures = new ReadFailures();
    failures.sync(client, list, false);
    expect((await readNames([entry], failing, failures, () => true))?.size).toBe(0);
    expect(failures.has(key)).toBe(true);

    failures.sync(client, list, false); // an effect re-run alone does not retry
    expect(failures.has(key)).toBe(true);
    failures.sync(client, list, true); // paused
    failures.sync(client, list, false); // resumed
    expect(failures.has(key)).toBe(false);
    const found = await readNames(
      [entry],
      async () => ["a", "b"],
      failures,
      () => true,
    );
    expect(found?.get(key)).toEqual(["a", "b"]);
  });

  it("retries after the playlists list changes", async () => {
    const failures = new ReadFailures();
    failures.sync(client, list, false);
    await readNames([entry], failing, failures, () => true);
    failures.sync(client, [...list], false);
    expect(failures.has(key)).toBe(false);
  });

  it("does not record a failure of a cancelled read", async () => {
    const failures = new ReadFailures();
    expect(await readNames([entry], failing, failures, () => false)).toBeNull();
    expect(failures.has(key)).toBe(false);
  });
});

describe("capNames and nameList", () => {
  const names = Array.from({ length: 300 }, (_, i) => `a${i}`);

  it("spells out ten of 300 names and counts the rest", () => {
    const { shown, more } = capNames(names);
    expect(shown).toEqual(names.slice(0, 10));
    expect(more).toBe(290);
    expect(nameList(names)).toBe(`${names.slice(0, 10).join(", ")} and 290 more`);
  });

  it("leaves a short list whole", () => {
    expect(nameList(names.slice(0, 10))).toBe(names.slice(0, 10).join(", "));
    expect(capNames(names.slice(0, 3)).more).toBe(0);
  });
});
