// SPDX-License-Identifier: GPL-3.0-or-later

// Reference images of one main state per view, at 1,280 and 375 px, in both themes. Every state, these included, also
// gets the layout checks of layout.spec.ts. See states.ts for how to add a state, and playwright.screenshots.config.ts.

import { expect } from "../e2e/fixtures";
import { describeStates, THEMES, type StateName } from "./states";

/** The Board (the Files section closed, and open on both tabs), Library with its schedule list, Firmware and Editor,
 * the playlist editor, a confirmation dialog and the connection chip's panel: 10 states, 40 images. */
const CURATED: readonly StateName[] = [
  "board-connected",
  "board-files-open",
  "board-playlists",
  "library-connected",
  "library-schedules",
  "firmware-up-to-date",
  "editor-from-board",
  "board-playlist-editor",
  "board-delete-dialog",
  "chip-connected",
];

// Release PRs change the real version. Check its form, then use a neutral label in reference images.
const SCREENSHOT_VERSION_LABEL = "Web app vX.Y.Z";
const SEMVER_VERSION =
  /^Web app v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

describeStates({
  names: CURATED,
  themes: THEMES,
  check: async (page, image) => {
    const version = page.getByTestId("footer-version");
    await expect(version).toHaveText(SEMVER_VERSION);
    await version.evaluate((element, label) => {
      element.textContent = label;
    }, SCREENSHOT_VERSION_LABEL);
    // Fonts loaded and two frames drawn, so a dialog that has just opened has settled.
    await page.evaluate(() =>
      document.fonts.ready.then(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      ),
    );
    await expect(page).toHaveScreenshot(image, {
      fullPage: true,
      // Pixels that move with time: the animation that plays, its frame number and its timeline item.
      mask: [
        page.locator("canvas"),
        page.getByTestId("frame-info"),
        page.getByTestId("preview-frame"),
        page.getByTestId("preview-item"),
      ],
    });
  },
});
