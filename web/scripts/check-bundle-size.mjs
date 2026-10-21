// Fails when the JavaScript the page loads at start goes over the budget.
//
// That is the entry chunk index.html names and every chunk it preloads (the modules the entry imports), each gzipped
// on its own, as a browser receives them. Chunks loaded on demand (the editor, ESP Web Tools, the YAML reader, the
// other views) do not count. KB is 1,000 bytes, as Vite reports it.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const BUDGET_KB = 190;
const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");

let html;
try {
  html = readFileSync(join(dist, "index.html"), "utf8");
} catch {
  console.error("dist/index.html is missing: run `npm run build` first.");
  process.exit(2);
}

const files = [
  ...html.matchAll(/<script[^>]*type="module"[^>]*src="\.\/([^"]+)"/g),
  ...html.matchAll(/<link[^>]*rel="modulepreload"[^>]*href="\.\/([^"]+)"/g),
].map((match) => match[1]);

if (files.length === 0) {
  console.error("dist/index.html names no entry script: the build output changed shape.");
  process.exit(2);
}

let total = 0;
for (const file of files) {
  const size = gzipSync(readFileSync(join(dist, file)), { level: 9 }).length;
  total += size;
  console.log(`${(size / 1000).toFixed(1).padStart(7)} KB  ${file}`);
}
const kb = total / 1000;
console.log(`${kb.toFixed(1).padStart(7)} KB  initial JavaScript, gzip (budget ${BUDGET_KB} KB)`);

if (kb > BUDGET_KB) {
  console.error(`Over the budget by ${(kb - BUDGET_KB).toFixed(1)} KB.`);
  process.exit(1);
}
