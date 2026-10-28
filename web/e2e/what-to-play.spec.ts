// SPDX-License-Identifier: GPL-3.0-or-later

// "What to play" and the time settings on a firmware that knows schedules: the simulator, with the schedule of
// e2e/board-files/schedules/default.json (Quiet season, February 1 to March 15, plays holiday; the fallback is
// default) and, where a test adds it, e2e/files/summer.json (Beach days, June 1 to August 31, plays default; the
// fallback is holiday).

import { copyFileSync, existsSync, writeFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { setServerChoice } from "./board";
import {
  connectSimulator,
  expect,
  file,
  showBoardPlaylists,
  showBoardSchedules,
  stored,
  test,
  watchRequests,
  type Simulator,
} from "./fixtures";

const settingsCard = (page: Page) => page.getByRole("region", { name: "Settings" });
const automatic = (page: Page) => page.getByTestId("play-auto");
const mine = (page: Page) => page.getByTestId("play-mine");
const choice = (page: Page, name: "Automatic" | "My choice") => page.getByRole("radio", { name, exact: true });
const segment = (page: Page, name: "Playlists" | "Schedule") => page.getByRole("radio", { name, exact: true });
const announced = (page: Page) => page.getByTestId("what-to-play-status");
/** The Active mark of a schedule row: a playlist of the same ID has its own. */
const activeSchedule = (page: Page, id: string) =>
  page.getByRole("table", { name: "Schedules on the board" }).getByTestId(`active-${id}`);
const addSummer = (simulator: Simulator): void =>
  copyFileSync(file("summer.json"), stored(simulator, "schedules", "summer"));
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
    await expect(choice(page, "Automatic")).toBeChecked();
    await expect(automatic(page).getByTestId("server-choice")).toHaveText(
      "The site has not chosen what to play, so the board plays the schedule default.",
    );
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
  await expect(automatic(page).getByTestId("server-choice")).toHaveText(
    "The site has not chosen what to play, so the board plays the playlist default.",
  );

  // Schedule is then disabled, with a link to the Schedules tab of the Files section.
  await expect(segment(page, "Schedule")).toBeDisabled();
  await page.getByRole("button", { name: "Schedules tab of Files" }).click();
  const tab = page.getByRole("tab", { name: /^Schedules/ });
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(tab).toBeFocused();
  await expect(page.getByText("No schedules on this board")).toBeVisible();
});

