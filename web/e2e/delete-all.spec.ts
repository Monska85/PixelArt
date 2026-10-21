import { copyFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { connectSimulator, expect, test, toastWith, watchReplies } from "./fixtures";
import { watchBoard } from "../screenshots/board";
import { connectScripted, scriptedBoard } from "./scripted";

const count = (dir: string, kind: string): number => readdirSync(join(dir, kind)).length;

/** Opens Delete everything from the Board view's More menu. */
async function openDeleteEverything(page: Page): Promise<void> {
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Delete everything" }).click();
}

const resetBox = (dialog: Locator) => dialog.getByRole("checkbox", { name: "Also reset the settings" });

test("Delete everything in the Board view names the counts, removes every file and keeps the settings", async ({
  page,
  simulator,
}) => {
  await connectSimulator(page, simulator);
  const animations = count(simulator.dataDir, "animations");
  const playlists = count(simulator.dataDir, "playlists");
  const total = animations + playlists;
  await page.getByRole("slider", { name: "Brightness" }).focus();
  await page.getByRole("slider", { name: "Brightness" }).press("PageDown");
  const brightness = await page.getByTestId("brightness-value").innerText();

  await openDeleteEverything(page);
  const dialog = page.getByRole("dialog", {
    name: `Delete all ${animations} animations and ${playlists} playlist${playlists === 1 ? "" : "s"} from this board?`,
  });
  await expect(dialog).toContainText("This cannot be undone. The firmware and the settings stay.");
  await expect(resetBox(dialog)).not.toBeChecked();
  // A destructive question starts on the safe action, and Cancel changes nothing, even with the box checked.
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await resetBox(dialog).check();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  expect(count(simulator.dataDir, "animations")).toBe(animations);

  // The next opening starts unchecked again, with the wording of a deletion that keeps the settings.
  await openDeleteEverything(page);
  await expect(resetBox(dialog)).not.toBeChecked();
  await expect(dialog.getByTestId("delete-all-what")).toHaveText(
    "This cannot be undone. The firmware and the settings stay.",
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: `Delete ${total} files` })
    .click();
  await expect(toastWith(page, `Deleted ${animations} animations and ${playlists} playlist`)).toBeVisible();
  await expect(page.getByText("No animations on this board")).toBeVisible();
  expect(count(simulator.dataDir, "animations")).toBe(0);
  expect(count(simulator.dataDir, "playlists")).toBe(0);
  // The settings stay.
  await expect(page.getByTestId("brightness-value")).toHaveText(brightness);
});

test("Delete everything can also reset the settings: brightness 100 and playlist default", async ({
  page,
  simulator,
}) => {
  copyFileSync(join(simulator.dataDir, "playlists", "default.json"), join(simulator.dataDir, "playlists", "mine.json"));
  const replies = watchReplies(page, "delete_all");
  await connectSimulator(page, simulator);
  await page.getByLabel("Active playlist").selectOption("mine");
  await expect(page.getByLabel("Active playlist")).toHaveValue("mine");
  await page.getByRole("slider", { name: "Brightness" }).focus();
  await page.getByRole("slider", { name: "Brightness" }).press("PageDown");
  await expect(page.getByTestId("brightness-value")).not.toHaveText("100");
  const total = count(simulator.dataDir, "animations") + count(simulator.dataDir, "playlists");

  await openDeleteEverything(page);
  const dialog = page.getByRole("dialog");
  await resetBox(dialog).check();
  // The dialog says what the settings go back to, and so does its button.
  await expect(dialog.getByTestId("delete-all-what")).toHaveText(
    "This cannot be undone. The firmware stays; the settings go back to their defaults: brightness 100 and active playlist default.",
  );
  await dialog.getByRole("button", { name: `Delete ${total} files and reset the settings` }).click();
  await expect(toastWith(page, /^Deleted \d+ animations and 2 playlists and reset the settings/)).toContainText(
    "The settings are back to their defaults: brightness 100 and active playlist default.",
  );
  expect(count(simulator.dataDir, "animations")).toBe(0);
  expect(count(simulator.dataDir, "playlists")).toBe(0);
  expect(replies.replies[0]).toMatchObject({ ok: true, settings: { brightness: 100, playlist: "default" } });
  await expect(page.getByTestId("brightness-value")).toHaveText("100");
});

