import { BoardError, UploadCancelled, type WireDiagnostic } from "../protocol";

export interface ShownError {
  id: number;
  /** What the user was doing. */
  context: string;
  code: string;
  message: string;
  diagnostics: WireDiagnostic[];
  /** The action went through and the board has something to say, so it is shown as a warning, not an error. */
  warning?: boolean;
  /** A summary, not a problem: shown as information. */
  info?: boolean;
  /** One line per group of files, for a summary. */
  lines?: string[];
}

let nextId = 1;

export function toShownError(context: string, error: unknown): ShownError {
  if (error instanceof BoardError)
    return { id: nextId++, context, code: error.code, message: error.message, diagnostics: error.diagnostics };
  if (error instanceof UploadCancelled)
    return { id: nextId++, context, code: "cancelled", message: "Cancelled.", diagnostics: [] };
  return {
    id: nextId++,
    context,
    code: "error",
    message: error instanceof Error ? error.message : "Something went wrong.",
    diagnostics: [],
  };
}

/** The text of an error in a place that has room for one line: the code, then the message. */
export function shownMessage(error: ShownError): string {
  return error.code === "error" || error.code === "cancelled" ? error.message : `${error.code}: ${error.message}`;
}
