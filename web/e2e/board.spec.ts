// SPDX-License-Identifier: GPL-3.0-or-later

import { readdirSync, readFileSync, existsSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { decodeLine } from "../src/protocol/framing";
import { firmwareBeforeSchedules } from "./board";
import {
  animations,
  connectSimulator,
  expect,
  file,
  openConnection,
  pick,
  showFiles,
  showBoardPlaylists,
  stored,
  test,
  toastWith,
  upload,
  watchReplies,
} from "./fixtures";

const dotYaml = readFileSync(file("dot.yaml"), "utf8");
const playlists = (page: Page) => page.getByRole("table", { name: "Playlists on the board" });
const editorPanel = (page: Page, name: string | RegExp) => page.getByRole("dialog", { name });
const row = (section: ReturnType<typeof animations>, id: string) =>
  section.locator("tr", { has: section.page().locator("code", { hasText: new RegExp(`^${id}$`) }) });
const showAnimations = (page: Page) => page.getByRole("tab", { name: /^Animations/ }).click();
/** On a wide screen the playlist editor spans the content width above the lists, in view, not at the end of the page. */
const expectAboveLists = async (page: Page, panel: ReturnType<typeof editorPanel>): Promise<void> => {
  await expect(panel).toBeVisible();
  const list = await page.getByRole("tablist", { name: "Stored files" }).boundingBox();
  const wide = await panel.boundingBox();
  const content = await page.getByRole("main").boundingBox();
  if (!list || !wide || !content) throw new Error("the panel or the lists are not shown");
  expect(wide.y + wide.height).toBeLessThanOrEqual(list.y);
  expect(wide.width).toBeGreaterThan(content.width - 64);
};
/** Chooses an item of the More menu of an animation. */
async function downloadItem(page: Page, id: string, item: string): Promise<void> {
  await row(animations(page), id)
    .getByRole("button", { name: `More actions for ${id}` })
    .click();
  await page.getByRole("menuitem", { name: item }).click();
}
async function chooseDelete(page: Page, table: ReturnType<typeof animations>, id: string): Promise<void> {
  await row(table, id)
    .getByRole("button", { name: `More actions for ${id}` })
    .click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
}
async function newPlaylist(page: Page): Promise<void> {
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "New playlist" }).click();
}
const storedIds = (dir: string, kind: string): string[] =>
  readdirSync(join(dir, kind)).map((n) => n.replace(/\.json$/, ""));

