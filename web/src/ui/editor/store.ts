// SPDX-License-Identifier: GPL-3.0-or-later

// The editor's document, shared by the whole app so that it survives a change of
// view (the Board view's Edit button opens a file here), with its draft in the
// browser's storage.

import { useSyncExternalStore } from "react";
import { createEmitter } from "../emitter";
import { writeJson } from "../../yaml/writeJson";
import { newAnimation, type Doc } from "../../editor/doc";
import { deriveSaveState, hasCurrentCopy, type BoardFiles, type SavedCopy, type Saves } from "../../editor/saves";
import { initialState, reduce, type Action, type EditorState } from "../../editor/state";
import { saveBytes } from "../files";
import { publishHolding } from "./holding";
import { clearDraft, parseDraftDocument, readDraft, writeDraft, type Draft, type DraftOrigin } from "./drafts";

/** The view an opening came from, so the editor can offer a way back. */

export interface Opening {
  doc: Doc;
  id: string | null;
  source: string;
  from?: DraftOrigin;
  /** The copies the document already has outside the browser: the board file it came from, or its file. */
  saves?: Saves;
}

type DraftStatus = "none" | "saving" | "saved" | "unavailable";

interface EditorSnapshot {
  state: EditorState;
  /** An opening waiting for the user to agree to replace the document being edited. */
  pending: Opening | null;
  /** A note about a draft restored when the page loaded. */
  restored: string | null;
  draft: DraftStatus;
  /** The view the document being edited was opened from, or null (the menu, a file, a new animation). */
  origin: DraftOrigin | null;
  /** Counts the documents opened, so what belongs to one document can start over with the next. */
  openings: number;
}

/** The name of a document for a message: its `name`, or where it came from. */
export function documentName(doc: Doc, fallback: string): string {
  const name = doc.get("name");
  return typeof name === "string" && name !== "" ? name : fallback;
}

/** What became of a request: the document was opened, the user kept the one being edited, or a newer request took over. */
type RequestResult = "opened" | "kept" | "superseded";

const DRAFT_DELAY_MS = 400;
/** How long an opening waits for the stored draft. Storage that never answers must not keep the user from opening anything. */
export const RESTORE_WAIT_MS = 3000;

export class EditorStore {
  private snapshot: EditorSnapshot = {
    state: initialState(),
    pending: null,
    restored: null,
    draft: "none",
    origin: null,
    openings: 0,
  };
  private readonly changes = createEmitter();
  private starting: Promise<void> | null = null;
  /**
   * Resolves the one request waiting for the user's answer. Invariant: it is set exactly while `snapshot.pending` is
   * set by `request`, there is at most one, and every path that clears `pending` (confirm, cancel, a newer request,
   * an opening, a discarded draft) takes it with `takeWaiting` and resolves it.
   */
  private waiting: ((result: RequestResult) => void) | null = null;
  /** The stored draft did not answer in time and was not applied: it stays in storage until the user's next edit. */
  private holdDraft = false;
  private drafting = true;
  private timer: ReturnType<typeof setTimeout> | null = null;

  subscribe = this.changes.subscribe;

  getSnapshot = (): EditorSnapshot => this.snapshot;

  private set(patch: Partial<EditorSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.changes.emit();
  }

  /**
   * Brings back the stored draft, once, when the app starts. Every opening waits for it, so a draft is never
   * replaced behind the user's back and never replaces an opening.
   */
  start(): Promise<void> {
    this.starting ??= this.restore();
    return this.starting;
  }

  private async restore(): Promise<void> {
    const untouched = this.snapshot.state;
    const read = readDraft();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const first = await Promise.race([
      read,
      new Promise<"late">((resolve) => {
        timer = setTimeout(resolve, RESTORE_WAIT_MS, "late");
      }),
    ]);
    clearTimeout(timer);
    if (first !== "late") {
      this.applyDraft(first, untouched);
      return;
    }
    // A late draft is applied only when nothing was opened or edited meanwhile. Otherwise it stays in storage, not
    // overwritten by the opening, until the user's next edit replaces it.
    this.holdDraft = true;
    void read.then((draft) => this.applyDraft(draft, untouched));
  }

  private applyDraft(draft: Draft | null, untouched: EditorState): void {
    if (!draft || this.snapshot.state !== untouched) return;
    const doc = parseDraftDocument(draft.json);
    if (!doc) return;
    this.holdDraft = false;
    this.dispatch({ type: "load", doc, id: draft.id, source: draft.source, dirty: draft.dirty, saves: draft.saves });
    // The draft just read is what storage already holds: writing it back would only race a discard.
    this.cancelTimer();
    this.set({ draft: "saved", origin: draft.origin });
    if (draft.dirty) {
      const when = new Date(draft.savedAt).toLocaleString("en-GB");
      this.set({ restored: `Restored the draft saved in this browser on ${when}.` });
    }
  }

  dispatch = (action: Action): void => {
    const before = this.snapshot.state;
    const state = reduce(before, action);
    if (state === before) return;
    this.set({ state });
    this.publishHolding();
    if (action.type !== "load") this.holdDraft = false;
    if (this.holdDraft) return;
    if (state.doc !== before.doc || state.id !== before.id || state.dirty !== before.dirty || action.type === "load")
      this.scheduleDraft();
  };

