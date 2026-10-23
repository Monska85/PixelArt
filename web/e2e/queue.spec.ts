// SPDX-License-Identifier: GPL-3.0-or-later

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { watchBoard } from "./board";
import {
  animations,
  animationYaml,
  connectSimulator,
  expect,
  pick,
  playlistYaml,
  showPlaylists,
  type Simulator,
  stored,
  summary,
  test,
  toastWith,
  upload,
} from "./fixtures";
import { connectScripted, scriptedBoard } from "./scripted";

const row = (page: Page, id: string) =>
  animations(page).locator("tr", { has: page.locator("code", { hasText: new RegExp(`^${id}$`) }) });

test("Upload folder sends every JSON and YAML file of the folder, subfolders included", async ({ page, simulator }) => {
  const folder = mkdtempSync(join(tmpdir(), "pixelart-folder-"));
  try {
    mkdirSync(join(folder, "nested"));
    writeFileSync(join(folder, "first.yaml"), animationYaml("First"));
    writeFileSync(join(folder, "nested", "second.yml"), animationYaml("Second"));
    writeFileSync(join(folder, "nested", "other.json"), '{ "format": "something/9" }');
    writeFileSync(join(folder, "nested", "notes.txt"), "not a board file");
    await connectSimulator(page, simulator);
    await page.locator("#upload-folder-input").setInputFiles(folder);
    await expect(toastWith(page, "Uploaded 2 animations")).toBeVisible();
    expect(existsSync(stored(simulator, "animations", "first"))).toBe(true);
    expect(existsSync(stored(simulator, "animations", "second"))).toBe(true);
    // The file of another format is listed and left out; the text file is not a candidate at all.
    await expect(page.getByRole("alert").filter({ hasText: "something/9" })).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "notes.txt" })).toHaveCount(0);
    await expect(summary(page)).toContainText("Uploaded: first, second");
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("a playlist picked with its animations goes last and brings no warning", async ({ page, simulator }) => {
  await connectSimulator(page, simulator);
  await pick(
    page,
    upload("mix.yaml", playlistYaml("one", "two")),
    upload("one.yaml", animationYaml("One")),
    upload("two.yaml", animationYaml("Two")),
  );
  await expect(toastWith(page, "Uploaded 2 animations and 1 playlist")).toBeVisible();
  // Sent in the other order, the board would have stored the playlist with unknown_animation warnings.
  await expect(page.getByRole("alert").filter({ hasText: "warnings" })).toHaveCount(0);
  await expect(summary(page)).toContainText("Uploaded: one, two, mix");
  for (const [kind, id] of [
    ["animations", "one"],
    ["animations", "two"],
    ["playlists", "mix"],
  ] as const)
    expect(existsSync(stored(simulator, kind, id))).toBe(true);
});

test("a playlist from local files takes an animation it names from the Library when the selection lacks it", async ({
  page,
  simulator,
}) => {
  // "wreath" is published and not on the board; "own" is in the selection; "star" is identical on the board.
  rmSync(stored(simulator, "animations", "wreath"));
  await connectSimulator(page, simulator);
  await pick(page, upload("mix.yaml", playlistYaml("own", "wreath", "star")), upload("own.yaml", animationYaml("Own")));
  await expect(toastWith(page, "Uploaded 2 animations and 1 playlist")).toBeVisible();
  await expect(summary(page)).toContainText("Uploaded: own, wreath, mix");
  await expect(summary(page)).toContainText("Skipped, the board has the same file: star");
  expect(existsSync(stored(simulator, "animations", "wreath"))).toBe(true);
});

