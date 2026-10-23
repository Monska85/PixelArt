// SPDX-License-Identifier: GPL-3.0-or-later

// The network login (docs/protocol/protocol-v1.md#authentication): the token never crosses the network, only the
// HMAC-SHA256 of the board's nonce under it.

/** The token: 16 characters from a-z and 0-9. */
export const TOKEN_PATTERN = /^[a-z0-9]{16}$/;
/** The nonce of `auth_challenge`: 32 lowercase hexadecimal digits. */
export const NONCE_PATTERN = /^[0-9a-f]{32}$/;

export const isToken = (text: string): boolean => TOKEN_PATTERN.test(text);

/** The `hmac` of an `auth` request: HMAC-SHA256 with the token's ASCII bytes as the key and the nonce's as the message. */
export async function loginHmac(token: string, nonce: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(token), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(nonce)));
  return Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** How a client gets the token when the board asks for a login. */
export interface Login {
  /** The token to log in with, or null when there is none and the user gave up. May wait for the user. */
  getToken: () => Promise<string | null>;
  /** The board did not accept the token. */
  refused: () => void;
}
