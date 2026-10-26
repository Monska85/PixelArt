// SPDX-License-Identifier: GPL-3.0-or-later

import type { Page } from "@playwright/test";
import { connectScripted, scriptedBoard } from "./scripted";
import { connectSimulator, expect, test, toastWith } from "./fixtures";
import { watchReplies } from "./fixtures";

test("the WiFi card shows what the simulator reports and sets the transmit power", async ({ page, simulator }) => {
  const statusReplies = watchReplies(page, "status");
  const settingsReplies = watchReplies(page, "settings_set");
  await connectSimulator(page, simulator);
  const card = page.getByRole("region", { name: "WiFi" });
  const state = card.getByTestId("wifi-state");
  await expect(state).toContainText("Connected");
  // Over the WebSocket, which is also how a board on WiFi is reached.
  await expect(card.getByTestId("wifi-network")).toHaveText("PixelArt Simulator");
  await expect(state).toContainText("127.0.0.1");
  await expect(state).toContainText("pixelart-sim.local");
  await expect(state).toContainText("-50 dBm, excellent");

  const power = card.getByLabel("Transmit power");
  await expect(power).toHaveValue("auto");
  await expect(card.getByTestId("power-legend")).toContainText("Auto is recommended");
  await expect(card.getByTestId("power-legend")).toContainText("below -75 dBm weak");
  await power.selectOption("8.5");
  await expect(power).toHaveValue("8.5");
  expect(settingsReplies.replies.at(-1)).toMatchObject({ ok: true, settings: { wifi_power: "8.5" } });
  // The card reads the state again after the change: the simulator reports the power in use.
  await expect.poll(() => statusReplies.replies.at(-1)).toMatchObject({ wifi: { power: "8.5" } });
});

test("Set up WiFi and Forget network need a USB connection and say so", async ({ page, simulator }) => {
  await connectSimulator(page, simulator);
  const card = page.getByRole("region", { name: "WiFi" });
  await expect(card.getByRole("button", { name: "Set up WiFi" })).toBeDisabled();
  await expect(card.getByRole("button", { name: "Forget network" })).toBeDisabled();
  await expect(card.getByRole("group", { name: "Setting up WiFi needs a USB connection." })).toHaveCount(2);
});