test("a playlist whose animation is nowhere is listed, with Upload the playlist anyway or Cancel", async ({
  page,
  simulator,
}) => {
  await connectSimulator(page, simulator);
  await pick(page, upload("lonely.yaml", playlistYaml("nowhere_a")));
  const dialog = page.getByRole("dialog", { name: "Upload the playlist without all its animations?" });
  await expect(dialog.getByTestId("missing-animations")).toContainText("nowhere_a");
  await expect(dialog.getByTestId("missing-animations")).toContainText("lonely");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  expect(existsSync(stored(simulator, "playlists", "lonely"))).toBe(false);

  await pick(page, upload("lonely.yaml", playlistYaml("nowhere_a")));
  await page.getByRole("dialog").getByRole("button", { name: "Upload the playlist anyway" }).click();
  await expect(toastWith(page, "Uploaded playlist lonely")).toBeVisible();
  // The board stores it with the warning it always gives.
  await expect(page.getByRole("status").filter({ hasText: "uploaded with warnings" })).toContainText(
    "unknown_animation",
  );
  expect(existsSync(stored(simulator, "playlists", "lonely"))).toBe(true);
});

/** star differs from the published one and wreath is not on the board. */
function libraryDifferences(simulator: Simulator): string {
  const original = readFileSync(stored(simulator, "animations", "star"), "utf8");
  const document = JSON.parse(original) as { name: string };
  writeFileSync(stored(simulator, "animations", "star"), JSON.stringify({ ...document, name: "Star (mine)" }));
  rmSync(stored(simulator, "animations", "wreath"));
  return original;
}

test("Install all asks once about differing files: Cancel, Keep the board's, Replace them", async ({
  page,
  simulator,
}) => {
  const published = libraryDifferences(simulator);
  await connectSimulator(page, simulator);
  await page.getByRole("link", { name: "Library", exact: true }).click();
  const installAll = async (item: string) => {
    await page.getByRole("button", { name: "Install all" }).click();
    await page.getByRole("menuitem", { name: item }).click();
  };

  await installAll("Everything (4)");
  const dialog = page.getByRole("dialog", { name: "Replace the stored file?" });
  await expect(dialog.getByTestId("differing-files")).toContainText("star");
  await expect(dialog.getByTestId("differing-files")).not.toContainText("snowflake");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  expect(existsSync(stored(simulator, "animations", "wreath"))).toBe(false);

  await installAll("All animations (3)");
  await page.getByRole("dialog").getByRole("button", { name: "Keep the board's" }).click();
  await expect(toastWith(page, "Installed 1 animation")).toContainText("2 files skipped");
  await expect(summary(page)).toContainText("Skipped, the board's file was kept: star");
  expect(existsSync(stored(simulator, "animations", "wreath"))).toBe(true);
  expect(JSON.parse(readFileSync(stored(simulator, "animations", "star"), "utf8")).name).toBe("Star (mine)");

  await installAll("All animations (3)");
  await page.getByRole("dialog").getByRole("button", { name: "Replace them" }).click();
  await expect(page.getByTestId("state-star")).toContainText("Same");
  expect(readFileSync(stored(simulator, "animations", "star"), "utf8")).toBe(published);
});

test("installing a playlist from the Library brings the animations it names", async ({ page, simulator }) => {
  // Remove the playlist and two published animations: the playlist names all 30, three of them are published.
  rmSync(stored(simulator, "playlists", "default"));
  rmSync(stored(simulator, "animations", "snowflake"));
  rmSync(stored(simulator, "animations", "wreath"));
  await connectSimulator(page, simulator);
  await page.getByRole("link", { name: "Library", exact: true }).click();
  await showPlaylists(page);
  await page.getByRole("button", { name: "Install default" }).click();
  await expect(toastWith(page, "Installed 2 animations and 1 playlist")).toBeVisible();
  await expect(summary(page)).toContainText("Installed: wreath, snowflake, default");
  await expect(summary(page)).toContainText("Skipped, the board has the same file: star");
  for (const [kind, id] of [
    ["animations", "snowflake"],
    ["animations", "wreath"],
    ["playlists", "default"],
  ] as const)
    expect(existsSync(stored(simulator, kind, id))).toBe(true);
});

