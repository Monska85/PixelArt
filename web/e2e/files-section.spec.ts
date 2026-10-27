// SPDX-License-Identifier: GPL-3.0-or-later

import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import {
  animations,
  animationYaml,
  connectSimulator,
  expect,
  file,
  filesToggle as toggle,
  pick,
  showBoardPlaylists,
  showFiles,
  stored,
  test,
  upload,
} from "./fixtures";
import { watchBoard } from "./board";
import { connectScripted, scriptedBoard } from "./scripted";

const card = (page: Page) => page.getByTestId("files-card");
const count = (dir: string, kind: string): number => readdirSync(join(dir, kind)).length;

// The stored playlist `default` is the active one and names snowflake and bear.
const MISSING = ["snowflake", "bear"];

test("the card is first, closed by default, and says what the board holds", async ({ page, simulator }) => {
  await connectSimulator(page, simulator);
  await expect(card(page)).toBeVisible();
  await expect(page.getByRole("region", { name: "Files" })).toBeVisible();
  const cards = page.getByRole("main").getByRole("region");
  const order = ["Files", "Storage", "Settings", "WiFi", "Updates", "Network access"];
  await expect(cards).toHaveCount(order.length);
  for (const [index, name] of order.entries()) await expect(cards.nth(index)).toHaveAccessibleName(name);

  const animationCount = count(simulator.dataDir, "animations");
  const playlistCount = count(simulator.dataDir, "playlists");
  await expect(page.getByTestId("files-summary")).toHaveText(
    `${animationCount} animations, ${playlistCount} playlists, active playlist: Christmas`,
  );
  await expect(toggle(page)).toHaveText("Show all files");
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
  await expect(animations(page)).toBeHidden();
  await expect(page.getByTestId("files-missing")).toHaveCount(0);

  // The upload actions are in the card, and the page header carries none.
  await expect(card(page).getByRole("button", { name: "Upload files" })).toBeVisible();
  await expect(page.getByRole("banner").getByRole("button", { name: "Upload files" })).toHaveCount(0);
});

test("the toggle names its state, controls the tabs, and works with Enter and Space", async ({ page, simulator }) => {
  await connectSimulator(page, simulator);
  const button = toggle(page);
  const region = await button.getAttribute("aria-controls");
  expect(region).toBeTruthy();
  const controlled = page.locator(`[id="${region}"]`);
  await expect(controlled).toBeHidden();
  await expect(controlled).toHaveAttribute("hidden", "");
  await expect(controlled.locator('[role="tablist"]')).toHaveCount(1);

  await button.click();
  await expect(button).toHaveText("Hide files");
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await expect(controlled).toBeVisible();
  await expect(animations(page)).toBeVisible();

  await button.focus();
  await page.keyboard.press("Enter");
  await expect(button).toHaveText("Show all files");
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await expect(controlled).toBeHidden();

  await page.keyboard.press("Space");
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await expect(animations(page)).toBeVisible();
});

test("the choice made with the toggle survives a reload", async ({ page, simulator }) => {
  await connectSimulator(page, simulator);
  await toggle(page).click();
  await page.reload();
  await connectSimulator(page, simulator);
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");
  await expect(animations(page)).toBeVisible();

  await toggle(page).click();
  await page.reload();
  await connectSimulator(page, simulator);
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
  await expect(animations(page)).toBeHidden();
});

test("New playlist opens the section without storing it", async ({ page, simulator }) => {
  await connectSimulator(page, simulator);
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "New playlist" }).click();
  await expect(page.getByRole("heading", { name: "New playlist" })).toBeVisible();
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");
  await expect(animations(page)).toBeVisible();

  await page.reload();
  await connectSimulator(page, simulator);
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
});

test("an upload that stores a file opens the section; one that stores nothing does not", async ({
  page,
  simulator,
}) => {
  await connectSimulator(page, simulator);
  await pick(page, file("bad.yaml"));
  await expect(page.getByText("bad.yaml").first()).toBeVisible();
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");

  await pick(page, file("dot.yaml"));
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");
  await expect(animations(page).locator("tr", { hasText: "dot" })).toBeVisible();

  await page.reload();
  await connectSimulator(page, simulator);
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
});

test("an upload the board refuses does not open the section", async ({ page }) => {
  const board = await scriptedBoard(page);
  board.refuse.add("b");
  await connectScripted(page, board);
  await pick(page, upload("b.yaml", animationYaml("B")));
  await expect(page.getByRole("alert").filter({ hasText: "b" }).first()).toBeVisible();
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");

  await pick(page, upload("a.yaml", animationYaml("A")));
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");
});

test("a playlist that misses animations is flagged while the section is closed, and Show playlists opens it", async ({
  page,
  simulator,
}) => {
  for (const id of MISSING) rmSync(stored(simulator, "animations", id), { force: true });
  await connectSimulator(page, simulator);
  const warning = page.getByTestId("files-missing");
  await expect(warning).toContainText("1 playlist is missing animations: default.");
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");

  await warning.getByRole("button", { name: "Show playlists" }).click();
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");
  const tab = page.getByRole("tab", { name: /^Playlists/ });
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(tab).toBeFocused();
  await expect(page.getByRole("table", { name: "Playlists on the board" })).toBeVisible();

  // Not stored: the next visit follows the user's own choice.
  await page.reload();
  await connectSimulator(page, simulator);
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId("files-missing")).toBeVisible();
});

test("the summary says when the active playlist is not stored", async ({ page, simulator }) => {
  rmSync(stored(simulator, "playlists", "default"));
  await connectSimulator(page, simulator);
  await expect(page.getByTestId("files-summary")).toContainText("active playlist: default (not stored)");
});

// Edit sits in the list, so only an editor that does not need the list (New playlist) can open the section while it
// is hidden; a confirmed switch needs Edit and so cannot start from a hidden section.
test("Edit on a playlist keeps the section open", async ({ page, simulator }) => {
  await connectSimulator(page, simulator);
  await showBoardPlaylists(page);
  await page.getByRole("button", { name: "Edit default" }).click();
  await expect(page.getByRole("heading", { name: "Edit playlist default" })).toBeVisible();
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");
});

test("a preview opens the section again when it was hidden while the file downloaded, without storing it", async ({
  page,
  simulator,
}) => {
  const watch = await watchBoard(page, simulator);
  await connectSimulator(page, simulator);
  await showFiles(page);
  watch.hold("get");
  await animations(page).getByRole("button", { name: "Preview snowflake" }).click();
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
  watch.release();

  await expect(page.getByRole("dialog", { name: "Preview of snowflake" })).toBeVisible();
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");
  // The user hid the section last: that stays their stored choice.
  await page.reload();
  await connectSimulator(page, simulator);
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
});
