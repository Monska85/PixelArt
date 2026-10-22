// Browser storage can be missing or blocked: it is a convenience, never a requirement.

export const SIMULATOR_KEY = "pixelart.simulator";

export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not remembered.
  }
}
