import type { Page } from "@playwright/test";
import { connectSimulator, expect, test } from "./fixtures";

/** A Web Serial that records, when a port is asked for, whether every WebSocket of the page was already closing. */
async function stubSerial(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const sockets: WebSocket[] = [];
    const Native = window.WebSocket;
    window.WebSocket = class extends Native {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        sockets.push(this);
      }
    };
    const asked: boolean[] = [];
    (window as unknown as { portRequests: boolean[] }).portRequests = asked;
    Object.defineProperty(navigator, "serial", {
      configurable: true,
      value: {
        requestPort: async () => {
          asked.push(sockets.every((socket) => socket.readyState >= WebSocket.CLOSING));
          throw new DOMException("no port in the test", "AbortError");
        },
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      },
    });
  });
  // ESP Web Tools reports a failed port request with alert().
  page.on("dialog", (dialog) => void dialog.dismiss());
}

test("compares the version of the board with the latest release and shows the install buttons", async ({
  page,
  simulator,
}) => {
  await connectSimulator(page, simulator);
  await page.getByRole("link", { name: "Firmware" }).click();
  await expect(page.getByTestId("firmware-latest")).toHaveText("0.1.0");
  const check = page.getByTestId("firmware-check");
  await expect(check).toContainText(/^This board runs 0\.0\.0-dev\..* The latest release is 0\.1\.0\./);
  await expect(check).toContainText("Update available");
  await expect(check).toContainText("Development build");
  await expect(page.getByRole("button", { name: "Update firmware" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Install from scratch" })).toBeVisible();
  await expect(page.getByTestId("erase-warning")).toContainText("deletes the settings and every stored file");
  await expect(page.locator("esp-web-install-button")).toHaveCount(2);
  await expect(page.locator('esp-web-install-button[manifest="./firmware/update.json"]')).toHaveCount(1);
  await expect(page.locator('esp-web-install-button[manifest="./firmware/install.json"]')).toHaveCount(1);
});

test("offers the install buttons without a connection, and no comparison", async ({ page }) => {
  await page.goto("/#firmware");
  await expect(page.getByRole("button", { name: "Install from scratch" })).toBeVisible();
  await expect(page.getByTestId("firmware-check")).toHaveCount(0);
});

test("closes the connection of the app before ESP Web Tools asks for the port, then offers to reconnect", async ({
  page,
  simulator,
}) => {
  await stubSerial(page);
  await connectSimulator(page, simulator);
  await page.getByRole("link", { name: "Firmware" }).click();
  await page.getByRole("button", { name: "Update firmware" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { portRequests: boolean[] }).portRequests))
    .toEqual([true]);
  await expect(page.getByTestId("connection-state")).toHaveText("Not connected");
  await expect(page.getByTestId("reconnect")).toContainText("connection of this app was closed");
  await expect(page.getByRole("button", { name: "Connect board" }).last()).toBeVisible();
});

test("asks for the port directly when the app is not connected", async ({ page }) => {
  await stubSerial(page);
  await page.goto("/#firmware");
  await page.getByRole("button", { name: "Install from scratch" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { portRequests: boolean[] }).portRequests))
    .toEqual([true]);
  await expect(page.getByTestId("reconnect")).toHaveCount(0);
});

test("ESP Web Tools opens its dialog under the Content Security Policy", async ({ page }) => {
  // A port that opens but carries no data: the dialog opens and reports that the board does not answer.
  await page.addInitScript(() => {
    const port = {
      open: async () => undefined,
      close: async () => undefined,
      readable: null,
      writable: null,
      getInfo: () => ({}),
      setSignals: async () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };
    Object.defineProperty(navigator, "serial", {
      configurable: true,
      value: { requestPort: async () => port, addEventListener: () => undefined, removeEventListener: () => undefined },
    });
  });
  await page.goto("/#firmware");
  await page.getByRole("button", { name: "Install from scratch" }).click();
  await expect(page.locator("ewt-install-dialog ew-dialog[open]")).toBeVisible();
  await expect(page.locator("ewt-install-dialog").getByText("Error", { exact: true })).toBeVisible();
  // Any Content Security Policy violation is a console error and fails the test.
});
