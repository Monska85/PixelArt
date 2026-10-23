import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

const PORT = 4174;
const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

// The suite has its own board files and its own published release, so a change to the repository's animations never
// moves a reference image. The functional fixtures read PIXELART_DATA for the simulator's files.
process.env.PIXELART_DATA = here("./screenshots/board-files");

// Compares one main state per view (screenshots/views.spec.ts) with the reference images in screenshots/baselines/. They
// are only comparable when drawn by the same browser build and fonts, so `make web-screenshots` runs this suite in
// the official Playwright container (see README.md in this folder). Run without the container, text renders
// differently and every comparison fails.
export default defineConfig({
  testDir: "screenshots",
  testMatch: "views.spec.ts",
  snapshotPathTemplate: "{testDir}/baselines/{arg}{ext}",
  // Every test starts its own simulator on its own port.
  workers: 2,
  fullyParallel: true,
  timeout: 60_000,
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never", outputFolder: "playwright-report-screenshots" }]]
    : [["list"]],
  outputDir: "test-results-screenshots",
  expect: {
    // A count, not a share of the page: a share of a long page hid a mark 76 px out of place.
    toHaveScreenshot: { animations: "disabled", caret: "hide", maxDiffPixels: 20 },
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
      PIXELART_PUBLISHED: here("./screenshots/site-published.json"),
    },
    url: `http://localhost:${PORT}`,
    timeout: 30_000,
  },
});
