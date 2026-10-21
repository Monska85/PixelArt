import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { connectSimulator, expect, test, toastWith, type Simulator } from "./fixtures";

const published = JSON.parse(
  readFileSync(fileURLToPath(new URL("./site/published.json", import.meta.url)), "utf8"),
) as {
  animations: string[];
  playlists: string[];
};
const [SAME, MISSING, DIFFERENT] = published.animations as [string, string, string];

const library = (page: Page) => page.getByRole("link", { name: "Library", exact: true });
const state = (page: Page, id: string) => page.getByTestId(`state-${id}`);
const stored = (simulator: Simulator, kind: string, id: string): string => join(simulator.dataDir, kind, `${id}.json`);
const sha = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");
const publishedTable = (page: Page) => page.getByRole("table", { name: "Published animations" });
const summary = (page: Page) => page.getByRole("status").filter({ hasText: /(Upload|Install) summary/ });

/** A stored animation that has the ID of a published one but other content. */
function makeDifferent(simulator: Simulator, id: string): void {
  const path = stored(simulator, "animations", id);
  const document = JSON.parse(readFileSync(path, "utf8")) as { name: string };
  document.name = `${document.name} (changed)`;
  writeFileSync(path, JSON.stringify(document));
}

test("lists the published animations and playlists with their state on the board", async ({ page, simulator }) => {
  rmSync(stored(simulator, "animations", MISSING));
  makeDifferent(simulator, DIFFERENT);
  await connectSimulator(page, simulator);
  await library(page).click();

  await expect(page.getByText(/Published with firmware/)).toContainText("0.1.0");
  await expect(page.getByRole("tab", { name: /^Animations/ })).toContainText(String(published.animations.length));
  await expect(page.getByRole("tab", { name: /^Playlists/ })).toContainText(String(published.playlists.length));
  await expect(state(page, SAME)).toHaveText("Same");
  await expect(state(page, MISSING)).toHaveText("Not on the board");
  await expect(state(page, DIFFERENT)).toHaveText("Different");
  await expect(publishedTable(page).locator("tr", { hasText: SAME })).toContainText("Snowflake");
  await expect(page.getByRole("button", { name: "Install all" })).toBeEnabled();
  await expect(page.getByRole("button", { name: `Install ${SAME}` })).toBeDisabled();
  await expect(page.getByRole("button", { name: `Install ${MISSING}` })).toBeEnabled();

  await page.getByRole("tab", { name: /^Playlists/ }).click();
  await expect(state(page, "default")).toHaveText("Same");
});