test("connects to the simulator and lists what it stores", async ({ page, simulator }) => {
  await page.goto("/");
  await expect(page.getByTestId("connection-state")).toHaveText("Not connected");
  await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveCount(1);
  await connectSimulator(page, simulator);
  await openConnection(page);
  await expect(page.getByTestId("info-board")).toHaveText("simulator");
  await expect(page.getByTestId("info-firmware")).not.toBeEmpty();
  await expect(page.getByTestId("info-storage")).toContainText(/KB|MB/);
  await page.keyboard.press("Escape");

  await showFiles(page);
  const ids = storedIds(simulator.dataDir, "animations");
  await expect(page.getByRole("tab", { name: /^Animations/ })).toContainText(String(ids.length));
  await expect(animations(page).getByRole("row")).toHaveCount(ids.length + 1);
  await expect(row(animations(page), "snowflake")).toContainText("Snowflake");
  await showBoardPlaylists(page);
  await expect(row(playlists(page), "default")).toContainText("Active");
  await expect(page).toHaveURL(/#board$|\/$/);
});

test("remembers the simulator address", async ({ page, simulator }) => {
  await connectSimulator(page, simulator);
  await page.reload();
  await page.getByTestId("connection-state").click();
  await expect(page.getByLabel("Simulator address")).toHaveValue(simulator.address);
});

test("uploads a valid YAML file, stored as the JSON of make data", async ({ page, simulator }) => {
  await connectSimulator(page, simulator);
  await pick(page, file("dot.yaml"));
  await expect(toastWith(page, "Uploaded animation dot")).toContainText("147 B");
  await expect(row(animations(page), "dot")).toContainText("Dot");
  expect(readFileSync(stored(simulator, "animations", "dot")).length).toBe(147);
});

test("shows the diagnostics of a rejected file and does not upload it", async ({ page, simulator }) => {
  await connectSimulator(page, simulator);
  await pick(page, file("bad.yaml"));
  const table = page.getByRole("table").filter({ hasText: "unknown_color" });
  await expect(table).toBeVisible();
  await expect(table).toContainText("sprites.dot.points[0][2]");
  await expect(page.getByRole("alert").filter({ hasText: "The file has errors and was not uploaded." })).toBeVisible();
  expect(existsSync(stored(simulator, "animations", "bad"))).toBe(false);
});

test("refuses a file of another format", async ({ page, simulator }) => {
  await connectSimulator(page, simulator);
  await pick(page, file("other.json"));
  await expect(page.getByRole("alert").filter({ hasText: /format of this file is "something\/9"/ })).toBeVisible();
});

test("asks for an ID when the file name is not one, and for confirmation before replacing", async ({
  page,
  simulator,
}) => {
  await connectSimulator(page, simulator);
  await pick(page, file("Bad Name.yaml"));
  const dialog = page.getByRole("dialog", { name: "Choose an ID" });
  await expect(dialog.getByLabel("ID")).toHaveValue("bad_name");
  await dialog.getByLabel("ID").fill("Not valid!");
  await expect(dialog.getByRole("button", { name: "Use this ID" })).toBeDisabled();
  await dialog.getByLabel("ID").fill("odd");
  await dialog.getByRole("button", { name: "Use this ID" }).click();
  await expect(toastWith(page, "Uploaded animation odd")).toBeVisible();

  await pick(page, file("dot.yaml"));
  await expect(toastWith(page, "Uploaded animation dot").first()).toBeVisible();
  // The same file again is skipped without a question.
  await pick(page, file("dot.yaml"));
  await expect(toastWith(page, "The board already has these files.")).toBeVisible();
  // A different file with the same ID asks once.
  const changed = upload("dot.yaml", dotYaml.replace("Dot", "Dot 2"));
  await pick(page, changed);
  const replace = page.getByRole("dialog", { name: "Replace the stored file?" });
  await expect(replace).toContainText("dot");
  await replace.getByRole("button", { name: "Cancel" }).click();
  await expect(row(animations(page), "dot")).toContainText("Dot");
  await expect(row(animations(page), "dot")).not.toContainText("Dot 2");
  await pick(page, changed);
  await page
    .getByRole("dialog", { name: "Replace the stored file?" })
    .getByRole("button", { name: "Keep the board's" })
    .click();
  await expect(toastWith(page, "The board's files were kept.")).toBeVisible();
  await pick(page, changed);
  await page
    .getByRole("dialog", { name: "Replace the stored file?" })
    .getByRole("button", { name: "Replace them" })
    .click();
  await expect(toastWith(page, "Uploaded animation dot").first()).toBeVisible();
  await expect(row(animations(page), "dot")).toContainText("Dot 2");
});

test("uploads several files picked together", async ({ page, simulator }) => {
  await connectSimulator(page, simulator);
  await pick(page, file("dot.yaml"), file("bad.yaml"), file("other.json"));
  await expect(toastWith(page, "Uploaded animation dot")).toBeVisible();
  // The two files that cannot be uploaded each get an alert that stays until it is dismissed.
  await expect(page.getByRole("alert")).toHaveCount(2);
});

test("uploads a file dropped on the view", async ({ page, simulator }) => {
  await connectSimulator(page, simulator);
  const source = readFileSync(file("dot.yaml"), "utf8");
  await page.getByTestId("drop-area").evaluate((zone, text) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([text], "dropped.yaml"));
    zone.dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }));
  }, source);
  await expect(toastWith(page, "Uploaded animation dropped")).toBeVisible();
  expect(existsSync(stored(simulator, "animations", "dropped"))).toBe(true);
});