test("Cancel in the activity panel sends put_abort and stops the queue", async ({ page, simulator }) => {
  const watch = await watchBoard(page, simulator);
  await connectSimulator(page, simulator);
  watch.hold("put_chunk");
  await pick(page, upload("one.yaml", animationYaml("One")), upload("two.yaml", animationYaml("Two")));
  const activity = page.getByTestId("activity");
  await expect(activity).toContainText("Uploading animation one");
  await expect(activity).toContainText("File 1 of 2");
  await activity.getByRole("button", { name: "Cancel" }).click();
  watch.release();
  await expect(toastWith(page, "Cancelled")).toBeVisible();
  await expect(summary(page)).toContainText("Not attempted: one, two");
  expect(existsSync(stored(simulator, "animations", "one"))).toBe(false);
  expect(existsSync(stored(simulator, "animations", "two"))).toBe(false);
  await expect(page.getByTestId("activity")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Upload files" })).toBeEnabled();
});

test("a queue that does not fit is refused before anything is sent, with how much is missing", async ({ page }) => {
  const board = await scriptedBoard(page);
  // 8,192 bytes free: two files of one block each fit, three do not.
  board.storage = { total: 16384, used: 8192 };
  await connectScripted(page, board);
  await pick(
    page,
    upload("a.yaml", animationYaml("A")),
    upload("b.yaml", animationYaml("B")),
    upload("c.yaml", animationYaml("C")),
  );
  const refusal = page.getByRole("alert").filter({ hasText: "Not enough space on the board" });
  await expect(refusal).toContainText("The files need 12.0 KB");
  await expect(refusal).toContainText("4.0 KB more is needed");
  await expect(refusal).toContainText("Nothing was sent");
  expect(board.requests.some((r) => r.cmd === "put_begin")).toBe(false);
  expect(board.files.animation.size).toBe(0);

  await pick(page, upload("a.yaml", animationYaml("A")), upload("b.yaml", animationYaml("B")));
  await expect(toastWith(page, "Uploaded 2 animations")).toBeVisible();
  expect(board.files.animation.size).toBe(2);
});

test("a replaced file gives its space back in the space check", async ({ page }) => {
  const board = await scriptedBoard(page);
  board.files.animation.set("a", Buffer.from(animationYaml("Old")));
  // One block free and one block taken by "a": replacing "a" needs one block and gives one back.
  board.storage = { total: 12288, used: 8192 };
  await connectScripted(page, board);
  await pick(page, upload("a.yaml", animationYaml("New")), upload("b.yaml", animationYaml("B")));
  await page
    .getByRole("dialog", { name: "Replace the stored file?" })
    .getByRole("button", { name: "Replace them" })
    .click();
  await expect(toastWith(page, "Uploaded 2 animations")).toBeVisible();
});

test("the queue stops at the first failure, sends no playlist, and a second run resumes", async ({ page }) => {
  const board = await scriptedBoard(page);
  board.refuse.add("b");
  await connectScripted(page, board);
  const files = [
    upload("a.yaml", animationYaml("A")),
    upload("b.yaml", animationYaml("B")),
    upload("c.yaml", animationYaml("C")),
    upload("mix.yaml", playlistYaml("a", "b", "c")),
  ];
  await pick(page, ...files);
  await expect(toastWith(page, "Upload stopped at b")).toBeVisible();
  const detail = page.getByRole("alert").filter({ hasText: "Upload summary" });
  await expect(detail).toContainText("Uploaded: a");
  await expect(detail).toContainText("Failed: b");
  await expect(detail).toContainText("Not attempted: c, mix");
  expect([...board.files.animation.keys()]).toEqual(["a"]);
  expect(board.files.playlist.size).toBe(0);
  expect(board.requests.filter((r) => r.cmd === "put_begin").map((r) => r.id)).toEqual(["a", "b"]);

  // Run again once the board accepts the file: "a" is skipped, the rest follows.
  board.refuse.clear();
  await pick(page, ...files);
  await expect(toastWith(page, "Uploaded 2 animations and 1 playlist")).toBeVisible();
  expect([...board.files.animation.keys()].sort()).toEqual(["a", "b", "c"]);
  expect([...board.files.playlist.keys()]).toEqual(["mix"]);
  await expect(row(page, "a")).toBeVisible();
});
