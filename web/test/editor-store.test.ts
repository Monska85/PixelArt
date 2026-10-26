// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newAnimation, setTopField, type Doc } from "../src/editor/doc";
import type { BoardFiles } from "../src/editor/saves";
import { writeJson } from "../src/yaml/writeJson";
import * as drafts from "../src/ui/editor/drafts";
import { EditorStore, hasUnsavedWork, RESTORE_WAIT_MS, type Opening } from "../src/ui/editor/store";
import * as holding from "../src/ui/editor/holding";

vi.mock("../src/ui/editor/drafts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/ui/editor/drafts")>()),
  readDraft: vi.fn(),
  writeDraft: vi.fn(),
  clearDraft: vi.fn(),
}));

/** Longer than the delay before a draft is written. */
const DRAFT_WAIT = 1000;

const named = (name: string): Doc => setTopField(newAnimation(), "name", name);
const opening = (name: string): Opening => ({ doc: named(name), id: null, source: name });
const nameOf = (store: EditorStore): unknown => store.getSnapshot().state.doc.get("name");
const stored = (name: string, dirty = true, origin: drafts.DraftOrigin | null = null): drafts.Draft => ({
  json: writeJson(named(name)),
  id: null,
  source: name,
  dirty,
  origin,
  savedAt: 0,
});

/** Makes the stored draft arrive only when the returned function is called. */
function slowDraft(): (draft: drafts.Draft) => void {
  let answer: (draft: drafts.Draft) => void = () => {};
  vi.mocked(drafts.readDraft).mockReturnValue(new Promise((resolve) => (answer = resolve)));
  return (draft) => answer(draft);
}

