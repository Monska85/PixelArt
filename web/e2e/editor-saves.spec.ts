// SPDX-License-Identifier: GPL-3.0-or-later

import { existsSync, rmSync } from "node:fs";
import type { Dialog, Page } from "@playwright/test";
import { connectSimulator, expect, file, showFiles, stored, test, text } from "./fixtures";

const editorLink = (page: Page) => page.getByRole("link", { name: "Editor", exact: true });
const state = (page: Page) => page.getByTestId("save-state");
const TIME = "\\d\\d:\\d\\d";

/** Uploads the document under the ID, which the first save asks for. */
async function uploadAs(page: Page, id: string): Promise<void> {
  await page.getByRole("button", { name: "Upload to board" }).click();
  const chooser = page.getByRole("dialog");
  if (await chooser.getByLabel("ID", { exact: true }).isVisible()) {
    await chooser.getByLabel("ID", { exact: true }).fill(id);
    await chooser.getByRole("button", { name: "Use this ID" }).click();
  }
  await expect(page.getByTestId("save-outcome")).toContainText(/Uploaded animation|already has this exact/);
}

test("a new animation is a draft in this browser only, with a first-use note that Got it hides for good", async ({
  page,
}) => {
  await page.goto("/#editor");
  await expect(state(page)).toHaveText("Draft in this browser only");
  await expect(state(page)).toHaveAttribute("data-kind", "draft");
  const note = page.getByTestId("editor-note");
  await expect(note).toContainText("It is not a backup");
  await note.getByRole("button", { name: "Got it" }).click();
  await expect(note).toHaveCount(0);
  await page.reload();
  await expect(state(page)).toBeVisible();
  await expect(page.getByTestId("editor-note")).toHaveCount(0);
});

test("the first-use note shows again when the browser cannot remember the answer", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    });
  });
  await page.goto("/#editor");
  await page.getByTestId("editor-note").getByRole("button", { name: "Got it" }).click();
  await expect(page.getByTestId("editor-note")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("editor-note")).toBeVisible();
});

test("the save state follows an upload, an edit, an undo, a download and the board's files", async ({
  page,
  simulator,
}) => {
  await connectSimulator(page, simulator);
  await editorLink(page).click();
  await text(page, "Name", "Saved Dot");
  await expect(state(page)).toHaveText("Draft in this browser only");

  await uploadAs(page, "e2e_saves");
  await expect(state(page)).toHaveText(new RegExp(`^Saved to board as e2e_saves at ${TIME}$`));

  // An edit leaves it as changed since the upload; undoing the edit makes it saved again, by content.
  await text(page, "Name", "Saved Dot 2");
  await expect(state(page)).toHaveText(new RegExp(`^Changed since: saved to board as e2e_saves at ${TIME}$`));
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(state(page)).toHaveText(new RegExp(`^Saved to board as e2e_saves at ${TIME}$`));
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(state(page)).toHaveText(/^Changed since: /);

  // A download is the current copy now, and the tooltip lists both.
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download YAML" }).click();
  expect((await download).suggestedFilename()).toBe("e2e_saves.yaml");
  await expect(state(page)).toHaveText(new RegExp(`^Downloaded as e2e_saves.yaml at ${TIME}$`));
  await state(page).hover();
  await expect(page.getByRole("tooltip")).toContainText("Saved to board as e2e_saves");
  await expect(page.getByRole("tooltip")).toContainText("(older version)");
  await page.keyboard.press("Escape");

  // Uploaded again over the changed file: both copies are current, and the newest is shown.
  await page.getByRole("button", { name: "Upload to board" }).click();
  await page
    .getByRole("dialog", { name: "Replace the stored file?" })
    .getByRole("button", { name: "Replace them" })
    .click();
  await expect(state(page)).toHaveText(new RegExp(`^Saved to board as e2e_saves at ${TIME}$`));
});

test("a file that is no longer on the connected board is not shown as saved to it", async ({ page, simulator }) => {
  await connectSimulator(page, simulator);
  await editorLink(page).click();
  await text(page, "Name", "Gone Soon");
  await uploadAs(page, "e2e_gone");
  await expect(state(page)).toHaveText(new RegExp(`^Saved to board as e2e_gone at ${TIME}$`));
  rmSync(stored(simulator, "animations", "e2e_gone"));
  // The check reads the board's files again when the view opens.
  await page.getByRole("link", { name: "Board" }).click();
  await editorLink(page).click();
  await expect(state(page)).toHaveText("Not on the connected board");
  await expect(state(page)).toHaveAttribute("data-kind", "not-on-board");
  // Uploading again puts it back.
  await uploadAs(page, "e2e_gone");
  await expect(state(page)).toHaveText(new RegExp(`^Saved to board as e2e_gone at ${TIME}$`));
});

