// SPDX-License-Identifier: GPL-3.0-or-later

export const DEFAULT_SIMULATOR_URL = "ws://127.0.0.1:8765";
const LOOPBACK_HOSTS = ["127.0.0.1", "localhost"];

/** The address to connect to, or an error message. Only ws:// addresses on a loopback host are accepted. */
export function checkSimulatorUrl(text: string): { ok: true; url: string } | { ok: false; message: string } {
  try {
    const url = new URL(text.trim());
    if (url.protocol === "ws:" && LOOPBACK_HOSTS.includes(url.hostname)) return { ok: true, url: url.toString() };
  } catch {
    // Falls through to the message.
  }
  return {
    ok: false,
    message: `The address must look like ${DEFAULT_SIMULATOR_URL}: only ws:// on 127.0.0.1 or localhost is allowed`,
  };
}

/** What the app says when a connection to a board over WiFi fails: the browsers that can and cannot do it. */
export const WIFI_BROWSER_NOTE =
  "Connecting over WiFi is expected to work in Chromium browsers (Chrome, Edge, Opera); Chrome asks to allow access to devices on the local network the first time. Firefox and Safari are expected not to let a page from the internet reach a board.";

const WIFI_ADDRESS_HELP = "Type the board's name (pixelart-XXXX.local) or its IP address, such as 192.168.1.42.";

/** A board's address as the app uses it. `host` is what is remembered and keys the stored token; `url` is the WebSocket's. */
export interface BoardAddress {
  host: string;
  url: string;
}

const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

function validIpv4(text: string): boolean {
  const parts = text.split(".");
  return parts.length === 4 && parts.every((part) => /^(0|[1-9][0-9]{0,2})$/.test(part) && Number(part) <= 255);
}

/**
 * The WebSocket address of a board from what the user typed: a host name or an IPv4 address, with an optional port. A
 * leading `ws://` and a trailing `/ws` or `/` are accepted and dropped. Nothing else is: no user information, no other
 * path, no IPv6 address.
 */
export function parseBoardAddress(text: string): { ok: true; address: BoardAddress } | { ok: false; message: string } {
  const refused = { ok: false as const, message: WIFI_ADDRESS_HELP };
  let rest = text.trim().toLowerCase();
  if (rest.startsWith("ws://")) rest = rest.slice("ws://".length);
  rest = rest.replace(/\/ws\/?$/, "").replace(/\/$/, "");
  const match = /^([a-z0-9.-]+)(?::([0-9]{1,5}))?$/.exec(rest);
  if (!match) return refused;
  const host = match[1] as string;
  const port = match[2];
  if (port !== undefined && (Number(port) < 1 || Number(port) > 65535 || port.startsWith("0"))) return refused;
  if (/^[0-9.]+$/.test(host)) {
    if (!validIpv4(host)) return refused;
  } else if (host.length > 253 || !host.split(".").every((label) => LABEL.test(label))) return refused;
  const shown = port === undefined ? host : `${host}:${port}`;
  return { ok: true, address: { host: shown, url: `ws://${shown}/ws` } };
}
