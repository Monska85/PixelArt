// The theme choice: System (the default), Dark or Light. The document carries the resolved theme in `data-theme`;
// public/theme-init.js sets it before the first paint, this module keeps it right afterwards.

import { useSyncExternalStore } from "react";

export type ThemeChoice = "system" | "dark" | "light";

const KEY = "pixelart.theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

const isChoice = (value: unknown): value is ThemeChoice => value === "system" || value === "dark" || value === "light";

// Browser storage can be missing or blocked: the choice then lasts until the page closes, and starts on System.
function readChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(KEY);
    return isChoice(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

class Theme {
  private choice: ThemeChoice = readChoice();
  private listeners = new Set<() => void>();
  private query: MediaQueryList | null = null;

  /** Applies the choice to the document and follows the operating system while the choice is System. */
  start(): void {
    if (this.query || typeof window.matchMedia !== "function") return this.apply();
    this.query = window.matchMedia(DARK_QUERY);
    this.query.addEventListener("change", () => this.apply());
    this.apply();
  }

  private apply(): void {
    const dark = this.choice === "dark" || (this.choice === "system" && this.query?.matches === true);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ThemeChoice => this.choice;

  set(choice: ThemeChoice): void {
    this.choice = choice;
    try {
      localStorage.setItem(KEY, choice);
    } catch {
      // Not remembered.
    }
    this.apply();
    for (const listener of this.listeners) listener();
  }
}

export const theme = new Theme();

export const useTheme = (): ThemeChoice => useSyncExternalStore(theme.subscribe, theme.getSnapshot);
