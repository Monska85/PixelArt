// SPDX-License-Identifier: GPL-3.0-or-later

import { existsSync, readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import {
  animations,
  connectSimulator,
  expect,
  file,
  openFromLibrary,
  settled,
  showFiles,
  stored,
  test,
  text,
  upload,
} from "./fixtures";

const editorLink = (page: Page) => page.getByRole("link", { name: "Editor" });
const yamlTab = (page: Page) => page.getByRole("tab", { name: "YAML" });
const visualTab = (page: Page) => page.getByRole("tab", { name: "Visual" });
const diagnostics = (page: Page) => page.getByTestId("diagnostics");

async function pixel(page: Page, x: number, y: number): Promise<number[]> {
  return page
    .getByTestId("preview-canvas")
    .evaluate(
      (canvas: HTMLCanvasElement, at: number[]) =>
        Array.from(
          (canvas.getContext("2d") as CanvasRenderingContext2D).getImageData(at[0] as number, at[1] as number, 1, 1)
            .data,
        ),
      [x, y],
    );
}

const RED = [255, 0, 0, 255];
const BLUE = [0, 0, 255, 255];
const BLACK = [0, 0, 0, 255];

/** Opens the editor on the new animation of the template. */
async function openEditor(page: Page): Promise<void> {
  await page.goto("/#editor");
  await expect(page.getByRole("heading", { name: "Palette" })).toBeVisible();
  await settled(page);
}

test("starts from a valid template", async ({ page }) => {
  await openEditor(page);
  await expect(page.getByTestId("diagnostics-clean")).toBeVisible();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("New animation");
  await expect(page.getByTestId("palette-red")).toBeVisible();
  await expect(page.getByTestId("sprite-dot")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("cell-7-7")).toHaveAttribute("data-color", "#ff0000");
  expect(await pixel(page, 7, 7)).toEqual(RED);
});

test("edits the palette, draws on the grid, adds an effect and follows it in the preview", async ({ page }) => {
  await openEditor(page);

  // Palette: add a color, rename it and give it a value.
  await page.getByRole("button", { name: "Add color" }).click();
  await text(page, "Name of color", "blue");
  await text(page, "Hex value of blue", "#0000ff");
  await page.getByRole("button", { name: "Draw with blue" }).click();

  // Grid: one click, then a drag over three more cells.
  await page.getByTestId("cell-3-3").click();
  await expect(page.getByTestId("cell-3-3")).toHaveAttribute("data-color", "#0000ff");
  const from = await page.getByTestId("cell-4-3").boundingBox();
  const to = await page.getByTestId("cell-6-3").boundingBox();
  if (!from || !to) throw new Error("the grid is not shown");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 6 });
  await page.mouse.up();
  for (const x of [3, 4, 5, 6]) await expect(page.getByTestId(`cell-${x}-3`)).toHaveAttribute("data-color", "#0000ff");

  // The stroke is one undo step.
  await page.getByRole("button", { name: "Undo" }).click();
  for (const x of [4, 5, 6]) await expect(page.getByTestId(`cell-${x}-3`)).toHaveAttribute("data-color", "empty");
  await expect(page.getByTestId("cell-3-3")).toHaveAttribute("data-color", "#0000ff");
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(page.getByTestId("cell-6-3")).toHaveAttribute("data-color", "#0000ff");

  // Erase with the keyboard: arrows move the cursor, Delete erases.
  await page.getByTestId("grid").focus();
  await expect(page.getByTestId("grid-cursor")).toContainText("Cell 6, 3");
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowLeft");
  await expect(page.getByTestId("grid-cursor")).toContainText("Cell 3, 3");
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("cell-3-3")).toHaveAttribute("data-color", "empty");
  await page.keyboard.press("Space");
  await expect(page.getByTestId("cell-3-3")).toHaveAttribute("data-color", "#0000ff");

  // Timeline: repeat the frame 5 times and move the sprite one pixel to the right on each repetition.
  await page.getByTestId("item-0").click();
  await page.getByTestId("frame-repeat").fill("5");
  await page.getByTestId("frame-repeat").press("Enter");
  await page.getByTestId("show-0-move-x").fill("1");
  await page.getByTestId("show-0-move-y").fill("0");
  await page.getByTestId("show-0-move-y").press("Enter");
  await expect(page.getByTestId("show-0-move-x")).toHaveValue("1");

  await settled(page);
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByTestId("preview-frame")).toHaveText(/^Frame 1, /);
  expect(await pixel(page, 3, 3)).toEqual(BLUE);
  expect(await pixel(page, 7, 7)).toEqual(RED);
  await expect(page.getByTestId("preview-item")).toHaveText("Timeline item 1");

  await page.getByRole("button", { name: "Step" }).click();
  await expect(page.getByTestId("preview-frame")).toHaveText(/^Frame 2, /);
  expect(await pixel(page, 3, 3)).toEqual(BLACK);
  expect(await pixel(page, 4, 3)).toEqual(BLUE);
  expect(await pixel(page, 8, 7)).toEqual(RED);

  // The first frame of a selected timeline item is shown.
  await page.getByRole("button", { name: "Add frame", exact: true }).click();
  await settled(page);
  await expect(page.getByTestId("preview-item")).toHaveText("Timeline item 2");
  await expect(page.getByTestId("preview-frame")).toHaveText(/^Frame 6, /);
  await page.getByTestId("item-0").click();
  await expect(page.getByTestId("preview-frame")).toHaveText(/^Frame 1, /);
});

