// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from "vitest";
import { clearDraft, writeDraft, type Draft } from "../src/ui/editor/drafts";

afterEach(() => vi.unstubAllGlobals());

describe("editor draft mutations", () => {
  it("deletes after an earlier write even when opening storage for that write is slow", async () => {
    const events: string[] = [];
    let stored: Draft | undefined;
    let opens = 0;
    let finishFirstOpen: () => void = () => undefined;
    const db = {
      close: () => undefined,
      transaction: () => {
        const transaction: { oncomplete?: () => void; objectStore: () => object } = {
          objectStore: () => ({
            put: (draft: Draft) => {
              queueMicrotask(() => {
                events.push("write");
                stored = draft;
                transaction.oncomplete?.();
              });
              return { result: undefined };
            },
            delete: () => {
              queueMicrotask(() => {
                events.push("delete");
                stored = undefined;
                transaction.oncomplete?.();
              });
              return { result: undefined };
            },
          }),
        };
        return transaction;
      },
    };
    vi.stubGlobal("indexedDB", {
      open: () => {
        opens++;
        const request: { result: typeof db; onsuccess?: () => void } = { result: db };
        if (opens === 1) finishFirstOpen = () => request.onsuccess?.();
        else queueMicrotask(() => request.onsuccess?.());
        return request;
      },
    });
    const draft: Draft = {
      json: "{}",
      id: null,
      source: "test",
      dirty: true,
      origin: null,
      savedAt: 1,
    };
    const writing = writeDraft(draft);
    await Promise.resolve();
    await Promise.resolve();
    const clearing = clearDraft();
    await Promise.resolve();
    expect(opens).toBe(1);
    finishFirstOpen();
    expect(await writing).toBe(true);
    await clearing;
    expect(events).toEqual(["write", "delete"]);
    expect(stored).toBeUndefined();
  });
});
