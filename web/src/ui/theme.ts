// SPDX-License-Identifier: GPL-3.0-or-later

// The theme choice: System (the default), Dark or Light. The document carries the resolved theme in `data-theme`;
// public/theme-init.js sets it before the first paint, this module keeps it right afterwards.

import { useSyncExternalStore } from "react";
import { createEmitter } from "./emitter";
import { readStored, writeStored } from "./storage";

export type ThemeChoice = "system" | "dark" | "light";

const KEY = "pixelart.theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

const isChoice = (value: unknown): value is ThemeChoice => value === "system" || value === "dark" || value === "light";

// Browser storage can be missing or blocked: the choice then lasts until the page closes, and starts on System.
function readChoice(): ThemeChoice {
  const stored = readStored(KEY);
  return isChoice(stored) ? stored : "system";
}

class Theme {
  private choice: ThemeChoice = readChoice();
  private readonly changes = createEmitter();
  private query: MediaQueryList | null = null;

  /** Applies the choice to the document and follows the operating system while the choice is System. */
  start(): void {
    if (this.query) return this.apply();
    this.query = window.matchMedia(DARK_QUERY);
    this.query.addEventListener("change", () => this.apply());
    this.apply();
  }

  private apply(): void {
    const dark = this.choice === "dark" || (this.choice === "system" && this.query?.matches === true);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }

  subscribe = this.changes.subscribe;

  getSnapshot = (): ThemeChoice => this.choice;

  set(choice: ThemeChoice): void {
    this.choice = choice;
    writeStored(KEY, choice);
    this.apply();
    this.changes.emit();
  }
}

export const theme = new Theme();

export const useTheme = (): ThemeChoice => useSyncExternalStore(theme.subscribe, theme.getSnapshot);
