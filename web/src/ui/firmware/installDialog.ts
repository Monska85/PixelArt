// SPDX-License-Identifier: GPL-3.0-or-later

// What the app needs to know about the dialog ESP Web Tools opens, which sends no event for a finished installation.
// Everything that reads the dialog's private state is in this file, and test/install-dialog.test.ts pins it to the
// pinned version of ESP Web Tools (package.json), so an update that changes it fails a test instead of the feature.

import type { SerialPortLike } from "../../protocol/serial";

/** The ESP Web Tools manifest of Install from scratch: the only installation the app follows up. */
export const SCRATCH_MANIFEST = "./firmware/install.json";

const DIALOG = "ewt-install-dialog";

interface InstallDialog {
  localName: string;
  /** Set by ESP Web Tools' `connect`: the port the user picked, already open. */
  port?: unknown;
  manifestPath?: unknown;
  /** Lit state of the dialog: `{ state: "finished" }` once the flashing is done, undefined before and after a restart. */
  _installState?: { state?: unknown };
}

const isPort = (value: unknown): value is SerialPortLike =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as SerialPortLike).open === "function" &&
  typeof (value as SerialPortLike).close === "function";

/**
 * The port of a dialog that closes after Install from scratch finished flashing, or null for any other dialog
 * and for an installation that was canceled, failed or never started.
 */
export function finishedScratchInstall(dialog: unknown): SerialPortLike | null {
  if (typeof dialog !== "object" || dialog === null) return null;
  const { localName, port, manifestPath, _installState } = dialog as InstallDialog;
  if (localName !== DIALOG || manifestPath !== SCRATCH_MANIFEST) return null;
  if (_installState?.state !== "finished") return null;
  return isPort(port) ? port : null;
}

/**
 * Calls `onFinished` with the port when an ESP Web Tools dialog closes after a finished Install from scratch. The
 * dialog's `closed` event bubbles out of its shadow tree and is retargeted to the dialog, so one listener on the
 * document sees it; an event from inside the dialog (another element's own `closed`) is not the dialog's.
 */
export function watchInstallDialogs(
  onFinished: (port: SerialPortLike) => void,
  root: EventTarget = document,
): () => void {
  const listener = (event: Event): void => {
    if (event.composedPath()[0] !== event.target) return;
    const port = finishedScratchInstall(event.target);
    if (port) onFinished(port);
  };
  root.addEventListener("closed", listener);
  return () => root.removeEventListener("closed", listener);
}
