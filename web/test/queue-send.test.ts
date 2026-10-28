// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BoardClient, BoardError, deleteAll, listFiles, sha256Hex } from "../src/protocol";
import { planAgainstBoard, type PlanEntry, type QueueFile } from "../src/queue/plan";
import { cancelRunningUpload, sendQueue, withUploadLock, UPLOAD_BUSY } from "../src/ui/upload";
import { FakeBoard } from "./fakeBoard";
import { text } from "./helpers";

const animation = (name: string): Uint8Array =>
  text(
    `{"format":"pixelart/1","name":"${name}","canvas":{"width":16,"height":16},"sprites":{"a":{"points":[[1,1,"#ff0000"]]}},"timeline":[{"show":["a"]}]}`,
  );
const playlist = text(`{"format":"pixelart-playlist/1","canvas":{"width":16,"height":16},"items":[{"animation":"a"}]}`);

async function entry(kind: "animation" | "playlist", id: string, bytes: Uint8Array): Promise<PlanEntry> {
  const file: QueueFile = { kind, id, bytes, sha256: await sha256Hex(bytes), origin: `${id}.yaml` };
  return { file, status: "missing", stored: null };
}

describe("sending a queue", () => {
  let board: FakeBoard;
  let client: BoardClient;
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    board = new FakeBoard();
    board.chunk = 64;
    client = new BoardClient(board, { firstSeq: 1 });
    await client.handshake();
  });
  afterEach(() => vi.useRealTimers());

  const begins = (): string[] =>
    board.requests.filter((r) => r.cmd === "put_begin").map((r) => `${r.kind}/${r.id as string}`);

  it("sends the files one after the other, animations before playlists", async () => {
    const sends = [await entry("animation", "a", animation("A")), await entry("playlist", "p", playlist)];
    const summary = await sendQueue(client, sends, []);
    expect(summary.uploaded.map((u) => u.file.id)).toEqual(["a", "p"]);
    expect(begins()).toEqual(["animation/a", "playlist/p"]);
    expect(board.files.playlist.has("p")).toBe(true);
  });

  it("holds the lock for the whole queue, so no upload slips in between two files", async () => {
    const sends = [await entry("animation", "a", animation("A")), await entry("animation", "b", animation("B"))];
    const running = sendQueue(client, sends, []);
    await expect(sendQueue(client, [await entry("animation", "c", animation("C"))], [])).rejects.toMatchObject({
      code: UPLOAD_BUSY,
    });
    await running;
    expect(begins()).toEqual(["animation/a", "animation/b"]);
  });

  it("stops at the first file the board refuses and never sends the playlist", async () => {
    const bad = text(String.raw`{"format":"pixelart/1","name":"INVALID"}`);
    const sends = [
      await entry("animation", "a", animation("A")),
      await entry("animation", "bad", bad),
      await entry("animation", "c", animation("C")),
      await entry("playlist", "p", playlist),
    ];
    const summary = await sendQueue(client, sends, []);
    expect(summary.uploaded.map((u) => u.file.id)).toEqual(["a"]);
    expect(summary.failed?.file.id).toBe("bad");
    expect(summary.failed?.error).toMatchObject({ code: "invalid_file" });
    expect(summary.notAttempted.map((f) => f.id)).toEqual(["c", "p"]);
    expect(begins()).toEqual(["animation/a", "animation/bad"]);
    expect(board.files.playlist.size).toBe(0);
    expect(board.uploading).toBe(false);
  });

  it("cancels with put_abort and stops", async () => {
    const sends = [await entry("animation", "a", animation("A")), await entry("animation", "b", animation("B"))];
    const running = sendQueue(client, sends, []);
    cancelRunningUpload();
    const summary = await running;
    expect(summary.cancelled).toBe(true);
    expect(summary.notAttempted.map((f) => f.id)).toEqual(["a", "b"]);
    expect(board.requests.some((r) => r.cmd === "put_abort")).toBe(true);
    expect(board.files.animation.size).toBe(0);
    // The lock is free again.
    const next = await sendQueue(client, [await entry("animation", "d", animation("D"))], []);
    expect(next.uploaded.map((u) => u.file.id)).toEqual(["d"]);
  });

  it("resumes when run again: what the first run stored is planned as identical", async () => {
    const bad = text(String.raw`{"format":"pixelart/1","name":"INVALID"}`);
    const first = [await entry("animation", "a", animation("A")), await entry("animation", "bad", bad)];
    await sendQueue(client, first, []);
    const stored = {
      animation: await listFiles(client, "animation"),
      playlist: await listFiles(client, "playlist"),
      schedule: [],
    };
    expect(
      planAgainstBoard(
        first.map((e) => e.file),
        stored,
      ).map((e) => [e.file.id, e.status]),
    ).toEqual([
      ["a", "identical"],
      ["bad", "missing"],
    ]);
  });
});

