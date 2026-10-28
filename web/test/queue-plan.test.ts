// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import type { Entry } from "../src/protocol";
import {
  BLOCK_SIZE,
  blocksOf,
  checkSpace,
  dedupe,
  planAgainstBoard,
  playlistAnimations,
  resolveAnimations,
  runSends,
  sendOrder,
  type PlanEntry,
  type QueueFile,
  type SendOutcome,
  type StoredFiles,
} from "../src/queue/plan";
import type { Manifest, Published } from "../src/release/manifest";
import { text } from "./helpers";

const sha = (n: number): string => n.toString(16).padStart(64, "0");

function file(kind: QueueFile["kind"], id: string, size = 100, hash = 1): QueueFile {
  return { kind, id, bytes: new Uint8Array(size), sha256: sha(hash), origin: `${id}.yaml` };
}

const entry = (id: string, size: number, hash: number | null): Entry => ({
  id,
  size,
  sha256: hash === null ? null : sha(hash),
  name: null,
  version: null,
});

const board = (
  animation: Entry[] = [],
  playlist: Entry[] = [],
  schedule: Entry[] = [],
  play: Entry[] = [],
): StoredFiles => ({
  animation,
  playlist,
  schedule,
  play,
});

const playlist = (...items: Array<string | [string, boolean]>): Uint8Array =>
  text(
    JSON.stringify({
      format: "pixelart-playlist/1",
      canvas: { width: 16, height: 16 },
      items: items.map((i) =>
        typeof i === "string" ? { animation: i } : { animation: i[0], ...(i[1] ? {} : { enabled: false }) },
      ),
    }),
  );

const published = (id: string): Published => ({ id, name: null, version: 1, size: 100, sha256: sha(1) });
const manifest = (...ids: string[]): Manifest => ({
  version: "1.0.0",
  contentVersion: null,
  hasFirmware: true,
  animations: ids.map(published),
  playlists: [],
  schedules: [],
  play: [],
});

describe("planning against the board", () => {
  it("sorts files into missing, identical and different", () => {
    const plan = planAgainstBoard(
      [file("animation", "new"), file("animation", "same", 100, 5), file("animation", "other", 100, 6)],
      board([entry("same", 100, 5), entry("other", 100, 7)]),
    );
    expect(plan.map((e) => [e.file.id, e.status])).toEqual([
      ["new", "missing"],
      ["same", "identical"],
      ["other", "different"],
    ]);
    expect(plan[2]?.stored?.sha256).toBe(sha(7));
  });

  it("compares kind and ID together, and treats a stored file without a SHA-256 as different", () => {
    const plan = planAgainstBoard(
      [file("playlist", "x", 100, 5), file("animation", "y", 100, 5)],
      board([entry("x", 100, 5), entry("y", 100, null)], [entry("x", 100, 5)]),
    );
    expect(plan.map((e) => e.status)).toEqual(["identical", "different"]);
    expect(planAgainstBoard([file("playlist", "x")], board([entry("x", 100, 1)]))[0]?.status).toBe("missing");
  });

  it("compares the SHA-256 without regard to the case the board uses", () => {
    const upper = { ...entry("a", 100, 0), sha256: sha(255).toUpperCase() };
    expect(planAgainstBoard([file("animation", "a", 100, 255)], board([upper]))[0]?.status).toBe("identical");
  });

  it("keeps the first of two files with the same kind and ID and reports the one that differs", () => {
    const result = dedupe([
      file("animation", "a", 10, 1),
      file("animation", "a", 10, 1),
      file("animation", "a", 20, 2),
    ]);
    expect(result.files).toHaveLength(1);
    expect(result.duplicates.map((f) => f.sha256)).toEqual([sha(2)]);
  });
});

