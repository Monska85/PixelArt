// SPDX-License-Identifier: GPL-3.0-or-later
// The third-party notices of the web app (docs/web/web-app-v1.md, Publishing): rollup-plugin-license lists the
// packages the build bundles, with their license texts, and the build writes them with the fixed entries below as
// THIRD_PARTY_NOTICES.txt at the root of the app. A bundled package whose license is not allowed fails the build.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import license from "rollup-plugin-license";
import type { Plugin } from "vite";
import { DEFAULT_REPOSITORY_URL } from "./repository";

/** The licenses a bundled package may have: permissive ones and those compatible with GPL-3.0-or-later. */
export const ALLOWED_LICENSES = [
  "MIT",
  "ISC",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "0BSD",
  "Apache-2.0",
  "Zlib",
  "GPL-2.0-or-later",
  "GPL-3.0-or-later",
  "MPL-2.0",
];
const LGPL = /^LGPL-(2\.0|2\.1|3\.0)(-only|-or-later|\+)?$/;

/**
 * Whether an SPDX license expression is allowed: one of the alternatives of an OR must be, and every part of an AND.
 * An expression with WITH, or one that cannot be read, is not.
 */
export function licenseAllowed(expression: string | null | undefined): boolean {
  if (!expression) return false;
  const text = expression.trim().replace(/^\((.*)\)$/, "$1");
  if (/\(|\)|\sWITH\s/.test(text)) return false;
  return text
    .split(/\s+OR\s+/)
    .some((alternative) =>
      alternative.split(/\s+AND\s+/).every((id) => ALLOWED_LICENSES.includes(id.trim()) || LGPL.test(id.trim())),
    );
}

/** What the notices need of a bundled package, as rollup-plugin-license describes it. */
export interface BundledPackage {
  name: string | null;
  version: string | null;
  license: string | null;
  licenseText: string | null;
  noticeText: string | null;
  repository: string | { url: string } | null;
  homepage: string | null;
}

/** Software in the bundle that is not an npm package of its own, with its license files in LICENSES/web/. */
export interface FixedEntry {
  name: string;
  version: string;
  license: string;
  source: string;
  note: string;
  files: string[];
}

export const FIXED_ENTRIES: FixedEntry[] = [
  {
    name: "shadcn/ui",
    version: "components copied into web/src/ui/components and changed there",
    license: "MIT",
    source: "https://github.com/shadcn-ui/ui",
    note: "The components of web/src/ui/components are based on shadcn/ui.",
    files: ["shadcn-ui.LICENSE.md"],
  },
  {
    name: "esptool flasher stubs",
    version:
      "as bundled by esptool-js: the stubs of esptool-legacy-flasher-stub v1.3.0 (ESP32, ESP32-C2, C3, C6, C61, H2, S2, S3 and ESP8266), v1.8.0 (ESP32-P4 rc1), v1.10.0 (ESP32-P4) and v1.11.1 (ESP32-C5)",
    license: "GPL-2.0-or-later",
    source: "https://github.com/espressif/esptool-legacy-flasher-stub (the releases named above hold the source code)",
    note: "Small programs that ESP Web Tools loads into the RAM of a board to write its flash. They run on the board, not in the browser.",
    files: ["esptool-legacy-flasher-stub.LICENSE"],
  },
];

/**
 * The license text of a bundled package that ships none, taken from its repository, for that version only: another
 * version without a text fails the build until it is checked again.
 */
export const MISSING_TEXTS: Record<string, string> = {
  // https://github.com/theKashey/react-remove-scroll-bar/blob/7301c160fda44cb8cf2b9fdfde61efad35736196/LICENSE
  "react-remove-scroll-bar@2.3.8": "react-remove-scroll-bar.LICENSE",
  // https://github.com/lit/lit/blob/%40lit-labs/ssr-dom-shim%401.6.0/LICENSE
  "@lit-labs/ssr-dom-shim@1.6.0": "lit.LICENSE",
};

