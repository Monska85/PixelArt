// SPDX-License-Identifier: GPL-3.0-or-later

import type { Page } from "@playwright/test";
import { decodeLine } from "../src/protocol/framing";
import { animationYaml, connectSimulator, expect, pick, test, toastWith, upload } from "./fixtures";
import { watchBoard } from "./board";

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

test.describe("a development build older than the latest release", () => {
  // Pinned, so the test does not depend on the release tags of the clone: the build takes its version from git.
  test.use({ simulatorArgs: ["--firmware-version", "0.0.0-dev.3+gabc1234"] });

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

test("the Firmware view does not read the board status while an upload runs", async ({ page, simulator }) => {
  const watch = await watchBoard(page, simulator);
  const sent: string[] = [];
  page.on("websocket", (socket) =>
    socket.on("framesent", (frame) => {
      const request = decodeLine(new TextEncoder().encode(String(frame.payload)));
      if (typeof request?.cmd === "string") sent.push(request.cmd);
    }),
  );
  await connectSimulator(page, simulator);
  watch.hold("put_end");
  await pick(page, upload("first.yaml", animationYaml("First")), upload("second.yaml", animationYaml("Second")));
  await expect.poll(() => sent.includes("put_end")).toBe(true);
  const opened = sent.length;
  await page.getByRole("link", { name: "Firmware" }).click();
  await expect(page.getByText("Updates over WiFi", { exact: true })).toBeVisible();
  watch.release();
  await expect(toastWith(page, "Uploaded 2 animations")).toBeVisible();
  // The second file follows the first with no status request between them; the view reads it once the upload ends.
  const during = sent.slice(opened, sent.lastIndexOf("put_end"));
  expect(during).toContain("put_begin");
  expect(during).not.toContain("status");
  await expect.poll(() => sent.slice(opened).includes("status")).toBe(true);
});

const FIRMWARE_FILE = {
  board: "esp32c3",
  chip: "ESP32-C3",
  part: "app",
  offset: 65536,
  file: "firmware/esp32c3/app-0.1.0.bin",
  size: 1,
  sha256: "0".repeat(64),
};

/** Serves this manifest instead of the fixture's. */
async function serveManifest(page: Page, manifest: Record<string, unknown>): Promise<void> {
  await page.route("**/manifest.json", (route) =>
    route.fulfill({ json: { format: "pixelart-manifest/1", released: "2026-01-01", ...manifest } }),
  );
}

test("a manifest without firmware, from a content release alone, says no firmware is published", async ({ page }) => {
  await serveManifest(page, { version: "1.4.0", content_version: "1.4.0", animations: [], playlists: [] });
  await page.goto("/#firmware");
  await expect(page.getByTestId("firmware-empty")).toContainText("No firmware release is published yet");
  await expect(page.getByRole("button", { name: "Install from scratch" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete everything" })).toBeVisible();
});

test("a manifest with an empty firmware list says the same", async ({ page }) => {
  await serveManifest(page, { version: "1.0.0", firmware: [], animations: [], playlists: [] });
  await page.goto("/#firmware");
  await expect(page.getByTestId("firmware-empty")).toBeVisible();
});

test("the box to install the animations and playlists is checked each time the view opens", async ({ page }) => {
  await page.goto("/#firmware");
  // The release of the fixture site publishes a schedule too.
  const box = page.getByRole("checkbox", { name: "Then install the animations, playlists and schedules" });
  await expect(box).toBeChecked();
  await expect(page.getByText(/Keep the board connected until they are installed/)).toBeVisible();
  await box.uncheck();
  await expect(box).not.toBeChecked();
  await page.getByRole("link", { name: "Library", exact: true }).click();
  await page.getByRole("link", { name: "Firmware", exact: true }).click();
  await expect(box).toBeChecked();
});

test("the box is disabled and unchecked when nothing is published", async ({ page }) => {
  await serveManifest(page, { version: "0.1.0", firmware: [FIRMWARE_FILE], animations: [], playlists: [] });
  await page.goto("/#firmware");
  const box = page.getByRole("checkbox", { name: "Then install the animations and playlists" });
  await expect(box).toBeDisabled();
  await expect(box).not.toBeChecked();
});
