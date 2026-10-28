// SPDX-License-Identifier: GPL-3.0-or-later

// "What to play" and the time settings on a firmware that knows schedules: the simulator, with the schedule of
// e2e/board-files/schedules/default.json (Quiet season, February 1 to March 15, plays holiday; the fallback is
// default).

import { existsSync } from "node:fs";
import type { Page } from "@playwright/test";
import {
  connectSimulator,
  expect,
  showBoardPlaylists,
  showBoardSchedules,
  stored,
  test,
  watchRequests,
} from "./fixtures";

const settingsCard = (page: Page) => page.getByRole("region", { name: "Settings" });
const automatic = (page: Page) => page.getByTestId("play-auto");
const mine = (page: Page) => page.getByTestId("play-playlists");
const list = (page: Page) => page.getByRole("list", { name: "My playlists, in the order they play" });
/** The fields of every settings_set the page sent, without seq and cmd. */
const sent = (requests: Array<Record<string, unknown>>) =>
  requests.map((request) =>
    Object.fromEntries(Object.entries(request).filter(([key]) => key !== "seq" && key !== "cmd")),
  );

test.describe("on a date of the schedule", () => {
  test.use({ simulatorArgs: ["--date", "2026-02-10"], timezoneId: "UTC" });

  test("Automatic says what the board plays, the next change, and shows the schedule", async ({ page, simulator }) => {
    await page.clock.setFixedTime(new Date("2026-02-10T12:00:00Z"));
    await connectSimulator(page, simulator);
    await expect(page.getByRole("radio", { name: "Automatic" })).toBeChecked();
    await expect(automatic(page).getByTestId("play-now")).toHaveText(
      "Now: Quiet season is on: the board plays holiday.",
    );
    await expect(automatic(page).getByTestId("play-next")).toHaveText(
      "Next change: March 16, 2026, the fallback: default.",
    );
    // The schedule, read only, with today's entry marked by a word.
    const show = automatic(page).getByRole("button", { name: "Show the schedule" });
    await expect(show).toHaveAttribute("aria-expanded", "false");
    await show.click();
    const view = page.getByRole("table", { name: "Seasons, stored on this board" });
    await expect(view.getByRole("row", { name: /Quiet season/ })).toContainText("February 1 to March 15");
    await expect(view.getByRole("row", { name: /Quiet season/ })).toContainText("Today");
    await expect(view.getByRole("row", { name: /Fallback/ })).toContainText("default");
    await expect(page.getByRole("button", { name: "Hide the schedule" })).toHaveAttribute("aria-expanded", "true");
    // The playlist the board plays is the active one.
    await showBoardPlaylists(page);
    const playlists = page.getByRole("table", { name: "Playlists on the board" });
    await expect(playlists.getByTestId("active-holiday")).toHaveText("Active");
    await expect(playlists.getByTestId("active-default")).toHaveCount(0);
  });
});

test("without a date, Automatic plays the fallback and says why", async ({ page, simulator }) => {
  await connectSimulator(page, simulator);
  await expect(automatic(page).getByTestId("play-now")).toHaveText(
    "Now: The board does not know the date yet: it plays the fallback, default.",
  );
});

