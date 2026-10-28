// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useRef } from "react";

/**
 * Gives a button its focus back after a change. The buttons of a list are disabled while the board answers, which
 * takes their focus: the button a keyboard user expects, asked for with `focusLater`, gets it once `ready` is true,
 * and again checked each time `answer` (the board's answer) changes. Each button registers with `ref(key)`.
 */
export function useFocusAfter(ready: boolean, answer: unknown) {
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const wanted = useRef<string | null>(null);

  useEffect(() => {
    const key = wanted.current;
    if (!ready || key === null) return;
    wanted.current = null;
    requestAnimationFrame(() => buttons.current.get(key)?.focus());
  }, [ready, answer]);

  return {
    /** The ref of the button with `key`. */
    ref: (key: string) => (element: HTMLButtonElement | null) => {
      if (element) buttons.current.set(key, element);
      else buttons.current.delete(key);
    },
    /** Asks for the button with `key` to get the focus once the answer is shown; null asks for none. */
    focusLater: (key: string | null): void => {
      wanted.current = key;
    },
  };
}
