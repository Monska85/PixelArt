// SPDX-License-Identifier: GPL-3.0-or-later

import type { Page } from "@playwright/test";
import { expect, showFiles, test } from "./fixtures";
import { connectScripted, scriptedBoard } from "./scripted";

/** A board of an older firmware: another protocol version or other file formats. */
async function oldBoard(page: Page, info: { protocol: number; formats: { animation: string[]; playlist: string[] } }) {
  const board = await scriptedBoard(page);
  board.info = { firmware: "0.0.1", board: "old", ...info };
  await connectScripted(page, board);
}

test("offers the Firmware view when the board speaks another protocol", async ({ page }) => {
  await oldBoard(page, { protocol: 2, formats: { animation: ["pixelart/1"], playlist: ["pixelart-playlist/1"] } });
  const message = page.getByTestId("connection-message");
  await expect(message).toContainText("protocol 2");
  await message.getByRole("link", { name: "Open the Firmware view" }).click();
  await expect(page.getByRole("link", { name: "Firmware", exact: true })).toHaveAttribute("aria-current", "page");
});

test("offers the Firmware view where uploads are blocked by the file formats of the board", async ({ page }) => {
  await oldBoard(page, { protocol: 1, formats: { animation: ["pixelart/0"], playlist: ["pixelart-playlist/1"] } });
  await expect(page.getByTestId("connection-state")).toHaveText("Connected");
  for (const view of ["Board", "Library", "Editor"]) {
    await page.getByRole("link", { name: view, exact: true }).click();
    const note = page.getByTestId("blocked-note");
    await expect(note).toContainText("does not read the file formats");
    await expect(note.getByRole("link", { name: "Open the Firmware view" })).toBeVisible();
  }
  await page.getByTestId("blocked-note").getByRole("link", { name: "Open the Firmware view" }).click();
  await expect(page.getByRole("link", { name: "Firmware", exact: true })).toHaveAttribute("aria-current", "page");
});

test("tells a board on the old flash layout to use Install from scratch once", async ({ page }) => {
  const board = await scriptedBoard(page);
  board.storage = { total: 0x160000, used: 8192 };
  await connectScripted(page, board);
  await page.getByRole("link", { name: "Firmware", exact: true }).click();
  const warning = page.getByTestId("old-layout");
  await expect(warning).toContainText("This board needs Install from scratch once");
  await expect(warning).toContainText("Update firmware cannot move its stored files");
});

test("does not warn a board on the current flash layout", async ({ page }) => {
  const board = await scriptedBoard(page);
  board.storage = { total: 0xf0000, used: 8192 };
  await connectScripted(page, board);
  await page.getByRole("link", { name: "Firmware", exact: true }).click();
  await expect(page.getByTestId("firmware-check")).toBeVisible();
  await expect(page.getByTestId("old-layout")).toHaveCount(0);
});

test("a firmware from before schedules keeps the Active playlist, and asks only what it knows", async ({ page }) => {
  const board = await scriptedBoard(page);
  board.files.playlist.set("default", Buffer.from("{}"));
  board.files.playlist.set("mine", Buffer.from("{}"));
  await connectScripted(page, board);
  const card = page.getByRole("region", { name: "Settings" });
  await expect(card.getByLabel("Active playlist")).toHaveValue("default");
  await expect(page.getByTestId("what-to-play")).toHaveCount(0);
  await expect(page.getByTestId("time-settings")).toHaveCount(0);
  await expect(page.getByTestId("files-summary")).toHaveText("0 animations, 2 playlists, active playlist: default");
  await showFiles(page);
  await expect(page.getByRole("tab", { name: /^Playlists/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /^Schedules/ })).toHaveCount(0);

  await card.getByLabel("Active playlist").selectOption("mine");
  await expect(card.getByLabel("Active playlist")).toHaveValue("mine");
  await expect(page.getByTestId("files-summary")).toHaveText("0 animations, 2 playlists, active playlist: mine");
  const set = board.requests.filter((r) => r.cmd === "settings_set");
  expect(set.map((request) => ({ ...request, seq: 0 }))).toEqual([{ seq: 0, cmd: "settings_set", playlist: "mine" }]);
  // The board was never asked about schedules.
  expect(board.requests.some((r) => r.kind === "schedule")).toBe(false);
});