test("updates the diagnostics while editing", async ({ page }) => {
  await openEditor(page);
  await page.getByRole("button", { name: "Add points sprite" }).click();
  await expect(diagnostics(page)).toContainText("empty_sprite");
  await expect(page.getByText("The animation has errors, so it cannot play.")).toBeVisible();

  await page.getByTestId("cell-1-1").click();
  await expect(diagnostics(page)).not.toContainText("empty_sprite");
  await expect(diagnostics(page)).toContainText("unused_sprite");
  await expect(page.getByTestId("preview-canvas")).toBeVisible();

  // Deleting a color that is used asks first, then writes its hex value where it was used.
  await page.getByRole("button", { name: "Delete red" }).click();
  await expect(page.getByRole("dialog")).toContainText("Each use becomes its hex value");
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByTestId("palette-red")).toHaveCount(0);
  await page.getByTestId("sprite-dot").click();
  await expect(page.getByTestId("cell-7-7")).toHaveAttribute("data-color", "#ff0000");
  await settled(page);
  await expect(diagnostics(page)).not.toContainText("unknown_color");
});

test("follows the YAML tab and keeps the last valid document", async ({ page }) => {
  await openEditor(page);
  await yamlTab(page).click();
  const area = page.getByLabel("Animation as YAML");
  await expect(area).toHaveValue(/palette:\n {2}red: "#ff0000"/);

  // Valid text, with a comment, replaces the document.
  const original = await area.inputValue();
  await area.fill(original.replace("name: New animation", "name: From YAML # my note"));
  await visualTab(page).click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("From YAML");
  await yamlTab(page).click();
  await expect(area).toHaveValue(/my note/);
  await expect(page.getByTestId("comments-dropped")).toHaveCount(0);

  // Text that does not parse: the error names the line and the visual editor keeps the document.
  await area.fill("format: pixelart/1\nname: [oops\n");
  await expect(page.getByTestId("yaml-error")).toContainText(/Line \d+/);
  await visualTab(page).click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("From YAML");
  await yamlTab(page).click();
  await expect(area).toHaveValue("format: pixelart/1\nname: [oops\n");

  // Fixing it brings the document back; a visual change rewrites the text and drops the comments.
  await area.fill(original.replace("name: New animation", "name: Fixed # again"));
  await visualTab(page).click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Fixed");
  await text(page, "Author", "Ada");
  await yamlTab(page).click();
  await expect(page.getByTestId("comments-dropped")).toBeVisible();
  await expect(area).not.toHaveValue(/again/);
  await expect(area).toHaveValue(/author: Ada/);
});

test("undoes and redoes with the keyboard", async ({ page }) => {
  await openEditor(page);
  await text(page, "Name", "First");
  await text(page, "Name", "Second");
  await page.getByRole("heading", { name: "Palette" }).click();
  await page.keyboard.press("Control+z");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("First");
  await page.keyboard.press("Control+Shift+z");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Second");
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+z");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("New animation");
  await page.keyboard.press("Control+y");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("First");
});