test("downloads a file as stored, and as YAML", async ({ page, simulator }) => {
  await connectSimulator(page, simulator);
  await showFiles(page);
  const [json] = await Promise.all([page.waitForEvent("download"), downloadItem(page, "snowflake", "Download JSON")]);
  expect(json.suggestedFilename()).toBe("snowflake.json");
  const saved = readFileSync((await json.path()) as string);
  expect(saved.equals(readFileSync(stored(simulator, "animations", "snowflake")))).toBe(true);

  const [yaml] = await Promise.all([page.waitForEvent("download"), downloadItem(page, "snowflake", "Download YAML")]);
  expect(yaml.suggestedFilename()).toBe("snowflake.yaml");
  expect(readFileSync((await yaml.path()) as string, "utf8")).toMatch(/^format: pixelart\/1\nname: Snowflake\n/);
});

test("previews an animation with play, pause and step", async ({ page, simulator }) => {
  await connectSimulator(page, simulator);
  await showFiles(page);
  await row(animations(page), "snowflake").getByRole("button", { name: "Preview snowflake" }).click();
  const preview = page.getByRole("dialog", { name: "Preview of snowflake" });
  await expect(preview.getByRole("img", { name: "Preview of snowflake" })).toBeVisible();
  await preview.getByRole("button", { name: "Pause" }).click();
  await expect(preview.getByText(/^Frame 1, /)).toBeVisible();
  await preview.getByRole("button", { name: "Step" }).click();
  await expect(preview.getByText(/^Frame 2, /)).toBeVisible();
  const painted = await preview
    .locator("canvas")
    .evaluate((canvas: HTMLCanvasElement) =>
      Array.from(canvas.getContext("2d")!.getImageData(0, 0, 16, 16).data).some((v, i) => i % 4 !== 3 && v > 0),
    );
  expect(painted).toBe(true);
});

test("deletes after a confirmation that names the file", async ({ page, simulator }) => {
  await connectSimulator(page, simulator);
  await showFiles(page);
  await chooseDelete(page, animations(page), "star");
  const dialog = page.getByRole("dialog", { name: "Delete star?" });
  await expect(dialog).toContainText("star");
  await expect(dialog).not.toContainText("active playlist");
  // A destructive question starts on the safe action.
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(row(animations(page), "star")).toHaveCount(1);
  // Focus goes back to the button that opened the menu.
  await expect(row(animations(page), "star").getByRole("button", { name: "More actions for star" })).toBeFocused();

  await chooseDelete(page, animations(page), "star");
  await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(row(animations(page), "star")).toHaveCount(0);
  expect(existsSync(stored(simulator, "animations", "star"))).toBe(false);
});

test("deleting the active playlist says the board then plays every animation", async ({ page, simulator }) => {
  // The Active playlist menu of a firmware from before schedules; What to play is in what-to-play.spec.ts.
  await firmwareBeforeSchedules(page, simulator);
  await connectSimulator(page, simulator);
  await showBoardPlaylists(page);
  await chooseDelete(page, playlists(page), "default");
  const dialog = page.getByRole("dialog", { name: "Delete default?" });
  await expect(dialog).toContainText("play every animation");
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect(row(playlists(page), "default")).toHaveCount(0);
  await expect(page.getByLabel("Active playlist")).toContainText("default (missing)");
  await expect(page.getByRole("status").filter({ hasText: "plays every animation" })).toBeVisible();
});

