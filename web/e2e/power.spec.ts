// SPDX-License-Identifier: GPL-3.0-or-later

// The Power card against the simulator, which takes the starts of its board from `--boot`
// (docs/board/power-protection-v1.md, "Simulator and tests"). The animation and frame of a marker are fixtures of
// e2e/board-files/.

import type { Page } from "@playwright/test";
import { rewritePower } from "./board";
import { connectSimulator, expect, test, toastWith, watchRequests } from "./fixtures";

const brownouts = (count: number, marker = ""): string[] =>
  Array.from({ length: count }, () => ["--boot", `brownout${marker}`]).flat();

const THREE_WITH_MARKER = brownouts(3, ":bear:1");
const SCALE_SENTENCE = /Playing now at \d+%\.|The animation playing now is not dimmed\./;

const powerCard = (page: Page) => page.getByRole("region", { name: "Power" });
const wifiCard = (page: Page) => page.getByRole("region", { name: "WiFi" });

test("a healthy board shows no Power card", async ({ page, simulator }) => {
  await connectSimulator(page, simulator);
  await expect(wifiCard(page)).toBeVisible();
  await expect(powerCard(page)).toHaveCount(0);
});

test.describe("three brownouts", () => {
  test.use({ simulatorArgs: THREE_WITH_MARKER });

  test("show the note with the count and a scale sentence", async ({ page, simulator }) => {
    await connectSimulator(page, simulator);
    const note = powerCard(page).getByTestId("power-protection");
    await expect(note).toContainText("Power protection is on.");
    await expect(note).toContainText("restarted 3 times");
    await expect(note).toContainText(SCALE_SENTENCE);
    await expect(note).not.toContainText("lowest level");
  });

  test("Cancel in the dialog sends no power_reset", async ({ page, simulator }) => {
    const requests = watchRequests(page, "power_reset");
    await connectSimulator(page, simulator);
    await powerCard(page).getByRole("button", { name: "I changed the power hardware" }).click();
    const dialog = page.getByRole("dialog", { name: "Turn power protection off?" });
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(powerCard(page)).toBeVisible();
    await page.waitForTimeout(250);
    expect(requests).toEqual([]);
  });

  test("confirming turns the protection off and the card goes away", async ({ page, simulator }) => {
    const requests = watchRequests(page, "power_reset");
    await connectSimulator(page, simulator);
    await powerCard(page).getByRole("button", { name: "I changed the power hardware" }).click();
    await page
      .getByRole("dialog", { name: "Turn power protection off?" })
      .getByRole("button", { name: "Turn off" })
      .click();
    await expect(toastWith(page, "Power protection is off")).toBeVisible();
    await expect(powerCard(page)).toHaveCount(0);
    expect(requests).toHaveLength(1);
  });

  test("a status reply without power keeps the card hidden while the limit is on", async ({ page, simulator }) => {
    const sent = await rewritePower(page, simulator, () => undefined);
    await connectSimulator(page, simulator);
    await expect(wifiCard(page)).toBeVisible();
    await expect.poll(() => sent.length).toBeGreaterThan(0);
    expect(sent[0]).toMatchObject({ limit_active: true });
    await expect(powerCard(page)).toHaveCount(0);
  });
});

test.describe("twenty brownouts without a marker", () => {
  test.use({ simulatorArgs: brownouts(20) });

  test("keep ten in the history and send the user to the power supply advice at the floor", async ({
    page,
    simulator,
  }) => {
    await connectSimulator(page, simulator);
    const note = powerCard(page).getByTestId("power-protection");
    await expect(note).toContainText("restarted 10 times");
    await expect(note).toContainText("Your power supply is not adequate even at the lowest level.");
    const link = note.getByRole("link", { name: "power supply advice" });
    await expect(link).toHaveAttribute("href", /README\.md#power-supply-improvement$/);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});
