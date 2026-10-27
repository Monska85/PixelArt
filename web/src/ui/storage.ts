// SPDX-License-Identifier: GPL-3.0-or-later

// Browser storage can be missing or blocked: it is a convenience, never a requirement.

export const SIMULATOR_KEY = "pixelart.simulator";
/** The address of the last board connected over WiFi, or the one the last USB connection read from `status`. */
export const WIFI_KEY = "pixelart.wifi";
/** The token of the board at `host`, kept in this browser to log in over WiFi. It is sent only as an HMAC. */
export const tokenKey = (host: string): string => `pixelart.token.${host}`;

/** Whether the Board view's Files section is open (`"open"`) or closed (`"closed"`), the user's last choice with its button. */
export const BOARD_FILES_KEY = "pixelart.boardFiles";

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

export function removeStored(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing to forget.
  }
}
