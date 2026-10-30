// SPDX-License-Identifier: GPL-3.0-or-later

import { expect, test } from "./fixtures";

test("the favicon loads and decodes from the app's own directory", async ({ page }) => {
  await page.goto("/#board");
  const icon = page.locator('link[rel="icon"]');
  await expect(icon).toHaveAttribute("href", "./favicon.svg");

  const iconUrl = await icon.evaluate((link: HTMLLinkElement) => link.href);
  const response = await page.request.get(iconUrl);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("image/svg+xml");

  const dimensions = await page.evaluate(async (url) => {
    const image = new Image();
    image.src = url;
    await image.decode();
    return [image.naturalWidth, image.naturalHeight];
  }, iconUrl);
  expect(dimensions).toEqual([16, 16]);
});
