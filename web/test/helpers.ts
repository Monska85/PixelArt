// SPDX-License-Identifier: GPL-3.0-or-later

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const REPO = fileURLToPath(new URL("../../", import.meta.url));

export function readBytes(path: string): Uint8Array {
  return new Uint8Array(readFileSync(path));
}

/** The case files (not the .expected.json ones) of a folder, sorted by name. */
export function caseFiles(folder: string): string[] {
  return readdirSync(folder)
    .filter((name) => name.endsWith(".json") && !name.includes(".expected."))
    .sort()
    .map((name) => `${folder}/${name}`);
}

export function expectedPath(file: string): string {
  return file.replace(/\.json$/, ".expected.json");
}

export const text = (s: string): Uint8Array => new TextEncoder().encode(s);
