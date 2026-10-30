// SPDX-License-Identifier: GPL-3.0-or-later

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { repositoryUrl } from "../scripts/repository";
import {
  FOOTER_TEXT,
  PASSWORD_NOTE,
  REPOSITORY_URL,
  STORED_ITEMS,
  TOKEN_CARD_NOTE,
  TOKEN_LOGIN_NOTE,
  TIME_SERVER_NOTE,
  repositoryLabel,
  sourceOfVersion,
} from "../src/ui/privacy";

const ROOT = new URL("..", import.meta.url).pathname;
const SRC = join(ROOT, "src");

function files(dir: string, pattern: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path, pattern) : pattern.test(name) ? [path] : [];
  });
}
const sources = (): string[] => files(SRC, /\.(ts|tsx)$/);
const text = (path: string): string => readFileSync(path, "utf8");
const where = (path: string): string => relative(SRC, path);
/** The code without its comments, so a word in an explanation is not taken for a call. */
const code = (path: string): string =>
  text(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("the privacy texts", () => {
  it("say what the contract promises", () => {
    expect(FOOTER_TEXT).toBe(
      "Runs entirely in your browser. Your animations, settings and WiFi details go only to your board. The board itself contacts only its update source and its time server.",
    );
    expect(TIME_SERVER_NOTE).toBe(
      "The board asks this server for the time when the board plays a schedule or the install window is narrower than the whole day. The request carries none of your data; the server sees the board's IP address.",
    );
    expect(PASSWORD_NOTE).toBe("The password goes straight to the board over USB. It is never sent anywhere else.");
    expect(TOKEN_CARD_NOTE).toBe(
      "Read from the board over USB. The app does not store it or send it anywhere: over WiFi the board checks a code derived from it.",
    );
    expect(TOKEN_LOGIN_NOTE).toBe(
      "Kept in this browser to log in again. It is never sent: the board checks a code derived from it.",
    );
  });

  it("name the repository the build derives, and write no repository address of their own", () => {
    expect(REPOSITORY_URL).toBe(repositoryUrl(process.env));
    expect(repositoryLabel("https://github.com/Owner/Fork")).toBe("github.com/Owner/Fork");
    for (const path of sources())
      expect(code(path), where(path)).not.toMatch(/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+/);
  });

  it("link the license files the build publishes next to the notices, by relative links", () => {
    const view = text(join(SRC, "ui/privacy/PrivacyView.tsx"));
    expect(view).toContain('href="./LICENSE.txt"');
    expect(view).toContain('href="./LICENSE-EXCEPTION.txt"');
    expect(view).toContain('href="./THIRD_PARTY_NOTICES.txt"');
    expect(view).not.toContain("/blob/main/");
  });
});

describe("what the app keeps in the browser", () => {
  const listed = (kind: string): string[] => STORED_ITEMS.filter((item) => item.kind === kind).map((item) => item.key);

  it("reaches browser storage only through the helpers and the draft module", () => {
    const allowed = new Set(["ui/storage.ts", "ui/editor/drafts.ts", "ui/privacy.ts"]);
    for (const path of sources()) {
      if (allowed.has(where(path))) continue;
      expect(code(path), where(path)).not.toMatch(
        /\b(localStorage|sessionStorage|indexedDB|IDBFactory|caches|cookieStore|navigator\.storage)\b|document\.cookie/,
      );
    }
  });

  it("names every key at the call sites of the helpers, and each one is listed", () => {
    const keyOf: Record<string, string> = {
      SIMULATOR_KEY: "pixelart.simulator",
      WIFI_KEY: "pixelart.wifi",
      BOARD_FILES_KEY: "pixelart.boardFiles",
      "tokenKey(": "pixelart.token.<host>",
    };
    const seen = new Set<string>();
    for (const path of sources()) {
      if (where(path) === "ui/storage.ts") continue;
      for (const call of code(path).matchAll(/\b(readStored|writeStored|removeStored)\(\s*([^,)]*(?:\([^)]*\))?)/g)) {
        const argument = (call[2] as string).trim();
        const named = Object.keys(keyOf).find((name) => argument.startsWith(name));
        if (named) seen.add(keyOf[named] as string);
        else if (argument === "KEY" && where(path) === "ui/theme.ts") seen.add("pixelart.theme");
        else if (argument === "NOTE_KEY" && where(path) === "ui/editor/EditorHeader.tsx")
          seen.add("pixelart.editorNote");
        else if (argument === "key" && where(path) === "ui/session.ts") {
          // The login's key is made in place, from the board's address.
          expect(code(path)).toMatch(/const key = tokenKey\(address\.host\);/);
          seen.add("pixelart.token.<host>");
        } else expect.fail(`${where(path)} uses a key this test does not know: ${argument}`);
      }
    }
    expect([...seen].sort()).toEqual(listed("localStorage").sort());
    // The constants hold what the list says.
    expect(code(join(SRC, "ui/theme.ts"))).toContain('const KEY = "pixelart.theme";');
    expect(code(join(SRC, "ui/editor/EditorHeader.tsx"))).toContain('const NOTE_KEY = "pixelart.editorNote";');
  });

  it("has no other string that looks like a storage key", () => {
    const found = new Set<string>();
    for (const path of sources())
      for (const match of code(path).matchAll(/["'`](pixelart[.-][A-Za-z.-]*(?:\$\{[a-z]+\})?)["'`]/g))
        found.add((match[1] as string).replace(/\$\{[a-z]+\}/, "<host>"));
    // `pixelart-editor` is the IndexedDB name, `pixelart-token` the name of the token field of the login form and `pixelart-XXXX.local` an example in a hint.
    expect([...found].sort()).toEqual(
      [...listed("localStorage"), "pixelart-XXXX.local", "pixelart-editor", "pixelart-token"].sort(),
    );
  });

  describe("when the helpers run", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.resetModules();
    });

    it("write, read and remove only the keys of the list", async () => {
      const store = new Map<string, string>();
      const calls: string[] = [];
      vi.stubGlobal("localStorage", {
        setItem: (key: string, value: string) => (calls.push(key), store.set(key, value)),
        getItem: (key: string) => (calls.push(key), store.get(key) ?? null),
        removeItem: (key: string) => (calls.push(key), store.delete(key)),
      });
      const storage = await import("../src/ui/storage");
      for (const key of [
        storage.SIMULATOR_KEY,
        storage.WIFI_KEY,
        storage.BOARD_FILES_KEY,
        storage.tokenKey("board-1234.local"),
      ]) {
        storage.writeStored(key, "x");
        storage.readStored(key);
        storage.removeStored(key);
      }
      const patterns = listed("localStorage").map(
        (key) => new RegExp(`^${key.replace(/[.]/g, "\\.").replace("<host>", "[^/]+")}$`),
      );
      expect(calls.length).toBe(12);
      for (const key of calls)
        expect(
          patterns.some((p) => p.test(key)),
          key,
        ).toBe(true);
    });

    it("keep the editor draft in the IndexedDB that is listed", async () => {
      const opened: string[] = [];
      vi.stubGlobal("indexedDB", {
        open: (name: string) => {
          opened.push(name);
          const request: { error: Error; onerror?: () => void } = { error: new Error("stub") };
          queueMicrotask(() => request.onerror?.());
          return request;
        },
      });
      const drafts = await import("../src/ui/editor/drafts");
      expect(await drafts.readDraft()).toBeNull();
      await drafts.clearDraft();
      expect(opened).toEqual(["pixelart-editor", "pixelart-editor"]);
      expect(listed("IndexedDB")).toEqual(["pixelart-editor / drafts / current"]);
    });
  });
});

