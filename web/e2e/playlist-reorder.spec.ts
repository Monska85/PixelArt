import { copyFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { connectSimulator, expect, test } from "./fixtures";

const editorPanel = (page: Page) => page.getByRole("dialog", { name: "Edit playlist default" });

/** Opens the simulator's playlist `default` in the editor and returns its items as stored. */
async function openDefault(page: Page, dataDir: string): Promise<{ editor: Locator; before: string[] }> {
  const path = join(dataDir, "playlists", "default.json");
  const before = (JSON.parse(readFileSync(path, "utf8")).items as Array<{ animation: string }>).map((i) => i.animation);
  await page.getByRole("tab", { name: /^Playlists/ }).click();
  await page.getByRole("button", { name: "Edit default", exact: true }).click();
  const editor = editorPanel(page);
  await expect(editor.getByRole("heading", { name: "Edit playlist default" })).toBeFocused();
  return { editor, before };
}

const animationOf = (editor: Locator, n: number) => editor.getByLabel(`Animation of item ${n}`, { exact: true });
const handle = (editor: Locator, n: number) => editor.getByTestId(`reorder-handle-${n}`);

/** Uploads the editor's playlist and reads back the order of the animations the board stores. */
async function uploadAndRead(page: Page, editor: Locator, dataDir: string): Promise<string[]> {
  await editor.getByRole("button", { name: "Upload to board" }).click();
  await expect(editorPanel(page)).toHaveCount(0);
  const stored = JSON.parse(readFileSync(join(dataDir, "playlists", "default.json"), "utf8"));
  return (stored.items as Array<{ animation: string }>).map((i) => i.animation);
}

test("the playlist editor spans the content width on a wide screen and fills the screen on a phone", async ({
  page,
  simulator,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await connectSimulator(page, simulator);
  const { editor } = await openDefault(page, simulator.dataDir);
  const main = await page.getByRole("main").boundingBox();
  const wide = await editor.boundingBox();
  if (!main || !wide) throw new Error("the editor is not shown");
  expect(wide.width).toBeGreaterThan(main.width - 64);
  // Room for an item on one line: the handle, the animation, repeat, enabled and the move buttons side by side.
  const item = await editor.getByTestId("playlist-item-1").boundingBox();
  const up = await editor.getByRole("button", { name: "Up item 1", exact: true }).boundingBox();
  const select = await animationOf(editor, 1).boundingBox();
  if (!item || !up || !select) throw new Error("the first item is not shown");
  expect(Math.abs(up.y + up.height - (select.y + select.height))).toBeLessThan(4);
  expect(item.height).toBeLessThan(120);
  // The list stays usable below the editor.
  await expect(page.getByRole("tablist", { name: "Stored files" })).toBeVisible();

  // Opened on a phone, it fills the screen and is modal: the page behind is hidden and Tab stays in the panel.
  await editor.getByRole("button", { name: "Cancel" }).click();
  await page.setViewportSize({ width: 375, height: 700 });
  await page.getByRole("button", { name: "Edit default", exact: true }).click();
  await expect(editor.getByRole("heading", { name: "Edit playlist default" })).toBeFocused();
  const phone = await page.getByTestId("wide-panel").boundingBox();
  if (!phone) throw new Error("the editor is not shown");
  expect(phone).toEqual({ x: 0, y: 0, width: 375, height: 700 });
  await expect(editor.getByRole("button", { name: "Upload to board" })).toBeInViewport();
  await expect(page.getByRole("tablist", { name: "Stored files" })).toHaveCount(0);
  await page.keyboard.press("Shift+Tab");
  expect(await editor.evaluate((panel) => panel.contains(document.activeElement))).toBe(true);
  await editor.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("tablist", { name: "Stored files" })).toBeVisible();
});

test("a discard question asked from the editor still works after the window narrows", async ({ page, simulator }) => {
  copyFileSync(join(simulator.dataDir, "playlists", "default.json"), join(simulator.dataDir, "playlists", "mine.json"));
  await page.setViewportSize({ width: 1280, height: 800 });
  await connectSimulator(page, simulator);
  const { editor } = await openDefault(page, simulator.dataDir);
  await editor.getByLabel("Name", { exact: true }).fill("Changed");
  await page.getByRole("button", { name: "Edit mine", exact: true }).click();
  const ask = page.getByRole("dialog", { name: /^Discard the unsaved changes/ });
  await expect(ask).toBeVisible();

  // The editor was opened on a wide screen and stays as it is: the question stays on top and usable.
  await page.setViewportSize({ width: 375, height: 700 });
  await ask.getByRole("button", { name: "Keep editing" }).click();
  await expect(ask).toHaveCount(0);
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Changed");
});

test("dragging an item's handle with the mouse reorders the playlist", async ({ page, simulator }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await connectSimulator(page, simulator);
  const { editor, before } = await openDefault(page, simulator.dataDir);
  const [first, second, third] = before;

  const from = await handle(editor, 1).boundingBox();
  const target = await editor.getByTestId("playlist-item-3").boundingBox();
  if (!from || !target) throw new Error("the items are not shown");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, target.y + target.height * 0.75, { steps: 12 });
  // While it is dragged the item is marked, and it already sits at its new place.
  await expect(editor.getByTestId("playlist-item-3")).toHaveClass(/ring-primary/);
  await page.mouse.up();

  await expect(animationOf(editor, 1)).toHaveValue(second!);
  await expect(animationOf(editor, 2)).toHaveValue(third!);
  await expect(animationOf(editor, 3)).toHaveValue(first!);
  await expect(editor.getByTestId("reorder-status")).toHaveText(`${first} dropped at position 3 of ${before.length}.`);
  await expect(editor.getByTestId("playlist-item-3")).not.toHaveClass(/ring-primary/);

  expect(await uploadAndRead(page, editor, simulator.dataDir)).toEqual([second, third, first, ...before.slice(3)]);
});

