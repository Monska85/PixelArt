// SPDX-License-Identifier: GPL-3.0-or-later

// The privacy contract of the app (docs/web/web-app-v1.md#privacy): what the footer, the notes where sensitive data is
// entered and the Privacy view say. A change that sends anything private somewhere else, or adds an outside service,
// must change these texts, the spec and the README in the same change (AGENTS.md).

/** The repository of this build: the one GitHub Actions builds for, else the project's (scripts/repository.ts). */
export const REPOSITORY_URL: string = __REPOSITORY_URL__;

/** The repository address as text, without the scheme: `github.com/owner/name`. */
export function repositoryLabel(url: string): string {
  return url.replace(/^https:\/\//, "");
}

/** The version of this build, the `version` of web/package.json, which release-please sets for each release. */
export const APP_VERSION: string = __APP_VERSION__;

/** The source code of a web app version: the tree of its release tag, or the repository for a build that is not one. */
export function sourceOfVersion(version: string): { url: string; tag: string | null } {
  if (/^\d+\.\d+\.\d+$/.test(version) && version !== "0.0.0")
    return { url: `${REPOSITORY_URL}/tree/web-v${version}`, tag: `web-v${version}` };
  return { url: REPOSITORY_URL, tag: null };
}

export const FOOTER_TEXT =
  "Runs entirely in your browser. Your animations, settings and WiFi details go only to your board. The board itself contacts only its update source and its time server.";

/** Under the Time server field: the one outside host the board asks for the time, and what it learns. */
export const TIME_SERVER_NOTE =
  "The board asks this server for the time when Automatic plays a schedule or the install window is narrower than the whole day. The request carries none of your data; the server sees the board's IP address.";

export const PASSWORD_NOTE = "The password goes straight to the board over USB. It is never sent anywhere else.";

/** On the Network access card, which shows the token the board gives over USB. */
export const TOKEN_CARD_NOTE =
  "Read from the board over USB. The app does not store it or send it anywhere: over WiFi the board checks a code derived from it.";

/** In the login dialog, where the token is typed and then kept in this browser. */
export const TOKEN_LOGIN_NOTE =
  "Kept in this browser to log in again. It is never sent: the board checks a code derived from it.";

/** A thing the app keeps in the browser, by purpose. `key` is the exact name, `<host>` stands for a board address. */
export interface StoredItem {
  kind: "localStorage" | "IndexedDB";
  key: string;
  purpose: string;
}

/** Everything the app writes to browser storage. A test keeps this list equal to the keys in the source. */
export const STORED_ITEMS: readonly StoredItem[] = [
  { kind: "localStorage", key: "pixelart.theme", purpose: "Your choice of System, Dark or Light." },
  {
    kind: "localStorage",
    key: "pixelart.simulator",
    purpose: "The address of the simulator you last typed, so the field is filled in next time.",
  },
  {
    kind: "localStorage",
    key: "pixelart.wifi",
    purpose:
      "The address of your board on your network (its name ending in .local, or the address you typed), from your last WiFi connection or read from the board over USB, so the field is filled in next time.",
  },
  {
    kind: "localStorage",
    key: "pixelart.token.<host>",
    purpose:
      "The token of the board at that address, as written (clear text), kept after you enter it so the app can log in over WiFi again. It is never sent: the board checks a code derived from it.",
  },
  {
    kind: "localStorage",
    key: "pixelart.editorNote",
    purpose: "That you dismissed the note at the top of the Editor.",
  },
  {
    kind: "localStorage",
    key: "pixelart.boardFiles",
    purpose: "Whether the Board view's Files section is open or closed.",
  },
  {
    kind: "IndexedDB",
    key: "pixelart-editor / drafts / current",
    purpose: "The animation you are editing, so a reload does not lose it.",
  },
];
