// SPDX-License-Identifier: GPL-3.0-or-later
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FIXED_ENTRIES,
  MISSING_TEXTS,
  dependencyTree,
  licenseAllowed,
  licenseFiles,
  renderNotices,
  type BundledPackage,
} from "../scripts/notices";

const pkg = (name: string, license: string | null, licenseText: string | null): BundledPackage => ({
  name,
  version: "1.0.0",
  license,
  licenseText,
  noticeText: null,
  repository: { url: `git+https://example.org/${name}.git` },
  homepage: null,
});

describe("the license allowlist", () => {
  it.each([
    "MIT",
    "ISC",
    "0BSD",
    "BSD-2-Clause",
    "BSD-3-Clause",
    "Apache-2.0",
    "Zlib",
    "MPL-2.0",
    "GPL-2.0-or-later",
    "GPL-3.0-or-later",
    "LGPL-2.1-or-later",
    "LGPL-3.0-only",
    "(MIT AND Zlib)",
    "MIT OR GPL-3.0-only",
  ])("allows %s", (expression) => {
    expect(licenseAllowed(expression)).toBe(true);
  });

  it.each([
    null,
    "",
    "GPL-2.0-only",
    "GPL-3.0-only",
    "AGPL-3.0-or-later",
    "SSPL-1.0",
    "UNLICENSED",
    "MIT AND SSPL-1.0",
    "GPL-2.0-or-later WITH Classpath-exception-2.0",
    "(MIT OR (Apache-2.0 AND SSPL-1.0))",
  ])("refuses %s", (expression) => {
    expect(licenseAllowed(expression)).toBe(false);
  });
});

describe("the notices", () => {
  const read = (file: string): string => `text of ${file}`;

  it("lists the fixed entries first, then the packages by name, and gives every text once", () => {
    const text = renderNotices(
      [pkg("zeta", "MIT", "MIT text"), pkg("alpha", "ISC", "MIT text")],
      FIXED_ENTRIES,
      read,
      {},
    );
    const order = [...text.matchAll(/^\d+\. (.*)$/gm)].map((m) => m[1]);
    expect(order).toEqual([...FIXED_ENTRIES.map((e) => e.name), "alpha", "zeta"]);
    expect(text.split("MIT text").length - 1).toBe(1);
    expect(text).toContain("Source: https://example.org/alpha");
    for (const entry of FIXED_ENTRIES) for (const file of entry.files) expect(text).toContain(`text of ${file}`);
    expect(text).toContain("GNU\nGeneral Public License, version 3 or (at your option) any later version");
  });

  it("names the repository of the build in the header", () => {
    expect(renderNotices([], [], read, {})).toContain(
      "The source code and LICENSE are at\nhttps://github.com/Monska85/PixelArt.",
    );
    expect(renderNotices([], [], read, {}, "https://github.com/Owner/Fork")).toContain(
      "The source code and LICENSE are at\nhttps://github.com/Owner/Fork.",
    );
  });

  it("fails for a package that ships no license text and is not in the list of missing texts", () => {
    expect(() => renderNotices([pkg("bare", "MIT", null)], [], read, {})).toThrow("bare@1.0.0 (MIT)");
  });

  it("takes the text of a package that ships none from the list, for that version only", () => {
    const text = renderNotices([pkg("bare", "MIT", null)], [], read, { "bare@1.0.0": "bare.LICENSE" });
    expect(text).toContain("text of bare.LICENSE");
    expect(() =>
      renderNotices([{ ...pkg("bare", "MIT", null), version: "1.0.1" }], [], read, { "bare@1.0.0": "x" }),
    ).toThrow();
  });

  it("finds every text the fixed entries and the list of missing texts name, in LICENSES/web/", () => {
    const files = [...FIXED_ENTRIES.flatMap((entry) => entry.files), ...Object.values(MISSING_TEXTS)];
    expect(files.length).toBeGreaterThan(0);
    for (const file of files)
      expect(readFileSync(new URL(`../../LICENSES/web/${file}`, import.meta.url), "utf8").trim()).not.toBe("");
    expect(Object.keys(MISSING_TEXTS).every((key) => /@\d+\.\d+\.\d+$/.test(key))).toBe(true);
  });
});

