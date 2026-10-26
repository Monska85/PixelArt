// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BoardClient, sha256Hex } from "../src/protocol";
import type { PlanEntry } from "../src/queue/plan";
import {
  blockedOrBusy,
  cancelRunningUpload,
  reserveUploadQueue,
  sendQueue,
  uploadBlockedReason,
  withUploadLock,
  UPLOAD_BUSY,
} from "../src/ui/upload";
import { FakeBoard } from "./fakeBoard";
import { text } from "./helpers";

const animation = (name: string): Uint8Array =>
  text(
    `{"format":"pixelart/1","name":"${name}","canvas":{"width":16,"height":16},"sprites":{"a":{"points":[[1,1,"#ff0000"]]}},"timeline":[{"show":["a"]}],"description":"${"x".repeat(300)}"}`,
  );

describe("the upload lock", () => {
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

  const one = async (id: string): Promise<PlanEntry[]> => {
    const bytes = animation(id);
    return [
      {
        file: { kind: "animation", id, bytes, sha256: await sha256Hex(bytes), origin: id },
        status: "missing",
        stored: null,
      },
    ];
  };

  it("refuses a second upload while one runs and lets the first finish", async () => {
    const first = sendQueue(client, await one("one"), []);
    await expect(sendQueue(client, await one("two"), [])).rejects.toMatchObject({ code: UPLOAD_BUSY });
    expect((await first).uploaded).toHaveLength(1);
    expect(board.files.animation.has("one")).toBe(true);
    expect(board.files.animation.has("two")).toBe(false);
    expect(board.requests.filter((r) => r.cmd === "put_begin")).toHaveLength(1);
  });

  it("accepts a new upload once the first ended, and cancels the running one on request", async () => {
    const first = sendQueue(client, await one("one"), []);
    cancelRunningUpload();
    expect((await first).cancelled).toBe(true);
    expect((await sendQueue(client, await one("two"), [])).uploaded).toHaveLength(1);
  });
});

describe("the upload queue reservation", () => {
  let board: FakeBoard;
  let client: BoardClient;
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    board = new FakeBoard();
    client = new BoardClient(board, { firstSeq: 1 });
    await client.handshake();
  });
  afterEach(() => vi.useRealTimers());

  const one = async (id: string): Promise<PlanEntry[]> => {
    const bytes = animation(id);
    return [
      {
        file: { kind: "animation", id, bytes, sha256: await sha256Hex(bytes), origin: id },
        status: "missing",
        stored: null,
      },
    ];
  };

  it("lets one entry point hold the queue while another is refused, until the first releases it", () => {
    const first = reserveUploadQueue();
    expect(first).not.toBeNull();
    expect(reserveUploadQueue()).toBeNull();
    first?.release();
    const second = reserveUploadQueue();
    expect(second).not.toBeNull();
    second?.release();
  });

  it("releases only once, so a late release never frees the next holder's reservation", () => {
    const first = reserveUploadQueue();
    first?.release();
    const second = reserveUploadQueue();
    first?.release();
    expect(reserveUploadQueue()).toBeNull();
    second?.release();
  });

  it("keeps the upload lock from anyone but the holder while the queue asks its questions", async () => {
    const reservation = reserveUploadQueue();
    const initial = { label: "x", done: 0, total: 0 };
    await expect(withUploadLock(initial, async () => 1)).rejects.toMatchObject({ code: UPLOAD_BUSY });
    await expect(sendQueue(client, await one("other"), [])).rejects.toMatchObject({ code: UPLOAD_BUSY });
    expect((await sendQueue(client, await one("mine"), [], reservation ?? undefined)).uploaded).toHaveLength(1);
    expect(board.files.animation.has("mine")).toBe(true);
    expect(board.files.animation.has("other")).toBe(false);
    reservation?.release();
    expect(await withUploadLock(initial, async () => 1)).toBe(1);
  });

  it("refuses a reservation while an upload runs", async () => {
    const running = sendQueue(client, await one("one"), []);
    expect(reserveUploadQueue()).toBeNull();
    await running;
    const after = reserveUploadQueue();
    expect(after).not.toBeNull();
    after?.release();
  });
});

describe("the reason uploads are blocked", () => {
  const ready = { state: "connected" as const, client: {} as BoardClient, uploadsBlocked: null };

  it("says to connect, that the connection was lost, or why the board is refused", () => {
    expect(uploadBlockedReason({ ...ready, state: "disconnected", client: null }, "upload")).toBe(
      "Connect a board or the simulator to upload.",
    );
    expect(uploadBlockedReason({ ...ready, state: "lost" }, "install")).toBe("Connection lost. Reconnect to install.");
    expect(uploadBlockedReason({ ...ready, uploadsBlocked: "old board" }, "upload")).toBe("old board");
    expect(uploadBlockedReason(ready, "upload")).toBeNull();
  });
});

describe("blockedOrBusy", () => {
  it("keeps the given reason first, then reports a busy queue, else null", () => {
    expect(blockedOrBusy("Connection lost.", true)).toBe("Connection lost.");
    expect(blockedOrBusy(null, true)).toBe("Another upload is still running.");
    expect(blockedOrBusy(null, false)).toBeNull();
  });
});
