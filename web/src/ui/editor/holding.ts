// SPDX-License-Identifier: GPL-3.0-or-later

// Whether the editor holds an animation whose only saved copy is a file on the board. The Board and Firmware views
// read it before they delete that file, and offer "Download YAML first". It is a small module of its own so those
// views do not load the editor's store, which holds the YAML library.

import { useSyncExternalStore } from "react";
import { createEmitter } from "../emitter";

let heldId: string | null = null;
let download: (() => boolean) | null = null;
const changes = createEmitter();

/** The editor says which board file is the only saved copy of its document, or null. */
export function publishHolding(id: string | null, downloader: () => boolean): void {
  download = downloader;
  if (id === heldId) return;
  heldId = id;
  changes.emit();
}

/** Downloads the editor's YAML. False when the editor could not (its YAML tab has an error). */
export const downloadHeld = (): boolean => download?.() ?? false;

export const subscribeHeld = changes.subscribe;

export const getHeldId = (): string | null => heldId;

/** The ID of the animation whose only saved copy is the board file of that ID, or null. */
export const useHeldId = (): string | null => useSyncExternalStore(subscribeHeld, getHeldId);
