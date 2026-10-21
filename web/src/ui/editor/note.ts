const KEY = "pixelart.editorNote";

// Browser storage can be missing or blocked: then the note shows again next time, not again in this visit.
let dismissedThisVisit = false;

export function noteDismissed(): boolean {
  if (dismissedThisVisit) return true;
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function rememberNoteDismissed(): void {
  dismissedThisVisit = true;
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    // Not remembered.
  }
}
