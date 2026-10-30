// SPDX-License-Identifier: GPL-3.0-or-later

// Every view and its main states, as scripts that bring the app there, assert what it shows, and then call `check`.
// Every state runs in layout.spec.ts, where `check` runs the layout checks of layout.ts. The states named in CURATED
// (views.spec.ts) also run there, where `check` compares the page with its reference image. Adding a state here adds
// its layout checks; add its name to CURATED only for the one main state of a view, draw its images with
// `make web-screenshots-update`, and update the image count in web/README.md. Every state is
// its own test with its own simulator, so one that breaks does not hide the others.

import { copyFileSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  animations,
  animationYaml,
  connectSimulator,
  expect,
  file,
  openConnectCard,
  pick,
  playlistYaml,
  settled,
  showFiles,
  showBoardPlaylists,
  showBoardSchedules,
  type Simulator,
  stored,
  test as base,
  toastWith,
  upload,
} from "../e2e/fixtures";
import type { Page } from "@playwright/test";
import { connectScripted, scriptedBoard } from "../e2e/scripted";
import { setServerChoice, watchBoard } from "../e2e/board";

const SIZES = [
  { width: 1280, height: 800 },
  { width: 375, height: 812 },
];
export const THEMES = ["light", "dark"] as const;

interface Context {
  page: Page;
  simulator: Simulator;
  /** The check of the state: the layout checks, or a comparison with its reference image. */
  check: () => Promise<void>;
  /** Says that this state logs console errors on purpose (a crash that the page reports); the fixture's check is skipped. */
  allowConsoleErrors: () => void;
}

type State = (context: Context) => Promise<void>;

/** Puts a fixed firmware version between the page and the simulator and connects to it. */
async function connected(page: Page, simulator: Simulator, options?: Parameters<typeof watchBoard>[2]) {
  const board = await watchBoard(page, simulator, options);
  await connectSimulator(page, simulator);
  return board;
}

/** ball differs from the published one, bear is not on the board: the three states of the Library. */
function libraryStates(simulator: Simulator): void {
  const path = stored(simulator, "animations", "ball");
  const document = JSON.parse(readFileSync(path, "utf8")) as { name: string };
  writeFileSync(path, JSON.stringify({ ...document, name: `${document.name} (edited)` }));
  rmSync(stored(simulator, "animations", "bear"));
}

/** star is published and candle is not: a playlist that names them has one animation to install and one it cannot. */
function missingAnimations(simulator: Simulator): void {
  for (const id of ["star", "candle"]) rmSync(stored(simulator, "animations", id));
}

/** A second schedule, Summer, next to the stored one, so the choice of a schedule has something to choose from. */
function addSummer(simulator: Simulator): void {
  copyFileSync(file("summer.json"), stored(simulator, "schedules", "summer"));
}

function emptyBoard(simulator: Simulator): void {
  for (const id of ["ball", "bear", "candle", "snowflake", "star", "wreath"])
    rmSync(stored(simulator, "animations", id));
  for (const id of ["default", "holiday"]) rmSync(stored(simulator, "playlists", id));
  rmSync(stored(simulator, "schedules", "default"));
}

async function go(page: Page, view: string, heading: string): Promise<void> {
  await page.evaluate((id) => (window.location.hash = id), view);
  await expect(page.getByRole("heading", { name: heading, level: 2, exact: true })).toBeVisible();
}

const row = (page: Page, id: string) =>
  page.locator("tr", { has: page.locator("code", { hasText: new RegExp(`^${id}$`) }) });
const more = (page: Page, id: string) => page.getByRole("button", { name: `More actions for ${id}` });
const installers = (page: Page) => expect(page.locator("esp-web-install-button")).toHaveCount(2);

async function editFromBoard(page: Page, id: string): Promise<void> {
  await showFiles(page);
  await page.getByRole("button", { name: `Edit ${id}`, exact: true }).click();
  await expect(page.getByTestId("editor-back")).toBeVisible();
  await settled(page);
}

/** Download YAML is a button on a wide screen and an item of the More menu on a phone. */
async function downloadYaml(page: Page): Promise<void> {
  const button = page.getByRole("button", { name: "Download YAML" });
  if (await button.isVisible()) return button.click();
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Download YAML" }).click();
}

/**
 * The activity panel as it looks while a held put_begin keeps the upload at its first byte: the running label (not
 * "Preparing the upload", which is replaced the moment the file starts) and the byte line, so the layout is final.
 */
async function uploadHeld(page: Page, label: string, step?: string): Promise<void> {
  const activity = page.getByTestId("activity");
  await expect(activity).toContainText(label);
  if (step) await expect(activity).toContainText(step);
  await expect(activity).toContainText(/^[\s\S]*0 B of \d+(\.\d+)? [KM]?B/);
}

/** What the pages see as the time, so a time in the page never moves a reference image. */
const FIXED_TIME = new Date("2026-01-15T10:30:00Z");

/** States that only exist below 640 px, where the navigation is a menu button. */
const NARROW_ONLY = new Set(["nav-menu"]);

