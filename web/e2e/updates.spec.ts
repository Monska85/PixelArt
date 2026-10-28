// SPDX-License-Identifier: GPL-3.0-or-later

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { firmwareBeforeSchedules } from "./board";
import { connectSimulator, expect, stored, test, watchReplies, watchRequests, type Simulator } from "./fixtures";

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

const animationJson = (name: string, color: string): string =>
  JSON.stringify({
    format: "pixelart/1",
    name,
    canvas: { width: 16, height: 16 },
    sprites: { dot: { points: [[7, 7, color]] } },
    timeline: [{ show: ["dot"] }],
  });

const ONE = animationJson("One", "#ff0000");
const TWO = animationJson("Two", "#00ff00");
const PLAYLIST = JSON.stringify({
  format: "pixelart-playlist/1",
  canvas: { width: 16, height: 16 },
  name: "Mix",
  items: [{ animation: "one" }, { animation: "two" }],
});

const FIRMWARE = "pixelart-simulated-firmware-9.0.0";

/** A release site: the manifest and the files it lists, as the simulator serves them from a folder. */
function site(withFirmware = false): Record<string, string> {
  const entry = (id: string, folder: string, text: string) => ({
    id,
    name: id,
    version: 1,
    file: `${folder}/${id}.json`,
    size: Buffer.byteLength(text),
    sha256: sha256(text),
  });
  const manifest = {
    format: "pixelart-manifest/1",
    version: withFirmware ? "9.0.0" : "1.2.0",
    released: "2026-11-02",
    firmware: withFirmware
      ? [
          {
            board: "simulator",
            chip: "ESP32-C3",
            part: "app",
            offset: 65536,
            file: "firmware/simulator/app-9.0.0.bin",
            size: Buffer.byteLength(FIRMWARE),
            sha256: sha256(FIRMWARE),
          },
        ]
      : [],
    animations: [entry("one", "animations", ONE), entry("two", "animations", TWO)],
    playlists: [entry("mix", "playlists", PLAYLIST)],
  };
  return {
    "manifest.json": JSON.stringify(manifest),
    "animations/one.json": ONE,
    "animations/two.json": TWO,
    "playlists/mix.json": PLAYLIST,
    ...(withFirmware ? { "firmware/simulator/app-9.0.0.bin": FIRMWARE } : {}),
  };
}

const card = (page: import("@playwright/test").Page) => page.getByRole("region", { name: "Updates" });

/** The board's default mode is Automatic: most of these tests are about what a check finds and reports. */
async function connectInNotifyMode(page: import("@playwright/test").Page, simulator: Simulator): Promise<void> {
  await connectSimulator(page, simulator);
  await card(page).getByLabel("Mode").selectOption("notify");
  await expect(card(page).getByLabel("Mode")).toHaveValue("notify");
}