describe("what the app can send out of the browser", () => {
  // The modules that may use each of these: the release modules read the site's own files by relative path, and the
  // protocol module opens the WebSocket to the board the user chose.
  const ONLY_IN: Record<string, string[]> = {
    fetch: ["release/manifest.ts", "release/contentPages.ts", "release/library.ts"],
    // The Privacy view only says that the app opens a WebSocket.
    WebSocket: ["protocol/websocket.ts", "ui/privacy/PrivacyView.tsx"],
  };
  const BANNED_WORDS = [
    "fetch",
    "WebSocket",
    "sendBeacon",
    "XMLHttpRequest",
    "EventSource",
    "WebTransport",
    "RTCPeerConnection",
    "importScripts",
    "serviceWorker",
    "Worker",
    "SharedWorker",
  ];
  const BANNED_PATTERNS: Array<[string, RegExp]> = [
    ["new Image", /\bnew\s+Image\b/],
    ["an assignment to .src", /\.src\s*=[^=]/],
    ["globalThis[", /\bglobalThis\s*\[/],
    ["window[", /\bwindow\s*\[/],
    ["self[", /\bself\s*\[/],
    ["Reflect.", /\bReflect\./],
    ["eval(", /\beval\s*\(/],
    ["new Function", /\bnew\s+Function\b/],
    ["a dynamic import of an address", /\bimport\(\s*["'`]https?:/],
    ["navigator.sendBeacon", /navigator\s*\.\s*sendBeacon/],
  ];

  it("opens connections only in the modules that are listed", () => {
    for (const path of sources()) {
      const body = code(path);
      for (const word of BANNED_WORDS) {
        if ((ONLY_IN[word] ?? []).includes(where(path))) continue;
        expect(body, `${where(path)} uses ${word}`).not.toMatch(new RegExp(`\\b${word}\\b`));
      }
      for (const [name, pattern] of BANNED_PATTERNS) expect(body, `${where(path)} uses ${name}`).not.toMatch(pattern);
    }
  });

  it("calls fetch only with a relative path", () => {
    for (const file of ["release/manifest.ts", "release/contentPages.ts", "release/library.ts"]) {
      const body = code(join(SRC, file));
      expect(body, file).not.toMatch(/\b(fetch|fetchFn)\(\s*["'`]?https?:/);
      expect(body, file).not.toMatch(/\b(fetch|fetchFn)\(\s*["'`]\/\//);
    }
  });

  it("names no address of another site in the source, the page or the styles", () => {
    const urls = (path: string): string[] =>
      [...text(path).matchAll(/(?:https?|wss?):\/\/([A-Za-z0-9.-]+)/g)].map((m) => m[1] as string);
    const hosts = new Set<string>();
    for (const path of [
      ...sources(),
      ...files(SRC, /\.css$/),
      ...files(join(ROOT, "public"), /\.(js|css|html)$/),
      join(ROOT, "index.html"),
    ])
      for (const host of urls(path)) hosts.add(host);
    // The repository comes from the build, so it is not here. The project, the Improv and semver documents named in comments, the simulator's local address and example hosts of the tests.
    expect([...hosts].sort()).toEqual([
      "127.0.0.1",
      "monska85.github.io",
      "owner.github.io",
      "semver.org",
      "www.improv-wifi.com",
    ]);
    expect(urls(join(ROOT, "index.html"))).toEqual([]);
    for (const path of [...files(SRC, /\.css$/), ...files(join(ROOT, "public"), /\.(js|css)$/)])
      expect(urls(path), path).toEqual([]);
  });

  it("is held to its own site and to WebSocket addresses by the content security policy", () => {
    const html = text(join(ROOT, "index.html"));
    const policy = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1] ?? "";
    const directives: Record<string, string[]> = {};
    for (const part of policy.split(";")) {
      const [name, ...tokens] = part.trim().split(/\s+/);
      if (name) directives[name] = tokens;
    }
    // Every directive and every token, so a new directive, a `*`, a scheme-less host or `wss:` fails.
    expect(directives).toEqual({
      "default-src": ["'self'"],
      "script-src": ["'self'"],
      "style-src": ["'self'", "'unsafe-inline'"],
      "img-src": ["'self'"],
      "font-src": ["'self'"],
      "connect-src": ["'self'", "ws:"],
      "object-src": ["'none'"],
      "base-uri": ["'none'"],
      "form-action": ["'none'"],
    });
    expect(html.match(/http-equiv="Content-Security-Policy"/g)).toHaveLength(1);
  });
});

describe("the source of a version of the app", () => {
  it("is the tree of the release tag for a release", () => {
    expect(sourceOfVersion("1.4.0")).toEqual({ url: `${REPOSITORY_URL}/tree/web-v1.4.0`, tag: "web-v1.4.0" });
  });

  it.each(["0.0.0", "1.4.0-dev.3", "", "1.4"])("is the repository for %j, which is not a release", (version) => {
    expect(sourceOfVersion(version)).toEqual({ url: REPOSITORY_URL, tag: null });
  });
});
