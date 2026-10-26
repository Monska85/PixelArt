// SPDX-License-Identifier: GPL-3.0-or-later

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vitest/config";
import { licenseFiles, thirdPartyNotices } from "./scripts/notices";
import { repositoryUrl } from "./scripts/repository";

// The Content Security Policy in index.html blocks the inline script that the
// development server needs for live reload, so only builds carry it.
const cspOnlyInBuilds = (): Plugin => ({
  name: "csp-only-in-builds",
  apply: "serve",
  transformIndexHtml: (html) => html.replace(/\s*<meta http-equiv="Content-Security-Policy"[^>]*>/, ""),
});

const repository = repositoryUrl(process.env);

export default defineConfig({
  // Relative URLs: the build works at /PixelArt/ and anywhere else.
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(
      JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version,
    ),
    __REPOSITORY_URL__: JSON.stringify(repository),
  },
  plugins: [react(), tailwindcss(), cspOnlyInBuilds(), ...thirdPartyNotices(repository), licenseFiles()],
  build: { outDir: "dist", sourcemap: false },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
