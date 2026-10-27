// SPDX-License-Identifier: GPL-3.0-or-later

// Serves what GitHub Pages would: the built app with a fixture release next to it.
//
// The release is made from the repository's data/ (the animations and playlists named in site/published.json, with
// their real sizes and SHA-256) and the ESP Web Tools manifests of site/firmware/. PIXELART_DATA and PIXELART_PUBLISHED
// name other files (the screenshot suite has its own). Set NO_RELEASE=1 to serve the app alone. A path that does not exist answers 404, as on Pages.

import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "..", "dist");
const data = process.env.PIXELART_DATA ?? join(here, "..", "..", "data");
const port = Number(process.env.PORT ?? 4173);

const root = mkdtempSync(join(tmpdir(), "pixelart-site-"));
cpSync(dist, root, { recursive: true });

if (process.env.NO_RELEASE !== "1") {
  const published = JSON.parse(
    readFileSync(process.env.PIXELART_PUBLISHED ?? join(here, "site", "published.json"), "utf8"),
  );
  const describe = (kind, id) => {
    const bytes = readFileSync(join(data, kind, `${id}.json`));
    mkdirSync(join(root, kind), { recursive: true });
    writeFileSync(join(root, kind, `${id}.json`), bytes);
    const name = JSON.parse(bytes.toString("utf8")).name;
    return {
      id,
      name,
      file: `${kind}/${id}.json`,
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  };
  const manifest = {
    format: "pixelart-manifest/1",
    version: published.version,
    // Like the site of a firmware release and a content release: the web app reads only whether firmware is listed.
    ...(published.contentVersion ? { content_version: published.contentVersion } : {}),
    released: "2026-01-01",
    firmware: [
      {
        board: "esp32c3",
        chip: "ESP32-C3",
        part: "app",
        offset: 65536,
        file: `firmware/esp32c3/app-${published.version}.bin`,
        size: 1,
        sha256: "0".repeat(64),
      },
    ],
    animations: published.animations.map((id) => ({ ...describe("animations", id), version: 1 })),
    playlists: published.playlists.map((id) => describe("playlists", id)),
  };
  writeFileSync(join(root, "manifest.json"), JSON.stringify(manifest, null, 2));
  cpSync(join(here, "site", "firmware"), join(root, "firmware"), { recursive: true });
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8", // GitHub Pages serves a .txt file as text, which the browser shows
  ".bin": "application/octet-stream",
};

const server = createServer((request, response) => {
  let path;
  try {
    path = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
  } catch {
    response.writeHead(400, { "content-type": "text/plain" }).end("bad request");
    return;
  }
  let file = normalize(join(root, path === "/" ? "index.html" : path));
  if (file !== root && !file.startsWith(root + sep)) file = "";
  if (!file || !existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404, { "content-type": "text/plain" }).end("not found");
    return;
  }
  response.writeHead(200, {
    "content-type": TYPES[extname(file)] ?? "application/octet-stream",
    "cache-control": "no-cache",
  });
  response.end(readFileSync(file));
});

const stop = () => {
  server.close();
  rmSync(root, { recursive: true, force: true });
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
server.listen(port, "localhost");