test("changes the brightness on release and shows what the board answered", async ({ page, simulator }) => {
  // The brightness the board confirmed, read from the replies to settings_set.
  const settingsReplies = watchReplies(page, "settings_set");
  const confirmed = (): unknown[] =>
    settingsReplies.replies
      .filter((reply) => reply.ok === true)
      .map((reply) => (reply.settings as { brightness?: unknown } | undefined)?.brightness);
  await connectSimulator(page, simulator);
  await expect(page.getByTestId("brightness-value")).toHaveText("100");
  const slider = page.getByRole("slider", { name: "Brightness" });
  await slider.focus();
  await slider.press("Home");
  for (let i = 0; i < 4; i++) await slider.press("PageUp");
  await slider.press("ArrowRight");
  await expect(page.getByTestId("brightness-value")).toHaveText("41");
  // The slider shows the value at once: reload only after the board has applied the last one.
  await expect.poll(() => confirmed().at(-1)).toBe(41);
  await page.reload();
  await page.getByTestId("connection-state").click();
  await page.getByLabel("Simulator address").fill(simulator.address);
  await page.getByRole("button", { name: "Connect simulator" }).click();
  await expect(page.getByTestId("brightness-value")).toHaveText("41");
});

test("changes the active playlist", async ({ page, simulator }) => {
  await firmwareBeforeSchedules(page, simulator);
  await connectSimulator(page, simulator);
  await newPlaylist(page);
  await page.getByLabel("ID", { exact: true }).fill("mine");
  await page.getByRole("button", { name: "Add animation" }).click();
  await page.getByRole("button", { name: "Upload to board" }).click();
  await showBoardPlaylists(page);
  await expect(row(playlists(page), "mine")).toBeVisible();
  await page.getByLabel("Active playlist").selectOption("mine");
  await expect(page.getByLabel("Active playlist")).toHaveValue("mine");
  await expect(row(playlists(page), "mine")).toContainText("Active");
});

test("edits a stored playlist: order, repeat, enabled, add and remove", async ({ page, simulator }) => {
  await connectSimulator(page, simulator);
  const path = stored(simulator, "playlists", "default");
  const before = JSON.parse(readFileSync(path, "utf8"));
  await showBoardPlaylists(page);
  await row(playlists(page), "default").getByRole("button", { name: "Edit default" }).click();
  const editor = editorPanel(page, "Edit playlist default");
  await expect(editor.getByLabel("Animation of item 1", { exact: true })).toHaveValue(before.items[0].animation);

  await editor.getByLabel("Repeat of item 1", { exact: true }).fill("3");
  await editor.getByRole("switch", { name: "Enabled: item 2", exact: true }).uncheck();
  await editor.getByRole("button", { name: "Down item 1", exact: true }).click();
  await editor.getByRole("button", { name: "Remove item 3", exact: true }).click();
  await editor.getByRole("button", { name: "Add animation" }).click();
  await editor.getByLabel(`Animation of item ${before.items.length}`, { exact: true }).selectOption("star");
  await editor.getByRole("button", { name: "Upload to board" }).click();
  await expect(editorPanel(page, "Edit playlist default")).toHaveCount(0);

  const after = JSON.parse(readFileSync(path, "utf8"));
  expect(after.format).toBe("pixelart-playlist/1");
  expect(after.name).toBe(before.name);
  expect(after.items).toHaveLength(before.items.length);
  expect(after.items[0]).toEqual({ animation: before.items[1].animation, enabled: false });
  expect(after.items[1]).toEqual({ animation: before.items[0].animation, repeat: 3 });
  expect(after.items[2]).toEqual({ animation: before.items[3].animation });
  expect(after.items.at(-1)).toEqual({ animation: "star" });
});