/**
 * Packages published already bundled: their files hold their own dependencies, which the bundler cannot see. Their
 * dependency tree, as installed, is listed with them; type packages hold no code and are left out.
 */
export const PREBUNDLED = ["esp-web-tools"];

const LICENSES_DIR = fileURLToPath(new URL("../../LICENSES/web/", import.meta.url));
const NODE_MODULES = fileURLToPath(new URL("../node_modules/", import.meta.url));

/** The installed dependency tree of a package, itself excluded, read from node_modules as npm resolves it. */
export function dependencyTree(name: string, nodeModules: string = NODE_MODULES): BundledPackage[] {
  const found = new Map<string, BundledPackage>();
  const visit = (dir: string, isRoot: boolean): void => {
    const meta = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
      name: string;
      version: string;
      license?: string;
      repository?: string | { url: string };
      homepage?: string;
      dependencies?: Record<string, string>;
    };
    const key = `${meta.name}@${meta.version}`;
    if (found.has(key)) return;
    if (!isRoot) {
      const files = readdirSync(dir);
      const text = (pattern: RegExp): string | null => {
        const file = files.find((f) => pattern.test(f));
        return file ? readFileSync(join(dir, file), "utf8") : null;
      };
      found.set(key, {
        name: meta.name,
        version: meta.version,
        license: meta.license ?? null,
        licenseText: text(/^(licen[cs]e|copying)/i),
        noticeText: text(/^notice/i),
        repository: meta.repository ?? null,
        homepage: meta.homepage ?? null,
      });
    }
    for (const dependency of Object.keys(meta.dependencies ?? {})) {
      if (dependency.startsWith("@types/")) continue;
      const nested = join(dir, "node_modules", dependency);
      visit(existsSync(nested) ? nested : join(nodeModules, dependency), false);
    }
  };
  visit(join(nodeModules, name), true);
  return [...found.values()];
}

function sourceOf(pkg: BundledPackage): string {
  const repository = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
  return (repository ?? pkg.homepage ?? "").replace(/^git\+/, "").replace(/\.git$/, "") || "not given by the package";
}

