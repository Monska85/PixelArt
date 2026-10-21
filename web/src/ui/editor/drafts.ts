// The draft of the document being edited, kept in IndexedDB. Browser storage can
// be missing or blocked, so every call catches its failure and the editor works
// without it.

import { parseStrictJson, isObject } from "../../engine";
import type { JsonObject } from "../../engine";
import { isSaves, NO_SAVES, type Saves } from "../../editor/saves";

// A draft is the editor's own data and can be nested deeper than the engine accepts (wrapping into a loop
// again and again), so reading it back allows more depth; the engine still reports the depth error.
export const DRAFT_JSON_DEPTH = 128;

/** The document of a stored draft, or null when the text is not a JSON object. */
export function parseDraftDocument(json: string): JsonObject | null {
  const parsed = parseStrictJson(new TextEncoder().encode(json), DRAFT_JSON_DEPTH);
  return parsed.ok && isObject(parsed.value) ? (parsed.value as JsonObject) : null;
}

const DB_NAME = "pixelart-editor";
const STORE = "drafts";
const KEY = "current";

/** The view a document was opened from, so the editor can offer a way back, also after a reload. */
export type DraftOrigin = "board" | "library";

export interface Draft {
  /** The document as strict JSON text. */
  json: string;
  id: string | null;
  source: string;
  /** The document had unsaved changes. A draft stored before this field existed counts as changed. */
  dirty: boolean;
  /** Where the document came from. A draft stored before this field existed has none. */
  origin: DraftOrigin | null;
  /** The copies outside the browser, so the save state is still right after a reload. */
  saves?: Saves;
  savedAt: number;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB is not available"));
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB failed"));
    request.onblocked = () => reject(new Error("IndexedDB is blocked"));
  });
}

async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = action(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB failed"));
      transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB failed"));
    });
  } finally {
    db.close();
  }
}

function isDraft(
  value: unknown,
): value is Omit<Draft, "dirty" | "origin" | "saves"> & { dirty?: boolean; origin?: unknown; saves?: unknown } {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.json === "string" &&
    (v.id === null || typeof v.id === "string") &&
    typeof v.source === "string" &&
    (v.dirty === undefined || typeof v.dirty === "boolean") &&
    typeof v.savedAt === "number"
  );
}

/** The stored draft, or null when there is none or storage does not work. */
export async function readDraft(): Promise<Draft | null> {
  try {
    const value: unknown = await run("readonly", (store) => store.get(KEY));
    if (!isDraft(value)) return null;
    const origin = value.origin === "board" || value.origin === "library" ? value.origin : null;
    // A draft stored before the copies were kept has none.
    const saves = isSaves(value.saves) ? value.saves : NO_SAVES;
    return { ...value, dirty: value.dirty ?? true, origin, saves };
  } catch {
    return null;
  }
}

/** Stores the draft. Returns false when storage does not work. */
export async function writeDraft(draft: Draft): Promise<boolean> {
  try {
    await run("readwrite", (store) => store.put(draft, KEY));
    return true;
  } catch {
    return false;
  }
}

export async function clearDraft(): Promise<void> {
  try {
    await run("readwrite", (store) => store.delete(KEY));
  } catch {
    // Nothing to clear.
  }
}
