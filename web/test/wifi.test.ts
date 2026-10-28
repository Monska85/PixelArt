// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { BoardClient, getSettings, getStatus, parseStatus, setSettings } from "../src/protocol";
import { POWER_OPTIONS, describeSignal, signalQuality, WIFI_STATE_TEXT } from "../src/ui/board/wifi";
import { FakeBoard } from "./fakeBoard";

async function connected(board: FakeBoard): Promise<BoardClient> {
  const client = new BoardClient(board);
  await client.handshake();
  return client;
}

describe("status", () => {
  it("reads the WiFi state and whether the time is known", () => {
    expect(
      parseStatus({
        seq: 1,
        ok: true,
        wifi: {
          state: "connected",
          ip: "192.168.1.42",
          rssi: -58,
          power: "19.5",
          power_reduced: false,
          hostname: "pixelart-118c",
          ssid: "Example Home WiFi",
        },
        time: { known: true },
        update: { state: "idle" },
      }),
    ).toEqual({
      wifi: {
        state: "connected",
        ip: "192.168.1.42",
        rssi: -58,
        power: "19.5",
        powerReduced: false,
        hostname: "pixelart-118c",
        ssid: "Example Home WiFi",
      },
      timeKnown: true,
      play: null,
      update: {
        state: "idle",
        progress: 0,
        lastCheck: null,
        lastResult: null,
        lastDetail: null,
        failedFiles: 0,
        firmware: null,
        files: 0,
        lastInstall: null,
      },
    });
  });

  it("reads null for what the board does not have", () => {
    expect(
      parseStatus({ wifi: { state: "not_configured", ip: null, rssi: null, power: "8.5", power_reduced: true } }),
    ).toEqual({
      wifi: {
        state: "not_configured",
        ip: null,
        rssi: null,
        power: "8.5",
        powerReduced: true,
        hostname: null,
        ssid: null,
      },
      timeKnown: false,
      play: null,
      update: expect.objectContaining({ state: "idle", files: 0 }),
    });
  });

  it("keeps a network name as text, and reads a name of the wrong type or a missing one as none", () => {
    for (const ssid of ["Café Ü 2.4G", "<img src=x onerror=alert(1)>", "\ufffd\ufffd", "a\u202eb"])
      expect(parseStatus({ wifi: { state: "connected", ssid } }).wifi.ssid, ssid).toBe(ssid);
    expect(parseStatus({ wifi: { state: "not_configured", ssid: null } }).wifi.ssid).toBeNull();
    expect(parseStatus({ wifi: { state: "connected", ssid: 5 } }).wifi.ssid).toBeNull();
    expect(parseStatus({ wifi: { state: "connected" } }).wifi.ssid).toBeNull();
  });

  it("reads the detail of the last update result", () => {
    expect(parseStatus({ update: { last_result: "http_error", last_detail: "no_release" } }).update).toMatchObject({
      lastResult: "http_error",
      lastDetail: "no_release",
    });
    expect(parseStatus({ update: { last_result: "http_error", last_detail: null } }).update.lastDetail).toBeNull();
    expect(parseStatus({ update: { last_detail: 3 } }).update.lastDetail).toBeNull();
    expect(parseStatus({ update: {} }).update.lastDetail).toBeNull();
  });

  it("reads a state it does not know, or a reply of the wrong shape, as disconnected and unknown", () => {
    expect(parseStatus({ wifi: { state: "roaming", rssi: "strong", ip: 5 } }).wifi).toMatchObject({
      state: "disconnected",
      rssi: null,
      ip: null,
    });
    expect(parseStatus({ wifi: 3, time: "yes" })).toMatchObject({ wifi: { state: "disconnected" }, timeKnown: false });
  });

  it("has a sentence for every state", () => {
    for (const state of Object.keys(WIFI_STATE_TEXT))
      expect(WIFI_STATE_TEXT[state as keyof typeof WIFI_STATE_TEXT]).toBeTruthy();
    expect(WIFI_STATE_TEXT.no_address).toContain("may block new devices");
  });

  it("is read with the status command, and a board without it answers unknown_command", async () => {
    const board = new FakeBoard();
    const client = await connected(board);
    board.override = (r) => (r.cmd === "status" ? { ok: true, wifi: { state: "connecting" } } : undefined);
    expect((await getStatus(client)).wifi.state).toBe("connecting");
    board.override = () => undefined;
    await expect(getStatus(client)).rejects.toMatchObject({ code: "unknown_command" });
  });
});

describe("the settings of WiFi and updates", () => {
  const reply = {
    brightness: 40,
    playlist: "p",
    wifi_power: "13",
    update_mode: "automatic",
    update_firmware: false,
    update_animations: true,
    check_hours: 12,
    install_start: 60,
    install_end: 120,
    timezone: "CET-1",
    animation_source: "http://localhost/m.json",
    network_login: true,
    token: "abcdefghijklmnop",
  };

  it("keeps every setting the board sends with its type", async () => {
    const board = new FakeBoard();
    const client = await connected(board);
    board.override = (r) => (r.cmd === "settings_get" ? { ok: true, settings: reply } : undefined);
    expect(await getSettings(client)).toEqual(reply);
  });

  it("leaves out what has the wrong type, so an older or newer firmware does not break the views", async () => {
    const board = new FakeBoard();
    const client = await connected(board);
    board.override = (r) =>
      r.cmd === "settings_get"
        ? {
            ok: true,
            settings: { brightness: 1, playlist: "x", wifi_power: 8.5, check_hours: "6", network_login: 1, extra: 1 },
          }
        : undefined;
    expect(await getSettings(client)).toEqual({ brightness: 1, playlist: "x" });
  });

  it("sends only the changes", async () => {
    const board = new FakeBoard();
    const client = await connected(board);
    await setSettings(client, { wifi_power: "8.5" });
    expect(board.requests.at(-1)).toMatchObject({ cmd: "settings_set", wifi_power: "8.5" });
    expect(Object.keys(board.requests.at(-1) as object).sort()).toEqual(["cmd", "seq", "wifi_power"]);
  });
});

describe("the WiFi card's words", () => {
  it("names the signal as the legend does", () => {
    for (const [rssi, word] of [
      [-30, "excellent"],
      [-50, "excellent"],
      [-51, "good"],
      [-67, "good"],
      [-68, "fair"],
      [-75, "fair"],
      [-76, "weak"],
    ] as const)
      expect(signalQuality(rssi), String(rssi)).toBe(word);
    expect(describeSignal(-58)).toBe("-58 dBm, good");
  });

  it("offers Auto and the seven fixed powers, as the board accepts them", () => {
    expect(POWER_OPTIONS.map((o) => o.value)).toEqual(["auto", "8.5", "11", "13", "15", "17", "18.5", "19.5"]);
    expect(POWER_OPTIONS[0]?.label).toContain("recommended");
  });
});
