import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vitest/config";

// The Content Security Policy in index.html blocks the inline script that the
// development server needs for live reload, so only builds carry it.
const cspOnlyInBuilds = (): Plugin => ({
  name: "csp-only-in-builds",
  apply: "serve",
  transformIndexHtml: (html) => html.replace(/\s*<meta http-equiv="Content-Security-Policy"[^>]*>/, ""),
});

export default defineConfig({
  // Relative URLs: the build works at /PixelArt/ and anywhere else.
  base: "./",
  plugins: [react(), tailwindcss(), cspOnlyInBuilds()],
  build: { outDir: "dist", sourcemap: false },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
