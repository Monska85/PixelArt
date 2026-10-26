// SPDX-License-Identifier: GPL-3.0-or-later

// Change notification for the app's small stores, read with useSyncExternalStore. It imports nothing, so any module
// can use it without pulling in another chunk.

export interface Emitter {
  subscribe: (listener: () => void) => () => void;
  emit: () => void;
}

export function createEmitter(): Emitter {
  const listeners = new Set<() => void>();
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit: () => {
      for (const listener of listeners) listener();
    },
  };
}