/** A store that opened a document before the stored draft arrived; the draft arrives afterwards. */
async function openedBeforeLateDraft(): Promise<{ store: EditorStore; arrive: () => Promise<void> }> {
  const answer = slowDraft();
  const store = new EditorStore();
  const opened = store.request(opening("Opened"));
  await vi.advanceTimersByTimeAsync(RESTORE_WAIT_MS);
  await opened;
  return {
    store,
    arrive: async () => {
      answer(stored("Late"));
      await vi.advanceTimersByTimeAsync(DRAFT_WAIT);
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(drafts.readDraft).mockResolvedValue(null);
  vi.mocked(drafts.writeDraft).mockResolvedValue(true);
  vi.mocked(drafts.clearDraft).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

async function dirtyStore(): Promise<EditorStore> {
  const store = new EditorStore();
  await store.request(opening("Mine"));
  store.edit((doc) => setTopField(doc, "name", "Edited"));
  return store;
}

describe("discarding a restored draft", () => {
  it("drops a pending write once drafting is stopped", async () => {
    vi.mocked(drafts.readDraft).mockResolvedValue(stored("Broken"));
    const store = new EditorStore();
    await store.start();
    expect(nameOf(store)).toBe("Broken");
    store.edit((doc) => setTopField(doc, "name", "Edited"));
    store.stopDrafting();
    await vi.advanceTimersByTimeAsync(DRAFT_WAIT);
    expect(drafts.writeDraft).not.toHaveBeenCalled();
  });

  it("writes nothing for the restore alone", async () => {
    vi.mocked(drafts.readDraft).mockResolvedValue(stored("Broken"));
    await new EditorStore().start();
    await vi.advanceTimersByTimeAsync(DRAFT_WAIT);
    expect(drafts.writeDraft).not.toHaveBeenCalled();
  });
});

describe("requests to open a document", () => {
  it("opens at once when nothing is unsaved", async () => {
    const store = new EditorStore();
    await expect(store.request(opening("A"))).resolves.toBe("opened");
    expect(nameOf(store)).toBe("A");
  });

  it("asks when changes are unsaved, then opens on confirm", async () => {
    const store = await dirtyStore();
    const result = store.request(opening("B"));
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getSnapshot().pending?.source).toBe("B");
    store.confirmPending();
    await expect(result).resolves.toBe("opened");
    expect(nameOf(store)).toBe("B");
    expect(store.getSnapshot().pending).toBeNull();
  });

  it("keeps the document on cancel", async () => {
    const store = await dirtyStore();
    const result = store.request(opening("B"));
    await vi.advanceTimersByTimeAsync(0);
    store.cancelPending();
    await expect(result).resolves.toBe("kept");
    expect(nameOf(store)).toBe("Edited");
  });

  it("resolves a request replaced by a newer one as superseded", async () => {
    const store = await dirtyStore();
    const first = store.request(opening("B"));
    await vi.advanceTimersByTimeAsync(0);
    const second = store.request(opening("C"));
    await expect(first).resolves.toBe("superseded");
    expect(store.getSnapshot().pending?.source).toBe("C");
    store.confirmPending();
    await expect(second).resolves.toBe("opened");
    expect(nameOf(store)).toBe("C");
  });

  it("resolves a waiting request as superseded when the draft is discarded", async () => {
    const store = await dirtyStore();
    const result = store.request(opening("B"));
    await vi.advanceTimersByTimeAsync(0);
    store.discardDraft();
    await expect(result).resolves.toBe("superseded");
    expect(store.getSnapshot().pending).toBeNull();
  });
});

describe("counting the documents opened", () => {
  it("counts each opening and not the edits", async () => {
    const store = new EditorStore();
    expect(store.getSnapshot().openings).toBe(0);
    await store.request(opening("A"));
    expect(store.getSnapshot().openings).toBe(1);
    store.edit((doc) => setTopField(doc, "name", "Edited"));
    expect(store.getSnapshot().openings).toBe(1);
    store.openNow(opening("B"));
    expect(store.getSnapshot().openings).toBe(2);
    store.edit((doc) => setTopField(doc, "name", "Edited again"));
    const result = store.request(opening("C"));
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getSnapshot().openings).toBe(2);
    store.confirmPending();
    await result;
    expect(store.getSnapshot().openings).toBe(3);
  });

  it("does not count a request the user kept the document for", async () => {
    const store = await dirtyStore();
    const before = store.getSnapshot().openings;
    const result = store.request(opening("B"));
    await vi.advanceTimersByTimeAsync(0);
    store.cancelPending();
    await result;
    expect(store.getSnapshot().openings).toBe(before);
  });
});

describe("where an opening came from", () => {
  it("sets the origin from the request and clears it with a later opening without one", async () => {
    const store = new EditorStore();
    await store.request({ ...opening("A"), from: "board" });
    expect(store.getSnapshot().origin).toBe("board");
    await store.request(opening("B"));
    expect(store.getSnapshot().origin).toBeNull();
  });

  it("clears the origin when the draft is discarded", async () => {
    const store = new EditorStore();
    await store.request({ ...opening("A"), from: "library" });
    store.discardDraft();
    expect(store.getSnapshot().origin).toBeNull();
  });
});

describe("restoring the stored draft", () => {
  it("restores a draft without unsaved changes silently", async () => {
    vi.mocked(drafts.readDraft).mockResolvedValue(stored("Quiet", false));
    const store = new EditorStore();
    await store.start();
    expect(nameOf(store)).toBe("Quiet");
    expect(store.getSnapshot().restored).toBeNull();
    expect(store.getSnapshot().draft).toBe("saved");
  });

  it("restores a quick read and leaves no timer behind", async () => {
    vi.mocked(drafts.readDraft).mockResolvedValue(stored("Draft"));
    const store = new EditorStore();
    await store.start();
    expect(nameOf(store)).toBe("Draft");
    expect(store.getSnapshot().restored).toContain("Restored the draft");
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not wait forever for storage that never answers", async () => {
    slowDraft();
    const store = new EditorStore();
    const done = store.request(opening("A"));
    await vi.advanceTimersByTimeAsync(RESTORE_WAIT_MS);
    await expect(done).resolves.toBe("opened");
    expect(nameOf(store)).toBe("A");
  });

  it("applies a late draft when nothing was opened or edited meanwhile", async () => {
    const answer = slowDraft();
    const store = new EditorStore();
    const started = store.start();
    await vi.advanceTimersByTimeAsync(RESTORE_WAIT_MS);
    await started;
    answer(stored("Late"));
    await vi.advanceTimersByTimeAsync(0);
    expect(nameOf(store)).toBe("Late");
    expect(store.getSnapshot().restored).toContain("Restored the draft");
  });

  it("keeps a late draft in storage after an opening", async () => {
    const { store, arrive } = await openedBeforeLateDraft();
    await arrive();
    expect(nameOf(store)).toBe("Opened");
    expect(store.getSnapshot().restored).toBeNull();
    expect(drafts.writeDraft).not.toHaveBeenCalled();
  });

  it.each([
    ["an edit", (store: EditorStore) => store.edit((doc) => setTopField(doc, "name", "Changed"))],
    ["text typed in the YAML tab", (store: EditorStore) => store.dispatch({ type: "text", text: "name: Typed\n" })],
  ])("writes the draft after %s, once a late draft was held back", async (_label, change) => {
    const { store, arrive } = await openedBeforeLateDraft();
    await arrive();
    change(store);
    await vi.advanceTimersByTimeAsync(DRAFT_WAIT);
    expect(drafts.writeDraft).toHaveBeenCalledTimes(1);
  });
});

describe("the way back to the view a document came from", () => {
  it("is stored with the draft", async () => {
    const store = new EditorStore();
    await store.request({ ...opening("From the board"), from: "board" });
    await vi.advanceTimersByTimeAsync(DRAFT_WAIT);
    expect(drafts.writeDraft).toHaveBeenLastCalledWith(expect.objectContaining({ origin: "board" }));
  });

  it("comes back with a restored draft", async () => {
    vi.mocked(drafts.readDraft).mockResolvedValue(stored("Restored", true, "library"));
    const store = new EditorStore();
    await store.start();
    expect(store.getSnapshot().origin).toBe("library");
  });

  it("is absent for a draft stored without one, and after a new opening", async () => {
    vi.mocked(drafts.readDraft).mockResolvedValue(stored("Restored", false));
    const store = new EditorStore();
    await store.start();
    expect(store.getSnapshot().origin).toBeNull();
    await store.request({ ...opening("Opened"), from: "board" });
    expect(store.getSnapshot().origin).toBe("board");
    await store.request(opening("Next"));
    expect(store.getSnapshot().origin).toBeNull();
  });
});

describe("the copies of a document outside the browser", () => {
  const boardCopy = (doc: Doc, name = "ball") =>
    ({ kind: "board", name, at: 1, json: writeJson(doc), sha256: "aa" }) as const;
  const downloadCopy = (doc: Doc) => ({ kind: "download", name: "ball.yaml", at: 2, json: writeJson(doc) }) as const;

  it("is stored with the draft and comes back with it", async () => {
    const store = new EditorStore();
    const doc = named("Ball");
    await store.request({ doc, id: "ball", source: "x", saves: { board: boardCopy(doc), file: null } });
    await vi.advanceTimersByTimeAsync(DRAFT_WAIT);
    const written = vi.mocked(drafts.writeDraft).mock.calls.at(-1)?.[0];
    expect(written?.saves?.board?.name).toBe("ball");

    vi.mocked(drafts.readDraft).mockResolvedValue({ ...stored("Ball"), saves: written?.saves as never });
    const restored = new EditorStore();
    await restored.start();
    expect(restored.getSnapshot().state.saves.board?.name).toBe("ball");
  });

  it("counts as unsaved work only while no copy has the content, or the YAML text is not valid", async () => {
    const store = new EditorStore();
    const doc = named("Ball");
    await store.request({ doc, id: "ball", source: "x", saves: { board: boardCopy(doc), file: null } });
    expect(hasUnsavedWork(store.getSnapshot())).toBe(false);
    store.edit((d) => setTopField(d, "name", "Other"));
    expect(hasUnsavedWork(store.getSnapshot())).toBe(true);
    store.dispatch({ type: "undo" });
    expect(hasUnsavedWork(store.getSnapshot())).toBe(false);
    store.dispatch({ type: "text", text: "name: [" });
    expect(hasUnsavedWork(store.getSnapshot())).toBe(true);
  });

  const onBoard = (entries: Array<{ id: string; sha256: string }>): BoardFiles => ({ entries, staleSince: null });

  it("asks when the board's copy is gone and no download is current, and not when the board still has it", async () => {
    const store = new EditorStore();
    const doc = named("Ball");
    await store.request({ doc, id: "ball", source: "x", saves: { board: boardCopy(doc), file: null } });
    const snapshot = store.getSnapshot();
    // No board connected, or the board still has the file: nothing to lose.
    expect(hasUnsavedWork(snapshot, null)).toBe(false);
    expect(hasUnsavedWork(snapshot, onBoard([{ id: "ball", sha256: "aa" }]))).toBe(false);
    // The file is gone, or has other content: the board copy is not a copy any more.
    expect(hasUnsavedWork(snapshot, onBoard([]))).toBe(true);
    expect(hasUnsavedWork(snapshot, onBoard([{ id: "ball", sha256: "bb" }]))).toBe(true);
    // A current download is a second copy.
    await store.request({
      doc,
      id: "ball",
      source: "x",
      saves: { board: boardCopy(doc), file: downloadCopy(doc) },
    });
    expect(hasUnsavedWork(store.getSnapshot(), onBoard([]))).toBe(false);
  });

  it("a new animation with no change has nothing to lose, and one with a change has", async () => {
    const store = new EditorStore();
    await store.request(opening("New"));
    expect(hasUnsavedWork(store.getSnapshot())).toBe(false);
    store.edit((d) => setTopField(d, "name", "Changed"));
    expect(hasUnsavedWork(store.getSnapshot())).toBe(true);
  });

  it("tells the views which board file is the only saved copy of the document", async () => {
    const store = new EditorStore();
    const doc = named("Ball");
    const held: Array<string | null> = [];
    const stop = holding.subscribeHeld(() => held.push(holding.getHeldId()));
    await store.request({ doc, id: "ball", source: "x", saves: { board: boardCopy(doc), file: null } });
    expect(holding.getHeldId()).toBe("ball");
    // A current download is a second copy: the board file is no longer the only one.
    store.saved(doc, downloadCopy(doc));
    expect(holding.getHeldId()).toBeNull();
    // A change makes the copies older versions: the board file is not what the editor holds any more.
    store.edit((d) => setTopField(d, "name", "Other"));
    expect(holding.getHeldId()).toBeNull();
    stop();
    expect(held).toEqual(["ball", null]);
  });
});
