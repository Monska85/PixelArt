// SPDX-License-Identifier: GPL-3.0-or-later

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import {
  animations,
  connectSimulator,
  expect,
  file,
  openFromLibrary,
  showFiles,
  type Simulator,
  stored,
  test,
} from "./fixtures";

const name = (page: Page) => page.getByLabel("Name", { exact: true });
const source = (page: Page) => page.getByTestId("editor-source");
const back = (page: Page, view: string) => page.getByRole("button", { name: `Back to ${view}` });
const dialog = (page: Page, current: string, next: string) =>
  page.getByRole("dialog", { name: `Discard the unsaved changes to ${current} and open ${next}?` });

/** Chooses an item of the editor's More menu. */
async function editorMenu(page: Page, item: string): Promise<void> {
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: item }).click();
}

async function rename(page: Page, value: string): Promise<void> {
  await name(page).fill(value);
  await name(page).press("Enter");
}

const editFromBoard = async (page: Page, id: string): Promise<void> => {
  await page.getByRole("link", { name: "Board" }).click();
  await showFiles(page);
  await page.getByRole("button", { name: `Edit ${id}`, exact: true }).click();
};

/** Waits until the draft of the document is stored, so that a reload brings it back. */
const drafted = (page: Page) => expect(page.getByTestId("draft-status")).toHaveText("Draft saved in this browser.");