test("saves YAML with the hex colors quoted and uploads to the board", async ({ page, simulator }) => {
  await connectSimulator(page, simulator);
  await editorLink(page).click();
  await expect(page.getByRole("heading", { name: "Palette" })).toBeVisible();

  await text(page, "Name", "Blue Dot");
  await page.getByRole("button", { name: "Add color" }).click();
  await text(page, "Name of color", "blue");
  await text(page, "Hex value of blue", "#0000ff");
  await page.getByRole("button", { name: "Draw with blue" }).click();
  await page.getByTestId("cell-8-8").click();
  await settled(page);

  // The ID is chosen at the first save, from the rule.
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download YAML" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("ID")).toHaveValue("blue_dot");
  await dialog.getByLabel("ID").fill("Not valid");
  await expect(dialog.getByRole("button", { name: "Use this ID" })).toBeDisabled();
  await dialog.getByLabel("ID").fill("e2e_edit");
  await dialog.getByRole("button", { name: "Use this ID" }).click();
  const saved = await download;
  expect(saved.suggestedFilename()).toBe("e2e_edit.yaml");
  const content = readFileSync((await saved.path()) as string, "utf8");
  expect(content).toContain("format: pixelart/1");
  expect(content).toContain("name: Blue Dot");
  expect(content).toContain('blue: "#0000ff"');
  expect(content).toContain('red: "#ff0000"');
  await expect(page.getByTestId("editor-id")).toHaveText("e2e_edit");

  // Upload: the ID is kept, the board stores the JSON.
  await page.getByRole("button", { name: "Upload to board" }).click();
  await expect(page.getByTestId("save-outcome")).toContainText("Uploaded animation e2e_edit");
  const path = stored(simulator, "animations", "e2e_edit");
  expect(existsSync(path)).toBe(true);
  expect(JSON.parse(readFileSync(path, "utf8")).name).toBe("Blue Dot");
  await page.getByRole("link", { name: "Board" }).click();
  await showFiles(page);
  await expect(animations(page).locator("code", { hasText: /^e2e_edit$/ })).toBeVisible();

  // The same content again needs no question.
  await editorLink(page).click();
  await page.getByRole("button", { name: "Upload to board" }).click();
  await expect(page.getByTestId("save-outcome")).toContainText("already has this exact animation");

  // A changed document asks once before replacing.
  await text(page, "Name", "Blue Dot 2");
  await page.getByRole("button", { name: "Upload to board" }).click();
  const replace = page.getByRole("dialog", { name: "Replace the stored file?" });
  await expect(replace).toContainText("e2e_edit");
  await replace.getByRole("button", { name: "Keep the board's" }).click();
  await expect(page.getByTestId("save-outcome")).toContainText("Skipped");
  await page.getByRole("button", { name: "Upload to board" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByTestId("save-outcome")).toContainText("Cancelled");
  await page.getByRole("button", { name: "Upload to board" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Replace them" }).click();
  await expect(page.getByTestId("save-outcome")).toContainText("Uploaded animation e2e_edit");

  // Another document starts without the outcome of the previous one.
  await page.getByRole("link", { name: "Board" }).click();
  await page.getByRole("button", { name: "Edit star", exact: true }).click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Star");
  await expect(page.getByTestId("save-outcome")).toHaveCount(0);
});

test("does not upload an animation with errors", async ({ page, simulator }) => {
  await connectSimulator(page, simulator);
  await editorLink(page).click();
  await page.getByRole("button", { name: "Add points sprite" }).click();
  await page.getByRole("button", { name: "Upload to board" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("ID").fill("with_errors");
  await dialog.getByRole("button", { name: "Use this ID" }).click();
  await expect(page.getByTestId("save-outcome")).toContainText("has errors and was not uploaded");
  await expect(page.getByTestId("save-outcome")).toContainText("empty_sprite");
  expect(existsSync(stored(simulator, "animations", "with_errors"))).toBe(false);
});

test("opens a stored animation from the Board view and asks before replacing unsaved changes", async ({
  page,
  simulator,
}) => {
  await connectSimulator(page, simulator);
  await showFiles(page);
  await page.getByRole("button", { name: "Edit snowflake" }).click();
  await expect(page).toHaveURL(/#editor$/);
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Snowflake");
  await expect(page.getByTestId("editor-id")).toHaveText("snowflake");
  await expect(page.getByTestId("editor-source")).toContainText("The board's animation snowflake");
  await settled(page);
  expect(await diagnostics(page).getByText("error").count()).toBe(0);

  // The document has no changes yet, so another one opens at once; with changes, the user is asked.
  await text(page, "Name", "Snowflake edited");
  await page.getByRole("link", { name: "Board" }).click();
  await page.getByRole("button", { name: "Edit star", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Discard the unsaved changes to Snowflake edited and open Star?",
  });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Keep editing" }).click();
  await expect(page).toHaveURL(/#editor$/);
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Snowflake edited");
});

test("opens a YAML file, refuses a playlist and a broken file", async ({ page }) => {
  await openEditor(page);
  await page.locator("#editor-open").setInputFiles(file("dot.yaml"));
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Dot");
  await expect(page.getByTestId("editor-id")).toHaveText("dot");
  await expect(page.getByTestId("editor-source")).toContainText("dot.yaml");

  await page
    .locator("#editor-open")
    .setInputFiles(upload("list.json", '{"format":"pixelart-playlist/1","name":"x","items":[]}'));
  await expect(page.getByRole("alert")).toContainText("playlist");
  await page.locator("#editor-open").setInputFiles(upload("broken.json", "{'format': 1}"));
  await expect(page.getByRole("alert")).toContainText("not valid JSON");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Dot");
});

test("opens a published animation from the Library", async ({ page }) => {
  await page.goto("/#library");
  await openFromLibrary(page);
  await expect(page).toHaveURL(/#editor$/);
  await expect(page.getByTestId("editor-source")).toContainText("The published animation");
  await expect(page.getByTestId("editor-id")).not.toBeEmpty();
});

test("restores the draft after a reload and can discard it", async ({ page }) => {
  await openEditor(page);
  await text(page, "Name", "Kept across reload");
  await page.getByRole("button", { name: "Add color" }).click();
  await expect(page.getByTestId("draft-status")).toHaveText("Draft saved in this browser.");
  await page.reload();
  await expect(page.getByTestId("draft-restored")).toContainText("Restored the draft");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Kept across reload");
  await expect(page.getByTestId("palette-color")).toBeVisible();

  await page.getByRole("button", { name: "Discard the draft" }).click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("New animation");
  await expect(page.getByTestId("draft-restored")).toHaveCount(0);
  await expect(page.getByTestId("draft-status")).toHaveText("Draft saved in this browser.");
  await page.reload();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("New animation");
});

test("works when the browser storage is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "indexedDB", {
      get() {
        throw new Error("blocked");
      },
    });
  });
  await openEditor(page);
  await text(page, "Name", "No storage");
  await expect(page.getByTestId("draft-status")).toHaveText("This browser cannot keep a draft.");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("No storage");
});

test("shows file text as text, never as markup", async ({ page }) => {
  await openEditor(page);
  await page.locator("#editor-open").setInputFiles(
    upload(
      "xss.json",
      JSON.stringify({
        format: "pixelart/1",
        name: '<img src=x onerror="window.pwned=1">',
        author: "<b>bold</b>",
        canvas: { width: 16, height: 16 },
        palette: { red: "#ff0000" },
        sprites: { dot: { points: { red: [[0, 0]] } } },
        timeline: [{ show: ["dot"] }],
      }),
    ),
  );
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue('<img src=x onerror="window.pwned=1">');
  await expect(page.getByTestId("editor-source")).toContainText("xss.json");
  expect(await page.evaluate(() => (window as unknown as { pwned?: number }).pwned)).toBeUndefined();
  await expect(page.locator("main img")).toHaveCount(0);
  await expect(page.locator("main b")).toHaveCount(0);
});

const HOSTILE = [
  "palette: 5",
  "palette: s",
  "palette: true",
  "palette: [a, b]",
  "palette: {a: 5, b: [1], c: null}",
  "sprites: 5",
  "sprites: {a: 5, b: [1], c: {points: 5}, d: {parts: 5}, e: {points: {red: 5}}}",
  "sprites: {a: {parts: [5, x, {sprite: 5}]}}",
  "timeline: 5",
  "timeline: [5, x, null, {show: 5}, {show: [5, [1]]}, {loop: x, steps: 5}]",
  "timeline: [{loop: 2, steps: [5, {show: [a], recolor: 5}]}]",
  "timeline: [{show: [a], recolor: {red: 5}, ms: x, repeat: [1]}]",
  "background: 5",
  "canvas: 5",
  "name: 5\ndescription: [1]\nauthor: {a: 1}",
];

test("keeps working, with diagnostics, on a document whose parts have the wrong type", async ({ page }) => {
  await openEditor(page);
  for (const [index, extra] of HOSTILE.entries()) {
    await yamlTab(page).click();
    await page.getByLabel("Animation as YAML").fill(`format: pixelart/1\n${extra}\n`);
    await visualTab(page).click();
    await expect(page.getByRole("heading", { name: "Palette" }), `case ${index}: ${extra}`).toBeVisible();
    await expect(page.getByTestId("crash-note"), `case ${index}: ${extra}`).toHaveCount(0);
    await settled(page);
    await expect(page.getByTestId("diagnostics-clean")).toHaveCount(0);
  }
});

/** Makes drawing fail on every page this one opens from now on, while the `crash` flag is set in its storage. */
async function crashDrawingWhileFlagged(page: Page, message: string): Promise<void> {
  await page.addInitScript((text) => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: [string]) {
      if (localStorage.getItem("crash") === "1") throw new Error(text);
      return getContext.apply(this, args as never);
    } as typeof getContext;
  }, message);
}

async function setCrash(page: Page, on: boolean): Promise<void> {
  await page.evaluate((flag) => (flag ? localStorage.setItem("crash", "1") : localStorage.removeItem("crash")), on);
}

test("a draft that crashes the page can be discarded without the page's own state", async ({
  page,
  consoleProblems,
}) => {
  await openEditor(page);
  await text(page, "Name", "Broken draft");
  await expect(page.getByTestId("draft-status")).toHaveText("Draft saved in this browser.");
  // Drawing fails while the flag is set, as a draft that makes the editor throw would make it fail.
  await crashDrawingWhileFlagged(page, "cannot draw this document");
  await setCrash(page, true);
  await page.reload();
  await expect(page.getByTestId("crash-note")).toContainText("cannot draw this document");
  await expect(page.getByRole("navigation", { name: "Views" })).toBeVisible();

  // The cause is gone, as after a fix; the stored draft is the thing left to discard.
  await setCrash(page, false);
  await page.getByRole("button", { name: "Discard the draft and start again" }).click();
  await expect(page.getByTestId("crash-note")).toContainText("will be deleted");
  await page.getByRole("button", { name: "Keep the draft" }).click();
  await expect(page.getByRole("button", { name: "Discard the draft and start again" })).toBeVisible();
  await page.getByRole("button", { name: "Discard the draft and start again" }).click();
  await page.getByRole("button", { name: "Yes, delete the draft and reload" }).click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("New animation");
  await expect(page.getByTestId("draft-restored")).toHaveCount(0);
  consoleProblems.length = 0;
});

test("a crash outside the editor offers no way to discard the draft", async ({ page, consoleProblems }) => {
  await openEditor(page);
  await text(page, "Name", "Unrelated draft");
  await expect(page.getByTestId("draft-status")).toHaveText("Draft saved in this browser.");
  await crashDrawingWhileFlagged(page, "cannot draw this page");
  await page.goto("/#library");
  await setCrash(page, true);
  await page.reload();
  await page
    .getByRole("button", { name: /^Preview / })
    .first()
    .click();
  await expect(page.getByTestId("crash-note")).toContainText("cannot draw this page");
  await expect(page.getByRole("button", { name: "Reload the page" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Discard the draft/ })).toHaveCount(0);

  await setCrash(page, false);
  await page.goto("/#editor");
  await page.reload();
  await expect(page.getByTestId("draft-restored")).toContainText("Restored the draft");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Unrelated draft");
  consoleProblems.length = 0;
});

test("does not save while the YAML text has an error", async ({ page }) => {
  await openEditor(page);
  await yamlTab(page).click();
  await page.getByLabel("Animation as YAML").fill("format: pixelart/1\nname: [oops\n");
  await expect(page.getByTestId("yaml-error")).toBeVisible();
  let downloaded = false;
  page.on("download", () => (downloaded = true));
  await page.getByRole("button", { name: "Download YAML" }).click();
  await expect(page.getByTestId("save-outcome")).toContainText("has an error");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(downloaded).toBe(false);
});

test("does not upload while the YAML text has an error", async ({ page, simulator }) => {
  await connectSimulator(page, simulator);
  await page.getByRole("link", { name: "Editor", exact: true }).click();
  await text(page, "Name", "Valid name");
  await yamlTab(page).click();
  await page.getByLabel("Animation as YAML").fill("format: pixelart/1\nname: [oops\n");
  await expect(page.getByTestId("yaml-error")).toBeVisible();
  await page.getByRole("button", { name: "Upload to board" }).click();
  await expect(page.getByTestId("save-outcome")).toContainText("was not uploaded");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByTestId("save-outcome")).not.toContainText("Uploaded");
});

test("moves between the tabs with the arrow keys, Home and End, and focus follows", async ({ page }) => {
  await openEditor(page);
  await visualTab(page).focus();
  await page.keyboard.press("ArrowRight");
  await expect(yamlTab(page)).toBeFocused();
  await expect(yamlTab(page)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowRight");
  await expect(visualTab(page)).toBeFocused();
  await page.keyboard.press("End");
  await expect(yamlTab(page)).toBeFocused();
  await page.keyboard.press("Home");
  await expect(visualTab(page)).toBeFocused();
  await expect(visualTab(page)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowLeft");
  await expect(yamlTab(page)).toBeFocused();
});
