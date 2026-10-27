// SPDX-License-Identifier: GPL-3.0-or-later

import { fakeSerial, failedOpens, portLog } from "./first-install";
import { expect, test } from "./fixtures";

const NOT_A_PIXELART_BOARD =
  "This board did not answer as a PixelArt board. Its firmware may be old or missing: install the firmware from the Firmware view.";

// Each handshake takes about 10 seconds, and a second Connect board runs it again.
test.describe("a USB board that does not answer the protocol", () => {
  test.setTimeout(120_000);

  for (const answer of ["none", "garbage"] as const) {
    test(`says its firmware may be old or missing and lets Connect board open the port again (${answer})`, async ({
      page,
    }) => {
      await fakeSerial(page, { board: null, pick: true, answer });
      await page.goto("/");
      const message = page.getByTestId("connection-message");

      for (const opens of [1, 2]) {
        await page.getByRole("button", { name: "Connect board" }).first().click();
        await expect(message).toContainText(NOT_A_PIXELART_BOARD, { timeout: 40_000 });
        await expect(message.getByRole("link", { name: "Open the Firmware view" })).toBeVisible();
        await expect(page.getByTestId("connection-state")).toHaveText("Not connected");
        expect((await portLog(page)).opens).toBe(opens);
        expect(await failedOpens(page)).toEqual([]);
      }
    });
  }
});