test("the Reset card has its own Also reset the settings box, which the dialog starts from", async ({
  page,
  simulator,
}) => {
  const replies = watchReplies(page, "delete_all");
  await connectSimulator(page, simulator);
  await page.getByRole("link", { name: "Firmware" }).click();
  const card = page.getByRole("region", { name: "Reset" });
  await expect(card).toContainText("if you choose, put the settings back to their defaults");
  // Visible in the card, off by default.
  await expect(resetBox(card)).toBeVisible();
  await expect(resetBox(card)).not.toBeChecked();
  await resetBox(card).check();
  await card.getByRole("button", { name: "Delete everything" }).click();
  const dialog = page.getByRole("dialog");
  await expect(resetBox(dialog)).toBeChecked();
  await expect(dialog.getByTestId("delete-all-what")).toContainText("the settings go back to their defaults");
  await dialog.getByRole("button", { name: /^Delete \d+ files and reset the settings$/ }).click();
  await expect(toastWith(page, /and reset the settings/)).toBeVisible();
  expect(replies.replies[0]).toMatchObject({ ok: true, settings: { brightness: 100, playlist: "default" } });
  // The dialog carried the choice: the card's box is off again for the next time.
  await expect(resetBox(card)).not.toBeChecked();
});

test("a board without files can still have its settings reset from the Reset card", async ({ page, simulator }) => {
  for (const kind of ["animations", "playlists"])
    for (const name of readdirSync(join(simulator.dataDir, kind))) rmSync(join(simulator.dataDir, kind, name));
  const replies = watchReplies(page, "delete_all");
  await connectSimulator(page, simulator);
  await page.getByRole("link", { name: "Firmware" }).click();
  const card = page.getByRole("region", { name: "Reset" });

  // Without the box there is nothing to do, and the toast says how to reset the settings.
  await card.getByRole("button", { name: "Delete everything" }).click();
  await expect(toastWith(page, "The board has no animations or playlists")).toContainText(
    "Check Also reset the settings",
  );
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await resetBox(card).check();
  await card.getByRole("button", { name: "Delete everything" }).click();
  const dialog = page.getByRole("dialog", { name: "Reset the settings of this board?" });
  await expect(dialog.getByTestId("delete-all-what")).toHaveText(
    "The board has no animations or playlists. The settings go back to their defaults: brightness 100 and active playlist default.",
  );
  await dialog.getByRole("button", { name: "Reset the settings" }).click();
  await expect(toastWith(page, /^Reset the settings/)).toBeVisible();
  expect(replies.replies[0]).toMatchObject({ ok: true, playlists: 0, animations: 0, settings: { brightness: 100 } });
});

test("Delete everything in the Firmware view uses the same dialog", async ({ page, simulator }) => {
  await connectSimulator(page, simulator);
  const total = count(simulator.dataDir, "animations") + count(simulator.dataDir, "playlists");
  await page.getByRole("link", { name: "Firmware" }).click();
  await expect(page.getByRole("heading", { name: "Reset" })).toBeVisible();
  await page.getByRole("button", { name: "Delete everything" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: `Delete ${total} files` })
    .click();
  await expect(toastWith(page, /^Deleted \d+ animations/)).toBeVisible();
  expect(count(simulator.dataDir, "animations")).toBe(0);
  await page.getByRole("link", { name: "Board" }).click();
  await expect(page.getByText("No animations on this board")).toBeVisible();
});

