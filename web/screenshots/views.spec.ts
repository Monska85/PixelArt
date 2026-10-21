// Screenshots of every view and its main states, at 1,280 and 375 px, in both themes. Every state is its own test with
// its own simulator, so one that breaks does not hide the others. See playwright.screenshots.config.ts.

import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test as base, toastWith, connectSimulator, type Simulator } from "../e2e/fixtures";
import type { Page } from "@playwright/test";
import { connectScripted, scriptedBoard } from "../e2e/scripted";
import { FIXED_TIME, watchBoard } from "./board";

const file = (name: string): string => fileURLToPath(new URL(`../e2e/files/${name}`, import.meta.url));

const SIZES = [
  { width: 1280, height: 800 },
  { width: 375, height: 812 },
];
const THEMES = ["light", "dark"] as const;

interface Context {
  page: Page;
  simulator: Simulator;
  /** Compares the page with the reference image of this state, and checks that nothing scrolls sideways. */
  shot: (name?: string) => Promise<void>;
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

const stored = (simulator: Simulator, kind: string, id: string): string => join(simulator.dataDir, kind, `${id}.json`);

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

function emptyBoard(simulator: Simulator): void {
  for (const id of ["ball", "bear", "candle", "snowflake", "star", "wreath"])
    rmSync(stored(simulator, "animations", id));
  for (const id of ["default", "holiday"]) rmSync(stored(simulator, "playlists", id));
}

async function go(page: Page, view: string, heading: string): Promise<void> {
  await page.evaluate((id) => (window.location.hash = id), view);
  await expect(page.getByRole("heading", { name: heading, level: 2, exact: true })).toBeVisible();
}

const settled = (page: Page) => expect(page.getByTestId("diagnostics")).toHaveAttribute("aria-busy", "false");
const row = (page: Page, id: string) =>
  page.locator("tr", { has: page.locator("code", { hasText: new RegExp(`^${id}$`) }) });
const more = (page: Page, id: string) => page.getByRole("button", { name: `More actions for ${id}` });
const playlistsTab = (page: Page) => page.getByRole("tab", { name: /^Playlists/ });
const installers = (page: Page) => expect(page.locator("esp-web-install-button")).toHaveCount(2);

async function editFromBoard(page: Page, id: string): Promise<void> {
  await page.getByRole("button", { name: `Edit ${id}`, exact: true }).click();
  await expect(page.getByTestId("editor-back")).toBeVisible();
  await settled(page);
}

const animationYaml = (name: string): string =>
  `format: pixelart/1\nname: ${name}\ncanvas: { width: 16, height: 16 }\nsprites:\n  dot:\n    points: [[7, 7, "#ff0000"]]\ntimeline:\n  - show: [dot]\n`;
const playlistYaml = (...ids: string[]): string =>
  `format: pixelart-playlist/1\nname: Mix\ncanvas: { width: 16, height: 16 }\nitems:\n${ids.map((id) => `  - animation: ${id}\n`).join("")}`;
const upload = (name: string, text: string) => ({ name, mimeType: "application/yaml", buffer: Buffer.from(text) });
const pick = (page: Page, ...files: Array<ReturnType<typeof upload>>) =>
  page.locator("#upload-input").setInputFiles(files);

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

/** States that only exist below 640 px, where the navigation is a menu button. */
const NARROW_ONLY = new Set(["nav-menu"]);

const states: Record<string, State> = {
  // Not connected
  "board-not-connected": async ({ page, shot }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Connect a board" })).toBeVisible();
    await shot();
  },
  "board-simulator-open": async ({ page, shot }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Use the simulator" }).click();
    await expect(page.getByLabel("Simulator address")).toBeVisible();
    await shot();
  },
  "board-address-error": async ({ page, shot }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Use the simulator" }).click();
    await page.getByLabel("Simulator address").fill("ws://127.0.0.1:1");
    await page.getByRole("button", { name: "Connect simulator" }).click();
    await expect(page.getByTestId("connection-message")).toBeVisible();
    await shot();
  },
  "board-connecting": async ({ page, simulator, shot }) => {
    const board = await watchBoard(page, simulator);
    board.hold("info");
    await page.goto("/");
    await page.getByRole("button", { name: "Use the simulator" }).click();
    await page.getByLabel("Simulator address").fill(simulator.address);
    await page.getByRole("button", { name: "Connect simulator" }).click();
    await expect(page.getByRole("button", { name: "Connect simulator" })).toHaveAttribute("aria-busy", "true");
    await shot();
  },
  "library-not-connected": async ({ page, shot }) => {
    await page.goto("/#library");
    await expect(page.getByTestId("state-ball")).toHaveCount(0);
    await expect(page.getByRole("table", { name: "Published animations" })).toBeVisible();
    await shot();
  },
  "firmware-not-connected": async ({ page, shot }) => {
    await page.goto("/#firmware");
    await installers(page);
    await shot();
  },
  "editor-not-connected": async ({ page, shot }) => {
    await page.goto("/#editor");
    await expect(page.getByRole("heading", { name: "Palette" })).toBeVisible();
    await settled(page);
    await shot();
  },
  "chip-not-connected": async ({ page, shot }) => {
    await page.goto("/");
    await page.getByTestId("connection-state").click();
    await expect(page.getByRole("button", { name: "Connect board" }).last()).toBeVisible();
    await shot();
  },
  "theme-button": async ({ page, shot }) => {
    await page.goto("/");
    await page.getByTestId("theme-button").hover();
    await expect(page.getByRole("tooltip")).toHaveText("Theme: System. Click for Dark.");
    await shot();
  },
  "nav-menu": async ({ page, shot }) => {
    await page.goto("/");
    await page.getByTestId("nav-menu").click();
    await expect(page.getByRole("menuitem", { name: "Library" })).toBeVisible();
    await shot();
  },

  // Board view, connected
  "board-connected": async ({ page, simulator, shot }) => {
    await connected(page, simulator);
    await expect(page.getByRole("table", { name: "Animations on the board" })).toBeVisible();
    await shot();
  },
  "chip-connected": async ({ page, simulator, shot }) => {
    await connected(page, simulator);
    await page.getByTestId("connection-state").click();
    await expect(page.getByTestId("info-storage")).toBeVisible();
    await shot();
  },
  "board-playlists": async ({ page, simulator, shot }) => {
    await connected(page, simulator);
    await playlistsTab(page).click();
    await expect(row(page, "default")).toBeVisible();
    await shot();
  },
  "board-more-menu": async ({ page, simulator, shot }) => {
    await connected(page, simulator);
    await more(page, "ball").click();
    await expect(page.getByRole("menuitem", { name: "Delete" })).toBeVisible();
    await shot();
  },
  "board-header-menu": async ({ page, simulator, shot }) => {
    await connected(page, simulator);
    await page.getByRole("button", { name: "More", exact: true }).click();
    await expect(page.getByRole("menuitem", { name: "New playlist" })).toBeVisible();
    await shot();
  },
  "board-preview": async ({ page, simulator, shot }) => {
    await connected(page, simulator);
    await page.getByRole("button", { name: "Preview ball" }).click();
    await expect(page.getByRole("dialog", { name: "Preview of ball" })).toBeVisible();
    await shot();
  },
  "board-delete-dialog": async ({ page, simulator, shot }) => {
    await connected(page, simulator);
    await more(page, "ball").click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await expect(page.getByRole("dialog", { name: "Delete ball?" })).toBeVisible();
    await shot();
  },
  "board-playlist-editor": async ({ page, simulator, shot }) => {
    await connected(page, simulator);
    await playlistsTab(page).click();
    await page.getByRole("button", { name: "Edit default" }).click();
    await expect(page.getByRole("heading", { name: "Edit playlist default" })).toBeFocused();
    await shot();
  },
  "board-playlist-editor-moving": async ({ page, simulator, shot }) => {
    await connected(page, simulator);
    await playlistsTab(page).click();
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
    await shot();
  },
  "board-missing-animations": async ({ page, simulator, shot }) => {
    missingAnimations(simulator);
    await connected(page, simulator);
    await playlistsTab(page).click();
    const badge = page.getByTestId("missing-default");
    await expect(badge).toHaveText("2 missing");
    await badge.focus();
    await expect(page.getByTestId("missing-tip-default")).toContainText("candle (not available in the Library)");
    await shot();
  },
  "board-playlist-editor-missing": async ({ page, simulator, shot }) => {
    missingAnimations(simulator);
    await connected(page, simulator);
    await playlistsTab(page).click();
    await page.getByRole("button", { name: "Edit default" }).click();
    await expect(page.getByRole("heading", { name: "Edit playlist default" })).toBeFocused();
    await expect(page.getByTestId(/^item-missing-/)).toHaveCount(2);
    await shot();
  },
  "board-playlist-editor-new": async ({ page, simulator, shot }) => {
    await connected(page, simulator);
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("menuitem", { name: "New playlist" }).click();
    await page.getByLabel("ID", { exact: true }).fill("Bad ID");
    await page.getByRole("button", { name: "Add animation" }).click();
    await expect(page.getByLabel("Animation of item 1")).toBeVisible();
    await shot();
  },
  "board-upload-id-dialog": async ({ page, simulator, shot }) => {
    await connected(page, simulator);
    await page.locator("#upload-input").setInputFiles(file("Bad Name.yaml"));
    await expect(page.getByRole("dialog", { name: "Choose an ID" })).toBeVisible();
    await shot();
  },
  "board-upload-progress": async ({ page, simulator, shot }) => {
    const board = await connected(page, simulator);
    board.hold("put_begin");
    await page.locator("#upload-input").setInputFiles(file("dot.yaml"));
    await uploadHeld(page, "Uploading animation dot", "File 1 of 1");
    await shot();
  },
  "board-upload-done": async ({ page, simulator, shot }) => {
    await connected(page, simulator);
    await page.locator("#upload-input").setInputFiles(file("dot.yaml"));
    await expect(toastWith(page, "Uploaded animation dot")).toBeVisible();
    await expect(row(page, "dot")).toBeVisible();
    await shot();
  },
  "board-upload-replace-dialog": async ({ page, simulator, shot }) => {
    await connected(page, simulator);
    const document = JSON.parse(readFileSync(stored(simulator, "animations", "star"), "utf8")) as { name: string };
    await page.locator("#upload-input").setInputFiles({
      name: "star.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ ...document, name: "Star (new)" })),
    });
    await expect(page.getByRole("dialog", { name: "Replace the stored file?" })).toBeVisible();
    await shot();
  },
  "board-delete-everything-dialog": async ({ page, simulator, shot }) => {
    await connected(page, simulator);
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("menuitem", { name: "Delete everything" }).click();
    await expect(page.getByRole("dialog", { name: /^Delete all 6 animations and 2 playlists/ })).toBeVisible();
    await shot();
  },
  "board-delete-everything-reset-dialog": async ({ page, simulator, shot }) => {
    await connected(page, simulator);
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("menuitem", { name: "Delete everything" }).click();
    await page.getByRole("dialog").getByRole("checkbox", { name: "Also reset the settings" }).check();
    await expect(
      page.getByRole("dialog").getByRole("button", { name: "Delete 8 files and reset the settings" }),
    ).toBeVisible();
    await shot();
  },
  "board-delete-everything-progress": async ({ page, simulator, shot }) => {
    const board = await connected(page, simulator);
    board.hold("delete_all");
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("menuitem", { name: "Delete everything" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete 8 files" }).click();
    await expect(page.getByTestId("activity")).toContainText("Deleting every animation and playlist");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await shot();
  },
  "board-delete-everything-old-firmware": async ({ page, shot }) => {
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
    await expect(page.getByTestId("delete-all-old")).toBeVisible();
    await shot();
  },
  "board-delete-everything-old-reset": async ({ page, shot }) => {
    const board = await scriptedBoard(page);
    board.files.animation.set("a", Buffer.from("{}"));
    board.deleteAll = () => ({ ok: false, error: "bad_request", message: 'unknown field "settings"' });
    await connectScripted(page, board);
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("menuitem", { name: "Delete everything" }).click();
    await page.getByRole("dialog").getByRole("checkbox", { name: "Also reset the settings" }).check();
    await page.getByRole("dialog").getByRole("button", { name: "Delete 1 file and reset the settings" }).click();
    await expect(page.getByTestId("delete-all-old-reset")).toBeVisible();
    await shot();
  },
  "board-delete-everything-storage-error": async ({ page, shot }) => {
    const board = await scriptedBoard(page);
    board.files.animation.set("a", Buffer.from("{}"));
    board.deleteAll = () => ({ ok: false, error: "storage_error", message: "a file cannot be removed" });
    await connectScripted(page, board);
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("menuitem", { name: "Delete everything" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete 1 file" }).click();
    await expect(page.getByTestId("delete-all-storage")).toBeVisible();
    await shot();
  },
  "board-queue-progress": async ({ page, simulator, shot }) => {
    const board = await connected(page, simulator);
    board.hold("put_begin");
    await pick(page, upload("one.yaml", animationYaml("One")), upload("two.yaml", animationYaml("Two")));
    await uploadHeld(page, "Uploading animation one", "File 1 of 2");
    await shot();
  },
  "board-queue-differing-dialog": async ({ page, simulator, shot }) => {
    await connected(page, simulator);
    const star = JSON.parse(readFileSync(stored(simulator, "animations", "star"), "utf8")) as { name: string };
    const ball = JSON.parse(readFileSync(stored(simulator, "animations", "ball"), "utf8")) as { name: string };
    await pick(
      page,
      {
        name: "star.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify({ ...star, name: "Star (new)" })),
      },
      {
        name: "ball.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify({ ...ball, name: "Ball (new)" })),
      },
      upload("fresh.yaml", animationYaml("Fresh")),
    );
    await expect(page.getByRole("dialog", { name: "Replace 2 stored files?" })).toBeVisible();
    await shot();
  },
  "board-queue-missing-animations-dialog": async ({ page, simulator, shot }) => {
    await connected(page, simulator);
    await pick(page, upload("evening.yaml", playlistYaml("ember", "star")));
    await expect(page.getByRole("dialog", { name: "Upload the playlist without all its animations?" })).toBeVisible();
    await shot();
  },
  "board-queue-summary": async ({ page, simulator, shot }) => {
    await connected(page, simulator);
    await pick(
      page,
      upload("evening.yaml", playlistYaml("fresh", "star")),
      upload("fresh.yaml", animationYaml("Fresh")),
      upload("bad.yaml", readFileSync(file("bad.yaml"), "utf8")),
    );
    await expect(toastWith(page, "Uploaded 1 animation and 1 playlist")).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Upload summary" })).toBeVisible();
    await shot();
  },
  "board-queue-no-space": async ({ page, shot }) => {
    const board = await scriptedBoard(page);
    board.storage = { total: 16384, used: 12288 };
    await connectScripted(page, board);
    await pick(page, upload("a.yaml", animationYaml("A")), upload("b.yaml", animationYaml("B")));
    await expect(page.getByRole("alert").filter({ hasText: "Not enough space on the board" })).toBeVisible();
    await shot();
  },
  "board-queue-failed": async ({ page, shot }) => {
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
    await shot();
  },
  "board-upload-diagnostics": async ({ page, simulator, shot }) => {
    await connected(page, simulator);
    await page.locator("#upload-input").setInputFiles([file("bad.yaml"), file("other.json")]);
    await expect(page.getByRole("alert")).toHaveCount(2);
    await shot();
  },
  "board-lost": async ({ page, simulator, shot }) => {
    await connected(page, simulator);
    // The board's files and settings are read before the link drops, so the picture does not depend on which read the
    // drop cuts.
    await expect(row(page, "ball")).toBeVisible();
    await expect(page.getByRole("tab", { name: /^Playlists\s*2$/ })).toBeVisible();
    await expect(page.getByTestId("brightness-value")).toBeVisible();
    simulator.stop();
    await expect(page.getByTestId("lost-alert")).toBeVisible();
    await shot();
  },
  "board-loading": async ({ page, simulator, shot }) => {
    const board = await watchBoard(page, simulator);
    board.hold("list");
    await connectSimulator(page, simulator);
    await expect(page.getByTestId("list-loading").first()).toBeVisible();
    await expect(page.getByText("No animations on this board")).toHaveCount(0);
    await shot();
  },
  "board-unreadable": async ({ page, shot }) => {
    const board = await scriptedBoard(page);
    board.files.animation.set("a", Buffer.from("{}"));
    board.failLists = true;
    await connectScripted(page, board);
    await expect(page.getByText("Could not read the files from the board.").first()).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "Reading the board" })).toHaveCount(2);
    await shot();
  },
  "board-empty": async ({ page, simulator, shot }) => {
    emptyBoard(simulator);
    await connected(page, simulator);
    await expect(page.getByText("No animations on this board")).toBeVisible();
    await shot();
  },
  "board-empty-playlists": async ({ page, simulator, shot }) => {
    emptyBoard(simulator);
    await connected(page, simulator);
    await playlistsTab(page).click();
    await expect(page.getByText("No playlists on this board")).toBeVisible();
    await shot();
  },

  // Library view
  "library-connected": async ({ page, simulator, shot }) => {
    libraryStates(simulator);
    await connected(page, simulator);
    await go(page, "library", "Library");
    await expect(page.getByTestId("state-ball")).toHaveText("Different");
    await expect(page.getByTestId("state-bear")).toHaveText("Not on the board");
    await shot();
  },
  "library-unreadable": async ({ page, shot }) => {
    const board = await scriptedBoard(page);
    board.failLists = true;
    await connectScripted(page, board);
    // The Board view reports the failed reads; the Library, opened after them, does not report them again.
    await expect(page.getByRole("alert").filter({ hasText: "Reading the board" })).toHaveCount(2);
    await go(page, "library", "Library");
    await expect(page.getByText("Could not read the files from the board.")).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "Reading the board" })).toHaveCount(0);
    await expect(page.getByTestId("state-ball")).toHaveCount(0);
    await shot();
  },
  "library-install-progress": async ({ page, simulator, shot }) => {
    libraryStates(simulator);
    const board = await connected(page, simulator);
    await go(page, "library", "Library");
    await expect(page.getByTestId("state-bear")).toBeVisible();
    board.hold("put_begin");
    await page.getByRole("button", { name: "Install bear" }).click();
    await uploadHeld(page, "Uploading animation bear", "File 1 of 1");
    await shot();
  },
  "library-install-done": async ({ page, simulator, shot }) => {
    libraryStates(simulator);
    await connected(page, simulator);
    await go(page, "library", "Library");
    await page.getByRole("button", { name: "Install bear" }).click();
    await expect(page.getByTestId("state-bear")).toHaveText("Same");
    await expect(toastWith(page, "Installed animation bear")).toBeVisible();
    await shot();
  },
  "library-replace-dialog": async ({ page, simulator, shot }) => {
    libraryStates(simulator);
    await connected(page, simulator);
    await go(page, "library", "Library");
    await page.getByRole("button", { name: "Install ball" }).click();
    await expect(page.getByRole("dialog", { name: "Replace the stored file?" })).toBeVisible();
    await shot();
  },
  "library-install-all-menu": async ({ page, simulator, shot }) => {
    libraryStates(simulator);
    await connected(page, simulator);
    await go(page, "library", "Library");
    await page.getByRole("button", { name: "Install all" }).click();
    await expect(page.getByRole("menuitem", { name: "Everything (4)" })).toBeVisible();
    await shot();
  },
  "library-differing-dialog": async ({ page, simulator, shot }) => {
    libraryStates(simulator);
    await connected(page, simulator);
    await go(page, "library", "Library");
    await page.getByRole("button", { name: "Install all" }).click();
    await page.getByRole("menuitem", { name: "Everything (4)" }).click();
    await expect(page.getByRole("dialog", { name: "Replace the stored file?" })).toBeVisible();
    await shot();
  },
  "library-preview": async ({ page, simulator, shot }) => {
    await connected(page, simulator);
    await go(page, "library", "Library");
    await page.getByRole("button", { name: "Preview star" }).click();
    await expect(page.getByRole("dialog", { name: "Preview of star" })).toBeVisible();
    await shot();
  },
  "library-empty-board": async ({ page, simulator, shot }) => {
    emptyBoard(simulator);
    await connected(page, simulator);
    await go(page, "library", "Library");
    await expect(page.getByTestId("state-ball")).toHaveText("Not on the board");
    await shot();
  },
  "library-lost": async ({ page, simulator, shot }) => {
    await connected(page, simulator);
    await go(page, "library", "Library");
    // Both file lists are read before the link drops, as in board-lost, so no read is cut by the drop.
    await expect(page.locator("#main")).toHaveAttribute("data-list-animations", "known");
    await expect(page.locator("#main")).toHaveAttribute("data-list-playlists", "known");
    simulator.stop();
    await expect(page.getByTestId("lost-alert")).toBeVisible();
    await shot();
  },
  "library-no-manifest": async ({ page, shot }) => {
    await page.route("**/manifest.json", (route) => route.fulfill({ status: 404, body: "not found" }));
    await page.goto("/#library");
    await expect(page.getByTestId("library-empty")).toBeVisible();
    await shot();
  },

  // Firmware view
  "firmware-update-available": async ({ page, simulator, shot }) => {
    await connected(page, simulator, { firmware: "0.0.9" });
    await go(page, "firmware", "Firmware");
    await installers(page);
    await expect(page.getByTestId("firmware-check")).toContainText("Update available");
    await shot();
  },
  "firmware-up-to-date": async ({ page, simulator, shot }) => {
    await connected(page, simulator, { firmware: "0.1.0" });
    await go(page, "firmware", "Firmware");
    await installers(page);
    await expect(page.getByTestId("firmware-check")).toContainText("Up to date");
    await shot();
  },
  "firmware-development-build": async ({ page, simulator, shot }) => {
    await connected(page, simulator, { firmware: "0.0.0-dev.3+gabc1234" });
    await go(page, "firmware", "Firmware");
    await installers(page);
    await expect(page.getByTestId("firmware-check")).toContainText("Development build");
    await shot();
  },
  "firmware-delete-everything-dialog": async ({ page, simulator, shot }) => {
    await connected(page, simulator, { firmware: "0.0.9" });
    await go(page, "firmware", "Firmware");
    await installers(page);
    await page.getByRole("button", { name: "Delete everything" }).click();
    await expect(page.getByRole("dialog", { name: /^Delete all 6 animations and 2 playlists/ })).toBeVisible();
    await shot();
  },
  "firmware-reset-settings-only-dialog": async ({ page, simulator, shot }) => {
    for (const kind of ["animations", "playlists"])
      for (const name of readdirSync(join(simulator.dataDir, kind))) rmSync(join(simulator.dataDir, kind, name));
    await connected(page, simulator, { firmware: "0.0.9" });
    await go(page, "firmware", "Firmware");
    await installers(page);
    const card = page.getByRole("region", { name: "Reset" });
    await card.getByRole("checkbox", { name: "Also reset the settings" }).check();
    await card.getByRole("button", { name: "Delete everything" }).click();
    await expect(page.getByRole("dialog", { name: "Reset the settings of this board?" })).toBeVisible();
    await shot();
  },
  "firmware-no-manifest": async ({ page, shot }) => {
    await page.route("**/manifest.json", (route) => route.fulfill({ status: 404, body: "not found" }));
    await page.goto("/#firmware");
    await expect(page.getByTestId("firmware-empty")).toBeVisible();
    await shot();
  },
  "firmware-no-web-serial": async ({ page, shot }) => {
    await page.addInitScript(() => {
      // @ts-expect-error The property is removed on purpose, as in a browser without Web Serial.
      delete Navigator.prototype.serial;
    });
    await page.goto("/#firmware");
    await expect(page.getByText(/needs Web Serial/)).toHaveCount(1);
    await shot();
  },

  // Editor view
  "editor-from-board": async ({ page, simulator, shot }) => {
    await connected(page, simulator);
    await editFromBoard(page, "ball");
    await shot();
  },
  "editor-yaml": async ({ page, simulator, shot }) => {
    await connected(page, simulator);
    await editFromBoard(page, "candle");
    await page.getByRole("tab", { name: "YAML" }).click();
    await expect(page.getByLabel("Animation as YAML")).toHaveValue(/format: pixelart\/1/);
    await shot();
  },
  "editor-yaml-error": async ({ page, simulator, shot }) => {
    await connected(page, simulator);
    await editFromBoard(page, "candle");
    await page.getByRole("tab", { name: "YAML" }).click();
    await page.getByLabel("Animation as YAML").fill("format: pixelart/1\nname: [oops\n");
    await expect(page.getByTestId("yaml-error")).toBeVisible();
    await shot();
  },
  "editor-diagnostics": async ({ page, shot }) => {
    await page.goto("/#editor");
    await expect(page.getByRole("heading", { name: "Palette" })).toBeVisible();
    await page.locator("#editor-open").setInputFiles(file("bad.yaml"));
    await expect(page.getByTestId("diagnostics")).toContainText("unknown_color");
    await settled(page);
    await shot();
  },
  "editor-upload-refused": async ({ page, simulator, shot }) => {
    await connected(page, simulator);
    await go(page, "editor", "Editor");
    await page.locator("#editor-open").setInputFiles(file("bad.yaml"));
    await expect(page.getByTestId("diagnostics")).toContainText("unknown_color");
    await settled(page);
    await page.getByRole("button", { name: "Upload to board" }).click();
    await expect(page.getByTestId("save-outcome")).toBeVisible();
    await shot();
  },
  "editor-upload-progress": async ({ page, simulator, shot }) => {
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
    await shot();
  },
  "editor-upload-done": async ({ page, simulator, shot }) => {
    await connected(page, simulator);
    await go(page, "editor", "Editor");
    await page.locator("#editor-open").setInputFiles(file("dot.yaml"));
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Dot");
    await settled(page);
    await page.getByRole("button", { name: "Upload to board" }).click();
    await expect(page.getByTestId("save-outcome")).toContainText("Uploaded animation dot");
    await shot();
  },
  "editor-saved-changed": async ({ page, simulator, shot }) => {
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
    await shot();
  },
  "editor-downloaded": async ({ page, shot }) => {
    await page.goto("/#editor");
    await expect(page.getByRole("heading", { name: "Palette" })).toBeVisible();
    await page.getByTestId("editor-note").getByRole("button", { name: "Got it" }).click();
    await downloadYaml(page);
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("ID", { exact: true }).fill("sketch");
    await dialog.getByRole("button", { name: "Use this ID" }).click();
    await expect(page.getByTestId("save-state")).toHaveText("Downloaded as sketch.yaml at 10:30");
    await settled(page);
    await shot();
  },
  "editor-same-as-file": async ({ page, shot }) => {
    await page.goto("/#editor");
    await expect(page.getByRole("heading", { name: "Palette" })).toBeVisible();
    await page.locator("#editor-open").setInputFiles(file("dot.yaml"));
    await expect(page.getByTestId("save-state")).toHaveText("Same as dot.yaml");
    await settled(page);
    await shot();
  },
  "editor-not-on-board": async ({ page, simulator, shot }) => {
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
    await shot();
  },
  "editor-delete-only-copy": async ({ page, simulator, shot }) => {
    await connected(page, simulator);
    await editFromBoard(page, "ball");
    await go(page, "board", "Board");
    await more(page, "ball").click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await expect(page.getByRole("dialog", { name: "Delete ball?" }).getByTestId("only-copy")).toBeVisible();
    await shot();
  },
  "editor-opening-dialog": async ({ page, simulator, shot }) => {
    await connected(page, simulator);
    await editFromBoard(page, "ball");
    await page.getByLabel("Name", { exact: true }).fill("Changed");
    await page.getByLabel("Name", { exact: true }).press("Enter");
    await page.getByRole("button", { name: "Back to Board" }).click();
    await page.getByRole("button", { name: "Edit candle", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("Discard the unsaved changes to Changed");
    await shot();
  },
  "editor-draft-restored": async ({ page, simulator, shot }) => {
    await connected(page, simulator);
    await editFromBoard(page, "ball");
    await page.getByLabel("Name", { exact: true }).fill("Work in progress");
    await page.getByLabel("Name", { exact: true }).press("Enter");
    await expect(page.getByTestId("draft-status")).toHaveText("Draft saved in this browser.");
    await page.goto("/#editor");
    await page.reload();
    await expect(page.getByTestId("draft-restored")).toBeVisible();
    await shot();
  },
  "editor-crash": async ({ page, shot, allowConsoleErrors }) => {
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
    await shot();
  },
};

// The editor crash is logged as an error on purpose; every other state must leave the console clean (the fixture checks).
for (const size of SIZES) {
  for (const theme of THEMES) {
    const tag = `${size.width}-${theme}`;
    base.describe(tag, () => {
      base.use({ viewport: size, colorScheme: theme });
      base.beforeEach(async ({ page }) => {
        await page.clock.setFixedTime(FIXED_TIME);
      });
      for (const [name, state] of Object.entries(states)) {
        if (NARROW_ONLY.has(name) && size.width >= 640) continue;
        base(name, async ({ page, simulator, consoleProblems }) => {
          const shot = async (suffix = ""): Promise<void> => {
            // Fonts loaded and two frames drawn, so a dialog that has just opened has settled.
            await page.evaluate(() =>
              document.fonts.ready.then(
                () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
              ),
            );
            const root = await page.evaluate(() => [
              document.documentElement.scrollWidth,
              document.documentElement.clientWidth,
            ]);
            expect(root[0], "the page scrolls sideways").toBe(root[1]);
            await expect(page).toHaveScreenshot(`${tag}-${name}${suffix}.png`, {
              fullPage: true,
              // Pixels that move with time: the animation that plays, and its frame number.
              mask: [page.locator("canvas"), page.getByTestId("frame-info"), page.getByTestId("preview-frame")],
            });
          };
          let expectsConsoleErrors = false;
          await state({ page, simulator, shot, allowConsoleErrors: () => (expectsConsoleErrors = true) });
          if (expectsConsoleErrors) consoleProblems.length = 0;
        });
      }
    });
  }
}