test("the playlist editor opens in view and takes typed changes, with the board's animations", async ({
  page,
  simulator,
}) => {
  await connectSimulator(page, simulator);
  const path = stored(simulator, "playlists", "default");
  const before = JSON.parse(readFileSync(path, "utf8"));
  expect(before.items.length).toBeGreaterThan(5); // the test edits up to item 6
  await showBoardPlaylists(page);
  await row(playlists(page), "default").getByRole("button", { name: "Edit default" }).click();
  const editor = editorPanel(page, "Edit playlist default");
  // The editor sits above the lists: the user sees it open and keyboard focus is on it.
  await expectAboveLists(page, editor);
  await expect(editor.getByRole("heading", { name: "Edit playlist default" })).toBeInViewport();
  await expect(editor.getByRole("heading", { name: "Edit playlist default" })).toBeFocused();

  // Emptying the repeat field and typing a new number, as a user does, gives that number.
  const repeat = editor.getByLabel("Repeat of item 2", { exact: true });
  await repeat.focus();
  await repeat.press("Backspace");
  await repeat.pressSequentially("4");
  await expect(repeat).toHaveValue("4");
  await editor.getByRole("switch", { name: "Enabled: item 3", exact: true }).uncheck();
  await editor.getByRole("button", { name: "Up item 2", exact: true }).click();
  await editor.getByRole("button", { name: "Remove item 5", exact: true }).click();
  await editor.getByRole("button", { name: "Upload to board" }).click();
  await expect(editorPanel(page, "Edit playlist default")).toHaveCount(0);

  const after = JSON.parse(readFileSync(path, "utf8"));
  expect(after.items).toHaveLength(before.items.length - 1);
  expect(after.items[0]).toEqual({ animation: before.items[1].animation, repeat: 4 });
  expect(after.items[1]).toEqual({ animation: before.items[0].animation });
  expect(after.items[2]).toEqual({ animation: before.items[2].animation, enabled: false });
  expect(after.items[4]).toEqual({ animation: before.items[5].animation });
});

test("a repeat field shows the stored value again when left empty, and refuses numbers out of range", async ({
  page,
  simulator,
}) => {
  const path = stored(simulator, "playlists", "default");
  const seeded = JSON.parse(readFileSync(path, "utf8"));
  seeded.items[1].repeat = 5;
  writeFileSync(path, JSON.stringify(seeded));
  await connectSimulator(page, simulator);
  await showBoardPlaylists(page);
  await row(playlists(page), "default").getByRole("button", { name: "Edit default" }).click();
  const editor = editorPanel(page, "Edit playlist default");
  const repeat = editor.getByLabel("Repeat of item 2", { exact: true });
  await expect(repeat).toHaveValue("5");

  await repeat.fill("");
  await expect(repeat).toHaveAttribute("aria-invalid", "true");
  await repeat.blur();
  await expect(repeat).toHaveValue("5");
  await expect(repeat).toHaveAttribute("aria-invalid", "false");

  for (const typed of ["0", "1001"]) {
    await repeat.fill(typed);
    await expect(repeat).toHaveAttribute("aria-invalid", "true");
  }
  await editor.getByRole("button", { name: "Upload to board" }).click();
  await expect(editorPanel(page, "Edit playlist default")).toHaveCount(0);
  const after = JSON.parse(readFileSync(path, "utf8"));
  expect(after.items[1]).toEqual(seeded.items[1]);
});

test("Edit on another playlist asks before replacing unsaved changes, and focuses the editor each time", async ({
  page,
  simulator,
}) => {
  copyFileSync(stored(simulator, "playlists", "default"), stored(simulator, "playlists", "other"));
  await connectSimulator(page, simulator);
  await showBoardPlaylists(page);
  const heading = (id: string) => page.getByRole("heading", { name: `Edit playlist ${id}` });
  await row(playlists(page), "default").getByRole("button", { name: "Edit default" }).click();
  await expect(heading("default")).toBeFocused();

  // Without changes, another Edit replaces the editor and moves focus to it again.
  await page.getByRole("button", { name: "Edit other", exact: true }).focus();
  await page.getByRole("button", { name: "Edit other", exact: true }).click();
  await expect(heading("other")).toBeFocused();

  await page.getByLabel("Name", { exact: true }).fill("Changed");
  await page.getByRole("button", { name: "Edit default", exact: true }).click();
  const ask = page.getByRole("dialog", {
    name: "Discard the unsaved changes to playlist other and open playlist default?",
  });
  await expect(ask).toBeVisible();
  await ask.getByRole("button", { name: "Keep editing" }).click();
  await expect(page.getByRole("button", { name: "Edit default", exact: true })).toBeFocused();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Changed");
  await expect(heading("other")).toBeVisible();

  await page.getByRole("button", { name: "Edit default", exact: true }).click();
  await ask.getByRole("button", { name: "Discard and open" }).click();
  await expect(heading("default")).toBeFocused();
  await expect(page.getByLabel("Name", { exact: true })).not.toHaveValue("Changed");
});