describe("the order files are sent in", () => {
  it("sends animations first and playlists last, each kind in the order given", () => {
    const entries = [
      file("playlist", "p1"),
      file("animation", "a2"),
      file("playlist", "p2"),
      file("animation", "a1"),
    ].map((f) => ({ file: f }));
    expect(sendOrder(entries).map((e) => e.file.id)).toEqual(["a2", "a1", "p1", "p2"]);
  });

  it("sends schedules after the playlists, so a schedule finds its playlists", () => {
    const entries = [
      file("schedule", "default"),
      file("playlist", "p1"),
      file("schedule", "other"),
      file("animation", "a1"),
    ].map((f) => ({ file: f }));
    expect(sendOrder(entries).map((e) => e.file.id)).toEqual(["a1", "p1", "default", "other"]);
  });

  it("sends the play file last, so it finds its schedule or playlists, and skips it when the board has it", () => {
    const entries = [file("play", "default"), file("schedule", "s1"), file("animation", "a1")].map((f) => ({
      file: f,
    }));
    expect(sendOrder(entries).map((e) => e.file.id)).toEqual(["a1", "s1", "default"]);
    const plan = planAgainstBoard([file("play", "default")], board([], [], [], [entry("default", 100, 1)]));
    expect(plan.map((e) => e.status)).toEqual(["identical"]);
  });
});

describe("space", () => {
  const entries = (...files: Array<[QueueFile, Entry | null]>): PlanEntry[] =>
    files.map(([f, stored]) => ({ file: f, status: stored ? "different" : "missing", stored }));

  it("rounds every file up to whole blocks of 4,096 bytes", () => {
    expect(BLOCK_SIZE).toBe(4096);
    expect(blocksOf(1)).toBe(4096);
    expect(blocksOf(4096)).toBe(4096);
    expect(blocksOf(4097)).toBe(8192);
  });

  it("adds up the blocks and compares them with the free space", () => {
    const sends = entries([file("animation", "a", 4097), null], [file("animation", "b", 10), null]);
    // 8,192 + 4,096 needed; 12,288 free: it fits exactly.
    expect(checkSpace(sends, { total: 20480, used: 8192 })).toMatchObject({ needed: 12288, free: 12288, short: 0 });
    // One block less free: 4,096 missing.
    expect(checkSpace(sends, { total: 20480, used: 12288 })).toMatchObject({ free: 8192, short: 4096 });
  });

  it("needs room for the new file while the old one exists, so a replacement is not free", () => {
    const same = entries([file("animation", "a", 4096), entry("a", 4096, 9)]);
    // Nothing free: the new copy has nowhere to go, although the old one will give its block back at the end.
    expect(checkSpace(same, { total: 8192, used: 8192 })).toMatchObject({ needed: 4096, freed: 4096, short: 4096 });
    expect(checkSpace(same, { total: 8192, used: 4096 })).toMatchObject({ short: 0 });
    const bigger = entries([file("animation", "a", 8193), entry("a", 4096, 9)]);
    expect(checkSpace(bigger, { total: 8192, used: 4096 })).toMatchObject({ needed: 12288, freed: 4096, short: 8192 });
    expect(checkSpace(bigger, { total: 16384, used: 4096 })).toMatchObject({ short: 0 });
  });

  it("credits a replaced file only to the files that come after it", () => {
    const old = entry("a", 8192, 9);
    // a is replaced (8,192 -> 4,096) and gives 4,096 back after its upload, which b (8,192) then uses.
    const sends = entries([file("animation", "a", 4096), old], [file("animation", "b", 8192), null]);
    expect(checkSpace(sends, { total: 20480, used: 16384 })).toMatchObject({ short: 0 });
    expect(checkSpace(sends, { total: 20480, used: 20480 })).toMatchObject({ short: 4096 });
    // In the other order b finds 4,096 free, and a then lacks more still.
    const reversed = entries([file("animation", "b", 8192), null], [file("animation", "a", 4096), old]);
    expect(checkSpace(reversed, { total: 20480, used: 16384 })).toMatchObject({ short: 8192 });
  });

  it("reports the tightest point of the queue, which is not always the last file", () => {
    // 4,096 free. a (8,192) replaces a 12,288-byte file: it lacks 4,096 at its turn, then 8,192 are free for b.
    const sends = entries([file("animation", "a", 8192), entry("a", 12288, 9)], [file("animation", "b", 4096), null]);
    expect(checkSpace(sends, { total: 8192, used: 4096 })).toMatchObject({ short: 4096 });
  });

  it("does not check a board that reports no storage, and never reports a negative shortage", () => {
    expect(checkSpace(entries([file("animation", "a", 99999), null]), null).short).toBe(0);
    expect(checkSpace([], { total: 4096, used: 8192 }).short).toBe(0);
  });
});

