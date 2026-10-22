import { copyFileSync, readFileSync } from "node:fs";
import type { Locator, Page } from "@playwright/test";
import { connectSimulator, expect, showPlaylists, type Simulator, stored, test } from "./fixtures";

const editorPanel = (page: Page) => page.getByRole("dialog", { name: "Edit playlist default" });

/** Opens the simulator's playlist `default` in the editor and returns its items as stored. */
async function openDefault(page: Page, simulator: Simulator): Promise<{ editor: Locator; before: string[] }> {
  const path = stored(simulator, "playlists", "default");
  const before = (JSON.parse(readFileSync(path, "utf8")).items as Array<{ animation: string }>).map((i) => i.animation);
  await showPlaylists(page);
  await page.getByRole("button", { name: "Edit default", exact: true }).click();
  const editor = editorPanel(page);
  await expect(editor.getByRole("heading", { name: "Edit playlist default" })).toBeFocused();
  return { editor, before };
}

const animationOf = (editor: Locator, n: number) => editor.getByLabel(`Animation of item ${n}`, { exact: true });
const handle = (editor: Locator, n: number) => editor.getByTestId(`reorder-handle-${n}`);

/** Uploads the editor's playlist and reads back the order of the animations the board stores. */
async function uploadAndRead(page: Page, editor: Locator, simulator: Simulator): Promise<string[]> {
  await editor.getByRole("button", { name: "Upload to board" }).click();
  await expect(editorPanel(page)).toHaveCount(0);
  const saved = JSON.parse(readFileSync(stored(simulator, "playlists", "default"), "utf8"));
  return (saved.items as Array<{ animation: string }>).map((i) => i.animation);
}

test("the playlist editor spans the content width on a wide screen and fills the screen on a phone", async ({
  page,
  simulator,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await connectSimulator(page, simulator);
  const { editor } = await openDefault(page, simulator);
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
  copyFileSync(stored(simulator, "playlists", "default"), stored(simulator, "playlists", "mine"));
  await page.setViewportSize({ width: 1280, height: 800 });
  await connectSimulator(page, simulator);
  const { editor } = await openDefault(page, simulator);
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
  const { editor, before } = await openDefault(page, simulator);
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

  expect(await uploadAndRead(page, editor, simulator)).toEqual([second, third, first, ...before.slice(3)]);
});

test("the keyboard reorders with the Up and Down buttons, focus follows the item, and the handles are not focusable", async ({
  page,
  simulator,
}) => {
  await connectSimulator(page, simulator);
  const { editor, before } = await openDefault(page, simulator);
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

  expect(await uploadAndRead(page, editor, simulator)).toEqual([second, first, third, ...before.slice(3)]);
});

test("a move to the top or the bottom hands focus to the item's other move button", async ({ page, simulator }) => {
  await connectSimulator(page, simulator);
  const { editor, before } = await openDefault(page, simulator);
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
  const { editor, before } = await openDefault(page, simulator);
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
  const { editor } = await openDefault(page, simulator);
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
  const { editor, before } = await openDefault(page, simulator);
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

/** A fixed start for the page's clock, so the tests do not depend on the machine's date or time zone. */
const CLOCK_START = new Date("2026-01-15T10:30:00Z");

/**
 * Stops the page's clock: from here its time, frames and timers move only by `page.clock.runFor`, so a test of the
 * edge scrolling speed or delay gives the same result on a slow runner. Needs `page.clock.install` before the page
 * loads. The installed clock runs until it is paused and `pauseAt` only moves forward, so it aims a second past the
 * page's time, and again if the page got there first. It waits for the board lists first: a request still waiting
 * for its reply when the clock jumps could time out (after 2 s).
 */
async function pauseClock(page: Page): Promise<void> {
  for (const kind of ["animations", "playlists"]) {
    await expect(page.locator("#main")).toHaveAttribute(`data-list-${kind}`, "known");
  }
  for (;;) {
    const target = (await page.evaluate(() => Date.now())) + 1000;
    try {
      await page.clock.pauseAt(target);
      return;
    } catch (error) {
      if (!String(error).includes("Cannot fast-forward to the past")) throw error;
    }
  }
}

/** The part of the panel where the list shows, between the title bar and the button bar that stick to it. */
const visibleBand = (panel: Locator) =>
  panel.evaluate((element) => {
    const box = element.getBoundingClientRect();
    let { top, bottom } = box;
    for (const child of element.children) {
      if (getComputedStyle(child).position !== "sticky") continue;
      const bar = child.getBoundingClientRect();
      if (bar.top <= box.top + 1) top = Math.max(top, bar.bottom);
      else if (bar.bottom >= box.bottom - 1) bottom = Math.min(bottom, bar.top);
    }
    return { top, bottom };
  });

test("near the outer limit of the edge zone the panel scrolls slowly, and a drag that starts there waits first", async ({
  page,
  simulator,
}) => {
  await page.clock.install({ time: CLOCK_START });
  await page.setViewportSize({ width: 375, height: 600 });
  await connectSimulator(page, simulator);
  const { editor } = await openDefault(page, simulator);
  const panel = page.getByTestId("wide-panel");
  const scrollTop = () => panel.evaluate((element) => element.scrollTop);
  const near = (await visibleBand(panel)).bottom - 40;
  await pauseClock(page);

  // The drag starts inside the bottom zone (48 px above the button bar): nothing scrolls for the first 300 ms.
  await touch(page, "pointerdown", handle(editor, 1), near);
  await touch(page, "pointermove", null, near);
  await page.clock.runFor(280);
  expect(await scrollTop()).toBe(0);

  // 8 px into the zone the speed is under 5 px per 60 Hz frame: well under 400 px in the next second.
  await page.clock.runFor(1170);
  const after = await scrollTop();
  expect(after).toBeGreaterThan(0);
  expect(after).toBeLessThan(400);
  await touch(page, "pointerup", null, near);
});

test("scrolling up while dragging is as fast as scrolling down", async ({ page, simulator }) => {
  await page.clock.install({ time: CLOCK_START });
  await page.setViewportSize({ width: 375, height: 600 });
  await connectSimulator(page, simulator);
  const { editor } = await openDefault(page, simulator);
  const panel = page.getByTestId("wide-panel");
  const scrollTop = () => panel.evaluate((element) => element.scrollTop);
  const band = await visibleBand(panel);
  const middle = await panel.evaluate((element) => Math.round((element.scrollHeight - element.clientHeight) / 2));
  await pauseClock(page);

  /** Drags item 10 to `y` from the middle of the list and returns how far the panel scrolled in one second. */
  async function scrolledFrom(y: number): Promise<number> {
    await panel.evaluate((element, top) => (element.scrollTop = top), middle);
    const grip = handle(editor, 10);
    await grip.scrollIntoViewIfNeeded();
    const box = await grip.boundingBox();
    if (!box) throw new Error("the handle is not shown");
    await touch(page, "pointerdown", grip, box.y + 4);
    await touch(page, "pointermove", null, box.y + 5);
    const before = await scrollTop();
    await touch(page, "pointermove", null, y);
    await page.clock.runFor(1000);
    const moved = Math.abs((await scrollTop()) - before);
    await touch(page, "pointerup", null, y);
    return moved;
  }

  // The same depth into each zone, 24 px from the inner edge of each bar.
  const down = await scrolledFrom(band.bottom - 24);
  const up = await scrolledFrom(band.top + 24);
  expect(down).toBeGreaterThan(100);
  expect(up / down).toBeGreaterThan(0.8);
  expect(up / down).toBeLessThan(1.25);
});