test.describe("with an update source", () => {
  test.use({ updateSource: site() });

  test("shows the settings and the idle state of a board that never checked", async ({ page, simulator }) => {
    await connectSimulator(page, simulator);
    const updates = card(page);
    await expect(updates.getByLabel("Mode")).toHaveValue("automatic");
    await expect(updates.getByTestId("update-modes")).toContainText("Automatic: The board checks and installs");
    await expect(updates.getByRole("switch", { name: "Firmware updates" })).toBeChecked();
    await expect(updates.getByRole("switch", { name: "Animation updates" })).toBeChecked();
    await expect(updates).toContainText(
      "The release wins: animations, playlists and schedules with the same name are replaced",
    );
    await expect(updates.getByLabel("Check every (hours)")).toHaveValue("6");
    await expect(updates.getByLabel("From", { exact: true })).toHaveValue("00:00");
    await expect(updates.getByLabel("To", { exact: true })).toHaveValue("00:00");
    await expect(updates.getByTestId("install-window")).toContainText("whole day");
    await expect(updates.getByLabel("Animation source")).toHaveValue(
      "https://monska85.github.io/PixelArt/manifest.json",
    );
    await expect(updates.getByTestId("update-state")).toHaveText("Idle");
    await expect(updates.getByTestId("update-last-check")).toHaveText("not since the board started");
    await expect(updates.getByTestId("update-available")).toContainText("No firmware update");
    await expect(updates.getByRole("button", { name: "Check now" })).toBeEnabled();
    // Nothing is found yet.
    await expect(updates.getByRole("button", { name: "Install animations" })).toBeDisabled();
    await expect(updates.getByRole("group", { name: "The last check found nothing to install." })).toBeVisible();
    await expect(updates.getByRole("button", { name: "Install firmware" })).toBeDisabled();
    await expect(updates.getByRole("group", { name: "The last check found no firmware update." })).toBeVisible();
  });

  test("Check now finds the files and Install animations stores them, the release winning", async ({
    page,
    simulator,
  }) => {
    await connectInNotifyMode(page, simulator);
    const updates = card(page);
    await updates.getByRole("button", { name: "Check now" }).click();
    await expect(updates.getByTestId("update-last-check")).toContainText("ago: Done");
    await expect(updates.getByTestId("update-available")).toContainText(
      "3 animation, playlist or schedule changes to install",
    );
    // Notify mode stores nothing by itself.
    expect(existsSync(stored(simulator, "animations", "one"))).toBe(false);

    await updates.getByRole("button", { name: "Install animations" }).click();
    await expect(updates.getByTestId("update-available")).toContainText(
      "animations, playlists and schedules are up to date",
    );
    expect(readFileSync(stored(simulator, "animations", "one"), "utf8")).toBe(ONE);
    expect(readFileSync(stored(simulator, "animations", "two"), "utf8")).toBe(TWO);
    expect(readFileSync(stored(simulator, "playlists", "mix"), "utf8")).toBe(PLAYLIST);
    await expect(updates.getByRole("button", { name: "Install animations" })).toBeDisabled();
  });

  test("a mode change and the switches are sent to the board", async ({ page, simulator }) => {
    const replies = watchReplies(page, "settings_set");
    await connectSimulator(page, simulator);
    const updates = card(page);
    await expect(updates.getByLabel("Mode")).toHaveValue("automatic");
    await updates.getByLabel("Mode").selectOption("notify");
    await expect(updates.getByLabel("Mode")).toHaveValue("notify");
    expect(replies.replies.at(-1)).toMatchObject({ ok: true, settings: { update_mode: "notify" } });
    await updates.getByRole("switch", { name: "Firmware updates" }).click();
    await expect(updates.getByRole("switch", { name: "Firmware updates" })).not.toBeChecked();
    expect(replies.replies.at(-1)).toMatchObject({ settings: { update_firmware: false } });
    await updates.getByRole("switch", { name: "Animation updates" }).click();
    await expect(updates.getByRole("switch", { name: "Animation updates" })).not.toBeChecked();
    expect(replies.replies.at(-1)).toMatchObject({ settings: { update_animations: false, update_firmware: false } });
    // Both switches off: nothing to check.
    await expect(updates.getByRole("button", { name: "Check now" })).toBeDisabled();
    await expect(updates.getByRole("group", { name: "Updates are off.", exact: true })).toBeVisible();
  });

  test("with the mode Off, Check now is disabled and says why", async ({ page, simulator }) => {
    await connectInNotifyMode(page, simulator);
    const updates = card(page);
    await updates.getByLabel("Mode").selectOption("off");
    await expect(updates.getByRole("button", { name: "Check now" })).toBeDisabled();
    await expect(updates.getByRole("button", { name: "Install animations" })).toBeDisabled();
    await expect(updates.getByRole("group", { name: "Updates are off.", exact: true })).toBeVisible();
  });

  test("the check interval takes whole hours from 1 to 168", async ({ page, simulator }) => {
    const replies = watchReplies(page, "settings_set");
    await connectInNotifyMode(page, simulator);
    const modeChanges = replies.count(); // the helper sent one
    const hours = card(page).getByLabel("Check every (hours)");
    await hours.fill("0");
    await hours.press("Enter");
    await expect(card(page)).toContainText("A whole number of hours from 1 to 168.");
    await expect(hours).toHaveAttribute("aria-invalid", "true");
    expect(replies.count()).toBe(modeChanges);
    await hours.fill("168");
    await hours.press("Enter");
    await expect.poll(() => replies.replies.at(-1)).toMatchObject({ ok: true, settings: { check_hours: 168 } });
    await expect(hours).toHaveValue("168");
    await expect(card(page)).not.toContainText("A whole number of hours");
    // Leaving the field sends it too, and an unchanged value sends nothing.
    await hours.fill("12");
    await hours.blur();
    await expect.poll(() => replies.replies.at(-1)).toMatchObject({ settings: { check_hours: 12 } });
    const count = replies.count();
    await hours.fill("12");
    await hours.blur();
    expect(replies.count()).toBe(count);
  });

  test("the animation source is checked, saved and reset to the default", async ({ page, simulator }) => {
    const replies = watchReplies(page, "settings_set");
    await connectInNotifyMode(page, simulator);
    const updates = card(page);
    const source = updates.getByLabel("Animation source");
    const save = updates.getByRole("button", { name: "Save source" });
    const reset = updates.getByRole("button", { name: "Reset to default" });
    await expect(save).toBeDisabled();
    await expect(reset).toBeDisabled();
    await source.fill("ftp://example.org/manifest.json");
    await expect(updates).toContainText(
      "A web address that starts with https:// or http://, with a host and no user name or password.",
    );
    await expect(save).toBeDisabled();
    await source.fill(`https://example.org/${"a".repeat(520)}`);
    await expect(updates).toContainText("At most 512 characters.");
    await source.fill("http://localhost:8000/manifest.json");
    await expect(save).toBeEnabled();
    await save.click();
    await expect
      .poll(() => replies.replies.at(-1))
      .toMatchObject({
        settings: { animation_source: "http://localhost:8000/manifest.json" },
      });
    await expect(source).toHaveValue("http://localhost:8000/manifest.json");
    await expect(save).toBeDisabled();
    await reset.click();
    await expect
      .poll(() => replies.replies.at(-1))
      .toMatchObject({ settings: { animation_source: "https://monska85.github.io/PixelArt/manifest.json" } });
    await expect(source).toHaveValue("https://monska85.github.io/PixelArt/manifest.json");
    await expect(reset).toBeDisabled();
  });

  test("Check now shows its result without waiting for the next poll", async ({ page, simulator }) => {
    const statuses = watchReplies(page, "status");
    await connectInNotifyMode(page, simulator);
    await expect.poll(() => statuses.count()).toBeGreaterThan(0);
    await card(page).getByRole("button", { name: "Check now" }).click();
    // The click reads the status again as soon as the board answers, without waiting for the next poll.
    await expect(card(page).getByTestId("update-last-check")).toContainText("ago");
  });
});

