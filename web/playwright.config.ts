import { defineConfig } from "@playwright/test";

const PORT = 4173;

export default defineConfig({
  testDir: "e2e",
  // The simulator serves one client at a time: tests run one after the other.
  workers: 1,
  fullyParallel: false,
  retries: 0,
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
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