export const states = {
  // Not connected
  "board-not-connected": async ({ page, check }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Connect a board" })).toBeVisible();
    await check();
  },
  "board-simulator-open": async ({ page, check }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Use the simulator" }).click();
    await expect(page.getByLabel("Simulator address")).toBeVisible();
    await check();
  },
  "board-address-error": async ({ page, check }) => {
    await openConnectCard(page, "ws://127.0.0.1:1");
    // The functional WiFi test checks the shared WebSocket retry timing in real time.
    await page.clock.runFor(7_000);
    await expect(page.getByTestId("connection-message")).toContainText("Cannot connect", {
      timeout: 10_000,
    });
    await expect(page.getByTestId("connection-state")).toHaveText("Not connected");
    await check();
  },
  "board-connecting": async ({ page, simulator, check }) => {
    const board = await watchBoard(page, simulator);
    board.hold("info");
    await openConnectCard(page, simulator.address);
    await expect(page.getByRole("button", { name: "Connect simulator" })).toHaveAttribute("aria-busy", "true");
    await check();
  },
  "library-not-connected": async ({ page, check }) => {
    await page.goto("/#library");
    await expect(page.getByTestId("state-ball")).toHaveCount(0);
    await expect(page.getByRole("table", { name: "Published animations" })).toBeVisible();
    await check();
  },
  "firmware-not-connected": async ({ page, check }) => {
    await page.goto("/#firmware");
    await installers(page);
    await check();
  },
  "editor-not-connected": async ({ page, check }) => {
    await page.goto("/#editor");
    await expect(page.getByRole("heading", { name: "Palette" })).toBeVisible();
    await settled(page);
    await check();
  },
  "chip-not-connected": async ({ page, check }) => {
    await page.goto("/");
    await page.getByTestId("connection-state").click();
    await expect(page.getByRole("button", { name: "Connect board" }).last()).toBeVisible();
    await check();
  },
  "theme-button": async ({ page, check }) => {
    await page.goto("/");
    await page.getByTestId("theme-button").hover();
    await expect(page.getByRole("tooltip")).toHaveText("Theme: System. Click for Dark.");
    await check();
  },
  "nav-menu": async ({ page, check }) => {
    await page.goto("/");
    await page.getByTestId("nav-menu").click();
    await expect(page.getByRole("menuitem", { name: "Library" })).toBeVisible();
    await check();
  },

  // Board view, connected
  "board-connected": async ({ page, simulator, check }) => {
    await connected(page, simulator);
    await expect(page.getByTestId("files-summary")).toContainText("Automatic: playing");
    await expect(animations(page)).toBeHidden();
    await check();
  },
  "board-files-open": async ({ page, simulator, check }) => {
    await connected(page, simulator);
    await showFiles(page);
    await expect(animations(page)).toBeVisible();
    await check();
  },
  "board-updates-failed": async ({ page, simulator, check }) => {
    // The simulator started without an update source reaches no server: the check ends with network_error.
    await connected(page, simulator);
    const updates = page.getByRole("region", { name: "Updates" });
    await updates.getByRole("button", { name: "Check now" }).click();
    await expect(updates.getByTestId("update-last-check")).toContainText("(network_error)");
    await check();
  },
  "chip-connected": async ({ page, simulator, check }) => {
    await connected(page, simulator);
    await page.getByTestId("connection-state").click();
    await expect(page.getByTestId("info-storage")).toBeVisible();
    await check();
  },
  "board-playlists": async ({ page, simulator, check }) => {
    await connected(page, simulator);
    await showBoardPlaylists(page);
    await expect(page.getByRole("table", { name: "Playlists on the board" }).getByText("Christmas")).toBeVisible();
    await check();
  },
  "board-schedules": async ({ page, simulator, check }) => {
    await connected(page, simulator);
    await showBoardSchedules(page);
    await expect(page.getByRole("table", { name: "Schedules on the board" }).getByText("Seasons")).toBeVisible();
    await check();
  },
  "board-automatic-schedule": async ({ page, simulator, check }) => {
    await connected(page, simulator);
    const automatic = page.getByTestId("play-auto");
    await expect(automatic.getByTestId("play-next")).toContainText("February 1, 2026");
    await automatic.getByRole("button", { name: "Show the schedule" }).click();
    await expect(page.getByTestId("schedule-view")).toContainText("Quiet season");
    await page.getByTestId("what-to-play").scrollIntoViewIfNeeded();
    await check();
  },
  "board-automatic-server-schedule": async ({ page, simulator, check }) => {
    addSummer(simulator);
    await setServerChoice(simulator, { schedule: "summer" });
    await connected(page, simulator);
    const automatic = page.getByTestId("play-auto");
    await expect(automatic.getByTestId("server-choice")).toHaveText("The site plays the schedule Summer.");
    await expect(automatic.getByTestId("play-next")).toContainText("Next change:");
    await automatic.getByRole("button", { name: "Show the schedule" }).click();
    await expect(page.getByTestId("schedule-view")).toContainText("Beach days");
    await page.getByTestId("what-to-play").scrollIntoViewIfNeeded();
    await check();
  },
  "board-my-schedule": async ({ page, simulator, check }) => {
    addSummer(simulator);
    await connected(page, simulator);
    await page.getByRole("radio", { name: "Schedule", exact: true }).check();
    await page.getByRole("combobox", { name: "Schedule", exact: true }).selectOption("summer");
    const mine = page.getByTestId("my-schedule");
    await expect(page.getByRole("radio", { name: "My choice", exact: true })).toBeChecked();
    await expect(mine.getByTestId("my-schedule-now")).toContainText("Now:");
    await mine.getByRole("button", { name: "Show the schedule" }).click();
    await expect(mine.getByTestId("schedule-view")).toContainText("Beach days");
    await mine.scrollIntoViewIfNeeded();
    await check();
  },
  "board-my-schedule-disabled": async ({ page, simulator, check }) => {
    rmSync(stored(simulator, "schedules", "default"));
    await connected(page, simulator);
    await expect(page.getByRole("radio", { name: "Schedule", exact: true })).toBeDisabled();
    await expect(page.getByTestId("no-schedule-link")).toBeVisible();
    await page.getByTestId("what-to-play").scrollIntoViewIfNeeded();
    await check();
  },
  "board-my-schedule-missing": async ({ page, simulator, check }) => {
    addSummer(simulator);
    await connected(page, simulator);
    await page.getByRole("radio", { name: "Schedule", exact: true }).check();
    await page.getByRole("combobox", { name: "Schedule", exact: true }).selectOption("summer");
    await expect(page.getByRole("radio", { name: "My choice", exact: true })).toBeChecked();
    // The schedule is deleted while it is chosen: the board keeps the setting and plays its own rule.
    await showBoardSchedules(page);
    await more(page, "summer").click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByTestId("my-schedule-missing")).toBeVisible();
    await page.getByTestId("my-schedule-missing").scrollIntoViewIfNeeded();
    await check();
  },
  "board-my-playlists": async ({ page, simulator, check }) => {
    await connected(page, simulator);
    await page.getByRole("radio", { name: "My choice", exact: true }).check();
    const mine = page.getByTestId("play-mine");
    await mine.getByLabel("Add a playlist").selectOption("holiday");
    await mine.getByRole("button", { name: "Add" }).click();
    await expect(mine.getByRole("listitem")).toHaveCount(2);
    await mine.scrollIntoViewIfNeeded();
    await check();
  },
  "board-more-menu": async ({ page, simulator, check }) => {
    await connected(page, simulator);
    await showFiles(page);
    await more(page, "ball").click();
    await expect(page.getByRole("menuitem", { name: "Delete" })).toBeVisible();
    await check();
  },
  "board-header-menu": async ({ page, simulator, check }) => {
    await connected(page, simulator);
    await page.getByRole("button", { name: "More", exact: true }).click();
    await expect(page.getByRole("menuitem", { name: "New playlist" })).toBeVisible();
    await check();
  },
  "board-preview": async ({ page, simulator, check }) => {
    await connected(page, simulator);
    await showFiles(page);
    await page.getByRole("button", { name: "Preview ball" }).click();
    await expect(page.getByRole("dialog", { name: "Preview of ball" })).toBeVisible();
    await check();
  },
  "board-delete-dialog": async ({ page, simulator, check }) => {
    await connected(page, simulator);
    await showFiles(page);
    await more(page, "ball").click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await expect(page.getByRole("dialog", { name: "Delete ball?" })).toBeVisible();
    await check();
  },
  "board-playlist-editor": async ({ page, simulator, check }) => {
    await connected(page, simulator);
    await showBoardPlaylists(page);
    await page.getByRole("button", { name: "Edit default" }).click();
    await expect(page.getByRole("heading", { name: "Edit playlist default" })).toBeFocused();
    await check();
  },
  "board-playlist-editor-moving": async ({ page, simulator, check }) => {
    await connected(page, simulator);
    await showBoardPlaylists(page);
    await page.getByRole("button", { name: "Edit default" }).click();
    await expect(page.getByRole("heading", { name: "Edit playlist default" })).toBeFocused();
    // An item dragged with the mouse one place down, still held: it is marked while it moves.
    const from = await page.getByTestId("reorder-handle-1").boundingBox();
    const over = await page.getByTestId("playlist-item-2").boundingBox();
    if (!from || !over) throw new Error("the items are not shown");
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2, over.y + over.height * 0.75, { steps: 8 });
    await expect(page.getByTestId("playlist-item-2")).toHaveClass(/ring-primary/);
    await check();
  },
  "board-missing-animations": async ({ page, simulator, check }) => {
    missingAnimations(simulator);
    await connected(page, simulator);
    await showBoardPlaylists(page);
    const badge = page.getByTestId("missing-default");
    await expect(badge).toHaveText("2 missing");
    await badge.focus();
    await expect(page.getByTestId("missing-tip-default")).toContainText("candle (not available in the Library)");
    await check();
  },
  "board-playlist-editor-missing": async ({ page, simulator, check }) => {
    missingAnimations(simulator);
    await connected(page, simulator);
    await showBoardPlaylists(page);
    await page.getByRole("button", { name: "Edit default" }).click();
    await expect(page.getByRole("heading", { name: "Edit playlist default" })).toBeFocused();
    await expect(page.getByTestId(/^item-missing-/)).toHaveCount(2);
    await check();
  },
  "board-playlist-editor-new": async ({ page, simulator, check }) => {
    await connected(page, simulator);
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("menuitem", { name: "New playlist" }).click();
    await page.getByLabel("ID", { exact: true }).fill("Bad ID");
    await page.getByRole("button", { name: "Add animation" }).click();
    await expect(page.getByLabel("Animation of item 1")).toBeVisible();
    await check();
  },
  "board-upload-id-dialog": async ({ page, simulator, check }) => {
    await connected(page, simulator);
    await pick(page, file("Bad Name.yaml"));
    await expect(page.getByRole("dialog", { name: "Choose an ID" })).toBeVisible();
    await check();
  },
  "board-upload-progress": async ({ page, simulator, check }) => {
    const board = await connected(page, simulator);
    board.hold("put_begin");
    await pick(page, file("dot.yaml"));
    await uploadHeld(page, "Uploading animation dot", "File 1 of 1");
    await check();
  },
  "board-upload-done": async ({ page, simulator, check }) => {
    await connected(page, simulator);
    await pick(page, file("dot.yaml"));
    await expect(toastWith(page, "Uploaded animation dot")).toBeVisible();
    await expect(row(page, "dot")).toBeVisible();
    await check();
  },
  "board-upload-replace-dialog": async ({ page, simulator, check }) => {
    await connected(page, simulator);
    const document = JSON.parse(readFileSync(stored(simulator, "animations", "star"), "utf8")) as { name: string };
    await pick(page, upload("star.json", JSON.stringify({ ...document, name: "Star (new)" })));
    await expect(page.getByRole("dialog", { name: "Replace the stored file?" })).toBeVisible();
    await check();
  },
  "board-delete-everything-dialog": async ({ page, simulator, check }) => {
    await connected(page, simulator);
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("menuitem", { name: "Delete everything" }).click();
    await expect(
      page.getByRole("dialog", { name: /^Delete all 6 animations, 2 playlists and 1 schedule/ }),
    ).toBeVisible();
    await check();
  },
  "board-delete-everything-reset-dialog": async ({ page, simulator, check }) => {
    await connected(page, simulator);
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("menuitem", { name: "Delete everything" }).click();
    await page.getByRole("dialog").getByRole("checkbox", { name: "Also reset the settings" }).check();
    await expect(
      page.getByRole("dialog").getByRole("button", { name: "Delete 9 files and reset the settings" }),
    ).toBeVisible();
    await check();
  },
  "board-delete-everything-progress": async ({ page, simulator, check }) => {
    const board = await connected(page, simulator);
    board.hold("delete_all");
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("menuitem", { name: "Delete everything" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete 9 files" }).click();
    await expect(page.getByTestId("activity")).toContainText("Deleting every animation, playlist and schedule");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await check();
  },
  "board-delete-everything-old-firmware": async ({ page, check }) => {
    const board = await scriptedBoard(page);
    board.files.animation.set("a", Buffer.from("{}"));
    board.deleteAll = () => ({
      ok: false,
      error: "unknown_command",
      message: "this firmware does not know the command",
    });
    await connectScripted(page, board);
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("menuitem", { name: "Delete everything" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete 1 file" }).click();
    const notice = page.getByTestId("delete-all-old");
    await expect(notice).toContainText("does not know the command");
    expect(board.files.animation.size).toBe(1);
    await check();
    // At both widths, where the navigation is a bar or a menu: the link opens the Firmware view.
    await notice.getByRole("link", { name: "Open the Firmware view" }).click();
    await expect(page.getByRole("heading", { name: "Firmware", level: 2, exact: true })).toBeVisible();
  },
  "board-delete-everything-old-reset": async ({ page, check }) => {
    const board = await scriptedBoard(page);
    board.files.animation.set("a", Buffer.from("{}"));
    board.deleteAll = () => ({ ok: false, error: "bad_request", message: 'unknown field "settings"' });
    await connectScripted(page, board);
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("menuitem", { name: "Delete everything" }).click();
    await page.getByRole("dialog").getByRole("checkbox", { name: "Also reset the settings" }).check();
    await page.getByRole("dialog").getByRole("button", { name: "Delete 1 file and reset the settings" }).click();
    const notice = page.getByTestId("delete-all-old-reset");
    await expect(notice).toContainText("Nothing was deleted");
    await expect(notice.getByRole("link", { name: "Open the Firmware view" })).toBeVisible();
    expect(board.requests.filter((r) => r.cmd === "delete_all")).toEqual([
      expect.objectContaining({ cmd: "delete_all", settings: true }),
    ]);
    expect(board.files.animation.size).toBe(1);
    await check();
  },
  "board-delete-everything-storage-error": async ({ page, check }) => {
    const board = await scriptedBoard(page);
    board.files.animation.set("a", Buffer.from("{}"));
    board.deleteAll = () => ({ ok: false, error: "storage_error", message: "a file cannot be removed" });
    await connectScripted(page, board);
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("menuitem", { name: "Delete everything" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete 1 file" }).click();
    await expect(page.getByTestId("delete-all-storage")).toBeVisible();
    await check();
  },
  "board-queue-progress": async ({ page, simulator, check }) => {
    const board = await connected(page, simulator);
    board.hold("put_begin");
    await pick(page, upload("one.yaml", animationYaml("One")), upload("two.yaml", animationYaml("Two")));
    await uploadHeld(page, "Uploading animation one", "File 1 of 2");
    await check();
  },
  "board-queue-differing-dialog": async ({ page, simulator, check }) => {
    await connected(page, simulator);
    const star = JSON.parse(readFileSync(stored(simulator, "animations", "star"), "utf8")) as { name: string };
    const ball = JSON.parse(readFileSync(stored(simulator, "animations", "ball"), "utf8")) as { name: string };
    await pick(
      page,
      upload("star.json", JSON.stringify({ ...star, name: "Star (new)" })),
      upload("ball.json", JSON.stringify({ ...ball, name: "Ball (new)" })),
      upload("fresh.yaml", animationYaml("Fresh")),
    );
    await expect(page.getByRole("dialog", { name: "Replace 2 stored files?" })).toBeVisible();
    await check();
  },
  "board-queue-missing-animations-dialog": async ({ page, simulator, check }) => {
    await connected(page, simulator);
    await pick(page, upload("evening.yaml", playlistYaml("ember", "star")));
    await expect(page.getByRole("dialog", { name: "Upload the playlist without all its animations?" })).toBeVisible();
    await check();
  },
  "board-queue-summary": async ({ page, simulator, check }) => {
    await connected(page, simulator);
    await pick(
      page,
      upload("evening.yaml", playlistYaml("fresh", "star")),
      upload("fresh.yaml", animationYaml("Fresh")),
      upload("bad.yaml", readFileSync(file("bad.yaml"), "utf8")),
    );
    await expect(toastWith(page, "Uploaded 1 animation and 1 playlist")).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Upload summary" })).toBeVisible();
    await check();
  },
  "board-queue-no-space": async ({ page, check }) => {
    const board = await scriptedBoard(page);
    board.storage = { total: 16384, used: 12288 };
    await connectScripted(page, board);
    await pick(page, upload("a.yaml", animationYaml("A")), upload("b.yaml", animationYaml("B")));
    await expect(page.getByRole("alert").filter({ hasText: "Not enough space on the board" })).toBeVisible();
    await check();
  },
  "board-queue-failed": async ({ page, check }) => {
    const board = await scriptedBoard(page);
    board.refuse.add("b");
    await connectScripted(page, board);
    await pick(
      page,
      upload("a.yaml", animationYaml("A")),
      upload("b.yaml", animationYaml("B")),
      upload("c.yaml", animationYaml("C")),
      upload("mix.yaml", playlistYaml("a", "b", "c")),
    );
    await expect(page.getByRole("alert").filter({ hasText: "Upload summary" })).toBeVisible();
    await check();
  },
  "board-upload-diagnostics": async ({ page, simulator, check }) => {
    await connected(page, simulator);
    await pick(page, file("bad.yaml"), file("other.json"));
    await expect(page.getByRole("alert")).toHaveCount(2);
    await check();
  },
  "board-lost": async ({ page, simulator, check }) => {
    const board = await connected(page, simulator);
    // The board's files and settings are read before the link drops, so the picture does not depend on which read the
    // drop cuts.
    await expect(page.getByTestId("files-summary")).toContainText("2 playlists");
    await expect(page.getByTestId("brightness-value")).toBeVisible();
    await board.disconnect();
    simulator.stop();
    await expect(page.getByTestId("lost-alert")).toBeVisible();
    await expect(page.getByTestId("connection-state")).toHaveText("Lost");
    await expect(page.getByRole("alert").filter({ hasText: "Connection lost. Reconnect to continue." })).toBeVisible();
    await check();
  },
  "board-loading": async ({ page, simulator, check }) => {
    const board = await watchBoard(page, simulator);
    board.hold("list");
    await connectSimulator(page, simulator);
    await expect(page.getByTestId("files-summary")).toHaveText("Reading the files from the board...");
    await showFiles(page);
    await expect(page.getByTestId("list-loading").first()).toBeVisible();
    await expect(page.getByText("No animations on this board")).toHaveCount(0);
    await check();
  },
  "board-unreadable": async ({ page, check }) => {
    const board = await scriptedBoard(page);
    board.files.animation.set("a", Buffer.from("{}"));
    board.failLists = true;
    await connectScripted(page, board);
    await expect(page.getByText("Could not read the files from the board.").first()).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "Reading the board" })).toHaveCount(2);
    await showFiles(page);
    await expect(page.getByRole("button", { name: "Retry" }).first()).toBeVisible();
    await check();
  },
  "board-empty": async ({ page, simulator, check }) => {
    emptyBoard(simulator);
    await connected(page, simulator);
    await showFiles(page);
    await expect(page.getByText("No animations on this board")).toBeVisible();
    await check();
  },
  "board-empty-playlists": async ({ page, simulator, check }) => {
    emptyBoard(simulator);
    await connected(page, simulator);
    await showBoardPlaylists(page);
    await expect(page.getByText("No playlists on this board")).toBeVisible();
    await check();
  },

  // Library view
  "library-connected": async ({ page, simulator, check }) => {
    libraryStates(simulator);
    await connected(page, simulator);
    await go(page, "library", "Library");
    await expect(page.getByTestId("state-ball")).toHaveText("Different");
    await expect(page.getByTestId("state-bear")).toHaveText("Not on the board");
    await check();
  },
  "library-unreadable": async ({ page, check }) => {
    const board = await scriptedBoard(page);
    board.failLists = true;
    await connectScripted(page, board);
    // The Board view reports the failed reads; the Library, opened after them, does not report them again.
    await expect(page.getByRole("alert").filter({ hasText: "Reading the board" })).toHaveCount(2);
    await go(page, "library", "Library");
    await expect(page.getByText("Could not read the files from the board.")).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "Reading the board" })).toHaveCount(0);
    await expect(page.getByTestId("state-ball")).toHaveCount(0);
    await check();
  },
  "library-install-progress": async ({ page, simulator, check }) => {
    libraryStates(simulator);
    const board = await connected(page, simulator);
    await go(page, "library", "Library");
    await expect(page.getByTestId("state-bear")).toBeVisible();
    board.hold("put_begin");
    await page.getByRole("button", { name: "Install bear" }).click();
    await uploadHeld(page, "Uploading animation bear", "File 1 of 1");
    await check();
  },
  "library-install-done": async ({ page, simulator, check }) => {
    libraryStates(simulator);
    await connected(page, simulator);
    await go(page, "library", "Library");
    await page.getByRole("button", { name: "Install bear" }).click();
    await expect(page.getByTestId("state-bear")).toHaveText("Same");
    await expect(toastWith(page, "Installed animation bear")).toBeVisible();
    await check();
  },
  "library-replace-dialog": async ({ page, simulator, check }) => {
    libraryStates(simulator);
    await connected(page, simulator);
    await go(page, "library", "Library");
    await page.getByRole("button", { name: "Install ball" }).click();
    await expect(page.getByRole("dialog", { name: "Replace the stored file?" })).toBeVisible();
    await check();
  },
  "library-install-all-menu": async ({ page, simulator, check }) => {
    libraryStates(simulator);
    await connected(page, simulator);
    await go(page, "library", "Library");
    await page.getByRole("button", { name: "Install all" }).click();
    await expect(page.getByRole("menuitem", { name: "Everything (4)" })).toBeVisible();
    await check();
  },
  "library-differing-dialog": async ({ page, simulator, check }) => {
    libraryStates(simulator);
    await connected(page, simulator);
    await go(page, "library", "Library");
    await page.getByRole("button", { name: "Install all" }).click();
    await page.getByRole("menuitem", { name: "Everything (4)" }).click();
    await expect(page.getByRole("dialog", { name: "Replace the stored file?" })).toBeVisible();
    await check();
  },
  "library-preview": async ({ page, simulator, check }) => {
    await connected(page, simulator);
    await go(page, "library", "Library");
    await page.getByRole("button", { name: "Preview star" }).click();
    await expect(page.getByRole("dialog", { name: "Preview of star" })).toBeVisible();
    await check();
  },
  "library-empty-board": async ({ page, simulator, check }) => {
    emptyBoard(simulator);
    await connected(page, simulator);
    await go(page, "library", "Library");
    await expect(page.getByTestId("state-ball")).toHaveText("Not on the board");
    await check();
  },
  "library-lost": async ({ page, simulator, check }) => {
    const board = await connected(page, simulator);
    await go(page, "library", "Library");
    // Both file lists are read before the link drops, as in board-lost, so no read is cut by the drop.
    await expect(page.locator("#main")).toHaveAttribute("data-list-animations", "known");
    await expect(page.locator("#main")).toHaveAttribute("data-list-playlists", "known");
    await board.disconnect();
    simulator.stop();
    await expect(page.getByTestId("lost-alert")).toBeVisible();
    await check();
  },
  "library-no-manifest": async ({ page, check }) => {
    await page.route("**/manifest.json", (route) => route.fulfill({ status: 404, body: "not found" }));
    await page.goto("/#library");
    await expect(page.getByTestId("library-empty")).toContainText("Nothing is published yet");
    await check();
  },

  // Firmware view
  "firmware-update-available": async ({ page, simulator, check }) => {
    await connected(page, simulator, { firmware: "0.0.9" });
    await go(page, "firmware", "Firmware");
    await installers(page);
    await expect(page.getByTestId("firmware-check")).toContainText("Update available");
    await check();
  },
  "firmware-up-to-date": async ({ page, simulator, check }) => {
    await connected(page, simulator, { firmware: "0.1.0" });
    await go(page, "firmware", "Firmware");
    await installers(page);
    await expect(page.getByTestId("firmware-check")).toContainText("Up to date");
    await check();
  },
  "firmware-development-build": async ({ page, simulator, check }) => {
    await connected(page, simulator, { firmware: "0.0.0-dev.3+gabc1234" });
    await go(page, "firmware", "Firmware");
    await installers(page);
    await expect(page.getByTestId("firmware-check")).toContainText("Development build");
    await check();
  },
  "firmware-delete-everything-dialog": async ({ page, simulator, check }) => {
    await connected(page, simulator, { firmware: "0.0.9" });
    await go(page, "firmware", "Firmware");
    await installers(page);
    await page.getByRole("button", { name: "Delete everything" }).click();
    await expect(
      page.getByRole("dialog", { name: /^Delete all 6 animations, 2 playlists and 1 schedule/ }),
    ).toBeVisible();
    await check();
  },
  "firmware-reset-settings-only-dialog": async ({ page, simulator, check }) => {
    for (const kind of ["animations", "playlists", "schedules"])
      for (const name of readdirSync(join(simulator.dataDir, kind))) rmSync(join(simulator.dataDir, kind, name));
    await connected(page, simulator, { firmware: "0.0.9" });
    await go(page, "firmware", "Firmware");
    await installers(page);
    const card = page.getByRole("region", { name: "Reset" });
    await card.getByRole("checkbox", { name: "Also reset the settings" }).check();
    await card.getByRole("button", { name: "Delete everything" }).click();
    await expect(page.getByRole("dialog", { name: "Reset the settings of this board?" })).toBeVisible();
    await check();
  },
  "firmware-no-manifest": async ({ page, check }) => {
    await page.route("**/manifest.json", (route) => route.fulfill({ status: 404, body: "not found" }));
    await page.goto("/#firmware");
    await expect(page.getByTestId("firmware-empty")).toContainText("No firmware release is published yet");
    await expect(page.locator("esp-web-install-button")).toHaveCount(0);
    await check();
  },
  "firmware-no-web-serial": async ({ page, check }) => {
    await page.addInitScript(() => {
      // @ts-expect-error The property is removed on purpose, as in a browser without Web Serial.
      delete Navigator.prototype.serial;
    });
    await page.goto("/#firmware");
    await expect(page.getByText(/needs Web Serial, which only desktop Chrome, Edge, Opera/)).toHaveCount(1);
    await expect(page.locator("esp-web-install-button")).toHaveCount(0);
    await check();
  },

  // Editor view
  "editor-from-board": async ({ page, simulator, check }) => {
    await connected(page, simulator);
    await editFromBoard(page, "ball");
    await check();
  },
  "editor-yaml": async ({ page, simulator, check }) => {
    await connected(page, simulator);
    await editFromBoard(page, "candle");
    await page.getByRole("tab", { name: "YAML" }).click();
    await expect(page.getByLabel("Animation as YAML")).toHaveValue(/format: pixelart\/1/);
    await check();
  },
  "editor-yaml-error": async ({ page, simulator, check }) => {
    await connected(page, simulator);
    await editFromBoard(page, "candle");
    await page.getByRole("tab", { name: "YAML" }).click();
    await page.getByLabel("Animation as YAML").fill("format: pixelart/1\nname: [oops\n");
    await expect(page.getByTestId("yaml-error")).toBeVisible();
    await check();
  },
  "editor-diagnostics": async ({ page, check }) => {
    await page.goto("/#editor");
    await expect(page.getByRole("heading", { name: "Palette" })).toBeVisible();
    await page.locator("#editor-open").setInputFiles(file("bad.yaml"));
    await expect(page.getByTestId("diagnostics")).toContainText("unknown_color");
    await settled(page);
    await check();
  },
  "editor-upload-refused": async ({ page, simulator, check }) => {
    await connected(page, simulator);
    await go(page, "editor", "Editor");
    await page.locator("#editor-open").setInputFiles(file("bad.yaml"));
    await expect(page.getByTestId("diagnostics")).toContainText("unknown_color");
    await settled(page);
    await page.getByRole("button", { name: "Upload to board" }).click();
    await expect(page.getByTestId("save-outcome")).toBeVisible();
    await check();
  },
  "editor-upload-progress": async ({ page, simulator, check }) => {
    const board = await connected(page, simulator);
    await go(page, "editor", "Editor");
    await page.locator("#editor-open").setInputFiles(file("dot.yaml"));
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Dot");
    await settled(page);
    board.hold("put_begin");
    await page.getByRole("button", { name: "Upload to board" }).click();
    await uploadHeld(page, "Uploading animation dot", "File 1 of 1");
    await expect(page.getByTestId("draft-status")).toHaveText("Draft saved in this browser.");
    await expect(page.getByTestId("editor-note")).toBeVisible();
    await check();
  },
  "editor-upload-done": async ({ page, simulator, check }) => {
    await connected(page, simulator);
    await go(page, "editor", "Editor");
    await page.locator("#editor-open").setInputFiles(file("dot.yaml"));
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Dot");
    await settled(page);
    await page.getByRole("button", { name: "Upload to board" }).click();
    await expect(page.getByTestId("save-outcome")).toContainText("Uploaded animation dot");
    await check();
  },
  "editor-saved-changed": async ({ page, simulator, check }) => {
    await connected(page, simulator);
    await go(page, "editor", "Editor");
    await page.locator("#editor-open").setInputFiles(file("dot.yaml"));
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Dot");
    await settled(page);
    await page.getByRole("button", { name: "Upload to board" }).click();
    await expect(page.getByTestId("save-state")).toHaveText("Saved to board as dot at 10:30");
    await page.getByLabel("Name", { exact: true }).fill("Dot again");
    await page.getByLabel("Name", { exact: true }).press("Enter");
    await expect(page.getByTestId("save-state")).toHaveText("Changed since: saved to board as dot at 10:30");
    await check();
  },
  "editor-downloaded": async ({ page, check }) => {
    await page.goto("/#editor");
    await expect(page.getByRole("heading", { name: "Palette" })).toBeVisible();
    await page.getByTestId("editor-note").getByRole("button", { name: "Got it" }).click();
    await downloadYaml(page);
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("ID", { exact: true }).fill("sketch");
    await dialog.getByRole("button", { name: "Use this ID" }).click();
    await expect(page.getByTestId("save-state")).toHaveText("Downloaded as sketch.yaml at 10:30");
    await settled(page);
    await check();
  },
  "editor-same-as-file": async ({ page, check }) => {
    await page.goto("/#editor");
    await expect(page.getByRole("heading", { name: "Palette" })).toBeVisible();
    await page.locator("#editor-open").setInputFiles(file("dot.yaml"));
    await expect(page.getByTestId("save-state")).toHaveText("Same as dot.yaml");
    await settled(page);
    await check();
  },
  "editor-not-on-board": async ({ page, simulator, check }) => {
    await connected(page, simulator);
    await go(page, "editor", "Editor");
    await page.getByRole("button", { name: "Upload to board" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("ID", { exact: true }).fill("sketch");
    await dialog.getByRole("button", { name: "Use this ID" }).click();
    await expect(page.getByTestId("save-state")).toHaveText("Saved to board as sketch at 10:30");
    rmSync(stored(simulator, "animations", "sketch"));
    await go(page, "board", "Board");
    await go(page, "editor", "Editor");
    await expect(page.getByTestId("save-state")).toHaveText("Not on the connected board");
    await settled(page);
    await check();
  },
  "editor-delete-only-copy": async ({ page, simulator, check }) => {
    await connected(page, simulator);
    await editFromBoard(page, "ball");
    await go(page, "board", "Board");
    await showFiles(page);
    await more(page, "ball").click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await expect(page.getByRole("dialog", { name: "Delete ball?" }).getByTestId("only-copy")).toBeVisible();
    await check();
  },
  "editor-opening-dialog": async ({ page, simulator, check }) => {
    await connected(page, simulator);
    await editFromBoard(page, "ball");
    await page.getByLabel("Name", { exact: true }).fill("Changed");
    await page.getByLabel("Name", { exact: true }).press("Enter");
    await page.getByRole("button", { name: "Back to Board" }).click();
    await page.getByRole("button", { name: "Edit candle", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("Discard the unsaved changes to Changed");
    await check();
  },
  "editor-draft-restored": async ({ page, simulator, check }) => {
    await connected(page, simulator);
    await editFromBoard(page, "ball");
    await page.getByLabel("Name", { exact: true }).fill("Work in progress");
    await page.getByLabel("Name", { exact: true }).press("Enter");
    await expect(page.getByTestId("draft-status")).toHaveText("Draft saved in this browser.");
    await page.goto("/#editor");
    await page.reload();
    await expect(page.getByTestId("draft-restored")).toBeVisible();
    await check();
  },
  "editor-crash": async ({ page, check, allowConsoleErrors }) => {
    // The page reports the error it caught while drawing, and the browser logs it.
    allowConsoleErrors();
    await page.addInitScript(() => {
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: [string]) {
        if (localStorage.getItem("crash") === "1") throw new Error("cannot draw this document");
        return getContext.apply(this, args as never);
      } as typeof getContext;
    });
    await page.goto("/#editor");
    await expect(page.getByRole("heading", { name: "Palette" })).toBeVisible();
    await page.getByLabel("Name", { exact: true }).fill("Broken draft");
    await page.getByLabel("Name", { exact: true }).press("Enter");
    await expect(page.getByTestId("draft-status")).toHaveText("Draft saved in this browser.");
    await page.evaluate(() => localStorage.setItem("crash", "1"));
    await page.reload();
    await expect(page.getByTestId("crash-note")).toBeVisible();
    await check();
  },
} satisfies Record<string, State>;

export type StateName = keyof typeof states;

// These states use a scripted board or no board. They still run every viewport and layout assertion, without
// starting a simulator and copying board files. Future use of a simulator fails with a clear error.
const NO_SIMULATOR_STATES = new Set<StateName>([
  "board-not-connected",
  "board-simulator-open",
  "board-address-error",
  "library-not-connected",
  "firmware-not-connected",
  "editor-not-connected",
  "chip-not-connected",
  "theme-button",
  "nav-menu",
  "board-delete-everything-old-firmware",
  "board-delete-everything-old-reset",
  "board-delete-everything-storage-error",
  "board-queue-no-space",
  "board-queue-failed",
  "board-unreadable",
  "library-unreadable",
  "library-no-manifest",
  "firmware-no-manifest",
  "firmware-no-web-serial",
  "editor-diagnostics",
  "editor-downloaded",
  "editor-same-as-file",
  "editor-crash",
]);

function unusedSimulator(name: StateName): Simulator {
  return new Proxy({} as Simulator, {
    get: (_target, property) => {
      throw new Error(`${name} needs a simulator for ${String(property)}; remove it from NO_SIMULATOR_STATES`);
    },
  });
}

/**
 * Defines one test per state and size (and theme, when given), each with the fixed clock and `check` run where the
 * state calls it. States that need a board get their own simulator. A state that logs console errors on purpose says so with
 * `allowConsoleErrors`, which turns off the fixture's console check for that test only.
 */
export function describeStates({
  names,
  themes,
  check,
}: {
  names: readonly StateName[];
  /** The colour schemes to run in, or none to keep the browser's default. */
  themes: ReadonlyArray<(typeof THEMES)[number]> | null;
  check: (page: Page, image: string) => Promise<void>;
}): void {
  for (const size of SIZES) {
    for (const theme of themes ?? [null]) {
      const tag = theme ? `${size.width}-${theme}` : `${size.width}`;
      base.describe(tag, () => {
        base.use(theme ? { viewport: size, colorScheme: theme } : { viewport: size });
        base.beforeEach(async ({ page }) => {
          await page.clock.setFixedTime(FIXED_TIME);
        });
        for (const name of names) {
          if (NARROW_ONLY.has(name) && size.width >= 640) continue;
          const runState = async (page: Page, simulator: Simulator, consoleProblems: string[]) => {
            let expectsConsoleErrors = false;
            await states[name]({
              page,
              simulator,
              check: () => check(page, `${tag}-${name}.png`),
              allowConsoleErrors: () => (expectsConsoleErrors = true),
            });
            if (expectsConsoleErrors) consoleProblems.length = 0;
          };
          if (NO_SIMULATOR_STATES.has(name))
            base(name, async ({ page, consoleProblems }) => runState(page, unusedSimulator(name), consoleProblems));
          else base(name, async ({ page, simulator, consoleProblems }) => runState(page, simulator, consoleProblems));
        }
      });
    }
  }
}