/** The notices: the fixed entries, then every bundled package by name, then the license texts, each once. */
export function renderNotices(
  packages: BundledPackage[],
  fixed: FixedEntry[] = FIXED_ENTRIES,
  read: (file: string) => string = (file) => readFileSync(LICENSES_DIR + file, "utf8"),
  missing: Record<string, string> = MISSING_TEXTS,
  repository: string = DEFAULT_REPOSITORY_URL,
): string {
  const texts: Array<{ label: string; text: string }> = [];
  const refer = (label: string, text: string): string => {
    const found = texts.findIndex((t) => t.text === text);
    if (found >= 0) return `[${found + 1}]`;
    texts.push({ label, text });
    return `[${texts.length}]`;
  };
  const entries: string[][] = [];
  for (const entry of fixed) {
    const refs = entry.files.map((file) => refer(`${entry.name}: ${file}`, read(file).trimEnd()));
    entries.push([entry.name, entry.version, entry.license, entry.source, refs.join(", "), entry.note]);
  }
  const sorted = [...packages].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`, "en"));
  const textOf = (pkg: BundledPackage): string | null => {
    if (pkg.licenseText?.trim()) return pkg.licenseText.trimEnd();
    const file = missing[`${pkg.name}@${pkg.version}`];
    return file ? read(file).trimEnd() : null;
  };
  const unlicensed = sorted.filter((pkg) => !textOf(pkg)).map((pkg) => `${pkg.name}@${pkg.version} (${pkg.license})`);
  if (unlicensed.length)
    throw new Error(`no license text in: ${unlicensed.join(", ")} (scripts/notices.ts, MISSING_TEXTS)`);
  for (const pkg of sorted) {
    const refs = [refer(`${pkg.name}: license`, textOf(pkg) as string)];
    if (pkg.noticeText?.trim()) refs.push(refer(`${pkg.name}: notice`, pkg.noticeText.trimEnd()));
    entries.push([pkg.name ?? "", pkg.version ?? "", pkg.license ?? "", sourceOf(pkg), refs.join(", "), ""]);
  }
  const lines = [
    "PixelArt web app: third-party notices",
    "",
    "The PixelArt web app is free software: you can redistribute it and/or modify it under the terms of the GNU",
    "General Public License, version 3 or (at your option) any later version. The source code and LICENSE are at",
    `${repository}.`,
    "",
    "It contains the third-party software below. Each entry names its license; the full texts follow the list,",
    "numbered.",
    "",
  ];
  entries.forEach(([name, version, spdx, source, refs, note], i) => {
    lines.push(`${i + 1}. ${name}`, `   Version: ${version}`, `   License: ${spdx}`, `   Source: ${source}`);
    if (note) lines.push(`   ${note}`);
    lines.push(`   License text: ${refs}`, "");
  });
  lines.push("", "License texts", "=============");
  texts.forEach(({ label, text }, i) => lines.push("", `[${i + 1}] ${label}`, "-".repeat(78), text, ""));
  return lines.join("\n") + "\n";
}

/** The build plugins: the license check of every bundled package, then THIRD_PARTY_NOTICES.txt in the output. */
export function thirdPartyNotices(repository: string): Plugin[] {
  let bundled: BundledPackage[] = [];
  const check = license({
    thirdParty: {
      includePrivate: false,
      multipleVersions: true,
      allow: {
        test: (dependency) => licenseAllowed(dependency.license),
        failOnUnlicensed: true,
        failOnViolation: true,
      },
      output: (dependencies) => {
        bundled = dependencies;
      },
    },
  }) as Plugin;
  return [
    { ...check, apply: "build" },
    {
      name: "third-party-notices",
      apply: "build",
      generateBundle() {
        const listed = new Set(bundled.map((pkg) => `${pkg.name}@${pkg.version}`));
        const inside = PREBUNDLED.flatMap((name) => dependencyTree(name)).filter((pkg) => {
          const key = `${pkg.name}@${pkg.version}`;
          if (listed.has(key)) return false;
          listed.add(key);
          return true;
        });
        const refused = inside.filter((pkg) => !licenseAllowed(pkg.license));
        if (refused.length)
          this.error(
            `license not allowed: ${refused.map((pkg) => `${pkg.name}@${pkg.version} (${pkg.license})`).join(", ")}`,
          );
        this.emitFile({
          type: "asset",
          fileName: "THIRD_PARTY_NOTICES.txt",
          source: renderNotices([...bundled, ...inside], FIXED_ENTRIES, undefined, undefined, repository),
        });
      },
    },
  ];
}

const REPOSITORY_ROOT = fileURLToPath(new URL("../../", import.meta.url));
/** The license files of the repository the app publishes, and the names they get in the output: `.txt`, so a static
 * host serves them as text the browser shows, as it does the notices. */
export const LICENSE_FILES: Record<string, string> = {
  LICENSE: "LICENSE.txt",
  "LICENSE-EXCEPTION": "LICENSE-EXCEPTION.txt",
};

/** The plugin that writes LICENSE.txt and LICENSE-EXCEPTION.txt at the root of the app. A missing file fails the
 * build. The dev server serves the same two paths as plain text, so the links of the Privacy view work there too. */
export function licenseFiles(root: string = REPOSITORY_ROOT): Plugin {
  const served = new Map(Object.entries(LICENSE_FILES).map(([source, fileName]) => [`/${fileName}`, source]));
  return {
    name: "license-files",
    generateBundle() {
      for (const [source, fileName] of Object.entries(LICENSE_FILES)) {
        if (!existsSync(join(root, source))) this.error(`${source} is missing at the root of the repository`);
        this.emitFile({ type: "asset", fileName, source: readFileSync(join(root, source), "utf8") });
      }
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const source = served.get((req.url ?? "").split(/[?#]/)[0]);
        if (!source || !existsSync(join(root, source))) return next();
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end(readFileSync(join(root, source), "utf8"));
      });
    },
  };
}