test("without a board the library lists the entries and asks to connect", async ({ page }) => {
  await page.goto("/#library");
  await expect(publishedTable(page)).toContainText("Snowflake");
  await expect(page.getByText(/Connect a board to install them/)).toBeVisible();
  await expect(page.getByRole("group", { name: "Connect a board or the simulator to install." }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Install all" })).toBeDisabled();
  await expect(page.getByRole("button", { name: `Install ${MISSING}` })).toBeDisabled();
  await expect(page.getByTestId(`state-${MISSING}`)).toHaveCount(0);
});

test("previews a published animation", async ({ page }) => {
  await page.goto("/#library");
  await page.getByRole("button", { name: `Preview ${SAME}` }).click();
  const preview = page.getByRole("dialog", { name: `Preview of ${SAME}` });
  await expect(preview.getByRole("img", { name: `Preview of ${SAME}` })).toBeVisible();
  await preview.getByRole("button", { name: "Pause" }).click();
  await expect(preview.getByText(/^Frame 1, /)).toBeVisible();
});

test("installs a missing animation and the board lists it", async ({ page, simulator }) => {
  rmSync(stored(simulator, "animations", MISSING));
  await connectSimulator(page, simulator);
  await library(page).click();
  await expect(state(page, MISSING)).toHaveText("Not on the board");
  await page.getByRole("button", { name: `Install ${MISSING}` }).click();
  await expect(state(page, MISSING)).toHaveText("Same");
  await expect(toastWith(page, `Installed animation ${MISSING}`)).toBeVisible();
  expect(sha(stored(simulator, "animations", MISSING))).toBe(
    sha(join(fileURLToPath(new URL("../../data", import.meta.url)), "animations", `${MISSING}.json`)),
  );
  await page.getByRole("link", { name: "Board", exact: true }).click();
  await expect(
    page
      .getByRole("table", { name: "Animations on the board" })
      .locator("code", { hasText: new RegExp(`^${MISSING}$`) }),
  ).toBeVisible();
});

test("asks before replacing a different stored file: Cancel, Keep the board's, Replace them", async ({
  page,
  simulator,
}) => {
  makeDifferent(simulator, DIFFERENT);
  const before = sha(stored(simulator, "animations", DIFFERENT));
  await connectSimulator(page, simulator);
  await library(page).click();

  await page.getByRole("button", { name: `Install ${DIFFERENT}` }).click();
  const dialog = page.getByRole("dialog", { name: "Replace the stored file?" });
  await expect(dialog.getByTestId("differing-files")).toContainText(DIFFERENT);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(state(page, DIFFERENT)).toHaveText("Different");
  expect(sha(stored(simulator, "animations", DIFFERENT))).toBe(before);

  await page.getByRole("button", { name: `Install ${DIFFERENT}` }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Keep the board's" }).click();
  await expect(toastWith(page, "Nothing to install")).toContainText("The board's files were kept.");
  await expect(state(page, DIFFERENT)).toHaveText("Different");
  expect(sha(stored(simulator, "animations", DIFFERENT))).toBe(before);

  await page.getByRole("button", { name: `Install ${DIFFERENT}` }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Replace them" }).click();
  await expect(state(page, DIFFERENT)).toHaveText("Same");
  expect(sha(stored(simulator, "animations", DIFFERENT))).not.toBe(before);
});

test("installs everything that is missing, playlists too", async ({ page, simulator }) => {
  rmSync(stored(simulator, "animations", MISSING));
  rmSync(stored(simulator, "animations", SAME));
  rmSync(stored(simulator, "playlists", "default"));
  await connectSimulator(page, simulator);
  await library(page).click();
  await page.getByRole("button", { name: "Install all" }).click();
  await page.getByRole("menuitem", { name: `Everything (${published.animations.length + 1})` }).click();
  await expect(summary(page)).toContainText(`Installed: ${SAME}, ${MISSING}, default`);
  await expect(summary(page)).toContainText(`Skipped, the board has the same file: ${DIFFERENT}`);
  for (const id of [MISSING, SAME]) await expect(state(page, id)).toHaveText("Same");
  expect(existsSync(stored(simulator, "animations", MISSING))).toBe(true);
  expect(existsSync(stored(simulator, "animations", SAME))).toBe(true);
  expect(existsSync(stored(simulator, "playlists", "default"))).toBe(true);
});

test("refuses a download that does not match the manifest, by size or by SHA-256", async ({ page, simulator }) => {
  rmSync(stored(simulator, "animations", MISSING));
  let damage: "size" | "sha" = "size";
  await page.route(`**/animations/${MISSING}.json`, async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    const changed =
      damage === "size" ? `${body} ` : body.replace(/[a-y]/, (c) => String.fromCharCode(c.charCodeAt(0) + 1));
    await route.fulfill({ response, body: Buffer.from(changed) });
  });
  await connectSimulator(page, simulator);
  await library(page).click();

  await page.getByRole("button", { name: `Install ${MISSING}` }).click();
  await expect(page.getByRole("alert").filter({ hasText: "size" })).toBeVisible();
  await expect(state(page, MISSING)).toHaveText("Not on the board");
  expect(existsSync(stored(simulator, "animations", MISSING))).toBe(false);

  damage = "sha";
  await page.getByRole("button", { name: `Install ${MISSING}` }).click();
  await expect(page.getByRole("alert").filter({ hasText: "SHA-256" })).toBeVisible();
  await expect(state(page, MISSING)).toHaveText("Not on the board");
  expect(existsSync(stored(simulator, "animations", MISSING))).toBe(false);
});

test("says that nothing is published without a manifest", async ({ page }) => {
  await page.route("**/manifest.json", (route) => route.fulfill({ status: 404, body: "not found" }));
  await page.goto("/#library");
  await expect(page.getByTestId("library-empty")).toContainText("Nothing is published yet");
});

test("treats a manifest of another format as nothing published", async ({ page }) => {
  await page.route("**/manifest.json", (route) =>
    route.fulfill({ json: { format: "pixelart-manifest/2", version: "1.0.0" } }),
  );
  await page.goto("/#library");
  await expect(page.getByTestId("library-empty")).toContainText("Nothing is published yet");
});

test("every row the board does not have the same has a visible Install button, for animations and playlists", async ({
  page,
  simulator,
}) => {
  rmSync(stored(simulator, "animations", MISSING));
  rmSync(stored(simulator, "playlists", "default"));
  makeDifferent(simulator, DIFFERENT);
  await connectSimulator(page, simulator);
  await library(page).click();

  // Direct icon buttons: no menu holds them.
  await expect(page.getByRole("button", { name: /^More actions for / })).toHaveCount(0);
  await expect(page.getByRole("button", { name: `Install ${MISSING}` })).toBeEnabled();
  await expect(page.getByRole("button", { name: `Install ${DIFFERENT}` })).toBeEnabled();
  await expect(page.getByRole("button", { name: `Install ${SAME}` })).toBeDisabled();
  await page.getByRole("tab", { name: /^Playlists/ }).click();
  await expect(state(page, "default")).toHaveText("Not on the board");
  const install = page.getByRole("button", { name: "Install default" });
  await expect(install).toBeEnabled();
  await install.hover();
  await expect(page.getByRole("tooltip")).toHaveText("Install with its animations");
});

test("Open in editor is a button on each animation row, not a menu item", async ({ page }) => {
  await page.goto("/#library");
  await expect(page.getByRole("button", { name: /^More actions for / })).toHaveCount(0);
  const open = page.getByRole("button", { name: `Open ${SAME} in editor` });
  await open.hover();
  await expect(page.getByRole("tooltip")).toHaveText("Open in editor");
  await open.click();
  await expect(page.getByRole("heading", { name: "Editor", level: 2, exact: true })).toBeVisible();
  await expect(page.getByTestId("editor-source")).toContainText(SAME);
});