test("Edit asks about changes typed while the other playlist is being read from the board", async ({
  page,
  simulator,
}) => {
  copyFileSync(stored(simulator, "playlists", "default"), stored(simulator, "playlists", "other"));
  const port = new URL(simulator.address).port;
  // Only the read that Edit starts is held: the app also reads every playlist in the background after connecting.
  let armed = false;
  let heldSeq: number | null = null;
  let held: string | null = null;
  const board: { send: (message: string) => void } = { send: () => {} };
  await page.routeWebSocket(
    (url) => url.port === port,
    (socket) => {
      const server = socket.connectToServer();
      board.send = (message) => socket.send(message);
      socket.onMessage((message) => {
        const request = decodeLine(new TextEncoder().encode(String(message)));
        if (
          armed &&
          request?.cmd === "get" &&
          request.id === "other" &&
          heldSeq === null &&
          typeof request.seq === "number"
        )
          heldSeq = request.seq;
        server.send(message);
      });
      server.onMessage((message) => {
        const reply = decodeLine(new TextEncoder().encode(String(message)));
        if (reply && heldSeq !== null && reply.seq === heldSeq && held === null) held = String(message);
        else socket.send(message);
      });
    },
  );
  await connectSimulator(page, simulator);
  await showBoardPlaylists(page);
  await row(playlists(page), "default").getByRole("button", { name: "Edit default" }).click();
  await expect(page.getByRole("heading", { name: "Edit playlist default" })).toBeVisible();

  armed = true;
  await page.getByRole("button", { name: "Edit other", exact: true }).click();
  await expect.poll(() => held).not.toBeNull();
  await page.getByLabel("Name", { exact: true }).fill("Typed meanwhile");
  board.send(held as unknown as string);

  await expect(
    page.getByRole("dialog", { name: "Discard the unsaved changes to playlist default and open playlist other?" }),
  ).toBeVisible();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Typed meanwhile");
});

test("the discard question names a new playlist by its typed ID, or as the new playlist", async ({
  page,
  simulator,
}) => {
  await connectSimulator(page, simulator);
  await showBoardPlaylists(page);
  await newPlaylist(page);
  await page.getByLabel("Name", { exact: true }).fill("Draft");
  await page.getByRole("button", { name: "Edit default", exact: true }).click();
  const ask = (current: string) =>
    page.getByRole("dialog", { name: `Discard the unsaved changes to ${current} and open playlist default?` });
  await expect(ask("the new playlist")).toBeVisible();
  await ask("the new playlist").getByRole("button", { name: "Keep editing" }).click();

  await page.getByLabel("ID", { exact: true }).fill("fresh");
  await page.getByRole("button", { name: "Edit default", exact: true }).click();
  await expect(ask("playlist fresh")).toBeVisible();
});