  // The Board and Firmware views warn before they delete the board file that is this document's only saved copy.
  private publishHolding(): void {
    const { doc, saves } = this.snapshot.state;
    const board = saves.board;
    if (!board || board.json !== writeJson(doc) || (saves.file && saves.file.json === board.json))
      return publishHolding(null, this.holdingDownload);
    publishHolding(board.name, this.holdingDownload);
  }

  private holdingDownload = (): boolean => {
    const id = this.snapshot.state.saves.board?.name;
    return id !== undefined && this.downloadYaml(id);
  };

  /**
   * Downloads the YAML the tab shows and remembers it as a copy. False, and nothing downloaded, while the tab has an
   * error: the file would not match what is on screen.
   */
  downloadYaml(id: string): boolean {
    const { state } = this.snapshot;
    if (state.textError) return false;
    const name = `${id}.yaml`;
    saveBytes(new TextEncoder().encode(state.text), name, "application/yaml");
    this.dispatch({
      type: "saved",
      doc: state.doc,
      copy: { kind: "download", name, at: Date.now(), json: writeJson(state.doc) },
    });
    return true;
  }

  saved(doc: Doc, copy: SavedCopy): void {
    this.dispatch({ type: "saved", doc, copy });
  }

  edit(change: (doc: Doc) => Doc, group?: string): void {
    this.dispatch({ type: "edit", doc: change(this.snapshot.state.doc), ...(group !== undefined && { group }) });
  }

  /** Opens a document now, replacing the one being edited. */
  openNow(opening: Opening): void {
    this.takeWaiting()?.("superseded");
    this.load(opening);
  }

  private load(opening: Opening): void {
    const { from, ...document } = opening;
    this.dispatch({ type: "load", ...document });
    this.set({ pending: null, restored: null, origin: from ?? null, openings: this.snapshot.openings + 1 });
  }

  /**
   * Opens a document, or asks the user first when the one being edited has unsaved changes. Resolves with what
   * became of the request; a request replaced by a newer one resolves as "superseded".
   */
  async request(opening: Opening): Promise<RequestResult> {
    await this.start();
    this.takeWaiting()?.("superseded");
    if (!this.snapshot.state.dirty) {
      this.load(opening);
      return "opened";
    }
    return new Promise<RequestResult>((resolve) => {
      this.waiting = resolve;
      this.set({ pending: opening });
    });
  }

  confirmPending(): void {
    const pending = this.snapshot.pending;
    const waiting = this.takeWaiting();
    if (pending) this.load(pending);
    waiting?.(pending ? "opened" : "superseded");
  }

  cancelPending(): void {
    this.set({ pending: null });
    this.takeWaiting()?.("kept");
  }

  private takeWaiting(): ((result: RequestResult) => void) | null {
    const waiting = this.waiting;
    this.waiting = null;
    return waiting;
  }

  dismissRestored(): void {
    this.set({ restored: null });
  }

  /**
   * Stops writing drafts for good, dropping a pending or not yet started write. For a page about to reload after it
   * cleared the stored draft: a write landing after the clear would bring the draft back.
   */
  stopDrafting(): void {
    this.drafting = false;
    this.cancelTimer();
  }

  private cancelTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Throws the stored draft away and starts from the template. */
  discardDraft(): void {
    this.cancelTimer();
    this.holdDraft = false;
    void clearDraft();
    this.openNow({ doc: newAnimation(), id: null, source: "A new animation" });
  }

  private scheduleDraft(): void {
    if (!this.drafting) return;
    if (this.timer) clearTimeout(this.timer);
    this.set({ draft: "saving" });
    this.timer = setTimeout(() => void this.writeNow(), DRAFT_DELAY_MS);
  }

  private async writeNow(): Promise<void> {
    this.timer = null;
    if (!this.drafting) return;
    const { doc, id, source, dirty, saves } = this.snapshot.state;
    const { origin } = this.snapshot;
    const ok = await writeDraft({ json: writeJson(doc), id, source, dirty, origin, saves, savedAt: Date.now() });
    if (this.timer === null) this.set({ draft: ok ? "saved" : "unavailable" });
  }
}

export const editorStore = new EditorStore();

/**
 * Work that exists nowhere but this browser: changes that no copy has, a YAML text that is not valid, or a document
 * whose only current copy is a board file that the connected board no longer has or whose list is not confirmed.
 */
export function hasUnsavedWork({ state }: EditorSnapshot, board: BoardFiles = null): boolean {
  const json = writeJson(state.doc);
  const kind = deriveSaveState(state.saves, json, board).kind;
  if (kind === "not-on-board" || kind === "unchecked") return true;
  return state.dirty && (state.textError !== null || !hasCurrentCopy(state.saves, json));
}

/**
 * Leaving the page (closing the tab, reloading) asks the browser's standard question while work is saved nowhere.
 * Registered by the app shell, which knows where the board's files are kept. Returns the way to stop.
 */
export function watchLeaving(getBoardFiles: () => BoardFiles): () => void {
  const onUnload = (event: BeforeUnloadEvent): void => {
    if (!hasUnsavedWork(editorStore.getSnapshot(), getBoardFiles())) return;
    event.preventDefault();
    // Older browsers show the question only when a return value is set.
    event.returnValue = "";
  };
  window.addEventListener("beforeunload", onUnload);
  return () => window.removeEventListener("beforeunload", onUnload);
}

export function useEditor(): EditorSnapshot {
  return useSyncExternalStore(editorStore.subscribe, editorStore.getSnapshot);
}