test("a board without the status command has no WiFi card", async ({ page }) => {
  const board = await scriptedBoard(page);
  await connectScripted(page, board);
  await expect(page.getByTestId("connection-state")).toHaveText("Connected");
  await expect(page.getByRole("region", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("region", { name: "WiFi" })).toHaveCount(0);
  expect(board.requests.map((r) => r.cmd)).toContain("status");
});

/**
 * A Web Serial port in the page that speaks the command protocol and Improv Wi-Fi, as a board does: it answers the
 * requests the app makes after connecting, scans two networks, and accepts one network and password. Everything it
 * receives is kept in window.__serial for the test. A `busy` board is on WiFi at reduced power and installing a
 * firmware.
 */
function installFakeSerial(busy = false): void {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (bytes: Uint8Array): string => {
    let c = 0xffffffff;
    for (const b of bytes) c = (table[(c ^ b) & 0xff] as number) ^ (c >>> 8);
    return ((c ^ 0xffffffff) >>> 0).toString(16).padStart(8, "0");
  };
  const log = { frames: [] as number[][], requests: [] as string[], credentials: [] as Array<[string, string]> };
  (window as unknown as { __serial: typeof log }).__serial = log;
  let wifi = {
    state: "not_configured",
    ip: null as string | null,
    rssi: null as number | null,
    ssid: null as string | null,
  };
  let power = "auto";
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let pending: number[] = [];

  const out = (bytes: Uint8Array): void => controller?.enqueue(bytes);
  const line = (body: object): void => {
    const json = encoder.encode(JSON.stringify(body));
    out(encoder.encode(`@PR ${crc32(json)} ${decoder.decode(json)}\n`));
  };
  const packet = (type: number, data: number[]): void => {
    const head = [...encoder.encode("IMPROV"), 1, type, data.length, ...data];
    out(Uint8Array.from([...head, head.reduce((a, b) => a + b, 0) & 0xff]));
  };
  const strings = (...texts: string[]): number[] => texts.flatMap((t) => [t.length, ...encoder.encode(t)]);
  const result = (command: number, ...texts: string[]): void => {
    const body = strings(...texts);
    packet(4, [command, body.length, ...body]);
  };
  const settings = () => ({
    brightness: 100,
    playlist: "default",
    wifi_power: power,
    update_mode: "notify",
    token: "abcdefghijklmnop",
  });

  const request = (r: Record<string, unknown>): void => {
    log.requests.push(String(r.cmd));
    const seq = r.seq;
    switch (r.cmd) {
      case "info":
        return line({
          seq,
          ok: true,
          protocol: 1,
          firmware: "1.2.0",
          board: "esp32c3",
          boot_id: 7,
          formats: { animation: ["pixelart/1"], playlist: ["pixelart-playlist/1"] },
          canvas: { width: 16, height: 16 },
          storage: { total: 983040, used: 0 },
          memory: { free: 100000, largest: 60000 },
          limits: { line: 1024, chunk: 512, page: 8, animation: 65536, playlist: 16384 },
        });
      case "list":
        return line({ seq, ok: true, kind: r.kind, entries: [], more: false });
      case "settings_get":
        return line({ seq, ok: true, settings: settings() });
      case "settings_set":
        if (typeof r.wifi_power === "string") power = r.wifi_power;
        return line({ seq, ok: true, settings: settings() });
      case "status":
        if (busy)
          return line({
            seq,
            ok: true,
            wifi: {
              state: "connected",
              ip: "192.168.1.42",
              rssi: -80,
              power: "8.5",
              power_reduced: true,
              ssid: "<img src=x onerror=alert(1)> & <b>bold</b>",
            },
            time: { known: false },
            update: { state: "installing", progress: 40, firmware: "1.3.0", files: 0 },
          });
        return line({
          seq,
          ok: true,
          wifi: { ...wifi, power: power === "auto" ? "19.5" : power, power_reduced: false, hostname: "pixelart-118c" },
          time: { known: false },
          update: { state: "idle" },
        });
      case "wifi_forget":
        wifi = { state: "not_configured", ip: null, rssi: null, ssid: null };
        return line({ seq, ok: true });
      default:
        return line({ seq, ok: false, error: "unknown_command", message: "not scripted" });
    }
  };

  const improv = (type: number, data: Uint8Array): void => {
    log.frames.push([type, ...data]);
    packet(2, [0]); // every request clears the error
    if (data[0] === 4) {
      result(4, "HomeNet", "-55", "YES");
      result(4, "Cafe", "-70", "NO");
      result(4);
    } else if (data[0] === 1) {
      const ssidLength = data[2] as number;
      const ssid = decoder.decode(data.subarray(3, 3 + ssidLength));
      const passwordLength = data[3 + ssidLength] as number;
      const password = decoder.decode(data.subarray(4 + ssidLength, 4 + ssidLength + passwordLength));
      log.credentials.push([ssid, password]);
      packet(1, [3]);
      setTimeout(() => {
        if (ssid === "HomeNet" && password === "hunter2") {
          wifi = { state: "connected", ip: "192.168.1.42", rssi: -58, ssid };
          packet(1, [4]);
          result(1);
        } else {
          packet(2, [3]);
          packet(1, [2]);
        }
      }, 300);
    }
  };

  const drain = (): void => {
    for (;;) {
      if (pending.length === 0) return;
      if (decoder.decode(Uint8Array.from(pending.slice(0, 6))) === "IMPROV") {
        if (pending.length < 9) return;
        const total = 10 + (pending[8] as number);
        if (pending.length < total) return;
        const frame = pending.splice(0, total);
        improv(frame[7] as number, Uint8Array.from(frame.slice(9, total - 1)));
      } else {
        const end = pending.indexOf(0x0a);
        if (end < 0) return;
        const text = decoder.decode(Uint8Array.from(pending.splice(0, end + 1))).trim();
        request(JSON.parse(text.slice(text.indexOf("{"))));
      }
    }
  };

  const port = {
    readable: null as ReadableStream<Uint8Array> | null,
    writable: null as WritableStream<Uint8Array> | null,
    async open() {
      port.readable = new ReadableStream({ start: (c) => void (controller = c) });
      port.writable = new WritableStream({
        write(chunk) {
          pending.push(...chunk);
          drain();
        },
      });
    },
    async close() {
      port.readable = port.writable = null;
      pending = [];
    },
    async setSignals() {},
  };
  Object.defineProperty(navigator, "serial", { value: { requestPort: async () => port }, configurable: true });
}

const serialLog = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __serial: { frames: number[][]; requests: string[]; credentials: string[][] } }).__serial,
  );

async function connectFakeBoard(page: Page, busy = false): Promise<void> {
  await page.addInitScript(installFakeSerial, busy);
  await page.goto("/");
  await page.getByRole("button", { name: "Connect board" }).first().click();
  await expect(page.getByTestId("connection-state")).toHaveText("Connected");
}