test("without a schedule, Automatic plays the playlist default", async ({ page, simulator }) => {
  await connectSimulator(page, simulator);
  // Deleting the schedule Automatic plays says what follows, and the board chooses again.
  await showBoardSchedules(page);
  await page.getByRole("button", { name: "More actions for default" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete default?" });
  await expect(dialog).toContainText("Automatic plays this schedule: the board will then play the playlist default.");
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText("No schedules on this board")).toBeVisible();
  expect(existsSync(stored(simulator, "schedules", "default"))).toBe(false);
  await expect(automatic(page).getByTestId("play-now")).toHaveText(
    "Now: The board stores no valid schedule default: it plays the playlist default.",
  );
  await expect(automatic(page).getByTestId("no-schedule")).toContainText("This board stores no schedule");
  await expect(automatic(page).getByTestId("no-schedule")).toContainText("The site publishes the schedule below");
});

test("My playlists: choose, add, reorder, remove, and each change sends only what changed", async ({
  page,
  simulator,
}) => {
  const requests = watchRequests(page, "settings_set");
  await connectSimulator(page, simulator);
  // A board that never stored play reads its playlist: default means Automatic, with the list [default].
  await expect(list(page).getByRole("listitem")).toHaveText([/default: Christmas/]);
  await expect(list(page).getByRole("button", { name: "Remove default, playlist 1" })).toBeDisabled();

  await page.getByRole("radio", { name: "My playlists" }).check();
  await expect(page.getByRole("radio", { name: "My playlists" })).toBeChecked();
  await expect.poll(() => sent(requests)).toEqual([{ play: "playlists" }]);

  await mine(page).getByLabel("Add a playlist").selectOption("holiday");
  await mine(page).getByRole("button", { name: "Add" }).click();
  await expect(list(page).getByRole("listitem")).toHaveText([/default/, /holiday: Quiet evening/]);
  await expect.poll(() => sent(requests).at(-1)).toEqual({ playlists: ["default", "holiday"] });
  // Every stored playlist is in the list: nothing more to add.
  await expect(mine(page).getByRole("button", { name: "Add" })).toBeDisabled();

  // The keyboard moves an item with its buttons, and focus stays on the item's other move button at the top.
  const up = list(page).getByRole("button", { name: "Up holiday, playlist 2" });
  await up.focus();
  await page.keyboard.press("Enter");
  await expect(list(page).getByRole("listitem")).toHaveText([/holiday/, /default/]);
  await expect.poll(() => sent(requests).at(-1)).toEqual({ playlists: ["holiday", "default"] });
  await expect(list(page).getByRole("button", { name: "Down holiday, playlist 1" })).toBeFocused();
  await expect(page.getByTestId("my-playlists-status")).toHaveText("holiday moved to position 1 of 2.");

  // A pointer drags the handle: one request, at the drop.
  const before = requests.length;
  const handle = await page.getByTestId("my-playlist-handle-1").boundingBox();
  const target = await page.getByTestId("my-playlist-2").boundingBox();
  if (!handle || !target) throw new Error("the list is not shown");
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, target.y + target.height * 0.9, { steps: 8 });
  expect(requests.length).toBe(before);
  await page.mouse.up();
  await expect.poll(() => sent(requests).at(-1)).toEqual({ playlists: ["default", "holiday"] });
  expect(requests.length).toBe(before + 1);

  await list(page).getByRole("button", { name: "Remove default, playlist 1" }).click();
  await expect(list(page).getByRole("listitem")).toHaveText([/holiday/]);
  await expect.poll(() => sent(requests).at(-1)).toEqual({ playlists: ["holiday"] });
  await expect(list(page).getByRole("button", { name: "Remove holiday, playlist 1" })).toBeDisabled();

  // The board plays the user's list: the first playlist is the active one.
  await showBoardPlaylists(page);
  await expect(page.getByTestId("active-holiday")).toBeVisible();
});

test("the list is kept while Automatic plays, and can be changed meanwhile", async ({ page, simulator }) => {
  const requests = watchRequests(page, "settings_set");
  await connectSimulator(page, simulator);
  await mine(page).getByLabel("Add a playlist").selectOption("holiday");
  await mine(page).getByRole("button", { name: "Add" }).click();
  // playlists alone keeps Automatic.
  await expect.poll(() => sent(requests)).toEqual([{ playlists: ["default", "holiday"] }]);
  await expect(page.getByRole("radio", { name: "Automatic" })).toBeChecked();
  await expect(mine(page)).toContainText("Automatic is on. This list is kept");

  await page.getByRole("radio", { name: "My playlists" }).check();
  await page.getByRole("radio", { name: "Automatic" }).check();
  await expect
    .poll(() => sent(requests))
    .toEqual([{ playlists: ["default", "holiday"] }, { play: "playlists" }, { play: "auto" }]);
  await expect(list(page).getByRole("listitem")).toHaveText([/default/, /holiday/]);
});

