// SPDX-License-Identifier: GPL-3.0-or-later

import { existsSync, rmSync, writeFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { animations, connectSimulator, expect, showPlaylists, stored, test, toastWith } from "./fixtures";

// The stored playlist `default` (also the active one) names both animations below. snowflake is published in the fixture
// release; bear is not.
const PUBLISHED = "snowflake";
const UNPUBLISHED = "bear";

const playlistRow = (page: Page) =>
  page.getByRole("table", { name: "Playlists on the board" }).locator("tr", { hasText: "Christmas" });
const badge = (page: Page) => page.getByTestId("missing-default");
const activeNote = (page: Page) => page.getByTestId("active-missing");

test("a playlist row says how many animations are missing, with the list in a tooltip", async ({ page, simulator }) => {
  rmSync(stored(simulator, "animations", PUBLISHED));
  rmSync(stored(simulator, "animations", UNPUBLISHED));
  await connectSimulator(page, simulator);
  await showPlaylists(page);

  // Icon and word, not color alone.
  await expect(badge(page)).toHaveText("2 missing");
  await expect(badge(page)).toHaveAccessibleName(`Missing 2 animations: ${PUBLISHED}, ${UNPUBLISHED}`);
  await badge(page).focus();
  const tip = page.getByTestId("missing-tip-default");
  await expect(tip).toContainText(PUBLISHED);
  await expect(tip).toContainText(`${UNPUBLISHED} (not available in the Library)`);
  await expect(tip).not.toContainText(`${PUBLISHED} (not available`);
});

test("a playlist missing hundreds of animations lists ten in the tooltip and keeps every name for screen readers", async ({
  page,
  simulator,
}) => {
  const names = Array.from({ length: 300 }, (_, i) => `absent_${String(i + 1).padStart(3, "0")}`);
  writeFileSync(
    stored(simulator, "playlists", "default"),
    JSON.stringify({
      format: "pixelart-playlist/1",
      name: "Christmas",
      canvas: { width: 16, height: 16 },
      items: names.map((animation) => ({ animation })),
    }),
  );
  await connectSimulator(page, simulator);
  await showPlaylists(page);

  await expect(badge(page)).toHaveText("300 missing");
  await expect(badge(page)).toHaveAccessibleName(new RegExp(`Missing 300 animations: .*${names[299]}$`));
  await badge(page).focus();
  const tip = page.getByTestId("missing-tip-default");
  await expect(tip.getByRole("listitem")).toHaveCount(10);
  await expect(tip).toContainText("and 290 more");

  const full = await activeNote(page).locator(".sr-only").first().textContent();
  expect(full).toBe(names.join(", "));
});

test("no badge is shown for a playlist that lacks nothing", async ({ page, simulator }) => {
  await connectSimulator(page, simulator);
  await showPlaylists(page);
  await expect(playlistRow(page)).toBeVisible();
  await expect(page.getByTestId(/^missing-/)).toHaveCount(0);
  await expect(activeNote(page)).toHaveCount(0);
});

test("deleting an animation a playlist uses shows the badge, and Install missing in Settings brings it back", async ({
  page,
  simulator,
}) => {
  await connectSimulator(page, simulator);
  await animations(page)
    .getByRole("button", { name: `More actions for ${PUBLISHED}` })
    .click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await showPlaylists(page);
  await expect(badge(page)).toHaveText("1 missing");
  await expect(activeNote(page)).toContainText(`missing 1 animation: ${PUBLISHED}`);
  await expect(activeNote(page)).not.toContainText("Not available in the Library");

  await activeNote(page).getByRole("button", { name: "Install missing" }).click();
  await expect(toastWith(page, `Installed animation ${PUBLISHED}`)).toBeVisible();
  expect(existsSync(stored(simulator, "animations", PUBLISHED))).toBe(true);
  await expect(page.getByTestId(/^missing-/)).toHaveCount(0);
  await expect(activeNote(page)).toHaveCount(0);
});

test("the editor marks each missing item and offers Install for a published one", async ({ page, simulator }) => {
  rmSync(stored(simulator, "animations", PUBLISHED));
  rmSync(stored(simulator, "animations", UNPUBLISHED));
  await connectSimulator(page, simulator);
  await showPlaylists(page);
  await playlistRow(page).getByRole("button", { name: "Edit default", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Edit playlist default" });

  await expect(panel.getByTestId(/^item-missing-/)).toHaveCount(2);
  await expect(panel.getByTestId(/^item-missing-/).first()).toHaveText("Not stored");
  await expect(panel.getByRole("button", { name: `Install ${PUBLISHED}` })).toBeEnabled();
  await expect(panel.getByRole("button", { name: `Install ${UNPUBLISHED}` })).toHaveCount(0);
  await expect(panel.getByText("Not available in the Library")).toHaveCount(1);

  await panel.getByRole("button", { name: `Install ${PUBLISHED}` }).click();
  await expect(toastWith(page, `Installed animation ${PUBLISHED}`)).toBeVisible();
  await expect(panel.getByTestId(/^item-missing-/)).toHaveCount(1);
  expect(existsSync(stored(simulator, "animations", PUBLISHED))).toBe(true);
});

test("Install missing on the row sends the published ones through the queue and lists the others", async ({
  page,
  simulator,
}) => {
  rmSync(stored(simulator, "animations", PUBLISHED));
  rmSync(stored(simulator, "animations", UNPUBLISHED));
  await connectSimulator(page, simulator);
  await showPlaylists(page);

  await expect(activeNote(page)).toContainText(`missing 2 animations: ${PUBLISHED}, ${UNPUBLISHED}`);
  await expect(activeNote(page)).toContainText(`Not available in the Library: ${UNPUBLISHED}.`);
  await playlistRow(page).getByRole("button", { name: "Install missing animations of default" }).click();
  await expect(toastWith(page, `Installed animation ${PUBLISHED}`)).toBeVisible();
  expect(existsSync(stored(simulator, "animations", PUBLISHED))).toBe(true);
  expect(existsSync(stored(simulator, "animations", UNPUBLISHED))).toBe(false);

  // What the Library cannot bring stays marked, and the button goes because nothing is left to install.
  await expect(badge(page)).toHaveText("1 missing");
  await badge(page).focus();
  await expect(page.getByTestId("missing-tip-default")).toContainText(`${UNPUBLISHED} (not available in the Library)`);
  await expect(page.getByRole("button", { name: "Install missing animations of default" })).toHaveCount(0);
  await expect(activeNote(page).getByRole("button", { name: "Install missing" })).toHaveCount(0);
  await expect(activeNote(page)).toContainText(`Not available in the Library: ${UNPUBLISHED}.`);
});

test("nothing is said about the Library while the release is still loading", async ({ page, simulator }) => {
  rmSync(stored(simulator, "animations", PUBLISHED));
  rmSync(stored(simulator, "animations", UNPUBLISHED));
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/manifest.json", async (route) => {
    await held;
    await route.fallback();
  });
  await connectSimulator(page, simulator);
  await showPlaylists(page);
  await expect(badge(page)).toHaveText("2 missing");
  await expect(activeNote(page)).toBeVisible();
  await expect(page.getByRole("button", { name: "Install missing" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Install missing animations of/ })).toHaveCount(0);
  await expect(page.getByText(/not available in the Library/i)).toHaveCount(0);
  await playlistRow(page).getByRole("button", { name: "Edit default", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Edit playlist default" });
  await expect(panel.getByTestId(/^item-missing-/)).toHaveCount(2);
  await expect(panel.getByRole("button", { name: /^Install / })).toHaveCount(0);
  await expect(panel.getByText(/not available in the Library/i)).toHaveCount(0);

  release();
  await expect(activeNote(page).getByRole("button", { name: "Install missing" })).toBeVisible();
  await expect(activeNote(page)).toContainText(`Not available in the Library: ${UNPUBLISHED}.`);
});