test.describe("in the time zone of Rome", () => {
  test.use({ updateSource: site(), timezoneId: "Europe/Rome" });

  test("the install window is sent with the POSIX rule of the browser's time zone", async ({ page, simulator }) => {
    // A firmware from before schedules: the Updates card sends the zone. One that knows them has a Time zone field.
    const board = await firmwareBeforeSchedules(page, simulator);
    await connectInNotifyMode(page, simulator);
    const updates = card(page);
    await expect(updates.getByTestId("time-zone")).toContainText("Time zone: Europe/Rome. The board uses UTC0");
    await updates.getByLabel("From", { exact: true }).fill("22:00");
    await expect(updates.getByLabel("From", { exact: true })).toHaveValue("22:00");
    expect(board.replies("settings_set").at(-1)).toMatchObject({
      ok: true,
      settings: { install_start: 1320, install_end: 0, timezone: "CET-1CEST,M3.5.0,M10.5.0/3" },
    });
    await expect(updates.getByTestId("install-window")).toContainText("22:00 to 00:00 (over midnight)");
    await expect(updates.getByTestId("time-zone")).toContainText("the one of this browser");
    await updates.getByLabel("To", { exact: true }).fill("06:00");
    await expect(updates.getByLabel("To", { exact: true })).toHaveValue("06:00");
    expect(board.replies("settings_set").at(-1)).toMatchObject({ settings: { install_start: 1320, install_end: 360 } });
    await expect(updates.getByTestId("install-window")).toContainText("22:00 to 06:00 (over midnight)");
    // Equal times are the whole day again.
    await updates.getByLabel("To", { exact: true }).fill("22:00");
    await expect(updates.getByTestId("install-window")).toContainText("whole day");
  });

  test("on a firmware that knows schedules the window sends no time zone: Settings has the field", async ({
    page,
    simulator,
  }) => {
    const replies = watchReplies(page, "settings_set");
    await connectInNotifyMode(page, simulator);
    const updates = card(page);
    await expect(updates.getByTestId("time-zone")).toHaveText("Time zone: UTC, set under Time in the Settings card.");
    await updates.getByLabel("From", { exact: true }).fill("22:00");
    await expect(updates.getByLabel("From", { exact: true })).toHaveValue("22:00");
    expect(replies.replies.at(-1)).toMatchObject({ ok: true, settings: { install_start: 1320, timezone: "UTC0" } });
  });
});

