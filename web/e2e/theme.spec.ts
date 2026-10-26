// SPDX-License-Identifier: GPL-3.0-or-later

import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const themeOf = (page: Page) => page.evaluate(() => document.documentElement.dataset.theme);
const background = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const NEXT: Record<string, string> = { System: "Dark", Dark: "Light", Light: "System" };
const themeButton = (page: Page, name: string) =>
  page.getByRole("button", { name: `Theme: ${name}. Click for ${NEXT[name]}.` });

/** Clicks the theme button until the theme is `option`, one click per step of System, Dark, Light. */
async function choose(page: Page, current: string, option: string): Promise<void> {
  for (let at = current; at !== option; at = NEXT[at]!) {
    await themeButton(page, at).click();
    await expect(themeButton(page, NEXT[at]!)).toBeVisible();
  }
}

test("starts on System and follows the operating system, live", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(themeButton(page, "System")).toBeVisible();
  expect(await themeOf(page)).toBe("dark");
  const dark = await background(page);

  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(() => themeOf(page)).toBe("light");
  expect(await background(page)).not.toBe(dark);

  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(() => themeOf(page)).toBe("dark");
  expect(await background(page)).toBe(dark);
});

test("one click cycles System, Dark, Light, System with the state in the tooltip and the accessible name", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  const button = page.getByTestId("theme-button");
  await expect(page.getByRole("menuitemradio")).toHaveCount(0);

  const seen: string[] = [];
  for (const [state, next] of [
    ["System", "Dark"],
    ["Dark", "Light"],
    ["Light", "System"],
  ] as const) {
    await expect(button).toHaveAccessibleName(`Theme: ${state}. Click for ${next}.`);
    // The tooltip closes on a click and opens again only when the pointer comes back.
    await page.mouse.move(0, 0);
    await button.hover();
    await expect(page.getByRole("tooltip")).toHaveText(`Theme: ${state}. Click for ${next}.`);
    seen.push(String(await themeOf(page)));
    await button.click();
  }
  await expect(button).toHaveAccessibleName("Theme: System. Click for Dark.");
  // System followed the light operating system, Dark was dark, Light was light.
  expect(seen).toEqual(["light", "dark", "light"]);
});

test("Enter and Space cycle the theme from the keyboard", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("theme-button").focus();
  await page.keyboard.press("Enter");
  await expect(themeButton(page, "Dark")).toBeFocused();
  await page.keyboard.press("Space");
  await expect(themeButton(page, "Light")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(themeButton(page, "System")).toBeFocused();
});

test("Dark and Light ignore the operating system, and System follows it again", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await choose(page, "System", "Dark");
  await expect(themeButton(page, "Dark")).toBeVisible();
  expect(await themeOf(page)).toBe("dark");

  // An operating system change does nothing while a theme is chosen.
  await page.emulateMedia({ colorScheme: "dark" });
  await page.emulateMedia({ colorScheme: "light" });
  expect(await themeOf(page)).toBe("dark");

  await choose(page, "Dark", "Light");
  expect(await themeOf(page)).toBe("light");
  await page.emulateMedia({ colorScheme: "dark" });
  expect(await themeOf(page)).toBe("light");

  await choose(page, "Light", "System");
  await expect.poll(() => themeOf(page)).toBe("dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(() => themeOf(page)).toBe("light");
});

test("the choice survives a reload and is applied before the app runs", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await choose(page, "System", "Dark");
  await page.reload();
  await expect(themeButton(page, "Dark")).toBeVisible();
  expect(await themeOf(page)).toBe("dark");

  // The first paint already has the theme: a classic script in the head sets it, not the app's bundle.
  await page.route("**/assets/index-*.js", (route) => route.fulfill({ contentType: "text/javascript", body: "" }));
  await page.reload();
  expect(await themeOf(page)).toBe("dark");
});

test("with the browser's storage blocked the app starts on System and still switches", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("blocked");
      },
    });
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(themeButton(page, "System")).toBeVisible();
  expect(await themeOf(page)).toBe("dark");

  await choose(page, "System", "Light");
  expect(await themeOf(page)).toBe("light");
  await page.reload();
  await expect(themeButton(page, "System")).toBeVisible();
  expect(await themeOf(page)).toBe("dark");
});
