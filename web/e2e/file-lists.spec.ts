// SPDX-License-Identifier: GPL-3.0-or-later

import type { Page } from "@playwright/test";
import { watchBoard } from "./board";
import { animations, animationYaml, connectSimulator, expect, pick, showFiles, test, upload } from "./fixtures";
import { connectScripted, scriptedBoard, type Scripted } from "./scripted";

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
  await showFiles(page);
  await expect(animations(page)).toContainText("ball");
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
  await pick(page, upload("one.yaml", animationYaml("One")));
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
  await showFiles(page);
  await expect(animations(page)).toBeVisible();
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
  await showFiles(page);
  await page.getByRole("button", { name: "Retry" }).first().click();
  await expect(animations(page)).toContainText("ball");
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

test("a board that knows schedules lists them as a third group, uploads one by its format and deletes it", async ({
  page,
}) => {
  const board = await scriptedBoard(page);
  board.info = {
    formats: { animation: ["pixelart/1"], playlist: ["pixelart-playlist/1"], schedule: ["pixelart-schedule/1"] },
    limits: { line: 1024, chunk: 512, page: 8, animation: 65536, playlist: 16384, schedule: 16384 },
  };
  board.settings = {
    ...board.settings,
    play: "auto",
    playlists: ["default"],
    time_sync_hours: 6,
    ntp_server: "pool.ntp.org",
  };
  board.files.playlist.set("default", Buffer.from("{}"));
  await connectScripted(page, board);
  const tab = page.getByRole("tab", { name: /^Schedules/ });
  await expect(tab).toContainText("0");
  await tab.click();
  await expect(page.getByText("No schedules on this board")).toBeVisible();

  await pick(
    page,
    upload(
      "seasons.yaml",
      "format: pixelart-schedule/1\nname: Seasons\nfallback: [default]\nentries:\n  - from: { month: 12 }\n    to: { month: 12 }\n    playlists: [default]\n",
    ),
  );
  const table = page.getByRole("table", { name: "Schedules on the board" });
  await expect(table).toContainText("seasons");
  await expect(tab).toContainText("1");
  const stored = JSON.parse(board.files.schedule.get("seasons")?.toString() ?? "null");
  expect(stored).toMatchObject({ format: "pixelart-schedule/1", entries: [{ from: { month: 12 } }] });

  await page.getByRole("button", { name: "More actions for seasons" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText("No schedules on this board")).toBeVisible();
  expect(board.files.schedule.size).toBe(0);
});

test("a schedule picked for a board from before schedules is not sent", async ({ page }) => {
  const board = await connected(page);
  await pick(page, upload("seasons.json", '{"format":"pixelart-schedule/1","fallback":["mix"]}'));
  await expect(page.getByRole("alert").filter({ hasText: "does not know schedules" })).toBeVisible();
  expect(board.requests.some((r) => r.kind === "schedule")).toBe(false);
});