test("sets up WiFi with Improv on the serial port the app already uses", async ({ page }) => {
  await connectFakeBoard(page);
  const card = page.getByRole("region", { name: "WiFi" });
  await expect(card.getByTestId("wifi-state")).toContainText("No network set up");
  await expect(card.getByTestId("wifi-network")).toHaveText("none");
  await expect(card.getByRole("button", { name: "Forget network" })).toBeDisabled();

  await card.getByRole("button", { name: "Set up WiFi" }).click();
  const dialog = page.getByRole("dialog", { name: "Set up WiFi" });
  // The scan lists the networks the board sees, strongest first, with their signal and whether they need a password.
  const networks = dialog.getByLabel("Network", { exact: true });
  await expect(networks.locator("option")).toHaveText([
    "HomeNet (good, password)",
    "Cafe (fair, open)",
    "Other network...",
  ]);
  const password = dialog.getByLabel("Password");
  await expect(password).toHaveAttribute("type", "password");
  await expect(dialog).toContainText(
    "The password goes straight to the board over USB. It is never sent anywhere else.",
  );
  await expect(password).toBeEnabled();

  // An open network has no password to type.
  await networks.selectOption("Cafe");
  await expect(password).toBeDisabled();
  await networks.selectOption("HomeNet");
  await password.fill("hunter2");
  await dialog.getByRole("button", { name: "Connect" }).click();
  await expect(dialog.getByText("Connecting. This can take up to 30 seconds.")).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await expect(toastWith(page, "The board joined the WiFi network")).toBeVisible();
  await expect(card.getByTestId("wifi-state")).toContainText("192.168.1.42");
  await expect(card.getByTestId("wifi-state")).toContainText("-58 dBm, good");
  // Over USB the card names the network the board stored.
  await expect(card.getByTestId("wifi-network")).toHaveText("HomeNet");

  const log = await serialLog(page);
  expect(log.credentials).toEqual([["HomeNet", "hunter2"]]);
  // The name and the password are nowhere in the page afterwards.
  await expect(page.locator("body")).not.toContainText("hunter2");

  // The transmit power menu sends the setting and shows the board's answer.
  const power = card.getByLabel("Transmit power");
  await expect(power).toHaveValue("auto");
  await power.selectOption("11");
  await expect(power).toHaveValue("11");

  // Forget network asks first, then sends wifi_forget.
  await card.getByRole("button", { name: "Forget network" }).click();
  const confirm = page.getByRole("dialog", { name: "Forget the WiFi network?" });
  await confirm.getByRole("button", { name: "Cancel" }).click();
  expect((await serialLog(page)).requests).not.toContain("wifi_forget");
  await card.getByRole("button", { name: "Forget network" }).click();
  await confirm.getByRole("button", { name: "Forget" }).click();
  await expect(card.getByTestId("wifi-state")).toContainText("No network set up");
  await expect(card.getByTestId("wifi-network")).toHaveText("none");
  expect((await serialLog(page)).requests).toContain("wifi_forget");
});

test("a network that does not connect says so, keeps the dialog open and empties the password", async ({ page }) => {
  await connectFakeBoard(page);
  await page.getByRole("region", { name: "WiFi" }).getByRole("button", { name: "Set up WiFi" }).click();
  const dialog = page.getByRole("dialog", { name: "Set up WiFi" });
  await dialog.getByLabel("Network", { exact: true }).selectOption("HomeNet");
  await dialog.getByLabel("Password").fill("wrong password");
  await dialog.getByRole("button", { name: "Connect" }).click();
  await expect(dialog).toContainText("The board could not connect");
  await expect(dialog).not.toContainText("wrong password");
  await expect(dialog.getByLabel("Password")).toHaveValue("");
  await expect(dialog.getByRole("button", { name: "Connect" })).toBeEnabled();
  // A name that is not in the list can be typed.
  await dialog.getByLabel("Network", { exact: true }).selectOption("Other network...");
  await dialog.getByLabel("Network name").fill("Hidden");
  await expect(dialog.getByLabel("Network name")).toHaveValue("Hidden");
});

test("the Updates card says why a board that is not on WiFi cannot check", async ({ page }) => {
  await connectFakeBoard(page);
  const card = page.getByRole("region", { name: "Updates" });
  await expect(card.getByRole("button", { name: "Check now" })).toBeDisabled();
  await expect(card.getByRole("group", { name: "The board is not connected to WiFi." })).toBeVisible();
});

test("a board installing a firmware at reduced power: the cards say so, and the setup dialog stops the status reads", async ({
  page,
}) => {
  await connectFakeBoard(page, true);
  await expect(page.getByRole("region", { name: "WiFi" }).getByTestId("power-reduced")).toBeVisible();
  // A network name is text, whatever it holds.
  const network = page.getByRole("region", { name: "WiFi" }).getByTestId("wifi-network");
  await expect(network).toHaveText("<img src=x onerror=alert(1)> & <b>bold</b>");
  await expect(network.locator("*")).toHaveCount(0);
  const updates = page.getByRole("region", { name: "Updates" });
  await expect(updates.getByTestId("firmware-installing")).toBeVisible();
  await expect(updates.getByRole("progressbar", { name: "Update progress" })).toHaveAttribute("aria-valuenow", "40");
  await expect(updates.getByRole("group", { name: "A check or an installation is running." })).toHaveCount(3);

  const statuses = async () => (await serialLog(page)).requests.filter((cmd) => cmd === "status").length;
  await page.getByRole("region", { name: "WiFi" }).getByRole("button", { name: "Set up WiFi" }).click();
  const dialog = page.getByRole("dialog", { name: "Set up WiFi" });
  await expect(dialog).toBeVisible();
  const before = await statuses();
  // While something runs the card reads the status every 2 seconds; the dialog shares the port with Improv.
  await page.waitForTimeout(3000);
  expect(await statuses()).toBe(before);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect.poll(statuses).toBeGreaterThan(before);
});
