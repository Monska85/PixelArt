// SPDX-License-Identifier: GPL-3.0-or-later

import { defineConfig } from "@playwright/test";
import { workers } from "./playwright.workers";

const PORT = 4173;

export default defineConfig({
  testDir: "e2e",
  // Every test starts its own simulator on its own port. `make` and `just` set PIXELART_JOBS (JOBS) for the workers.
  workers: workers(process.env.PIXELART_JOBS),
  fullyParallel: true,
  timeout: 60_000,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  outputDir: "test-results",
  use: {
    baseURL: `http://localhost:${PORT}`,
    browserName: "chromium",
    trace: process.env.CI ? "retain-on-failure" : "off",
    acceptDownloads: true,
  },
  // Serves the built app (npm run build first) with a fixture release next to it, as Pages would. The simulator
  // allows http://localhost:* as an origin.
  webServer: {
    command: "node e2e/serve-site.mjs",
    env: { PORT: String(PORT) },
    url: `http://localhost:${PORT}`,
    timeout: 30_000,
  },
});
