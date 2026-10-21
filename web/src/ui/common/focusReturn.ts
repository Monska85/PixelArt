// A dialog opened from a menu item must give focus back to the button that opened the menu: by the time the dialog
// mounts, the item has gone and `document.activeElement` is no use. Menus note their button here before they act.

let opener: HTMLElement | null = null;

export function rememberOpener(element: HTMLElement | null): void {
  opener = element;
}

/** The control that opened the menu the dialog came from, once. Falls back to the element that has focus. */
export function takeOpener(): Element | null {
  const taken = opener;
  opener = null;
  return taken?.isConnected ? taken : document.activeElement;
}