test.describe("in a time zone the table does not have", () => {
  test.use({ updateSource: site(), timezoneId: "Pacific/Chatham" });

  test("the window keeps the board's time zone and the card says so", async ({ page, simulator }) => {
    const board = await firmwareBeforeSchedules(page, simulator);
    await connectInNotifyMode(page, simulator);
    const updates = card(page);
    await expect(updates.getByTestId("time-zone")).toContainText("does not know the rules of your time zone");
    await updates.getByLabel("From", { exact: true }).fill("01:00");
    await expect(updates.getByLabel("From", { exact: true })).toHaveValue("01:00");
    expect(board.replies("settings_set").at(-1)).toMatchObject({ settings: { install_start: 60, timezone: "UTC0" } });
  });
});

test.describe("with a download that fails", () => {
  test.use({ updateSource: site(), updateFail: ["cut:animations/two.json"] });

  test("the update goes on, and the card shows the failed file and its error", async ({ page, simulator }) => {
    await connectInNotifyMode(page, simulator);
    const updates = card(page);
    await updates.getByRole("button", { name: "Check now" }).click();
    await expect(updates.getByRole("button", { name: "Install animations" })).toBeEnabled();
    await updates.getByRole("button", { name: "Install animations" }).click();
    await expect(updates.getByTestId("update-last-check")).toContainText("(network_error)");
    await expect(updates).toContainText("1 file in the last update");
    await expect(updates.getByTestId("update-available")).toContainText(
      "1 animation, playlist or schedule change to install",
    );
    expect(existsSync(stored(simulator, "animations", "one"))).toBe(true);
    expect(existsSync(stored(simulator, "animations", "two"))).toBe(false);
  });
});

test.describe("with a server that does not answer", () => {
  test.use({ updateSource: site(), updateFail: ["down"] });

  test("a check fails with network_error and the card says so", async ({ page, simulator }) => {
    await connectInNotifyMode(page, simulator);
    const updates = card(page);
    await updates.getByRole("button", { name: "Check now" }).click();
    await expect(updates.getByTestId("update-last-check")).toContainText("(network_error)");
    await expect(updates.getByTestId("update-state")).toHaveText("Idle");
  });
});

test.describe("with a server that has no release yet", () => {
  test.use({ updateSource: {} });

  test("a check says that no release is published at the address, and what to do", async ({ page, simulator }) => {
    await connectInNotifyMode(page, simulator);
    const updates = card(page);
    await updates.getByRole("button", { name: "Check now" }).click();
    await expect(updates.getByTestId("update-last-check")).toContainText(
      "No release is published at this address yet. Check the animation source, or try again after the first release.",
    );
    await expect(updates.getByTestId("update-last-check")).not.toContainText("http_error");
  });
});

test.describe("with a server that answers an error for the manifest", () => {
  test.use({ updateSource: site(), updateFail: ["http:manifest.json"] });

  test("a check keeps the words of an HTTP error", async ({ page, simulator }) => {
    await connectInNotifyMode(page, simulator);
    const updates = card(page);
    await updates.getByRole("button", { name: "Check now" }).click();
    await expect(updates.getByTestId("update-last-check")).toContainText(
      "The server answered with an error (http_error)",
    );
  });
});

test.describe("without an update source", () => {
  test("a check fails with network_error: the simulator reaches no server", async ({ page, simulator }) => {
    await connectInNotifyMode(page, simulator);
    await card(page).getByRole("button", { name: "Check now" }).click();
    await expect(card(page).getByTestId("update-last-check")).toContainText("(network_error)");
  });
});