test("the editor offers a way back to the Board and shows the upload on return", async ({ page, simulator }) => {
  await connectSimulator(page, simulator);
  await showFiles(page);
  await page.getByRole("button", { name: "Edit snowflake", exact: true }).click();
  await expect(page).toHaveURL(/#editor$/);
  await expect(back(page, "Board")).toBeVisible();

  // Upload under a new ID: the editor stays open with the note and the way back.
  await rename(page, "Snowflake again");
  await page.getByRole("button", { name: "Change ID" }).click();
  await page.getByRole("button", { name: "Upload to board" }).click();
  const chooser = page.getByRole("dialog");
  await chooser.getByLabel("ID", { exact: true }).fill("snowflake_again");
  await chooser.getByRole("button", { name: "Use this ID" }).click();
  await expect(page.getByTestId("save-outcome")).toContainText("Uploaded animation snowflake_again");
  await expect(page).toHaveURL(/#editor$/);
  await expect(back(page, "Board")).toBeVisible();
  expect(existsSync(stored(simulator, "animations", "snowflake_again"))).toBe(true);

  await back(page, "Board").click();
  await expect(page).toHaveURL(/#board$/);
  await expect(page.getByRole("heading", { name: "Board", exact: true })).toBeFocused();
  await expect(page.getByRole("tab", { name: /^Animations/ })).toBeVisible();
  await expect(animations(page).locator("tr", { hasText: "snowflake_again" })).toBeVisible();
});

test("the editor offers a way back to the Library, and none from the menu or a file", async ({ page }) => {
  await page.goto("/#library");
  await openFromLibrary(page);
  await expect(page).toHaveURL(/#editor$/);
  await expect(source(page)).toContainText("The published animation");
  await back(page, "Library").click();
  await expect(page).toHaveURL(/#library$/);

  // The Editor menu item shows the same document and keeps the way back.
  await page.getByRole("link", { name: "Editor" }).click();
  await expect(back(page, "Library")).toBeVisible();

  await page.locator("#editor-open").setInputFiles(file("dot.yaml"));
  await expect(name(page)).toHaveValue("Dot");
  await expect(page.getByRole("button", { name: /^Back to/ })).toHaveCount(0);
});

test("the way back survives a reload, since the draft remembers where the document came from", async ({
  page,
  simulator,
}) => {
  await connectSimulator(page, simulator);
  await showFiles(page);
  await page.getByRole("button", { name: "Edit snowflake", exact: true }).click();
  await expect(back(page, "Board")).toBeVisible();
  await drafted(page);
  await page.reload();
  await expect(name(page)).toHaveValue("Snowflake");
  await expect(back(page, "Board")).toBeVisible();
  // A file or a new animation has no way back.
  await editorMenu(page, "New animation");
  await expect(page.getByRole("button", { name: /^Back to/ })).toHaveCount(0);
});

test("no way back when the editor is opened from the menu", async ({ page }) => {
  await page.goto("/#editor");
  await expect(name(page)).toHaveValue("New animation");
  await expect(page.getByRole("button", { name: /^Back to/ })).toHaveCount(0);
});

test("a different animation and a new one open at once without unsaved changes", async ({ page, simulator }) => {
  await connectSimulator(page, simulator);
  await editFromBoard(page, "snowflake");
  await expect(name(page)).toHaveValue("Snowflake");
  await editFromBoard(page, "star");
  await expect(name(page)).toHaveValue("Star");
  await expect(source(page)).toHaveText("The board's animation star");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await editorMenu(page, "New animation");
  await expect(name(page)).toHaveValue("New animation");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.locator("#editor-open").setInputFiles(file("dot.yaml"));
  await expect(name(page)).toHaveValue("Dot");
});

test("with unsaved changes every opening asks first, where the user is", async ({ page, simulator }) => {
  await connectSimulator(page, simulator);
  await editFromBoard(page, "snowflake");
  await rename(page, "Mine");

  // From the Board view: the question appears there, and Keep editing returns to the document.
  await editFromBoard(page, "star");
  await expect(page).toHaveURL(/#board$/);
  await expect(dialog(page, "Mine", "Star")).toBeVisible();
  await dialog(page, "Mine", "Star").getByRole("button", { name: "Keep editing" }).click();
  await expect(page).toHaveURL(/#editor$/);
  await expect(name(page)).toHaveValue("Mine");

  // From inside the editor.
  await editorMenu(page, "New animation");
  await expect(dialog(page, "Mine", "New animation")).toBeVisible();
  await dialog(page, "Mine", "New animation").getByRole("button", { name: "Keep editing" }).click();
  await expect(page.getByRole("button", { name: "More", exact: true })).toBeFocused();
  await expect(name(page)).toHaveValue("Mine");
  await editorMenu(page, "New animation");
  await page.keyboard.press("Escape");
  await expect(name(page)).toHaveValue("Mine");
  await page.locator("#editor-open").setInputFiles(file("dot.yaml"));
  await expect(dialog(page, "Mine", "Dot")).toBeVisible();
  await dialog(page, "Mine", "Dot").getByRole("button", { name: "Discard and open" }).click();
  await expect(name(page)).toHaveValue("Dot");
  await expect(source(page)).toHaveText("The file dot.yaml");

  // The opened document is clean, so the next opening needs no question.
  await editFromBoard(page, "star");
  await expect(name(page)).toHaveValue("Star");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("discarding opens the requested animation and the way back follows it", async ({ page, simulator }) => {
  await connectSimulator(page, simulator);
  await showFiles(page);
  await page.getByRole("button", { name: "Edit snowflake", exact: true }).click();
  await rename(page, "Mine");
  await page.getByRole("link", { name: "Library" }).click();
  await openFromLibrary(page);
  await expect(page.getByRole("dialog")).toContainText("Discard the unsaved changes to Mine");
  await page.getByRole("dialog").getByRole("button", { name: "Discard and open" }).click();
  await expect(page).toHaveURL(/#editor$/);
  await expect(source(page)).toContainText("The published animation");
  await expect(back(page, "Library")).toBeVisible();
});

async function reloadWithDraft(page: Page, simulator: Simulator, changed: boolean): Promise<void> {
  await connectSimulator(page, simulator);
  await editFromBoard(page, "snowflake");
  if (changed) await rename(page, "Unsaved work");
  await drafted(page);
  await page.goto("/");
  await page.reload();
}

test("after a reload a stored draft with unsaved changes asks before an opening replaces it", async ({
  page,
  simulator,
}) => {
  await reloadWithDraft(page, simulator, true);
  await connectSimulator(page, simulator);
  await editFromBoard(page, "star");
  await expect(dialog(page, "Unsaved work", "Star")).toBeVisible();
  await dialog(page, "Unsaved work", "Star").getByRole("button", { name: "Discard and open" }).click();
  await expect(name(page)).toHaveValue("Star");
  await expect(page.getByTestId("draft-restored")).toHaveCount(0);
});

test("after a reload the stored draft comes back and keeps its unsaved changes", async ({ page, simulator }) => {
  await reloadWithDraft(page, simulator, true);
  await page.getByRole("link", { name: "Editor" }).click();
  await expect(name(page)).toHaveValue("Unsaved work");
  await expect(page.getByTestId("draft-restored")).toBeVisible();
  await expect(source(page)).toContainText("changed");
});

test("after a reload a stored draft without changes is replaced at once", async ({ page, simulator }) => {
  await reloadWithDraft(page, simulator, false);
  await connectSimulator(page, simulator);
  await editFromBoard(page, "star");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(name(page)).toHaveValue("Star");
  await editorMenu(page, "New animation");
  await expect(name(page)).toHaveValue("New animation");
});

test("a reload on the editor never lets the draft replace what was opened", async ({ page, simulator }) => {
  await reloadWithDraft(page, simulator, true);
  await page.goto("/#editor");
  await expect(name(page)).toHaveValue("Unsaved work");
  await editorMenu(page, "New animation");
  await expect(dialog(page, "Unsaved work", "New animation")).toBeVisible();
  await dialog(page, "Unsaved work", "New animation").getByRole("button", { name: "Discard and open" }).click();
  await expect(name(page)).toHaveValue("New animation");
  // The opening is written as the new draft, which must not bring the old one back.
  await expect(page.getByTestId("draft-status")).toHaveText("Saving the draft...");
  await drafted(page);
  await expect(name(page)).toHaveValue("New animation");
});

test("the file lists are tabs that work with the keyboard", async ({ page, simulator }) => {
  await connectSimulator(page, simulator);
  await showFiles(page);
  const animationsTab = page.getByRole("tab", { name: /^Animations/ });
  const playlistsTab = page.getByRole("tab", { name: /^Playlists/ });
  const schedulesTab = page.getByRole("tab", { name: /^Schedules/ });
  await expect(animationsTab).toHaveAttribute("aria-selected", "true");
  await expect(animations(page)).toBeVisible();
  await expect(page.getByRole("table", { name: "Playlists on the board" })).toBeHidden();

  await animationsTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(playlistsTab).toBeFocused();
  await expect(playlistsTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("table", { name: "Playlists on the board" })).toBeVisible();
  await expect(animations(page)).toBeHidden();
  await page.keyboard.press("ArrowRight");
  await expect(schedulesTab).toBeFocused();
  await expect(page.getByRole("table", { name: "Schedules on the board" })).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(animationsTab).toBeFocused();
  await page.keyboard.press("End");
  await expect(schedulesTab).toBeFocused();
  await page.keyboard.press("Home");
  await expect(animationsTab).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(schedulesTab).toBeFocused();
  await expect(schedulesTab).toHaveAttribute("tabindex", "0");
  await expect(animationsTab).toHaveAttribute("tabindex", "-1");
  await expect(playlistsTab).toHaveAttribute("tabindex", "-1");
});

for (const width of [1280, 320]) {
  test(`a size stays on one line at ${width} px`, async ({ page, simulator }) => {
    await page.setViewportSize({ width, height: 800 });
    await connectSimulator(page, simulator);
    await showFiles(page);
    const sizes = animations(page).locator("[data-testid^=size-]");
    await expect(sizes.first()).toBeVisible();
    const count = await sizes.count();
    expect(count).toBe(readdirSync(join(simulator.dataDir, "animations")).length);
    for (let i = 0; i < count; i++) {
      const box = await sizes.nth(i).evaluate((cell) => {
        const range = document.createRange();
        range.selectNodeContents(cell);
        return range.getClientRects().length;
      });
      expect(box).toBe(1);
    }
  });
}
