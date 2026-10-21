import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BoardClient, sha256Hex } from "../src/protocol";
import type { QueueFile } from "../src/queue/plan";
import { runQueue, type Notice, type RunDeps, type RunResult } from "../src/queue/run";
import type { Manifest } from "../src/release/manifest";
import { sendQueue } from "../src/ui/upload";
import { FakeBoard } from "./fakeBoard";
import { text } from "./helpers";

const animation = (name: string): Uint8Array =>
  text(
    `{"format":"pixelart/1","name":"${name}","canvas":{"width":16,"height":16},"sprites":{"a":{"points":[[1,1,"#ff0000"]]}},"timeline":[{"show":["a"]}]}`,
  );
const playlist = (animationId: string): Uint8Array =>
  text(`{"format":"pixelart-playlist/1","canvas":{"width":16,"height":16},"items":[{"animation":"${animationId}"}]}`);

async function file(kind: "animation" | "playlist", id: string, bytes: Uint8Array): Promise<QueueFile> {
  return { kind, id, bytes, sha256: await sha256Hex(bytes), origin: `${id}.yaml` };
}

describe("running the queue", () => {
  let board: FakeBoard;
  let client: BoardClient;
  let notices: Notice[];
  let deps: RunDeps;
  const differing = vi.fn();
  const missing = vi.fn();

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    board = new FakeBoard();
    client = new BoardClient(board, { firstSeq: 1 });
    await client.handshake();
    notices = [];
    differing.mockReset().mockResolvedValue("replace");
    missing.mockReset().mockResolvedValue(true);
    deps = {
      client,
      ask: { differing, missing },
      notify: (notice) => notices.push(notice),
      storage: async () => board.storage,
      send: (sends, skipped) => sendQueue(client, sends, skipped),
      manifest: null,
    };
  });
  afterEach(() => vi.useRealTimers());

  const begins = (): string[] => board.requests.filter((r) => r.cmd === "put_begin").map((r) => `${r.kind}/${r.id}`);
  const summaryOf = (result: RunResult) => {
    if (result.status !== "summary") throw new Error(`expected a summary, got ${result.status}`);
    return result.summary;
  };

  it("sends missing files, animations first, without a question", async () => {
    const result = await runQueue(deps, [
      await file("playlist", "p", playlist("a")),
      await file("animation", "a", animation("A")),
    ]);
    expect(summaryOf(result).uploaded.map((u) => u.file.id)).toEqual(["a", "p"]);
    expect(begins()).toEqual(["animation/a", "playlist/p"]);
    expect(differing).not.toHaveBeenCalled();
    expect(missing).not.toHaveBeenCalled();
  });

  it("keeps the first of two files with the same kind and ID and says so when they differ", async () => {
    const result = await runQueue(deps, [
      await file("animation", "a", animation("First")),
      await file("animation", "a", animation("First")),
      await file("animation", "a", animation("Second")),
    ]);
    expect(summaryOf(result).uploaded).toHaveLength(1);
    expect(begins()).toEqual(["animation/a"]);
    expect(notices).toEqual([expect.objectContaining({ code: "duplicate", warning: true })]);
    expect(board.files.animation.get("a")).toEqual(animation("First"));
  });

  it("skips an identical file without asking and sends nothing when that is all there is", async () => {
    board.files.animation.set("a", animation("A"));
    const summary = summaryOf(await runQueue(deps, [await file("animation", "a", animation("A"))]));
    expect(summary.skipped).toEqual([expect.objectContaining({ reason: "identical" })]);
    expect(summary.uploaded).toEqual([]);
    expect(differing).not.toHaveBeenCalled();
    expect(board.requests.some((r) => r.cmd === "put_begin")).toBe(false);
  });

  describe("files that differ from the board's", () => {
    beforeEach(() => board.files.animation.set("a", animation("Old")));

    it("asks once with every differing file and replaces them on Replace", async () => {
      board.files.animation.set("b", animation("OldB"));
      const result = await runQueue(deps, [
        await file("animation", "a", animation("New")),
        await file("animation", "b", animation("NewB")),
        await file("animation", "c", animation("C")),
      ]);
      expect(differing).toHaveBeenCalledOnce();
      expect(differing.mock.calls[0]?.[0].map((e: { file: QueueFile }) => e.file.id)).toEqual(["a", "b"]);
      expect(summaryOf(result).uploaded).toHaveLength(3);
      expect(board.files.animation.get("a")).toEqual(animation("New"));
    });

    it("sends only the missing files on Keep the board's and counts the rest as kept", async () => {
      differing.mockResolvedValue("keep");
      const summary = summaryOf(
        await runQueue(deps, [
          await file("animation", "a", animation("New")),
          await file("animation", "c", animation("C")),
        ]),
      );
      expect(summary.uploaded.map((u) => u.file.id)).toEqual(["c"]);
      expect(summary.skipped).toEqual([expect.objectContaining({ reason: "kept" })]);
      expect(board.files.animation.get("a")).toEqual(animation("Old"));
    });

    it("sends nothing on Cancel", async () => {
      differing.mockResolvedValue(null);
      const result = await runQueue(deps, [
        await file("animation", "a", animation("New")),
        await file("animation", "c", animation("C")),
      ]);
      expect(result).toEqual({ status: "cancelled" });
      expect(board.requests.some((r) => r.cmd === "put_begin")).toBe(false);
    });
  });

  describe("playlists and their animations", () => {
    it("asks about an animation found nowhere, and Cancel sends nothing", async () => {
      missing.mockResolvedValue(false);
      const result = await runQueue(deps, [await file("playlist", "p", playlist("gone"))]);
      expect(missing).toHaveBeenCalledWith([{ animation: "gone", playlists: ["p"] }]);
      expect(result).toEqual({ status: "cancelled" });
      expect(board.requests.some((r) => r.cmd === "put_begin")).toBe(false);
    });

    it("sends the playlist anyway when the user agrees", async () => {
      const summary = summaryOf(await runQueue(deps, [await file("playlist", "p", playlist("gone"))]));
      expect(summary.uploaded.map((u) => u.file.id)).toEqual(["p"]);
    });

    it("accepts the board's own copy of an animation without asking", async () => {
      board.files.animation.set("a", animation("A"));
      const summary = summaryOf(await runQueue(deps, [await file("playlist", "p", playlist("a"))]));
      expect(missing).not.toHaveBeenCalled();
      expect(summary.uploaded.map((u) => u.file.id)).toEqual(["p"]);
    });

    describe("from the Library", () => {
      const bytes = animation("Lib");
      const manifest = async (): Promise<Manifest> => ({
        version: "1.0.0",
        animations: [{ id: "lib", name: null, version: 1, size: bytes.length, sha256: await sha256Hex(bytes) }],
        playlists: [],
      });

      it("downloads it and sends it before the playlist", async () => {
        const download = vi.fn(async () => bytes);
        const result = await runQueue({ ...deps, manifest: await manifest(), download }, [
          await file("playlist", "p", playlist("lib")),
        ]);
        expect(summaryOf(result).uploaded.map((u) => u.file.id)).toEqual(["lib", "p"]);
        expect(download).toHaveBeenCalledOnce();
        expect(missing).not.toHaveBeenCalled();
      });

      it("counts a download that fails as found nowhere and says why", async () => {
        const download = vi.fn(async () => {
          throw new Error("offline");
        });
        const result = await runQueue({ ...deps, manifest: await manifest(), download }, [
          await file("playlist", "p", playlist("lib")),
        ]);
        expect(notices).toEqual([expect.objectContaining({ context: "Installing animation lib" })]);
        expect(missing).toHaveBeenCalledWith([{ animation: "lib", playlists: ["p"] }]);
        expect(summaryOf(result).uploaded.map((u) => u.file.id)).toEqual(["p"]);
      });

      it("sends the playlist without asking when the download fails but the board stores the animation", async () => {
        board.files.animation.set("lib", bytes);
        const download = vi.fn(async () => {
          throw new Error("offline");
        });
        const result = await runQueue({ ...deps, manifest: await manifest(), download }, [
          await file("playlist", "p", playlist("lib")),
        ]);
        expect(notices).toEqual([expect.objectContaining({ context: "Installing animation lib" })]);
        expect(missing).not.toHaveBeenCalled();
        expect(summaryOf(result).uploaded.map((u) => u.file.id)).toEqual(["p"]);
      });

      it("names only the playlists that reference an animation that cannot be taken", async () => {
        const download = vi.fn(async () => {
          throw new Error("offline");
        });
        await runQueue({ ...deps, manifest: await manifest(), download }, [
          await file("playlist", "p", playlist("lib")),
          await file("playlist", "q", playlist("other")),
        ]);
        expect(missing).toHaveBeenCalledWith(expect.arrayContaining([{ animation: "lib", playlists: ["p"] }]));
        expect(missing.mock.calls[0]?.[0]).not.toContainEqual({ animation: "lib", playlists: ["p", "q"] });
      });

      it("counts a published file that fails the app's check as found nowhere", async () => {
        const download = vi.fn(async () => text(`{"format":"pixelart/1"}`));
        await runQueue({ ...deps, manifest: await manifest(), download }, [
          await file("playlist", "p", playlist("lib")),
        ]);
        expect(notices).toEqual([expect.objectContaining({ code: "rejected" })]);
        expect(missing).toHaveBeenCalledOnce();
      });
    });
  });

  describe("refusals", () => {
    it("refuses with read_failed when the board's list cannot be read", async () => {
      board.override = (r) => (r.cmd === "list" ? { ok: false, error: "busy", message: "try later" } : undefined);
      const result = await runQueue(deps, [await file("animation", "a", animation("A"))]);
      expect(result).toMatchObject({ status: "refused", refusal: { reason: "read_failed", error: { code: "busy" } } });
    });

    it("refuses with read_failed when the board's free space cannot be read", async () => {
      const failing = { ...deps, storage: async () => Promise.reject(new Error("no answer")) };
      const result = await runQueue(failing, [await file("animation", "a", animation("A"))]);
      expect(result).toMatchObject({ status: "refused", refusal: { reason: "read_failed" } });
      expect(board.requests.some((r) => r.cmd === "put_begin")).toBe(false);
    });

    it("refuses with no_space before sending anything, with the shortage", async () => {
      board.storage = { total: 8192, used: 8192 };
      const result = await runQueue(deps, [await file("animation", "a", animation("A"))]);
      expect(result).toMatchObject({ status: "refused", refusal: { reason: "no_space", space: { short: 4096 } } });
      expect(board.requests.some((r) => r.cmd === "put_begin")).toBe(false);
    });

    it("refuses a replacement when the board has no room for both copies", async () => {
      board.files.animation.set("a", animation("Old"));
      board.storage = { total: 8192, used: 8192 };
      const result = await runQueue(deps, [await file("animation", "a", animation("New"))]);
      expect(result).toMatchObject({ status: "refused", refusal: { reason: "no_space" } });
    });

    it("refuses with failed when sending throws, as when another upload holds the lock", async () => {
      const error = new Error("locked");
      const result = await runQueue({ ...deps, send: async () => Promise.reject(error) }, [
        await file("animation", "a", animation("A")),
      ]);
      expect(result).toEqual({ status: "refused", refusal: { reason: "failed", error } });
    });
  });

  it("returns the summary of a send that failed or was cancelled, not a refusal", async () => {
    board.override = (r) => (r.cmd === "put_end" ? { ok: false, error: "storage_error" } : undefined);
    const summary = summaryOf(await runQueue(deps, [await file("animation", "a", animation("A"))]));
    expect(summary.failed).toMatchObject({ file: { id: "a" } });
  });
});
