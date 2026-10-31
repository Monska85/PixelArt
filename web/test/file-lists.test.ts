// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it, vi } from "vitest";
import type { Entry, Kind } from "../src/protocol";
import { FileListReader, KINDS, type FileLists } from "../src/ui/fileLists";

const entry = (id: string): Entry => ({ id, size: 1, sha256: null, name: null, version: null });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function reader(read: (kind: Kind) => Promise<Entry[]>) {
  const seen: FileLists[] = [];
  const instance = new FileListReader(read, (lists) => seen.push(lists));
  return { instance, seen };
}

describe("the board's file lists", () => {
  it("starts loading, marks a known list stale while it is read again, and never rejects", async () => {
    const second = deferred<Entry[]>();
    const read = vi
      .fn()
      .mockResolvedValueOnce([entry("a")])
      .mockReturnValueOnce(second.promise);
    const { instance } = reader(read);
    expect(instance.current.animation.status).toBe("loading");
    await instance.refresh(["animation"]);
    expect(instance.current.animation).toEqual({
      status: "known",
      entries: [entry("a")],
      staleSince: null,
    });
    const again = instance.refresh(["animation"]);
    expect(instance.current.animation).toMatchObject({
      status: "known",
      staleSince: expect.any(Number),
      entries: [entry("a")],
    });
    second.resolve([entry("a"), entry("b")]);
    await again;
    expect(instance.current.animation).toMatchObject({
      status: "known",
      entries: [entry("a"), entry("b")],
      staleSince: null,
    });
  });

  it("keeps the first staleSince while overlapping reads run", async () => {
    vi.useFakeTimers();
    try {
      const read = vi.fn().mockResolvedValueOnce([entry("a")]);
      const { instance } = reader(read);
      await instance.refresh(["animation"]);
      read.mockReturnValue(new Promise(() => {}));
      vi.setSystemTime(1000);
      void instance.refresh(["animation"]);
      vi.setSystemTime(2000);
      void instance.refresh(["animation"]);
      expect(instance.current.animation).toMatchObject({ status: "known", staleSince: 1000 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("reads only the kinds it is asked for", async () => {
    const read = vi.fn(async () => []);
    const { instance } = reader(read);
    await instance.refresh(["playlist"]);
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith("playlist");
    expect(instance.current.animation.status).toBe("loading");
    await instance.refresh(KINDS);
    expect(read).toHaveBeenCalledTimes(5);
  });

  it("never lets an older read replace a newer one", async () => {
    const older = deferred<Entry[]>();
    const newer = deferred<Entry[]>();
    const read = vi.fn().mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const { instance } = reader(read);
    const first = instance.refresh(["animation"]);
    const second = instance.refresh(["animation"]);
    newer.resolve([entry("new")]);
    await second;
    older.resolve([entry("old")]);
    await first;
    expect(instance.current.animation).toMatchObject({ status: "known", entries: [entry("new")] });
  });

  it("does not let an older failure hide a newer list, nor an older list hide a newer failure", async () => {
    const older = deferred<Entry[]>();
    const newer = deferred<Entry[]>();
    const read = vi.fn().mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const { instance } = reader(read);
    const first = instance.refresh(["animation"]);
    const second = instance.refresh(["animation"]);
    newer.reject(new Error("newer failed"));
    await second;
    older.resolve([entry("old")]);
    await first;
    expect(instance.current.animation.status).toBe("unknown");
  });

  it("is unknown after a failed read, not the previous list", async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce([entry("a")])
      .mockRejectedValueOnce(new Error("no answer"));
    const { instance } = reader(read);
    await instance.refresh(["animation"]);
    await instance.refresh(["animation"]);
    expect(instance.current.animation).toMatchObject({ status: "unknown", error: new Error("no answer") });
  });

  it("discards the reads in flight when it is reset", async () => {
    const pending = deferred<Entry[]>();
    const { instance } = reader(() => pending.promise);
    const refreshing = instance.refresh(["animation"]);
    instance.reset();
    pending.resolve([entry("late")]);
    await refreshing;
    expect(instance.current.animation.status).toBe("loading");
  });
});