test("a playlist of the list that is not stored is marked, and a change leaves it out", async ({ page, simulator }) => {
  const requests = watchRequests(page, "settings_set");
  await connectSimulator(page, simulator);
  await mine(page).getByLabel("Add a playlist").selectOption("holiday");
  await mine(page).getByRole("button", { name: "Add" }).click();
  await expect(list(page).getByRole("listitem")).toHaveCount(2);

  // holiday is deleted while the list names it: the board keeps it and skips it.
  await showBoardPlaylists(page);
  await page.getByRole("button", { name: "More actions for holiday" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByTestId("my-playlist-missing-holiday")).toHaveText("Not stored");
  await expect(page.getByTestId("my-playlists-missing")).toHaveText(
    "The playlist holiday is not stored, so the board skips it. A change to the list leaves out what the board does not store.",
  );

  await list(page).getByRole("button", { name: "Up holiday, playlist 2" }).click();
  await expect.poll(() => sent(requests).at(-1)).toEqual({ playlists: ["default"] });
  await expect(list(page).getByRole("listitem")).toHaveText([/default/]);
});

test.describe("the time settings", () => {
  test.use({ timezoneId: "Europe/Rome" });

  test("time zone, time sync and time server, each sent when it changes", async ({ page, simulator }) => {
    const requests = watchRequests(page, "settings_set");
    await connectSimulator(page, simulator);
    const time = settingsCard(page).getByTestId("time-settings");
    // The board starts on UTC; the browser is in Rome.
    await expect(time.getByLabel("Time zone")).toHaveValue("UTC");
    await expect(time).toContainText("This browser is in Europe/Rome, and the board uses another time zone.");
    await time.getByRole("button", { name: "Use Europe/Rome" }).click();
    await expect.poll(() => sent(requests)).toEqual([{ timezone: "CET-1CEST,M3.5.0,M10.5.0/3" }]);
    await expect(time.getByLabel("Time zone")).toHaveValue("Europe/Rome");
    await expect(time.getByRole("button", { name: "Use Europe/Rome" })).toHaveCount(0);
    // The install window reads the same zone, and sends none of its own.
    await expect(page.getByTestId("time-zone")).toHaveText(
      "Time zone: Europe/Rome, set under Time in the Settings card.",
    );

    await time.getByLabel("Time zone").selectOption("Asia/Tokyo");
    await expect.poll(() => sent(requests).at(-1)).toEqual({ timezone: "JST-9" });

    const hours = time.getByLabel("Time sync every (hours)");
    await expect(hours).toHaveValue("6");
    await hours.fill("0");
    await hours.press("Enter");
    await expect(time).toContainText("A whole number of hours from 1 to 168.");
    await hours.fill("24");
    await hours.press("Enter");
    await expect.poll(() => sent(requests).at(-1)).toEqual({ time_sync_hours: 24 });

    const server = time.getByLabel("Time server");
    await expect(server).toHaveValue("pool.ntp.org");
    await expect(time.getByTestId("time-server-note")).toHaveText(
      "The board asks this server for the time when Automatic plays a schedule or the install window is narrower than the whole day. The request carries none of your data; the server sees the board's IP address.",
    );
    await server.fill("time server!");
    await expect(time).toContainText("A host name or IPv4 address of 1 to 64 characters");
    await expect(time.getByRole("button", { name: "Save server" })).toBeDisabled();
    await server.fill("time.example.org");
    await time.getByRole("button", { name: "Save server" }).click();
    await expect.poll(() => sent(requests).at(-1)).toEqual({ ntp_server: "time.example.org" });
    await time.getByRole("button", { name: "Reset to pool.ntp.org" }).click();
    await expect.poll(() => sent(requests).at(-1)).toEqual({ ntp_server: "pool.ntp.org" });
    await expect(server).toHaveValue("pool.ntp.org");
    expect(requests).toHaveLength(5);
  });
});