test.describe("with a firmware to install", () => {
  test.use({
    updateSource: site(true),
    simulatorArgs: ["--firmware-version", "1.2.0"],
  });

  test("Install firmware asks first, then installs, restarts the board and reports the update", async ({
    page,
    simulator,
  }) => {
    const installs = watchRequests(page, "update_install");
    await connectInNotifyMode(page, simulator);
    const updates = card(page);
    await expect(updates.getByRole("button", { name: "Install firmware" })).toBeDisabled();
    await updates.getByRole("button", { name: "Check now" }).click();
    await expect(updates.getByTestId("update-available")).toContainText("Firmware 9.0.0;");
    await expect(updates.getByRole("button", { name: "Install firmware" })).toBeEnabled();

    // Cancel sends nothing.
    await updates.getByRole("button", { name: "Install firmware" }).click();
    const dialog = page.getByRole("dialog", { name: "Install firmware 9.0.0?" });
    await expect(dialog.getByTestId("firmware-confirmation")).toContainText("goes back to 1.2.0 by itself");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    expect(installs).toHaveLength(0);

    await updates.getByRole("button", { name: "Install firmware" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Install firmware" }).click();
    await expect.poll(() => installs.length).toBe(1);
    expect(installs[0]).toMatchObject({ cmd: "update_install", target: "firmware" });
    expect(installs[0]).not.toHaveProperty("force");

    // The simulated board restarts into the new firmware, which confirms itself at its first frame.
    await expect(updates.getByTestId("update-status")).toContainText("Updated from 1.2.0 to 9.0.0", {
      timeout: 20_000,
    });
    await expect(updates.getByTestId("update-state")).toHaveText("Idle");
    await expect(updates.getByTestId("update-available")).toContainText("No firmware update");
    await expect(updates.getByRole("button", { name: "Install firmware" })).toBeDisabled();
  });

  test("the Firmware view shows the board's own update state next to the USB install", async ({ page, simulator }) => {
    await connectInNotifyMode(page, simulator);
    await card(page).getByRole("button", { name: "Check now" }).click();
    await expect(card(page).getByTestId("update-available")).toContainText("Firmware 9.0.0;");
    await page.getByRole("link", { name: "Firmware" }).click();
    const network = page.getByRole("region", { name: "Updates over WiFi" });
    await expect(network.getByTestId("network-update-wifi")).toHaveText("Connected");
    await expect(network.getByTestId("network-update-state")).toHaveText("Idle");
    await expect(network.getByTestId("network-update-firmware")).toHaveText("Firmware 9.0.0");
    await expect(network.getByRole("link", { name: "Updates card" })).toHaveAttribute("href", "#board");
    // The USB install is still there.
    await expect(page.getByRole("button", { name: "Update firmware" })).toBeVisible();
  });
});

test.describe("with a firmware that does not start", () => {
  test.use({
    updateSource: site(true),
    simulatorArgs: ["--firmware-version", "1.2.0", "--update-trial", "fail"],
  });

  test("the board rolls back, the card says so, and installing that version again needs force", async ({
    page,
    simulator,
  }) => {
    const installs = watchRequests(page, "update_install");
    await connectInNotifyMode(page, simulator);
    const updates = card(page);
    await updates.getByRole("button", { name: "Check now" }).click();
    await expect(updates.getByRole("button", { name: "Install firmware" })).toBeEnabled();
    await updates.getByRole("button", { name: "Install firmware" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Install firmware" }).click();
    await expect(updates.getByTestId("update-status")).toContainText(
      "9.0.0 did not start properly: the board went back to 1.2.0",
      { timeout: 20_000 },
    );
    await expect(updates.getByTestId("update-status")).toContainText("1.2.0");

    // The version is skipped: it is offered, with a warning, and installed only after another question, by force.
    await updates.getByRole("button", { name: "Check now" }).click();
    await expect(updates.getByTestId("update-available")).toContainText("which the board rolled back");
    await updates.getByRole("button", { name: "Install firmware" }).click();
    const dialog = page.getByRole("dialog", { name: "Install firmware 9.0.0 again?" });
    await expect(dialog.getByTestId("firmware-confirmation")).toContainText("did not start properly");
    await dialog.getByRole("button", { name: "Install anyway" }).click();
    await expect.poll(() => installs.length).toBe(2);
    expect(installs[1]).toMatchObject({ cmd: "update_install", target: "firmware", force: true });
  });
});

test.describe("with a firmware that cannot be downloaded", () => {
  test.use({
    updateSource: site(true),
    updateFail: ["corrupt:firmware/simulator/app-9.0.0.bin"],
    simulatorArgs: ["--firmware-version", "1.2.0"],
  });

  test("the error shows, the firmware stays on offer and the board keeps running", async ({ page, simulator }) => {
    await connectInNotifyMode(page, simulator);
    const updates = card(page);
    await updates.getByRole("button", { name: "Check now" }).click();
    await updates.getByRole("button", { name: "Install firmware" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Install firmware" }).click();
    await expect(updates.getByTestId("update-last-check")).toContainText("(checksum_mismatch)");
    await expect(updates.getByTestId("update-state")).toHaveText("Idle");
    await expect(updates.getByTestId("update-available")).toContainText("Firmware 9.0.0;");
    await expect(updates.getByRole("button", { name: "Install firmware" })).toBeEnabled();
    await expect(updates.getByTestId("update-status")).not.toContainText("Last install");
  });
});
