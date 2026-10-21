import type { Doc } from "../../editor/doc";

/** Applies a change to the document. Changes with the same `group` in a row are one undo step. */
export type Edit = (change: (doc: Doc) => Doc, group?: string) => void;