describe("delete_all", () => {
  let board: FakeBoard;
  let client: BoardClient;
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    board = new FakeBoard();
    client = new BoardClient(board, { firstSeq: 1 });
    await client.handshake();
  });
  afterEach(() => vi.useRealTimers());

  it("returns the counts the board reports", async () => {
    board.files.animation.set("a", animation("A"));
    board.files.animation.set("b", animation("B"));
    board.files.playlist.set("p", playlist);
    expect(await deleteAll(client)).toEqual({ schedules: null, playlists: 1, animations: 2 });
    expect(board.files.animation.size + board.files.playlist.size).toBe(0);
    expect(board.requests.at(-1)).toMatchObject({ cmd: "delete_all" });
    expect(Object.keys(board.requests.at(-1) ?? {}).sort()).toEqual(["cmd", "seq"]);
  });

  it("asks for the settings reset only when told, and returns the settings the board reports", async () => {
    board.files.playlist.set("p", playlist);
    board.settings = { brightness: 7, playlist: "p" };
    expect(await deleteAll(client, { resetSettings: true })).toEqual({
      schedules: null,
      playlists: 1,
      animations: 0,
      settings: { brightness: 100, playlist: "default" },
    });
    expect(board.requests.at(-1)).toMatchObject({ cmd: "delete_all", settings: true });
  });

  it("refuses a reset reply without the settings", async () => {
    board.override = (r) =>
      r.cmd === "delete_all" ? { seq: r.seq, ok: true, playlists: 0, animations: 0 } : undefined;
    await expect(deleteAll(client, { resetSettings: true })).rejects.toMatchObject({ code: "protocol" });
  });

  it("waits 10 seconds for the reply, so a board that needs 5 seconds is asked once", async () => {
    board.files.animation.set("a", animation("A"));
    const reply = board.send.bind(board);
    let lines = 0;
    board.send = async (line) => {
      lines += 1;
      setTimeout(() => void reply(line), 5000);
    };
    const result = deleteAll(client);
    await vi.advanceTimersByTimeAsync(4999);
    expect(lines).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toEqual({ schedules: null, playlists: 0, animations: 1 });
    expect(lines).toBe(1);
  });

  it("asks again with the same seq only after 10 seconds without a reply", async () => {
    board.fault = (_i, r) =>
      r.cmd === "delete_all" && board.requests.filter((q) => q.cmd === "delete_all").length === 1 ? "drop" : undefined;
    const result = deleteAll(client);
    await vi.advanceTimersByTimeAsync(9999);
    expect(board.requests.filter((r) => r.cmd === "delete_all")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toEqual({ schedules: null, playlists: 0, animations: 0 });
    const sent = board.requests.filter((r) => r.cmd === "delete_all");
    expect(sent).toHaveLength(2);
    expect(sent[1]?.seq).toBe(sent[0]?.seq);
  });

  it("throws the board's error: unknown_command from an old firmware, storage_error", async () => {
    board.override = (r) =>
      r.cmd === "delete_all" ? { ok: false, error: "unknown_command", message: "no" } : undefined;
    await expect(deleteAll(client)).rejects.toMatchObject({ code: "unknown_command" });
    board.override = (r) => (r.cmd === "delete_all" ? { ok: false, error: "storage_error", message: "x" } : undefined);
    await expect(deleteAll(client)).rejects.toMatchObject({ code: "storage_error" });
  });

  it("refuses a reply without counts", async () => {
    board.override = (r) => (r.cmd === "delete_all" ? { ok: true, playlists: -1, animations: 2 } : undefined);
    await expect(deleteAll(client)).rejects.toBeInstanceOf(BoardError);
    board.override = (r) => (r.cmd === "delete_all" ? { ok: true } : undefined);
    await expect(deleteAll(client)).rejects.toMatchObject({ code: "protocol" });
  });

  it("holds the upload lock while it runs, with an activity that cannot be cancelled", async () => {
    const seen: Array<boolean | undefined> = [];
    await withUploadLock(
      { label: "Deleting", done: 0, total: 0, indeterminate: true, cancellable: false },
      async (lock) => {
        seen.push(lock.signal.aborted);
        await expect(withUploadLock({ label: "x", done: 0, total: 0 }, async () => undefined)).rejects.toMatchObject({
          code: UPLOAD_BUSY,
        });
      },
    );
    expect(seen).toEqual([false]);
  });
});
