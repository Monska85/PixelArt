// SPDX-License-Identifier: GPL-3.0-or-later

import { defineConfig } from "@playwright/test";
import screenshots from "./playwright.screenshots.config";

// The layout checks of screenshots/layout.spec.ts: every state of the screenshot suite, with its own board files and
// published release, checked without reference images. Text does not need to render like in the container, so this
// runs on the host with the end-to-end tests.
export default defineConfig({
  ...screenshots,
  testMatch: "layout.spec.ts",
  snapshotPathTemplate: undefined,
  outputDir: "test-results-layout",
  reporter: process.env.CI
    ? [["list"], ["github"], ["html", { open: "never", outputFolder: "playwright-report-layout" }]]
    : [["list"]],
});
