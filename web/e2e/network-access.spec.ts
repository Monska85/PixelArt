// SPDX-License-Identifier: GPL-3.0-or-later

import { createHmac } from "node:crypto";
import type { Page } from "@playwright/test";
import {
  connectSimulator,
  expect,
  openConnection,
  showFiles,
  test,
  toastWith,
  watchReplies,
  watchRequests,
} from "./fixtures";
import type { Simulator } from "./fixtures";

const TOKEN = "k3j9x0q7w2m5z8a1";
const WRONG_TOKEN = "a1z8m5w2q7x0j9k3";

/** The simulator as a board seen over WiFi: no token in `settings_get`, usb_only commands, the network login. */
test.use({ simulatorArgs: ["--ws-transport", "wifi", "--token", TOKEN] });

/** Opens the app, types the board's address and connects over WiFi. */
async function connectWifi(page: Page, simulator: Simulator): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Board address").fill(new URL(simulator.address).host);
  await page.getByRole("button", { name: "Connect over WiFi" }).click();
}

const tokenKey = (simulator: Simulator): string => `pixelart.token.${new URL(simulator.address).host}`;
const networkCard = (page: Page) => page.getByRole("region", { name: "Network access" });
const loginSwitch = (page: Page) => networkCard(page).getByRole("switch", { name: "Network login" });

async function logIn(page: Page, token: string): Promise<void> {
  const dialog = page.getByRole("dialog", { name: "Log in to the board" });
  await dialog.getByLabel("Token").fill(token);
  await dialog.getByRole("button", { name: "Log in" }).click();
  await expect(dialog).toHaveCount(0);
}

/** Turns the network login on in the first connection, which needs no login, and returns once the app has asked for it. */
async function turnLoginOn(page: Page): Promise<void> {
  await expect(page.getByTestId("connection-state")).toHaveText("Connected");
  await expect(loginSwitch(page)).not.toBeChecked();
  await loginSwitch(page).click();
}

test("the Board view connects over WiFi and leaves out what needs USB", async ({ page, simulator }) => {
  const requests = watchRequests(page, "settings_get");
  await connectWifi(page, simulator);
  await expect(page.getByTestId("connection-state")).toHaveText("Connected");
  await showFiles(page);
  await expect(page.getByRole("tab", { name: /^Animations/ })).toBeVisible();

  // The WiFi card shows the state without Set up WiFi and Forget network, which need USB.
  const wifi = page.getByRole("region", { name: "WiFi" });
  await expect(wifi.getByTestId("wifi-state")).toContainText("Connected");
  await expect(wifi.getByTestId("wifi-usb-note")).toContainText("need a USB connection");
  await expect(wifi.getByRole("button", { name: "Set up WiFi" })).toHaveCount(0);
  await expect(wifi.getByRole("button", { name: "Forget network" })).toHaveCount(0);

  // The board leaves the token out over WiFi, so the card cannot show it.
  await expect(loginSwitch(page)).not.toBeChecked();
  await expect(networkCard(page).getByTestId("network-login-note")).toContainText(
    "When this is off, anyone on your network can change this board's animations and settings.",
  );
  await expect(networkCard(page).getByTestId("token-usb-only")).toBeVisible();
  await expect(networkCard(page).getByRole("button", { name: "Regenerate" })).toHaveCount(0);
  expect(requests.length).toBeGreaterThan(0);
});

test("the reset box of Delete everything is off over WiFi, with a tooltip", async ({ page, simulator }) => {
  await connectWifi(page, simulator);
  await expect(page.getByTestId("connection-state")).toHaveText("Connected");
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Delete everything" }).click();
  const dialog = page.getByRole("dialog");
  const box = dialog.getByRole("checkbox", { name: "Also reset the settings" });
  await expect(box).toBeDisabled();
  await expect(dialog.getByTestId("delete-all-what")).toHaveText(
    "This cannot be undone. The firmware and the settings stay.",
  );
  await dialog.getByTestId("reset-needs-usb").focus();
  await expect(page.getByRole("tooltip").first()).toHaveText("Resetting the settings needs a USB connection.");
  await dialog.getByRole("button", { name: "Cancel" }).click();

  // The Firmware view's Reset card has the same box, off for the same reason.
  await page.getByRole("link", { name: "Firmware" }).click();
  const card = page.getByRole("region", { name: "Reset" });
  await expect(card.getByRole("checkbox", { name: "Also reset the settings" })).toBeDisabled();
  await expect(card).toContainText("the WiFi network is forgotten and a new token is made");
});

