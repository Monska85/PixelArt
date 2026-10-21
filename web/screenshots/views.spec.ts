// Reference images of one main state per view, at 1,280 and 375 px, in both themes. Every state, these included, also
// gets the layout checks of layout.spec.ts. See states.ts for how to add a state, and playwright.screenshots.config.ts.

import { expect } from "../e2e/fixtures";
import { describeStates, THEMES, type StateName } from "./states";

/** The Board (both tabs), Library, Firmware and Editor views, the playlist editor, a confirmation dialog and the
 * connection chip's panel: 8 states, 32 images. */
const CURATED: readonly StateName[] = [
  "board-connected",
  "board-playlists",
  "library-connected",
  "firmware-up-to-date",
  "editor-from-board",
  "board-playlist-editor",
  "board-delete-dialog",
  "chip-connected",
];

describeStates({
  names: CURATED,
  themes: THEMES,
  check: async (page, image) => {
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
