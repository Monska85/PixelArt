// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from "vitest";
import { newAnimation, setTopField } from "../src/editor/doc";
import { deleteFile, sha256Hex } from "../src/protocol";
import { writeJson } from "../src/yaml/writeJson";
import { EditorStore, hasUnsavedWork } from "../src/ui/editor/store";
import { boardFilesOf } from "../src/ui/editor/boardFiles";
import { session } from "../src/ui/session";
import { FakeBoard } from "./fakeBoard";
import { text } from "./helpers";

vi.mock("../src/ui/editor/drafts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/ui/editor/drafts")>()),
  readDraft: vi.fn(async () => null),
  writeDraft: vi.fn(async () => true),
  clearDraft: vi.fn(async () => undefined),
}));

const leaving = () => boardFilesOf(session.getSnapshot());

describe("the board's animations kept by the session", () => {
  afterEach(async () => {
    vi.useRealTimers();
    await session.disconnect();
  });

  it("does not publish a connection after disconnecting during upload cleanup", async () => {
    vi.useFakeTimers();
    const board = new FakeBoard();
    board.fault = (_index, request) => (request.cmd === "put_abort" ? "drop" : undefined);
    session.markUploadInterrupted();
    const connecting = session["connect"]("simulator", async () => board);
    await vi.advanceTimersByTimeAsync(0);
    expect(board.requests.some((request) => request.cmd === "put_abort")).toBe(true);
    await session.disconnect();
    await vi.advanceTimersByTimeAsync(11_000);
    await connecting;
    expect(session.getSnapshot().state).toBe("disconnected");
  });

  async function savedBall(board: FakeBoard): Promise<EditorStore> {
    const bytes = text("ball");
    board.files.animation.set("ball", bytes);
    await session["connect"]("simulator", async () => board);
    await session.refreshFiles(["animation"]);
    const doc = setTopField(newAnimation(), "name", "Ball");
    const store = new EditorStore();
    await store.request({
      doc,
      id: "ball",
      source: "x",
      saves: {
        board: { kind: "board", name: "ball", at: 1, json: writeJson(doc), sha256: await sha256Hex(bytes) },
        file: null,
      },
    });
    return store;
  }

  it("tells the leave-the-page check that a saved animation is gone after it is deleted, and clears the lists on disconnect", async () => {
    const store = await savedBall(new FakeBoard());
    expect(hasUnsavedWork(store.getSnapshot(), leaving())).toBe(false);

    const { client } = session.getSnapshot();
    if (!client) throw new Error("not connected");
    await deleteFile(client, "animation", "ball");
    await session.refreshFiles(["animation"]);
    expect(hasUnsavedWork(store.getSnapshot(), leaving())).toBe(true);

    await session.disconnect();
    expect(session.getSnapshot().files.animation.status).toBe("loading");
    expect(leaving()).toBeNull();
  });

  it("asks when the list could not be read after a delete, and keeps asking from the new list that no longer has the file", async () => {
    const board = new FakeBoard();
    const store = await savedBall(board);
    expect(hasUnsavedWork(store.getSnapshot(), leaving())).toBe(false);

    const { client } = session.getSnapshot();
    if (!client) throw new Error("not connected");
    await deleteFile(client, "animation", "ball");
    board.override = (request) =>
      request.cmd === "list" ? { ok: false, error: "storage_error", message: "unreadable" } : undefined;
    await session.refreshFiles(["animation"]);
    expect(session.getSnapshot().files.animation.status).toBe("unknown");
    expect(leaving()).toBe("unknown");
    expect(hasUnsavedWork(store.getSnapshot(), leaving())).toBe(true);

    board.override = () => undefined;
    await session.refreshFiles(["animation"]);
    expect(hasUnsavedWork(store.getSnapshot(), leaving())).toBe(true);
    expect(session.getSnapshot().files.animation.status).toBe("known");
  });

  it("judges a re-read with the last known list, and asks while the first read or a failed read leaves it unknown", async () => {
    const board = new FakeBoard();
    const store = await savedBall(board);
    const reading = session.refreshFiles(["animation"]);
    expect(session.getSnapshot().files.animation).toMatchObject({ status: "known", staleSince: expect.any(Number) });
    expect(leaving()).toMatchObject({ entries: [{ id: "ball" }], staleSince: expect.any(Number) });
    expect(hasUnsavedWork(store.getSnapshot(), leaving())).toBe(false);
    await reading;
    expect(leaving()).toMatchObject({ staleSince: null });

    await session.disconnect();
    await session["connect"]("simulator", async () => board);
    expect(session.getSnapshot().files.animation.status).toBe("loading");
    expect(leaving()).toBe("unknown");
  });

  it("reads only the kinds a change touched", async () => {
    const board = new FakeBoard();
    await session["connect"]("simulator", async () => board);
    await session.refreshFiles(["animation", "playlist"]);
    const lists = () => board.requests.filter((r) => r.cmd === "list").length;
    const before = lists();
    await session.refreshFiles(["playlist"]);
    expect(lists()).toBe(before + 1);
    expect(board.requests.at(-1)).toMatchObject({ cmd: "list", kind: "playlist" });
  });
});