test("an animation opened from a file is the same as that file, and from the board saved to the board", async ({
  page,
  simulator,
}) => {
  await connectSimulator(page, simulator);
  await showFiles(page);
  await editorLink(page).click();
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Open file" }).click();
  await page.locator("#editor-open").setInputFiles(file("dot.yaml"));
  await expect(state(page)).toHaveText("Same as dot.yaml");
  await text(page, "Name", "Dot changed");
  await expect(state(page)).toHaveText("Changed since: opened from dot.yaml");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(state(page)).toHaveText("Same as dot.yaml");

  await page.getByRole("link", { name: "Board" }).click();
  await page.getByRole("button", { name: "Edit snowflake", exact: true }).click();
  await expect(state(page)).toHaveText(new RegExp(`^Saved to board as snowflake at ${TIME}$`));
  // The draft keeps the copies, so the state is still right after a reload.
  await text(page, "Name", "Snowflake plus");
  await expect(page.getByTestId("draft-status")).toHaveText("Draft saved in this browser.");
  await page.reload();
  await expect(state(page)).toHaveText(new RegExp(`^Changed since: saved to board as snowflake at ${TIME}$`));
});

test("leaving the page asks only while the work is saved nowhere", async ({ page, simulator }) => {
  await connectSimulator(page, simulator);
  await editorLink(page).click();
  const dialogs: Dialog[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog);
    void dialog.dismiss();
  });

  // An untouched new animation has nothing to lose.
  await text(page, "Name", "Leave me");
  await page.getByRole("heading", { name: "Palette" }).click();
  await page.close({ runBeforeUnload: true });
  await expect.poll(() => dialogs.length).toBe(1);
  expect(dialogs[0]?.type()).toBe("beforeunload");
  expect(page.isClosed()).toBe(false);

  // Once saved to the board, or downloaded, leaving needs no question.
  await uploadAs(page, "e2e_leave");
  await text(page, "Name", "Leave me again");
  dialogs.length = 0;
  await page.close({ runBeforeUnload: true });
  await expect.poll(() => dialogs.length).toBe(1);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(state(page)).toHaveText(/^Saved to board/);
  dialogs.length = 0;
  await page.close({ runBeforeUnload: true });
  await expect.poll(() => page.isClosed()).toBe(true);
  expect(dialogs).toHaveLength(0);
});

test("leaving the page asks after the saved file is deleted from the Board view", async ({ page, simulator }) => {
  await connectSimulator(page, simulator);
  await showFiles(page);
  await editorLink(page).click();
  await text(page, "Name", "Deleted elsewhere");
  await uploadAs(page, "e2e_elsewhere");
  await page.getByRole("link", { name: "Board" }).click();
  await page.getByRole("button", { name: "More actions for e2e_elsewhere" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("e2e_elsewhere", { exact: true })).toHaveCount(0);
  expect(existsSync(stored(simulator, "animations", "e2e_elsewhere"))).toBe(false);

  const dialogs: Dialog[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog);
    void dialog.dismiss();
  });
  await page.close({ runBeforeUnload: true });
  await expect.poll(() => dialogs.length).toBe(1);
  expect(dialogs[0]?.type()).toBe("beforeunload");
});

for (const via of ["Board", "Firmware"] as const) {
  test(`leaving the page asks after Delete everything in the ${via} view removed the saved file`, async ({
    page,
    simulator,
  }) => {
    await connectSimulator(page, simulator);
    await editorLink(page).click();
    await text(page, "Name", `Wiped from ${via}`);
    await uploadAs(page, `e2e_wiped_${via.toLowerCase()}`);
    await expect(state(page)).toHaveText(/^Saved to board/);
    await page.getByRole("link", { name: via, exact: true }).click();
    if (via === "Board") {
      await page.getByRole("button", { name: "More", exact: true }).click();
      await page.getByRole("menuitem", { name: "Delete everything" }).click();
    } else {
      await page.getByRole("button", { name: "Delete everything" }).click();
    }
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /^Delete \d+ files$/ })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // The page is left from the view where the files were deleted: only the lists read again can tell it.
    await expect(page.locator("#main")).toHaveAttribute("data-list-animations-count", "0");
    await expect(page.locator("#main")).toHaveAttribute("data-list-playlists-count", "0");
    if (via === "Board") {
      await showFiles(page);
      await expect(page.getByText("No animations on this board")).toBeVisible();
    }

    const dialogs: Dialog[] = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog);
      void dialog.dismiss();
    });
    await page.close({ runBeforeUnload: true });
    await expect.poll(() => dialogs.length).toBe(1);
    expect(dialogs[0]?.type()).toBe("beforeunload");
  });
}