test("a new playlist opens in view and is stored", async ({ page, simulator }) => {
  await connectSimulator(page, simulator);
  await newPlaylist(page);
  await expect(page.getByRole("heading", { name: "New playlist" })).toBeInViewport();
  await expectAboveLists(page, editorPanel(page, "New playlist"));
  await page.getByLabel("ID", { exact: true }).fill("fresh");
  await page.getByLabel("Name", { exact: true }).fill("Fresh");
  await page.getByRole("button", { name: "Add animation" }).click();
  await page.getByRole("button", { name: "Add animation" }).click();
  await page.getByLabel("Animation of item 2", { exact: true }).selectOption("star");
  await page.getByRole("button", { name: "Upload to board" }).click();
  await expect(editorPanel(page, "New playlist")).toHaveCount(0);
  await showBoardPlaylists(page);
  await expect(row(playlists(page), "fresh")).toContainText("Fresh");
  const saved = JSON.parse(readFileSync(stored(simulator, "playlists", "fresh"), "utf8"));
  expect(saved.name).toBe("Fresh");
  expect(saved.items).toHaveLength(2);
  expect(saved.items[1]).toEqual({ animation: "star" });
});

test("saving a new playlist with a stored ID asks before replacing it", async ({ page, simulator }) => {
  await connectSimulator(page, simulator);
  const path = stored(simulator, "playlists", "default");
  const before = readFileSync(path, "utf8");
  await newPlaylist(page);
  await page.getByLabel("ID", { exact: true }).fill("default");
  await page.getByRole("button", { name: "Add animation" }).click();
  await page.getByLabel("Animation of item 1", { exact: true }).selectOption("star");
  await page.getByRole("button", { name: "Upload to board" }).click();

  const dialog = page.getByRole("dialog", { name: "Replace the stored file?" });
  await expect(dialog.getByTestId("differing-files")).toContainText("default");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  expect(readFileSync(path, "utf8")).toBe(before);

  await expect(toastWith(page, "Nothing was sent").first()).toBeVisible();
  await expect(editorPanel(page, "New playlist")).toBeVisible();

  await page.getByRole("button", { name: "Upload to board" }).click();
  await page
    .getByRole("dialog", { name: "Replace the stored file?" })
    .getByRole("button", { name: "Keep the board's" })
    .click();
  await expect(toastWith(page, "Kept the board's playlist default; nothing was sent").first()).toBeVisible();
  await expect(editorPanel(page, "New playlist")).toBeVisible();
  expect(readFileSync(path, "utf8")).toBe(before);

  await page.getByRole("button", { name: "Upload to board" }).click();
  await page
    .getByRole("dialog", { name: "Replace the stored file?" })
    .getByRole("button", { name: "Replace them" })
    .click();
  await expect(editorPanel(page, "New playlist")).toHaveCount(0);
  expect(JSON.parse(readFileSync(path, "utf8")).items).toEqual([{ animation: "star" }]);
});

test("marks an item whose animation is not stored and keeps it", async ({ page, simulator }) => {
  await connectSimulator(page, simulator);
  await pick(page, file("dot.yaml"));
  await expect(toastWith(page, "Uploaded animation dot").first()).toBeVisible();
  await newPlaylist(page);
  await page.getByLabel("ID", { exact: true }).fill("temp");
  await page.getByRole("button", { name: "Add animation" }).click();
  await page.getByLabel("Animation of item 1", { exact: true }).selectOption("dot");
  await page.getByRole("button", { name: "Upload to board" }).click();
  await showBoardPlaylists(page);
  await expect(row(playlists(page), "temp")).toBeVisible();
  await showAnimations(page);
  await chooseDelete(page, animations(page), "dot");
  await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  await showBoardPlaylists(page);
  await row(playlists(page), "temp").getByRole("button", { name: "Edit temp" }).click();
  await expect(page.getByText("not stored")).toBeVisible();
  await page.getByRole("button", { name: "Upload to board" }).click();
  // The board stores the playlist and warns about the missing animation: the editor stays open to show it.
  await expect(page.getByRole("table").filter({ hasText: "unknown_animation" })).toBeVisible();
  expect(JSON.parse(readFileSync(stored(simulator, "playlists", "temp"), "utf8")).items).toEqual([
    { animation: "dot" },
  ]);
});
