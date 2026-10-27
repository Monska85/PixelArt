// SPDX-License-Identifier: GPL-3.0-or-later

import { existsSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { closeInstallDialog, fakeSerial, portLog } from "./first-install";
import { expect, stored, summary, test, type Simulator } from "./fixtures";

const published = JSON.parse(
  readFileSync(fileURLToPath(new URL("./site/published.json", import.meta.url)), "utf8"),
) as { animations: string[]; playlists: string[] };

const BOX = "Then install the animations and playlists";
const files = (simulator: Simulator): string[] => [
  ...published.animations.map((id) => stored(simulator, "animations", id)),
  ...published.playlists.map((id) => stored(simulator, "playlists", id)),
];

/** A board that has just been flashed with an empty file system: none of the published files is there. */
function emptyBoard(simulator: Simulator): void {
  for (const path of files(simulator)) rmSync(path, { force: true });
}

test("installs the published animations and playlists over the port ESP Web Tools used", async ({
  page,
  simulator,
}) => {
  emptyBoard(simulator);
  // The port fails twice first, as a port does while the board restarts: the app tries again every second.
  await fakeSerial(page, { board: simulator.address, failOpens: 2 });
  await page.goto("/#firmware");
  await expect(page.getByRole("checkbox", { name: BOX })).toBeChecked();
  await expect(page.getByText(/Keep the board connected until they are installed/)).toBeVisible();

  await closeInstallDialog(page, { state: "finished" });
  await expect(page.getByTestId("activity")).toContainText("Installing the animations and playlists of release 0.2.0");
  await expect(summary(page)).toContainText("Installed");
  for (const path of files(simulator)) expect(existsSync(path), path).toBe(true);
  await expect(page.getByTestId("connection-state")).toHaveText("Connected");
  expect(await portLog(page)).toEqual({ opens: 3, pickerRequests: 0 });
  await expect(page.getByTestId("content-not-installed")).toHaveCount(0);
});

test("installs nothing when the box is unchecked", async ({ page, simulator }) => {
  emptyBoard(simulator);
  await fakeSerial(page, { board: simulator.address });
  await page.goto("/#firmware");
  await page.getByRole("checkbox", { name: BOX }).uncheck();
  await closeInstallDialog(page, { state: "finished" });
  await expect(page.getByTestId("connection-state")).toHaveText("Not connected");
  expect(await portLog(page)).toEqual({ opens: 0, pickerRequests: 0 });
  for (const path of files(simulator)) expect(existsSync(path), path).toBe(false);
});

test("does nothing when the dialog closes before its installation finished, or after Update firmware", async ({
  page,
  simulator,
}) => {
  emptyBoard(simulator);
  await fakeSerial(page, { board: simulator.address });
  await page.goto("/#firmware");
  await expect(page.getByRole("checkbox", { name: BOX })).toBeChecked();
  await closeInstallDialog(page, { state: null });
  await closeInstallDialog(page, { state: "preparing" });
  await closeInstallDialog(page, { state: "error" });
  await closeInstallDialog(page, { state: "finished", manifest: "./firmware/update.json" });
  await expect(page.getByTestId("connection-state")).toHaveText("Not connected");
  expect(await portLog(page)).toEqual({ opens: 0, pickerRequests: 0 });
  for (const path of files(simulator)) expect(existsSync(path), path).toBe(false);
  await expect(page.getByTestId("content-not-installed")).toHaveCount(0);
});

test.describe("a board that never answers", () => {
  // The app tries for 20 seconds, and the last try waits for the board's answer.
  test.setTimeout(120_000);

  test("gets the alert, with a way to connect and the Library", async ({ page, simulator }) => {
    emptyBoard(simulator);
    await fakeSerial(page, { board: null });
    await page.goto("/#firmware");
    await expect(page.getByRole("checkbox", { name: BOX })).toBeChecked();
    await closeInstallDialog(page, { state: "finished" });
    const alert = page.getByTestId("content-not-installed");
    await expect(alert).toContainText("The animations and playlists were not installed", { timeout: 90_000 });
    await expect(alert).toContainText("no animations");
    await expect(alert.getByRole("button", { name: "Connect board" })).toBeVisible();
    await expect(alert.getByRole("link", { name: "Library view" })).toHaveAttribute("href", "#library");
    await expect(page.getByTestId("activity")).toHaveCount(0);
    expect((await portLog(page)).opens).toBeGreaterThan(1);
    for (const path of files(simulator)) expect(existsSync(path), path).toBe(false);
  });
});