test("the keyboard reorders with the Up and Down buttons, focus follows the item, and the handles are not focusable", async ({
  page,
  simulator,
}) => {
  await connectSimulator(page, simulator);
  const { editor, before } = await openDefault(page, simulator.dataDir);
  const [first, second, third] = before;
  const status = editor.getByTestId("reorder-status");
  const total = before.length;
  const focused = () => page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "");

  // The handles serve a pointer only: nothing in them takes focus or is announced.
  await expect(editor.getByRole("button", { name: /reorder/i })).toHaveCount(0);
  await expect(handle(editor, 1)).not.toHaveAttribute("tabindex");
  expect(await handle(editor, 1).evaluate((element) => element.closest("[aria-hidden=true]") !== null)).toBe(true);
  // Tabbing from the first item's animation backwards reaches the editor's fields, never a handle.
  await animationOf(editor, 1).focus();
  await page.keyboard.press("Shift+Tab");
  await expect(editor.getByLabel("Name", { exact: true })).toBeFocused();

  // Down twice from the keyboard: the item moves, focus stays on its Down button, every move is announced.
  await editor.getByRole("button", { name: "Down item 1", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(status).toHaveText(`${first} moved to position 2 of ${total}.`);
  expect(await focused()).toBe("Down item 2");
  await page.keyboard.press("Space");
  await expect(status).toHaveText(`${first} moved to position 3 of ${total}.`);
  expect(await focused()).toBe("Down item 3");

  // Up from the keyboard, with focus on the moved item's Up button.
  await editor.getByRole("button", { name: "Up item 3", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(status).toHaveText(`${first} moved to position 2 of ${total}.`);
  expect(await focused()).toBe("Up item 2");

  expect(await uploadAndRead(page, editor, simulator.dataDir)).toEqual([second, first, third, ...before.slice(3)]);
});

test("a move to the top or the bottom hands focus to the item's other move button", async ({ page, simulator }) => {
  await connectSimulator(page, simulator);
  const { editor, before } = await openDefault(page, simulator.dataDir);
  const total = before.length;
  const focused = () => page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "");

  await editor.getByRole("button", { name: "Up item 2", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(animationOf(editor, 1)).toHaveValue(before[1]!);
  await expect.poll(focused).toBe("Down item 1");

  await editor.getByRole("button", { name: `Down item ${total - 1}`, exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(animationOf(editor, total)).toHaveValue(before[total - 2]!);
  await expect.poll(focused).toBe(`Up item ${total}`);
});

test("the missing-animation mark sits under the item's animation field, on a wide screen and on a phone", async ({
  page,
  simulator,
}) => {
  const path = join(simulator.dataDir, "playlists", "default.json");
  const missing = (JSON.parse(readFileSync(path, "utf8")).items as Array<{ animation: string }>)[2]!.animation;
  rmSync(join(simulator.dataDir, "animations", `${missing}.json`));
  await connectSimulator(page, simulator);
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 800 });
    const { editor } = await openDefault(page, simulator.dataDir);
    const mark = await editor.getByTestId("item-missing-3").boundingBox();
    const select = await animationOf(editor, 3).boundingBox();
    if (!mark || !select) throw new Error("the mark or the field is not shown");
    expect(Math.abs(mark.x - select.x)).toBeLessThan(2);
    expect(mark.y).toBeGreaterThan(select.y + select.height);
    await editor.getByRole("button", { name: "Close" }).click();
  }
});

/** Sends the pointer events of a touch drag to the page, as a finger would: down on the handle, then moves. */
async function touch(page: Page, type: string, target: Locator | null, clientY: number): Promise<void> {
  const init = { pointerId: 7, pointerType: "touch", isPrimary: true, button: 0, bubbles: true, clientY };
  if (target) await target.dispatchEvent(type, init);
  else
    await page.evaluate(
      ([t, i]) => window.dispatchEvent(new PointerEvent(t as string, i as PointerEventInit)),
      [type, init],
    );
}

test("a cancelled touch drag puts the item back", async ({ page, simulator }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await connectSimulator(page, simulator);
  const { editor, before } = await openDefault(page, simulator.dataDir);
  const target = await editor.getByTestId("playlist-item-3").boundingBox();
  if (!target) throw new Error("the items are not shown");

  await touch(page, "pointerdown", handle(editor, 1), 0);
  await touch(page, "pointermove", null, target.y + target.height * 0.75);
  await expect(animationOf(editor, 3)).toHaveValue(before[0]!);
  await touch(page, "pointercancel", null, target.y + target.height * 0.75);
  await expect(animationOf(editor, 1)).toHaveValue(before[0]!);
  await expect(editor.getByTestId("reorder-status")).toHaveText(
    `Move cancelled. ${before[0]} is back at position 1 of ${before.length}.`,
  );
});

test("a drag resting near the bottom edge keeps scrolling the panel until it leaves the edge", async ({
  page,
  simulator,
}) => {
  await page.setViewportSize({ width: 375, height: 600 });
  await connectSimulator(page, simulator);
  const { editor } = await openDefault(page, simulator.dataDir);
  const panel = page.getByTestId("wide-panel");
  const scrollTop = () => panel.evaluate((element) => element.scrollTop);
  expect(await scrollTop()).toBe(0);

  // One move into the edge zone, then the pointer rests: the panel keeps scrolling on its own.
  await touch(page, "pointerdown", handle(editor, 1), 0);
  await touch(page, "pointermove", null, 600 - 10);
  await expect.poll(scrollTop).toBeGreaterThan(200);

  // Out of the edge zone it stops.
  await touch(page, "pointermove", null, 300);
  const stopped = await scrollTop();
  await page.waitForTimeout(300);
  expect(await scrollTop()).toBe(stopped);

  // Back at the edge it scrolls again, and the end of the drag stops it.
  await touch(page, "pointermove", null, 600 - 10);
  await expect.poll(scrollTop).toBeGreaterThan(stopped);
  await touch(page, "pointerup", null, 600 - 10);
  const ended = await scrollTop();
  await page.waitForTimeout(300);
  expect(await scrollTop()).toBe(ended);
});

test("Remove from the keyboard moves focus to the next item, the previous one, then Add animation, and announces it", async ({
  page,
  simulator,
}) => {
  await connectSimulator(page, simulator);
  const { editor, before } = await openDefault(page, simulator.dataDir);
  const status = editor.getByTestId("reorder-status");
  const total = before.length;
  const focused = () => page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "");

  // The item that takes its place gets focus on its Remove button.
  await editor.getByRole("button", { name: "Remove item 2", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(status).toHaveText(`${before[1]} removed. ${total - 1} items left.`);
  await expect(animationOf(editor, 2)).toHaveValue(before[2]!);
  await expect.poll(focused).toBe("Remove item 2");

  // The last item: the one before it gets focus.
  await editor.getByRole("button", { name: `Remove item ${total - 1}`, exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect.poll(focused).toBe(`Remove item ${total - 2}`);

  // Removing every item leaves focus on Add animation.
  for (let left = total - 2; left > 0; left--) {
    await editor.getByRole("button", { name: "Remove item 1", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(status).toContainText(left === 1 ? "No items left." : `${left - 1} item`);
  }
  await expect(editor.getByRole("button", { name: "Add animation" })).toBeFocused();
});
