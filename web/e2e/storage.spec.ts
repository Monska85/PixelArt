// SPDX-License-Identifier: GPL-3.0-or-later

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { watchBoard } from "./board";
import {
  animations,
  connectSimulator,
  expect,
  file,
  pick,
  showFiles,
  test,
  toastWith,
  watchRequests,
} from "./fixtures";

const count = (dataDir: string, kind: string): number => readdirSync(join(dataDir, kind)).length;
const card = (page: import("@playwright/test").Page) => page.getByRole("region", { name: "Storage" });
/** The free space the card shows, in bytes of the unit it names (KB). */
const freeKb = async (page: import("@playwright/test").Page): Promise<number> =>
  Number(/([\d.]+) KB free/.exec(await card(page).getByTestId("storage-free").innerText())?.[1]);

test("the Storage card shows the free space and the stored files, and follows an upload and a deletion", async ({
  page,
  simulator,
}) => {
  await connectSimulator(page, simulator);
  const animations = count(simulator.dataDir, "animations");
  const playlists = count(simulator.dataDir, "playlists");
  const schedules = count(simulator.dataDir, "schedules");
  await expect(card(page).getByTestId("storage-free")).toContainText("KB free of");
  await expect(card(page).getByRole("progressbar", { name: "Storage used" })).toBeVisible();
  await expect(card(page).getByTestId("storage-files")).toContainText(
    `${animations} animations, ${playlists} playlist${playlists === 1 ? "" : "s"} and ${schedules} schedule${schedules === 1 ? "" : "s"} stored.`,
  );
  await expect(card(page).getByTestId("storage-estimate")).toContainText(/^Estimate: about \d+ more animations/);
  await expect(card(page).getByTestId("storage-warning")).toHaveCount(0);
  const before = await freeKb(page);

  // An upload takes at least one block (4 KB) and the card reads the storage again.
  await pick(page, file("dot.yaml"));
  await expect(toastWith(page, "Uploaded animation dot")).toBeVisible();
  await expect(card(page).getByTestId("storage-files")).toContainText(`${animations + 1} animations`);
  await expect.poll(() => freeKb(page)).toBeLessThanOrEqual(before - 4);

  // Delete everything leaves no animation to take an average from.
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Delete everything" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^Delete \d+ files$/ })
    .click();
  await expect(card(page).getByTestId("storage-files")).toContainText(
    "0 animations, 0 playlists and 0 schedules stored.",
  );
  await expect(card(page).getByTestId("storage-estimate")).toHaveText(
    "Store an animation to see how many more would fit.",
  );
  await expect.poll(() => freeKb(page)).toBeGreaterThan(before);
});

test("the Storage card reads the storage again after a single file is deleted", async ({ page, simulator }) => {
  const infos = watchRequests(page, "info");
  await connectSimulator(page, simulator);
  await showFiles(page);
  const files = count(simulator.dataDir, "animations");
  await expect(card(page).getByTestId("storage-files")).toContainText(`${files} animations`);
  const before = await freeKb(page);
  const requested = infos.length;

  const row = animations(page).locator("tr", { has: page.locator("code", { hasText: /^star$/ }) });
  await row.getByRole("button", { name: "More actions for star" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(row).toHaveCount(0);

  // The request that reads the storage was sent, and the card shows the new count and more free space.
  await expect.poll(() => infos.length).toBeGreaterThan(requested);
  await expect(card(page).getByTestId("storage-files")).toContainText(`${files - 1} animations`);
  await expect.poll(() => freeKb(page)).toBeGreaterThan(before);
});

test.describe("on a board that is nearly full", () => {
  test("the card warns when less than one average animation is left", async ({ page, simulator }) => {
    // 240 blocks in all, 239 used and one free: the files of the simulator are larger than a block on average.
    await watchBoard(page, simulator, { storage: { total: 983_040, used: 983_040 - 4_096 } });
    await connectSimulator(page, simulator);
    await expect(card(page).getByTestId("storage-warning")).toContainText("Space is low");
    await expect(card(page).getByTestId("storage-estimate")).toContainText("about 0 more animations");
  });

  test("the card says when the board is full", async ({ page, simulator }) => {
    await watchBoard(page, simulator, { storage: { total: 983_040, used: 983_040 } });
    await connectSimulator(page, simulator);
    await expect(card(page).getByTestId("storage-free")).toContainText("0 B free of");
    await expect(card(page).getByTestId("storage-warning")).toContainText("The board is full");
  });
});
