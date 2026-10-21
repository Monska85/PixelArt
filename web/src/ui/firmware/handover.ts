/**
 * Runs `disconnect` before the click on an ESP Web Tools install button reaches the component.
 *
 * The component opens the serial port as soon as its slot sees the click, and a port can only be open once, so the
 * app's own connection must be closed first. The listener runs in the capture phase, stops the click, waits for
 * `disconnect`, and then repeats the click on the same element (the user's activation is still valid, so the browser
 * still lets the page ask for a port). When nothing is connected the click goes through untouched.
 */
export function closeConnectionBeforeClick(
  host: HTMLElement,
  isConnected: () => boolean,
  disconnect: () => Promise<void>,
): () => void {
  let repeating = false;
  const onClick = (event: Event): void => {
    if (repeating || !isConnected()) return;
    const target = event.target;
    event.stopImmediatePropagation();
    event.preventDefault();
    void disconnect().then(() => {
      repeating = true;
      try {
        if (target instanceof HTMLElement) target.click();
      } finally {
        repeating = false;
      }
    });
  };
  host.addEventListener("click", onClick, true);
  return () => host.removeEventListener("click", onClick, true);
}