test("a fresh new animation can be left without a question", async ({ page }) => {
  await page.goto("/#editor");
  await expect(state(page)).toBeVisible();
  await page.getByRole("heading", { name: "Palette" }).click();
  const dialogs: Dialog[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog);
    void dialog.dismiss();
  });
  await page.close({ runBeforeUnload: true });
  await expect.poll(() => page.isClosed()).toBe(true);
  expect(dialogs).toHaveLength(0);
});

test("Delete warns when the editor holds the only saved copy, and Download YAML first removes the warning", async ({
  page,
  simulator,
}) => {
  await connectSimulator(page, simulator);
  await showFiles(page);
  await page.getByRole("button", { name: "Edit star", exact: true }).click();
  await expect(state(page)).toHaveText(new RegExp(`^Saved to board as star at `));
  await page.getByRole("link", { name: "Board" }).click();

  // Another file has no warning.
  await page.getByRole("button", { name: "More actions for ball" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(page.getByRole("dialog")).not.toContainText("The editor holds");
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "More actions for star" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete star?" });
  await expect(dialog.getByTestId("only-copy")).toHaveText(
    "The editor holds this animation and it has no other saved copy.",
  );
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download YAML first" }).click();
  expect((await download).suggestedFilename()).toBe("star.yaml");
  await expect(dialog.getByTestId("only-copy")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Download YAML first" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await expect.poll(() => existsSync(stored(simulator, "animations", "star"))).toBe(false);
});

test("Delete everything warns the same way", async ({ page, simulator }) => {
  await connectSimulator(page, simulator);
  await showFiles(page);
  await page.getByRole("button", { name: "Edit star", exact: true }).click();
  await expect(page.getByRole("button", { name: "Back to Board" })).toBeVisible();
  await page.getByRole("link", { name: "Board" }).click();
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Delete everything" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByTestId("only-copy")).toBeVisible();
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download YAML first" }).click();
  await download;
  await expect(dialog.getByTestId("only-copy")).toHaveCount(0);
});

test("a view the user went to while an animation was opening is not replaced by the editor", async ({
  page,
  simulator,
}) => {
  // The editor's store loads after the first paint: hold it, so Edit star is still opening when the user moves on.
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(/assets\/store-.*\.js/, async (route) => {
    await held;
    await route.continue();
  });
  await connectSimulator(page, simulator);
  await showFiles(page);
  await page.getByRole("button", { name: "Edit star", exact: true }).click();
  await page.getByRole("link", { name: "Library", exact: true }).click();
  await expect(page).toHaveURL(/#library$/);

  const loaded = page.waitForResponse(/assets\/store-.*\.js/);
  release();
  await loaded;
  await page.waitForTimeout(500);
  await expect(page).toHaveURL(/#library$/);
  await expect(page.getByRole("heading", { name: "Library", exact: true })).toBeVisible();

  // The document was opened all the same.
  await editorLink(page).click();
  await expect(page.getByTestId("editor-source")).toContainText("star");
});

test("the header does not flicker to a warning while the list is read again after an upload", async ({
  page,
  simulator,
}) => {
  await connectSimulator(page, simulator);
  await editorLink(page).click();
  await text(page, "Name", "Steady");
  await expect(state(page)).toBeVisible();
  await page.evaluate(() => {
    const seen = new Set<string>();
    (window as unknown as { seenKinds: Set<string> }).seenKinds = seen;
    const note = (): void => {
      const kind = document.querySelector('[data-testid="save-state"]')?.getAttribute("data-kind");
      if (kind) seen.add(kind);
    };
    new MutationObserver(note).observe(document.body, { subtree: true, childList: true, attributes: true });
  });
  await uploadAs(page, "e2e_steady");
  await expect(state(page)).toHaveAttribute("data-kind", "board");
  // Opening the Editor again and any later read of the list leave it saved too.
  await page.getByRole("link", { name: "Board" }).click();
  await showFiles(page);
  await expect(page.getByText("e2e_steady", { exact: true })).toBeVisible();
  const seen = await page.evaluate(() => [...(window as unknown as { seenKinds: Set<string> }).seenKinds]);
  expect(seen).not.toContain("unchecked");
  expect(seen).not.toContain("not-on-board");
});