test("with network login on, the app asks for the token once and logs in with an HMAC only", async ({
  page,
  simulator,
}) => {
  const challenges = watchReplies(page, "auth_challenge");
  const logins = watchRequests(page, "auth");
  const frames: string[] = [];
  page.on("websocket", (socket) => socket.on("framesent", (frame) => frames.push(String(frame.payload))));
  await connectWifi(page, simulator);
  await turnLoginOn(page);

  // The board now asks this connection to log in, and the browser has no token for it.
  const dialog = page.getByRole("dialog", { name: "Log in to the board" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Token")).toHaveAttribute("type", "password");
  await expect(dialog.getByTestId("token-login-privacy")).toHaveText(
    "Kept in this browser to log in again. It is never sent: the board checks a code derived from it.",
  );
  await dialog.getByLabel("Token").fill("not a token");
  await expect(dialog.getByRole("button", { name: "Log in" })).toBeDisabled();
  await expect(dialog).toContainText("The token is 16 characters");
  await logIn(page, TOKEN);

  await expect(loginSwitch(page)).toBeChecked();
  await expect(networkCard(page).getByTestId("network-login-note")).toContainText("WiFi clients log in with the token");
  expect(challenges.replies).toHaveLength(1);
  const nonce = String(challenges.replies[0]?.nonce);
  expect(nonce).toMatch(/^[0-9a-f]{32}$/);
  // The answer is the HMAC-SHA256 of the nonce under the token, worked out here with Node's crypto.
  expect(logins.map((request) => request.hmac)).toEqual([createHmac("sha256", TOKEN).update(nonce).digest("hex")]);
  expect(frames.join("\n")).not.toContain(TOKEN);
  // The browser remembers the token for this board.
  expect(await page.evaluate((key) => localStorage.getItem(key), tokenKey(simulator))).toBe(TOKEN);

  // Connecting again needs no question: the stored token logs in.
  await openConnection(page);
  await page.getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByTestId("connection-state")).toHaveText("Not connected");
  await page.getByRole("button", { name: "Connect over WiFi" }).click();
  await expect(page.getByTestId("connection-state")).toHaveText("Connected");
  await expect(loginSwitch(page)).toBeChecked();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(logins).toHaveLength(2);
  expect(frames.join("\n")).not.toContain(TOKEN);
});

test("a token the board does not accept ends the connection and is forgotten", async ({ page, simulator }) => {
  await connectWifi(page, simulator);
  await turnLoginOn(page);
  await logIn(page, TOKEN);
  await expect(loginSwitch(page)).toBeChecked();
  await page.evaluate(
    ([key, token]) => localStorage.setItem(key as string, token as string),
    [tokenKey(simulator), WRONG_TOKEN],
  );
  await openConnection(page);
  await page.getByRole("button", { name: "Disconnect" }).click();
  await page.getByRole("button", { name: "Connect over WiFi" }).click();

  await expect(page.getByTestId("connection-message")).toContainText("The board did not accept the token");
  await expect(page.getByTestId("connection-state")).toHaveText("Not connected");
  expect(await page.evaluate((key) => localStorage.getItem(key), tokenKey(simulator))).toBeNull();
});

test("giving up the login ends the connection with the way to try again", async ({ page, simulator }) => {
  await connectWifi(page, simulator);
  await turnLoginOn(page);
  await logIn(page, TOKEN);
  await expect(loginSwitch(page)).toBeChecked();
  await page.evaluate((key) => localStorage.removeItem(key), tokenKey(simulator));
  await openConnection(page);
  await page.getByRole("button", { name: "Disconnect" }).click();
  await page.getByRole("button", { name: "Connect over WiFi" }).click();

  const dialog = page.getByRole("dialog", { name: "Log in to the board" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByTestId("connection-message")).toContainText("The board asks for a login");
  await expect(page.getByTestId("connection-state")).toHaveText("Not connected");
});

test("a board address that is not one is refused at once", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Board address").fill("user@pixelart.local/x");
  await page.getByRole("button", { name: "Connect over WiFi" }).click();
  await expect(page.getByTestId("connection-message")).toContainText("pixelart-XXXX.local");
  await expect(page.getByTestId("connection-state")).toHaveText("Not connected");
});

test("a board that is not there is reported with the browsers that can connect", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Board address").fill("127.0.0.1:9");
  await page.getByRole("button", { name: "Connect over WiFi" }).click();
  // Six tries, with 6.2 seconds of waits in all.
  await expect(page.getByTestId("connection-message")).toContainText("Cannot connect to 127.0.0.1:9", {
    timeout: 10_000,
  });
  await expect(page.getByTestId("connection-message")).toContainText("Firefox and Safari");
});

// The simulator over its default transport is the USB case: it sends the token.
test.describe("over USB", () => {
  test.use({ simulatorArgs: [] });

  test("the Network access card shows, copies and regenerates the token", async ({ page, simulator, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const replies = watchReplies(page, "token_regenerate");
    await connectSimulator(page, simulator);
    const card = networkCard(page);
    const value = card.getByTestId("token-value");
    await expect(value).toHaveText("•".repeat(16));
    await expect(card.getByTestId("token-privacy")).toHaveText(
      "Read from the board over USB. The app does not store it or send it anywhere: over WiFi the board checks a code derived from it.",
    );
    await card.getByRole("button", { name: "Show" }).click();
    await expect(value).toHaveText(/^[a-z0-9]{16}$/);
    const first = await value.innerText();
    await card.getByRole("button", { name: "Copy" }).click();
    await expect(toastWith(page, "The token is copied")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(first);
    await card.getByRole("button", { name: "Hide" }).click();
    await expect(value).toHaveText("•".repeat(16));

    await card.getByRole("button", { name: "Regenerate" }).click();
    const dialog = page.getByRole("dialog", { name: "Make a new token?" });
    await expect(dialog).toContainText("WiFi clients have to log in again");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    expect(replies.count()).toBe(0);
    await card.getByRole("button", { name: "Regenerate" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Make a new token" }).click();
    await expect(toastWith(page, "A new token is made")).toBeVisible();
    await card.getByRole("button", { name: "Show" }).click();
    await expect(value).toHaveText(/^[a-z0-9]{16}$/);
    expect(await value.innerText()).not.toBe(first);
    expect(replies.replies[0]).toMatchObject({ ok: true, token: await value.innerText() });
  });

  test("the network login switch changes the setting", async ({ page, simulator }) => {
    const replies = watchReplies(page, "settings_set");
    await connectSimulator(page, simulator);
    await expect(loginSwitch(page)).not.toBeChecked();
    await loginSwitch(page).click();
    await expect(loginSwitch(page)).toBeChecked();
    expect(replies.replies.at(-1)).toMatchObject({ ok: true, settings: { network_login: true } });
    await loginSwitch(page).click();
    await expect(loginSwitch(page)).not.toBeChecked();
  });
});
