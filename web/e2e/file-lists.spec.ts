import type { Page } from "@playwright/test";
import { watchBoard } from "../screenshots/board";
import { connectSimulator, expect, test } from "./fixtures";
import { connectScripted, scriptedBoard, type Scripted } from "./scripted";

const animationYaml = (name: string): string =>
  `format: pixelart/1\nname: ${name}\ncanvas: { width: 16, height: 16 }\nsprites:\n  dot:\n    points: [[7, 7, "#ff0000"]]\ntimeline:\n  - show: [dot]\n`;

/** The kinds of the lists the page asked for since `since` requests (first pages only), in order. */
const listed = (board: Scripted, since: number): unknown[] =>
  board.requests
    .slice(since)
    .filter((r) => r.cmd === "list" && r.after === undefined)
    .map((r) => r.kind);

async function connected(page: Page): Promise<Scripted> {
  const board = await scriptedBoard(page);
  board.files.animation.set("ball", Buffer.from("{}"));
  board.files.playlist.set("mix", Buffer.from("{}"));
  await connectScripted(page, board);
  await expect(page.getByRole("table", { name: "Animations on the board" })).toContainText("ball");
  await expect(page.getByRole("table", { name: "Playlists on the board", includeHidden: true })).toContainText("mix");
  return board;
}

test("deleting one file reads the list of its kind again, and only that one", async ({ page }) => {
  const board = await connected(page);
  let since = board.requests.length;
  await page.getByRole("button", { name: "More actions for ball" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect.poll(() => listed(board, since)).toEqual(["animation"]);

  since = board.requests.length;
  await page.getByRole("tab", { name: /Playlists/ }).click();
  await page.getByRole("button", { name: "More actions for mix" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect.poll(() => listed(board, since)).toEqual(["playlist"]);
});

for (const via of ["Board", "Firmware"] as const) {
  test(`Delete everything in the ${via} view reads both lists again`, async ({ page }) => {
    const board = await connected(page);
    if (via === "Firmware") {
      await page.getByRole("link", { name: "Firmware" }).click();
      await page.getByRole("button", { name: "Delete everything" }).click();
    } else {
      await page.getByRole("button", { name: "More", exact: true }).click();
      await page.getByRole("menuitem", { name: "Delete everything" }).click();
    }
    // The dialog counts the files with lists of its own: only what follows the confirmation counts.
    const since = board.requests.length;
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /^Delete \d+ files$/ })
      .click();
    await expect.poll(() => listed(board, since).sort()).toEqual(["animation", "playlist"]);
  });
}

test("an upload reads the list of the kind it stored again", async ({ page }) => {
  const board = await connected(page);
  await page
    .locator("#upload-input")
    .setInputFiles([{ name: "one.yaml", mimeType: "application/yaml", buffer: Buffer.from(animationYaml("One")) }]);
  await expect.poll(() => board.requests.some((r) => r.cmd === "put_end")).toBe(true);
  // The queue lists the board before it sends; what follows the last file is the refresh.
  const sent = (): number => board.requests.findLastIndex((r) => r.cmd === "put_end") + 1;
  await expect.poll(() => listed(board, sent()).includes("animation")).toBe(true);
  expect(listed(board, sent())).not.toContain("playlist");
});

test("a list that is still being read is not shown as empty", async ({ page, simulator }) => {
  const watch = await watchBoard(page, simulator);
  watch.hold("list");
  await connectSimulator(page, simulator);
  await expect(page.getByText("Reading the files from the board...").first()).toBeVisible();
  await expect(page.getByText("No animations on this board")).toHaveCount(0);
  await expect(page.getByText("No playlists on this board")).toHaveCount(0);
  watch.release();
  await expect(page.getByRole("table", { name: "Animations on the board" })).toBeVisible();
});

test("a list that could not be read says so and Retry reads it again, and the failure is reported once", async ({
  page,
}) => {
  const board = await scriptedBoard(page);
  board.files.animation.set("ball", Buffer.from("{}"));
  board.failLists = true;
  await connectScripted(page, board);
  await expect(page.getByText("Could not read the files from the board.").first()).toBeVisible();
  await expect(page.getByText("No animations on this board")).toHaveCount(0);
  const reports = page.getByRole("alert").filter({ hasText: "Reading the board" });
  // One report for each of the two lists that failed.
  await expect(reports).toHaveCount(2);

  // The same failure is not reported again by a view that opens later.
  await page.getByRole("link", { name: "Library" }).click();
  await page.getByRole("link", { name: "Board", exact: true }).click();
  await expect(page.getByText("Could not read the files from the board.").first()).toBeVisible();
  await expect(reports).toHaveCount(0);

  board.failLists = false;
  await page.getByRole("button", { name: "Retry" }).first().click();
  await expect(page.getByRole("table", { name: "Animations on the board" })).toContainText("ball");
});

test("settings that could not be read say so and Retry reads the settings only", async ({ page }) => {
  const board = await scriptedBoard(page);
  board.failSettings = 1;
  await connectScripted(page, board);
  const card = page.getByRole("region", { name: "Settings" });
  await expect(card.getByText("Could not read the board's settings.")).toBeVisible();
  await expect(page.getByRole("slider", { name: "Brightness" })).toHaveCount(0);

  const since = board.requests.length;
  await card.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("slider", { name: "Brightness" })).toBeVisible();
  await expect(card.getByText("Could not read the board's settings.")).toHaveCount(0);
  expect(board.requests.slice(since).map((r) => r.cmd)).toEqual(["settings_get"]);
});
