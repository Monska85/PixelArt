import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

const PORT = 4174;
const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

// The suite has its own board files and its own published release, so a change to the repository's animations never
// moves a reference image. The functional fixtures read PIXELART_DATA for the simulator's files.
process.env.PIXELART_DATA = here("./screenshots/board-files");

// Compares screenshots of every view and its main states with the reference images in screenshots/baselines/. They
// are only comparable when drawn by the same browser build and fonts, so `make web-screenshots` runs this suite in
// the official Playwright container (see README.md in this folder). Run without the container, text renders
// differently and every comparison fails.
export default defineConfig({
  testDir: "screenshots",
  snapshotPathTemplate: "{testDir}/baselines/{arg}{ext}",
  // Every test starts its own simulator on its own port.
  workers: 2,
  fullyParallel: true,
  retries: 0,
  timeout: 60_000,
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never", outputFolder: "playwright-report-screenshots" }]]
    : [["list"]],
  outputDir: "test-results-screenshots",
  expect: {
    toHaveScreenshot: { animations: "disabled", caret: "hide", maxDiffPixelRatio: 0.002 },
  },
  use: {
    baseURL: `http://localhost:${PORT}`,
    browserName: "chromium",
    // The same text everywhere: language, time zone and the clock the pages see.
    locale: "en-GB",
    timezoneId: "UTC",
    contextOptions: { reducedMotion: "reduce" },
    deviceScaleFactor: 1,
    acceptDownloads: true,
    trace: process.env.CI ? "retain-on-failure" : "off",
  },
  webServer: {
    command: "node e2e/serve-site.mjs",
    env: {
      PORT: String(PORT),
      PIXELART_DATA: here("./screenshots/board-files"),
      PIXELART_PUBLISHED: here("./screenshots/site-published.json"),
    },
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