test("My choice, Playlists: choose, add, reorder, remove, and each change sends only what changed", async ({
  page,
  simulator,
}) => {
  const requests = watchRequests(page, "settings_set");
  await connectSimulator(page, simulator);
  // A board that never stored play reads its playlist: default means Automatic, with the list [default].
  await expect(choice(page, "Automatic")).toBeChecked();
  await expect(segment(page, "Playlists")).toBeChecked();
  await expect(list(page).getByRole("listitem")).toHaveText([/default: Christmas/]);
  await expect(list(page).getByRole("button", { name: "Remove default, playlist 1" })).toBeDisabled();

  await choice(page, "My choice").check();
  await expect(choice(page, "My choice")).toBeChecked();
  await expect.poll(() => sent(requests)).toEqual([{ play: "playlists" }]);
  await expect(announced(page)).toHaveText("My choice chosen, Playlists.");

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
  await expect(choice(page, "Automatic")).toBeChecked();
  await expect(mine(page)).toContainText("Automatic is on. This list is kept for when you choose My choice, Playlists");

  await choice(page, "My choice").check();
  await choice(page, "Automatic").check();
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
      "The board asks this server for the time when the board plays a schedule or the install window is narrower than the whole day. The request carries none of your data; the server sees the board's IP address.",
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

test.describe("what the site chose", () => {
  test.use({ simulatorArgs: ["--date", "2026-07-10"], timezoneId: "UTC" });

  test("a schedule: Automatic names it, plays by it and marks it Active in the files", async ({ page, simulator }) => {
    await page.clock.setFixedTime(new Date("2026-07-10T12:00:00Z"));
    addSummer(simulator);
    await setServerChoice(simulator, { schedule: "summer" });
    await connectSimulator(page, simulator);
    await expect(choice(page, "Automatic")).toBeChecked();
    await expect(automatic(page).getByTestId("server-choice")).toHaveText("The site plays the schedule Summer.");
    await expect(automatic(page).getByTestId("play-now")).toHaveText("Now: Beach days is on: the board plays default.");
    await expect(automatic(page).getByTestId("play-next")).toHaveText(
      "Next change: September 1, 2026, the fallback: holiday.",
    );
    await automatic(page).getByRole("button", { name: "Show the schedule" }).click();
    await expect(page.getByRole("table", { name: "Summer, stored on this board" })).toContainText("Beach days");
    await showBoardSchedules(page);
    await expect(activeSchedule(page, "summer")).toHaveText("Active");
    await expect(activeSchedule(page, "default")).toHaveCount(0);

    // Deleting it says whose choice it is and what plays instead.
    await page.getByRole("button", { name: "More actions for summer" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await expect(page.getByRole("dialog", { name: "Delete summer?" })).toContainText(
      "The site chose this schedule for Automatic: the board will then play the schedule default.",
    );
  });

  test("playlists: Automatic names them and plays them in turn, with no schedule to show", async ({
    page,
    simulator,
  }) => {
    await setServerChoice(simulator, { playlists: ["holiday", "default"] });
    await connectSimulator(page, simulator);
    await expect(automatic(page).getByTestId("server-choice")).toHaveText(
      "The site plays the playlists Quiet evening and Christmas.",
    );
    await expect(automatic(page).getByTestId("play-now")).toHaveText("Now: The board plays holiday and default.");
    await expect(automatic(page).getByRole("button", { name: "Show the schedule" })).toHaveCount(0);
    await expect(automatic(page).getByTestId("play-next")).toHaveCount(0);
    await expect(page.getByTestId("files-summary")).toContainText("Automatic: playing Quiet evening");
  });

  test("a schedule the board lacks: Automatic says what the board plays by its own rule", async ({
    page,
    simulator,
  }) => {
    await setServerChoice(simulator, { schedule: "ghost" });
    await connectSimulator(page, simulator);
    await expect(automatic(page).getByTestId("server-choice")).toHaveText(
      "The site chose the schedule ghost, which the board cannot follow, so it plays the schedule default.",
    );
    await expect(automatic(page).getByTestId("play-now")).toContainText("the board plays the fallback, default.");
  });

  test("a playlist the board stores but cannot play: the status decides, not the file list", async ({
    page,
    simulator,
  }) => {
    // The file is stored and valid, but the animation it names is not on the board.
    writeFileSync(
      stored(simulator, "playlists", "hollow"),
      '{"format":"pixelart-playlist/1","canvas":{"width":16,"height":16},"items":[{"animation":"not_stored"}]}',
    );
    await setServerChoice(simulator, { playlists: ["hollow"] });
    await connectSimulator(page, simulator);
    await expect(automatic(page).getByTestId("server-choice")).toHaveText(
      "The site chose the playlist hollow, which the board cannot follow, so it plays the schedule default.",
    );
  });

  test("My choice, Schedule: look, choose, switch, and each change sends only what changes", async ({
    page,
    simulator,
  }) => {
    await page.clock.setFixedTime(new Date("2026-07-10T12:00:00Z"));
    addSummer(simulator);
    const requests = watchRequests(page, "settings_set");
    await connectSimulator(page, simulator);
    await expect(choice(page, "Automatic")).toBeChecked();
    await expect(page.getByRole("radiogroup", { name: "My choice plays" })).toBeVisible();

    // Automatic has no segment of its own: looking at Schedule sends nothing.
    await segment(page, "Schedule").check();
    await expect(page.getByRole("combobox", { name: "Schedule", exact: true })).toHaveValue("default");
    await expect(announced(page)).toHaveText("Schedule chosen.");
    expect(requests).toHaveLength(0);
    await expect(choice(page, "Automatic")).toBeChecked();
    await expect(mine(page)).toContainText("Automatic is on. Choosing a schedule here switches to My choice.");

    // Choosing one from Automatic also chooses Schedule.
    await page.getByRole("combobox", { name: "Schedule", exact: true }).selectOption("summer");
    await expect.poll(() => sent(requests)).toEqual([{ schedule: "summer", play: "schedule" }]);
    await expect(choice(page, "My choice")).toBeChecked();
    await expect(segment(page, "Schedule")).toBeChecked();
    await expect(announced(page)).toHaveText("My choice chosen, Schedule.");
    await expect(page.getByTestId("my-schedule-now")).toHaveText("Now: Beach days is on: the board plays default.");
    await expect(page.getByTestId("my-schedule-next")).toHaveText(
      "Next change: September 1, 2026, the fallback: holiday.",
    );
    await page.getByTestId("my-schedule").getByRole("button", { name: "Show the schedule" }).click();
    await expect(page.getByRole("table", { name: "Summer, stored on this board" })).toBeVisible();

    // While Schedule plays, a schedule alone is sent.
    await page.getByRole("combobox", { name: "Schedule", exact: true }).selectOption("default");
    await expect.poll(() => sent(requests).at(-1)).toEqual({ schedule: "default" });
    await expect(page.getByTestId("my-schedule-now")).toHaveText(
      "Now: No entry of the schedule is on today: the board plays the fallback, default.",
    );

    // The segment is the play value, sent when it changes.
    await segment(page, "Playlists").check();
    await expect.poll(() => sent(requests).at(-1)).toEqual({ play: "playlists" });
    await expect(announced(page)).toHaveText("Playlists chosen.");
    await segment(page, "Schedule").check();
    await expect.poll(() => sent(requests).at(-1)).toEqual({ play: "schedule" });
    await expect(page.getByRole("combobox", { name: "Schedule", exact: true })).toHaveValue("default");

    await choice(page, "Automatic").check();
    await expect.poll(() => sent(requests).at(-1)).toEqual({ play: "auto" });
    await expect(announced(page)).toHaveText("Automatic chosen.");
    // Automatic shows Playlists again: My choice plays the playlists, whatever schedule was kept.
    await expect(segment(page, "Playlists")).toBeChecked();
    await choice(page, "My choice").check();
    await expect.poll(() => sent(requests).at(-1)).toEqual({ play: "playlists" });
    expect(requests).toHaveLength(6);
  });

  test("a chosen schedule that is not stored is marked, and the board plays its own rule", async ({
    page,
    simulator,
  }) => {
    addSummer(simulator);
    await connectSimulator(page, simulator);
    await segment(page, "Schedule").check();
    await page.getByRole("combobox", { name: "Schedule", exact: true }).selectOption("summer");
    await expect(segment(page, "Schedule")).toBeChecked();
    await showBoardSchedules(page);
    await expect(activeSchedule(page, "summer")).toHaveText("Active");
    await page.getByRole("button", { name: "More actions for summer" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete summer?" });
    await expect(dialog).toContainText("My choice plays this schedule: the board will then play the schedule default.");
    await dialog.getByRole("button", { name: "Delete", exact: true }).click();

    await expect(page.getByTestId("my-schedule-missing")).toHaveText(
      "The schedule summer is not stored, so the board plays the schedule default while it is chosen.",
    );
    await expect(page.getByRole("combobox", { name: "Schedule", exact: true })).toHaveValue("summer");
    await expect(page.getByRole("combobox", { name: "Schedule", exact: true }).locator("option:checked")).toHaveText(
      "summer (not stored)",
    );
    await expect(page.getByTestId("my-schedule-now")).toContainText("the board plays the fallback, default.");
    await expect(activeSchedule(page, "default")).toHaveText("Active");
  });
});
