let navigations = 0;
if (typeof window !== "undefined") window.addEventListener("hashchange", () => (navigations += 1));

/** Taken before work that awaits, to tell afterwards whether the user went to another view meanwhile. */
export const navigationMark = (): number => navigations;
export const navigatedSince = (mark: number): boolean => navigations !== mark;

let focusHeading = false;

/** Goes to a view and, once it is shown, moves keyboard focus to its heading (for controls that vanish with the old view). */
export function navigateAndFocus(viewId: string): void {
  focusHeading = true;
  window.location.hash = viewId;
}

/** Takes the pending request to focus the heading of the view just shown. */
export function takeFocusRequest(): boolean {
  const requested = focusHeading;
  focusHeading = false;
  return requested;
}
