import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
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