test("Delete everything is not offered without a board, and an empty board needs no dialog", async ({
  page,
  simulator,
}) => {
  await page.goto("/#firmware");
  await expect(page.getByRole("button", { name: "Delete everything" })).toBeDisabled();
  await expect(page.getByText("Connect a board to delete its files.")).toBeVisible();
  await connectSimulator(page, simulator);
  await page.getByRole("link", { name: "Firmware" }).click();
  await page.getByRole("button", { name: "Delete everything" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^Delete \d+ files$/ })
    .click();
  await expect(toastWith(page, /^Deleted/)).toBeVisible();
  await page.getByRole("button", { name: "Delete everything" }).click();
  await expect(toastWith(page, "The board has no animations or playlists")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("an old firmware that does not know delete_all gets the update message with a link", async ({ page }) => {
  const board = await scriptedBoard(page);
  board.files.animation.set("a", Buffer.from("{}"));
  board.deleteAll = () => ({ ok: false, error: "unknown_command", message: "this firmware does not know the command" });
  await connectScripted(page, board);
  await openDeleteEverything(page);
  await page.getByRole("dialog").getByRole("button", { name: "Delete 1 file" }).click();
  const notice = page.getByTestId("delete-all-old");
  await expect(notice).toContainText("does not know the command");
  await notice.getByRole("link", { name: "Open the Firmware view" }).click();
  await expect(page.getByRole("link", { name: "Firmware", exact: true })).toHaveAttribute("aria-current", "page");
  expect(board.files.animation.size).toBe(1);
});

test("a storage error offers to run Delete everything again", async ({ page }) => {
  const board = await scriptedBoard(page);
  board.files.animation.set("a", Buffer.from("{}"));
  board.files.animation.set("b", Buffer.from("{}"));
  board.deleteAll = (call) =>
    call === 1
      ? { ok: false, error: "storage_error", message: "a file cannot be removed" }
      : { ok: true, playlists: 0, animations: 2 };
  await connectScripted(page, board);
  await openDeleteEverything(page);
  await page.getByRole("dialog").getByRole("button", { name: "Delete 2 files" }).click();
  const notice = page.getByTestId("delete-all-storage");
  await expect(notice).toContainText("storage_error");
  await expect(notice).toContainText("a file cannot be removed");
  await notice.getByRole("button", { name: "Run it again" }).click();
  await expect(toastWith(page, "Deleted 2 animations")).toBeVisible();
  await expect(page.getByTestId("delete-all-storage")).toHaveCount(0);
  expect(board.requests.filter((r) => r.cmd === "delete_all")).toHaveLength(2);
  expect(board.files.animation.size).toBe(0);
});

test("the activity panel shows while Delete everything runs and no upload can start", async ({ page, simulator }) => {
  const watch = await watchBoard(page, simulator);
  await connectSimulator(page, simulator);
  watch.hold("delete_all");
  await openDeleteEverything(page);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^Delete \d+ files$/ })
    .click();
  const activity = page.getByTestId("activity");
  await expect(activity).toContainText("Deleting every animation and playlist");
  await expect(activity.getByRole("button", { name: "Cancel" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Upload files" })).toBeDisabled();
  watch.release();
  await expect(activity).toHaveCount(0);
  await expect(toastWith(page, /^Deleted/)).toBeVisible();
  // The empty list offers its own Upload files button once the board's lists are read again.
  await expect(page.getByText("No animations on this board")).toBeVisible();
  for (const button of await page.getByRole("button", { name: "Upload files" }).all())
    await expect(button).toBeEnabled();
});

test("a firmware that does not know the settings field deletes nothing and says so", async ({ page }) => {
  const board = await scriptedBoard(page);
  board.files.animation.set("a", Buffer.from("{}"));
  board.deleteAll = () => ({ ok: false, error: "bad_request", message: 'unknown field "settings"' });
  await connectScripted(page, board);
  await openDeleteEverything(page);
  await resetBox(page.getByRole("dialog")).check();
  await page.getByRole("dialog").getByRole("button", { name: "Delete 1 file and reset the settings" }).click();
  const notice = page.getByTestId("delete-all-old-reset");
  await expect(notice).toContainText("Nothing was deleted");
  await expect(notice.getByRole("link", { name: "Open the Firmware view" })).toBeVisible();
  expect(board.requests.filter((r) => r.cmd === "delete_all")).toEqual([
    expect.objectContaining({ cmd: "delete_all", settings: true }),
  ]);
  expect(board.files.animation.size).toBe(1);
});

test("without the checkbox Delete everything sends no settings field", async ({ page }) => {
  const board = await scriptedBoard(page);
  board.files.animation.set("a", Buffer.from("{}"));
  board.deleteAll = () => ({ ok: true, playlists: 0, animations: 1 });
  await connectScripted(page, board);
  await openDeleteEverything(page);
  await page.getByRole("dialog").getByRole("button", { name: "Delete 1 file" }).click();
  await expect(toastWith(page, "Deleted 1 animation")).toBeVisible();
  const sent = board.requests.filter((r) => r.cmd === "delete_all");
  expect(sent).toHaveLength(1);
  expect(sent[0]).not.toHaveProperty("settings");
});

test("Run it again after a storage error repeats the settings reset", async ({ page }) => {
  const board = await scriptedBoard(page);
  board.files.animation.set("a", Buffer.from("{}"));
  board.deleteAll = (call) =>
    call === 1
      ? { ok: false, error: "storage_error", message: "the files are removed but the settings cannot be saved" }
      : { ok: true, playlists: 0, animations: 0, settings: { brightness: 100, playlist: "default" } };
  await connectScripted(page, board);
  await openDeleteEverything(page);
  await resetBox(page.getByRole("dialog")).check();
  await page.getByRole("dialog").getByRole("button", { name: "Delete 1 file and reset the settings" }).click();
  const notice = page.getByTestId("delete-all-storage");
  await expect(notice).toContainText("Running it again removes the rest and resets the settings.");
  await notice.getByRole("button", { name: "Run it again" }).click();
  await expect(toastWith(page, "Reset the settings")).toBeVisible();
  const sent = board.requests.filter((r) => r.cmd === "delete_all");
  expect(sent).toHaveLength(2);
  expect(sent[1]).toMatchObject({ settings: true });
});

test("the activity panel says the settings are reset too while it runs", async ({ page, simulator }) => {
  const watch = await watchBoard(page, simulator);
  await connectSimulator(page, simulator);
  watch.hold("delete_all");
  await openDeleteEverything(page);
  await resetBox(page.getByRole("dialog")).check();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /and reset the settings$/ })
    .click();
  await expect(page.getByTestId("activity")).toContainText(
    "Deleting every animation and playlist and resetting the settings",
  );
  watch.release();
  await expect(page.getByTestId("activity")).toHaveCount(0);
});

test("a firmware without the settings field changes nothing in a settings-only reset and says so", async ({ page }) => {
  const board = await scriptedBoard(page);
  board.deleteAll = () => ({ ok: false, error: "bad_request", message: 'unknown field "settings"' });
  await connectScripted(page, board);
  await page.getByRole("link", { name: "Firmware" }).click();
  const card = page.getByRole("region", { name: "Reset" });
  await resetBox(card).check();
  await card.getByRole("button", { name: "Delete everything" }).click();
  await page
    .getByRole("dialog", { name: "Reset the settings of this board?" })
    .getByRole("button", { name: "Reset the settings" })
    .click();
  await expect(page.getByTestId("delete-all-old-reset")).toContainText(
    "Nothing was changed. This firmware cannot reset the settings: update the firmware.",
  );
  expect(board.requests.filter((r) => r.cmd === "delete_all")).toEqual([
    expect.objectContaining({ cmd: "delete_all", settings: true }),
  ]);
});