describe("the dependency tree of a prebundled package", () => {
  let dir = "";
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const write = (path: string, meta: object, files: Record<string, string> = {}): void => {
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, "package.json"), JSON.stringify(meta));
    for (const [name, text] of Object.entries(files)) writeFileSync(join(path, name), text);
  };

  it("lists every dependency once, nested copies first, and leaves out type packages and the package itself", () => {
    dir = mkdtempSync(join(tmpdir(), "notices-"));
    write(join(dir, "tool"), { name: "tool", version: "1.0.0", dependencies: { a: "^1", b: "^2", "@types/x": "^1" } });
    write(
      join(dir, "tool", "node_modules", "a"),
      { name: "a", version: "1.5.0", license: "MIT" },
      { LICENSE: "a text" },
    );
    write(join(dir, "a"), { name: "a", version: "0.1.0", license: "MIT" }, { LICENSE: "old a" });
    write(
      join(dir, "b"),
      { name: "b", version: "2.0.0", license: "ISC", dependencies: { a: "^1" } },
      { "LICENSE.md": "b text", NOTICE: "b notice" },
    );
    write(join(dir, "@types", "x"), { name: "@types/x", version: "1.0.0", license: "MIT" });
    const tree = dependencyTree("tool", dir);
    expect(tree.map((p) => `${p.name}@${p.version}`).sort()).toEqual(["a@0.1.0", "a@1.5.0", "b@2.0.0"]);
    const b = tree.find((p) => p.name === "b");
    expect(b?.licenseText).toBe("b text");
    expect(b?.noticeText).toBe("b notice");
  });
});

describe("the license files of the repository", () => {
  let dir = "";
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const generate = (root: string) => {
    const emitted: { fileName: string; source: string }[] = [];
    const context = {
      error: (message: string): never => {
        throw new Error(message);
      },
      emitFile: (file: { fileName: string; source: string }) => void emitted.push(file),
    };
    const hook = licenseFiles(root).generateBundle as unknown as (this: typeof context) => void;
    hook.call(context);
    return emitted;
  };

  it("fails the build when LICENSE or LICENSE-EXCEPTION is missing", () => {
    dir = mkdtempSync(join(tmpdir(), "licenses-"));
    expect(() => generate(dir)).toThrow("LICENSE is missing");
    writeFileSync(join(dir, "LICENSE"), "license text");
    expect(() => generate(dir)).toThrow("LICENSE-EXCEPTION is missing");
  });

  it("emits LICENSE.txt and LICENSE-EXCEPTION.txt with the content of the files, and nothing else", () => {
    dir = mkdtempSync(join(tmpdir(), "licenses-"));
    writeFileSync(join(dir, "LICENSE"), "license text");
    writeFileSync(join(dir, "LICENSE-EXCEPTION"), "exception text");
    expect(generate(dir)).toEqual([
      { type: "asset", fileName: "LICENSE.txt", source: "license text" },
      { type: "asset", fileName: "LICENSE-EXCEPTION.txt", source: "exception text" },
    ]);
  });

  it("serves both files as text in the dev server and lets every other path through", () => {
    dir = mkdtempSync(join(tmpdir(), "licenses-"));
    writeFileSync(join(dir, "LICENSE"), "license text");
    writeFileSync(join(dir, "LICENSE-EXCEPTION"), "exception text");
    let handler: (req: { url?: string }, res: object, next: () => void) => void = () => {};
    const server = { middlewares: { use: (fn: typeof handler) => (handler = fn) } };
    (licenseFiles(dir).configureServer as unknown as (server: unknown) => void)(server);
    const ask = (url: string) => {
      const res = { setHeader: vi.fn(), end: vi.fn() };
      const next = vi.fn();
      handler({ url }, res, next);
      return { res, next };
    };
    const license = ask("/LICENSE.txt?t=1");
    expect(license.res.setHeader).toHaveBeenCalledWith("Content-Type", "text/plain; charset=utf-8");
    expect(license.res.end).toHaveBeenCalledWith("license text");
    expect(ask("/LICENSE-EXCEPTION.txt").res.end).toHaveBeenCalledWith("exception text");
    expect(ask("/LICENSE").next).toHaveBeenCalled();
    expect(ask("/index.html").next).toHaveBeenCalled();
  });
});
