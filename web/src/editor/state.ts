// The state of the editor: the document with its undo history, and the text of
// the YAML tab. A pure reducer, so it runs in the tests without a page.

import { isObject } from "../engine/json";
import { readYaml } from "../yaml/read";
import { writeYaml } from "../yaml/writeYaml";
import { writeJson } from "../yaml/writeJson";
import { hasComments } from "./comments";
import { hasCurrentCopy, NO_SAVES, withCopy, type SavedCopy, type Saves } from "./saves";
import { newAnimation, type Doc } from "./doc";

export const MAX_UNDO = 200;

export interface TextError {
  message: string;
  line?: number;
}

export interface EditorState {
  doc: Doc;
  past: Doc[];
  future: Doc[];
  /** Edits with the same group in a row are one undo step. */
  group: string | null;
  /** The YAML tab's text: the last valid document written out, or what the user typed. */
  text: string;
  textError: TextError | null;
  /** The text is what the user typed in the tab, so it may have comments that a rewrite would drop. */
  userText: boolean;
  /** True once a change made in the visual editor rewrote text that had comments. */
  commentsDropped: boolean;
  /** The ID chosen for the file, or null before the first save. */
  id: string | null;
  /** Where the document came from, as text for the user. */
  source: string;
  /** Changed since it was opened or saved. */
  dirty: boolean;
  /** The copies outside the browser: a file on a board, a YAML file. */
  saves: Saves;
}

export type Action =
  | { type: "edit"; doc: Doc; group?: string }
  | { type: "text"; text: string }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "load"; doc: Doc; id: string | null; source: string; dirty?: boolean; saves?: Saves }
  | { type: "setId"; id: string | null }
  /** `doc` is the document that was saved: edits made while the save ran keep the state dirty. */
  | { type: "saved"; doc: Doc; copy: SavedCopy };

export function initialState(
  doc: Doc = newAnimation(),
  id: string | null = null,
  source = "A new animation",
): EditorState {
  return {
    doc,
    past: [],
    future: [],
    group: null,
    text: writeYaml(doc),
    textError: null,
    userText: false,
    commentsDropped: false,
    id,
    source,
    dirty: false,
    saves: NO_SAVES,
  };
}

const sameJson = (a: Doc, b: Doc): boolean => a === b || writeJson(a) === writeJson(b);

// What the YAML tab holds after the document was written out again: no comments, no error.
function rewritten(
  state: EditorState,
  doc: Doc,
): Pick<EditorState, "text" | "textError" | "userText" | "commentsDropped"> {
  return {
    text: writeYaml(doc),
    textError: null,
    userText: false,
    // Looking for comments costs a parse, so it waits until a rewrite would drop them.
    commentsDropped: state.commentsDropped || (state.userText && hasComments(state.text)),
  };
}

// A document edited back to the content of a saved copy has nothing unsaved.
function settled(state: EditorState): EditorState {
  return state.dirty && !state.textError && hasCurrentCopy(state.saves, writeJson(state.doc))
    ? { ...state, dirty: false }
    : state;
}

function push(state: EditorState, doc: Doc, group: string | null): EditorState {
  const coalesce = group !== null && group === state.group && state.past.length > 0;
  const past = coalesce ? state.past : [...state.past, state.doc].slice(-MAX_UNDO);
  return { ...state, doc, past, future: [], group, dirty: true };
}

export function reduce(state: EditorState, action: Action): EditorState {
  switch (action.type) {
    case "edit": {
      if (action.doc === state.doc) return state;
      return settled({ ...push(state, action.doc, action.group ?? null), ...rewritten(state, action.doc) });
    }
    case "text": {
      const read = readYaml(action.text);
      if (!read.ok) {
        const textError: TextError = { message: read.message, ...(read.line !== undefined && { line: read.line }) };
        return { ...state, text: action.text, textError, dirty: true };
      }
      if (!isObject(read.value)) {
        return { ...state, text: action.text, textError: { message: "The document must be a mapping." }, dirty: true };
      }
      const base = { ...state, text: action.text, textError: null, userText: true };
      if (sameJson(read.value, state.doc)) return { ...base, dirty: true };
      return settled(push(base, read.value, "yaml"));
    }
    case "undo":
    case "redo": {
      const from = action.type === "undo" ? state.past : state.future;
      const target = from[from.length - 1];
      if (!target) return state;
      const rest = from.slice(0, -1);
      return settled({
        ...state,
        doc: target,
        past: action.type === "undo" ? rest : [...state.past, state.doc],
        future: action.type === "undo" ? [...state.future, state.doc] : rest,
        group: null,
        ...rewritten(state, target),
        dirty: true,
      });
    }
    case "load":
      return {
        ...initialState(action.doc, action.id, action.source),
        dirty: action.dirty ?? false,
        saves: action.saves ?? NO_SAVES,
      };
    case "setId":
      return { ...state, id: action.id };
    case "saved": {
      // The copy is remembered whatever happened since: it is a real copy of the document it holds.
      const saves = withCopy(state.saves, action.copy);
      return state.doc === action.doc ? { ...state, saves, dirty: false } : { ...state, saves };
    }
  }
}