describe("the animations a playlist brings", () => {
  it("names every animation of the playlist, enabled or not, once each", () => {
    expect(playlistAnimations(playlist("a", ["b", false], "a", "c"))).toEqual(["a", "b", "c"]);
    expect(playlistAnimations(text("not json"))).toEqual([]);
  });

  const withPlaylist = (...items: Array<string | [string, boolean]>): QueueFile => ({
    ...file("playlist", "p"),
    bytes: playlist(...items),
  });

  it("takes an animation from the same selection first, then from the Library, then the board", () => {
    const files = [withPlaylist("sel", "lib", "brd", "nowhere"), file("animation", "sel")];
    const result = resolveAnimations(files, board([entry("brd", 1, 1)]), manifest("sel", "lib", "brd"));
    // "brd" is in the Library too: the Library comes before the board, and the plan then compares it with the board.
    expect(result.fromLibrary.map((e) => e.id)).toEqual(["lib", "brd"]);
    expect(result.onBoard).toEqual([]);
    expect(result.missing).toEqual([{ animation: "nowhere", playlists: ["p"] }]);
  });

  it("uses the board's copy of an animation that only the board has", () => {
    const result = resolveAnimations([withPlaylist("brd")], board([entry("brd", 1, 1)]), manifest());
    expect(result).toEqual({ fromLibrary: [], onBoard: ["brd"], missing: [] });
  });

  it("brings disabled animations too, and lists a missing one once for every playlist that names it", () => {
    const other: QueueFile = { ...file("playlist", "q"), bytes: playlist("gone") };
    const result = resolveAnimations([withPlaylist(["off", false], "gone"), other], board(), manifest("off"));
    expect(result.fromLibrary.map((e) => e.id)).toEqual(["off"]);
    expect(result.missing).toEqual([{ animation: "gone", playlists: ["p", "q"] }]);
  });

  it("works without a Library", () => {
    const result = resolveAnimations([withPlaylist("a")], board(), null);
    expect(result.missing).toEqual([{ animation: "a", playlists: ["p"] }]);
  });
});

describe("running the queue", () => {
  const sends = (...ids: Array<[string, "animation" | "playlist"]>): PlanEntry[] =>
    ids.map(([id, kind]) => ({ file: file(kind, id), status: "missing", stored: null }));
  const done: SendOutcome = { status: "done", warnings: [] };

  it("reports every file as uploaded, in order, with the step of each", async () => {
    const seen: string[] = [];
    const summary = await runSends(sends(["a", "animation"], ["p", "playlist"]), [], async (f, i, n) => {
      seen.push(`${f.id} ${i + 1}/${n}`);
      return done;
    });
    expect(seen).toEqual(["a 1/2", "p 2/2"]);
    expect(summary.uploaded.map((u) => u.file.id)).toEqual(["a", "p"]);
    expect(summary.failed).toBeNull();
    expect(summary.notAttempted).toEqual([]);
  });

  it("stops at the first failure and never sends the playlist after a failed animation", async () => {
    const sent: string[] = [];
    const error = new Error("refused");
    const summary = await runSends(
      sends(["a", "animation"], ["b", "animation"], ["c", "animation"], ["p", "playlist"]),
      [{ file: file("animation", "same"), reason: "identical" }],
      async (f) => {
        sent.push(f.id);
        return f.id === "b" ? { status: "failed", error } : done;
      },
    );
    expect(sent).toEqual(["a", "b"]);
    expect(summary.uploaded.map((u) => u.file.id)).toEqual(["a"]);
    expect(summary.failed).toEqual({ file: expect.objectContaining({ id: "b" }), error });
    expect(summary.notAttempted.map((f) => f.id)).toEqual(["c", "p"]);
    expect(summary.skipped.map((s) => s.file.id)).toEqual(["same"]);
  });

  it("stops on a cancel and counts the file that was cancelled as not attempted", async () => {
    const summary = await runSends(sends(["a", "animation"], ["b", "animation"]), [], async (f) =>
      f.id === "a" ? done : { status: "cancelled" },
    );
    expect(summary.cancelled).toBe(true);
    expect(summary.failed).toBeNull();
    expect(summary.notAttempted.map((f) => f.id)).toEqual(["b"]);
  });
});
