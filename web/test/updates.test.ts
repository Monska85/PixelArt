// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { BoardClient, checkForUpdates, installUpdate, isUpdateRunning, parseStatus } from "../src/protocol";
import { browserTimeZone, knownTimeZones, posixTimeZone } from "../src/ui/board/timezones";
import {
  DEFAULT_ANIMATION_SOURCE,
  PROJECT_ANIMATION_SOURCE,
  defaultAnimationSource,
  UPDATE_MODES,
  ageText,
  animationSourceProblem,
  describeFirmware,
  describeInstall,
  describeResult,
  describeState,
  describeWindow,
  disabledReason,
  firmwareConfirmation,
  firmwareSkipped,
  lastCheckText,
  minutesToTime,
  parseCheckHours,
  timeToMinutes,
} from "../src/ui/board/updates";
import { IDLE_POLL_MS, RUNNING_POLL_MS, pollIntervalMs } from "../src/ui/board/useBoardStatus";
import { FakeBoard } from "./fakeBoard";

const update = (fields: Record<string, unknown>) => parseStatus({ update: fields }).update;

describe("the update state of status", () => {
  it("reads every field", () => {
    expect(
      update({
        state: "downloading",
        progress: 42,
        last_check: 720,
        last_result: "ok",
        last_detail: null,
        failed_files: 2,
        firmware: "1.3.0",
        files: 3,
        last_install: { result: "updated", from: "1.2.0", to: "1.3.0" },
      }),
    ).toEqual({
      state: "downloading",
      progress: 42,
      lastCheck: 720,
      lastResult: "ok",
      lastDetail: null,
      failedFiles: 2,
      firmware: "1.3.0",
      files: 3,
      lastInstall: { result: "updated", from: "1.2.0", to: "1.3.0" },
    });
  });

  it("reads the idle values of a board that never checked", () => {
    expect(
      update({
        state: "idle",
        progress: 0,
        last_check: null,
        last_result: null,
        failed_files: 0,
        firmware: null,
        files: 0,
        last_install: null,
      }),
    ).toEqual({
      state: "idle",
      progress: 0,
      lastCheck: null,
      lastResult: null,
      lastDetail: null,
      failedFiles: 0,
      firmware: null,
      files: 0,
      lastInstall: null,
    });
  });

  it("reads what has the wrong type as not there, and a state it does not know as idle", () => {
    expect(
      update({
        state: "rebooting",
        progress: 900,
        last_check: -4,
        last_result: 5,
        last_detail: 5,
        failed_files: "2",
        firmware: 1,
        files: 1.5,
        last_install: { result: "updated", from: "1.2.0" },
      }),
    ).toEqual({
      state: "idle",
      progress: 100,
      lastCheck: null,
      lastResult: null,
      lastDetail: null,
      failedFiles: 0,
      firmware: null,
      files: 0,
      lastInstall: null,
    });
    expect(parseStatus({ update: 7 }).update.state).toBe("idle");
    expect(parseStatus({}).update.state).toBe("idle");
  });

  it("calls a check, a download and an installation running", () => {
    for (const state of ["checking", "downloading", "installing"])
      expect(isUpdateRunning(update({ state })), state).toBe(true);
    for (const state of ["idle", "waiting_for_time"]) expect(isUpdateRunning(update({ state })), state).toBe(false);
  });
});

describe("update_check and update_install", () => {
  it("send their commands", async () => {
    const board = new FakeBoard();
    const client = new BoardClient(board);
    await client.handshake();
    board.override = (r) => (r.cmd === "update_check" || r.cmd === "update_install" ? { ok: true } : undefined);
    await checkForUpdates(client);
    await installUpdate(client, "animations");
    await installUpdate(client, "firmware");
    await installUpdate(client, "firmware", true);
    await installUpdate(client, "animations", true);
    const sent = board.requests
      .slice(1)
      .map((r) => Object.fromEntries(Object.entries(r).filter(([key]) => key !== "seq")));
    expect(sent).toEqual([
      { cmd: "update_check" },
      { cmd: "update_install", target: "animations" },
      { cmd: "update_install", target: "firmware" },
      { cmd: "update_install", target: "firmware", force: true },
      { cmd: "update_install", target: "animations" },
    ]);
  });

  it("report the errors of the board", async () => {
    const board = new FakeBoard();
    const client = new BoardClient(board);
    await client.handshake();
    board.override = (r) => ({ ok: false, error: r.cmd === "update_check" ? "updates_off" : "busy", message: "no" });
    await expect(checkForUpdates(client)).rejects.toMatchObject({ code: "updates_off" });
    await expect(installUpdate(client, "animations")).rejects.toMatchObject({ code: "busy" });
  });
});

describe("how often the card reads the status", () => {
  it("reads every 2 seconds while something runs and every 30 seconds otherwise", () => {
    expect(RUNNING_POLL_MS).toBe(2000);
    expect(IDLE_POLL_MS).toBe(10000);
    expect(pollIntervalMs(true)).toBe(2000);
    expect(pollIntervalMs(false)).toBe(10000);
  });
});

describe("the time zone table", () => {
  it("gives the POSIX string of the zones people live in", () => {
    expect(posixTimeZone("Europe/Rome")).toBe("CET-1CEST,M3.5.0,M10.5.0/3");
    expect(posixTimeZone("Europe/London")).toBe("GMT0BST,M3.5.0/1,M10.5.0");
    expect(posixTimeZone("America/New_York")).toBe("EST5EDT,M3.2.0,M11.1.0");
    expect(posixTimeZone("America/Phoenix")).toBe("MST7");
    expect(posixTimeZone("Asia/Kolkata")).toBe("IST-5:30");
    expect(posixTimeZone("Asia/Tokyo")).toBe("JST-9");
    expect(posixTimeZone("Australia/Sydney")).toBe("AEST-10AEDT,M10.1.0,M4.1.0/3");
    expect(posixTimeZone("UTC")).toBe("UTC0");
  });

  it("does not know a zone it does not carry, and ignores names that are not zones", () => {
    expect(posixTimeZone("Mars/Olympus_Mons")).toBeNull();
    expect(posixTimeZone("")).toBeNull();
    expect(posixTimeZone("constructor")).toBeNull();
    expect(posixTimeZone("__proto__")).toBeNull();
  });

  it("holds only strings the board accepts: 1 to 64 printable ASCII characters", () => {
    const names = knownTimeZones();
    expect(names.length).toBeGreaterThan(80);
    for (const name of names) {
      const posix = posixTimeZone(name) as string;
      expect(posix, name).toMatch(/^[\x20-\x7e]{1,64}$/);
      // A name, an offset, then optionally a summer name with its dates.
      expect(posix, name).toMatch(
        /^(<[+-]?[0-9A-Za-z]+>|[A-Za-z]{3,})-?[0-9]{1,2}(:[0-9]{2})?(([A-Za-z]{3,}|<[+-]?[0-9A-Za-z]+>),.+)?$/,
      );
    }
  });

  it("has the same rule for every central European zone", () => {
    for (const zone of ["Europe/Berlin", "Europe/Paris", "Europe/Madrid", "Europe/Rome", "Europe/Vienna"])
      expect(posixTimeZone(zone), zone).toBe("CET-1CEST,M3.5.0,M10.5.0/3");
  });

  it("reads the browser's zone", () => {
    const zone = browserTimeZone();
    expect(zone === null || typeof zone === "string").toBe(true);
  });
});

describe("the Updates card's words", () => {
  it("has a line for each mode, in the order of the menu", () => {
    expect(UPDATE_MODES.map((m) => m.value)).toEqual(["off", "notify", "automatic"]);
    expect(UPDATE_MODES.every((m) => m.text.length > 0)).toBe(true);
  });

  it("takes check hours from 1 to 168 as whole numbers", () => {
    expect(parseCheckHours("1")).toBe(1);
    expect(parseCheckHours(" 168 ")).toBe(168);
    expect(parseCheckHours("06")).toBe(6);
    for (const bad of ["0", "169", "", "x", "1.5", "-1", "1e1", "1000", "+3"])
      expect(parseCheckHours(bad), bad).toBeNull();
  });

  it("takes the manifest next to the page as the default animation source", () => {
    const page = (href: string) => {
      const url = new URL(href);
      return { href, protocol: url.protocol, hostname: url.hostname };
    };
    expect(defaultAnimationSource(page("https://example-owner.github.io/Fork/"))).toBe(
      "https://example-owner.github.io/Fork/manifest.json",
    );
    expect(defaultAnimationSource(page("https://example-owner.github.io/Fork/index.html?x=1#board"))).toBe(
      "https://example-owner.github.io/Fork/manifest.json",
    );
    expect(defaultAnimationSource(page("https://example-owner.github.io/"))).toBe(
      "https://example-owner.github.io/manifest.json",
    );
    expect(defaultAnimationSource(page("https://art.example.org:8443/pixel/"))).toBe(
      "https://art.example.org:8443/pixel/manifest.json",
    );
    expect(defaultAnimationSource(page("https://monska85.github.io/PixelArt/"))).toBe(PROJECT_ANIMATION_SOURCE);
    // Local development, files, plain http and no page at all use the project's address.
    for (const local of [
      "http://localhost:5173/",
      "https://localhost:5173/",
      "http://127.0.0.1:4173/",
      "http://example.org/app/",
      "file:///home/user/PixelArt/index.html",
    ])
      expect(defaultAnimationSource(page(local)), local).toBe(PROJECT_ANIMATION_SOURCE);
    expect(defaultAnimationSource(undefined)).toBe(PROJECT_ANIMATION_SOURCE);
    // A page address the board would refuse (too long) falls back too.
    expect(defaultAnimationSource(page(`https://example.org/${"a".repeat(600)}/`))).toBe(PROJECT_ANIMATION_SOURCE);
    // Under test there is no page.
    expect(DEFAULT_ANIMATION_SOURCE).toBe(PROJECT_ANIMATION_SOURCE);
  });

  it("takes an animation source the way the board does", () => {
    expect(animationSourceProblem(DEFAULT_ANIMATION_SOURCE)).toBeNull();
    expect(animationSourceProblem("http://localhost:8000/manifest.json")).toBeNull();
    expect(animationSourceProblem("https://user@host.example/m.json")).toContain("no user name");
    expect(animationSourceProblem("https://user:pass@host.example/m.json")).toContain("no user name");
    expect(animationSourceProblem("https://host.example")).toBeNull();
    expect(animationSourceProblem(`https://host.example/${"a".repeat(491)}`)).toBeNull(); // 512 characters
    expect(animationSourceProblem(`https://host.example/${"a".repeat(492)}`)).toContain("512");
    for (const bad of [
      "",
      "host.example/m.json",
      "ftp://host/m.json",
      "https://",
      "https:///m.json",
      "https://@/m.json",
      "https://:8000/m.json",
      "https://.example/m.json",
      "https://-host/m.json",
      "http://:80",
    ])
      expect(animationSourceProblem(bad), bad).not.toBeNull();
    expect(animationSourceProblem("http://[::1]:8000/m.json")).toBeNull();
    expect(animationSourceProblem("http://192.168.1.5:8000/m.json")).toBeNull();
    expect(animationSourceProblem("https://host.example/a b")).toContain("ASCII");
    expect(animationSourceProblem("https://host.example/é")).toContain("ASCII");
  });

  it("writes minutes as times and back", () => {
    expect(minutesToTime(0)).toBe("00:00");
    expect(minutesToTime(61)).toBe("01:01");
    expect(minutesToTime(1439)).toBe("23:59");
    expect(timeToMinutes("00:00")).toBe(0);
    expect(timeToMinutes("22:30")).toBe(1350);
    expect(timeToMinutes("23:59")).toBe(1439);
    for (const bad of ["", "24:00", "12:60", "1:00", "12:5", "ab:cd", "12:00:00"])
      expect(timeToMinutes(bad), bad).toBeNull();
    for (let m = 0; m < 1440; m += 17) expect(timeToMinutes(minutesToTime(m))).toBe(m);
  });

  it("describes the window", () => {
    expect(describeWindow(0, 0)).toBe("whole day");
    expect(describeWindow(300, 300)).toBe("whole day");
    expect(describeWindow(480, 1020)).toBe("08:00 to 17:00");
    expect(describeWindow(1320, 360)).toBe("22:00 to 06:00 (over midnight)");
  });

  it("gives ages in the largest whole unit", () => {
    expect(ageText(0)).toBe("0 seconds");
    expect(ageText(1)).toBe("1 second");
    expect(ageText(59)).toBe("59 seconds");
    expect(ageText(60)).toBe("1 minute");
    expect(ageText(720)).toBe("12 minutes");
    expect(ageText(3599)).toBe("59 minutes");
    expect(ageText(3600)).toBe("1 hour");
    expect(ageText(86399)).toBe("23 hours");
    expect(ageText(86400)).toBe("1 day");
    expect(ageText(200000)).toBe("2 days");
    expect(lastCheckText(update({ last_check: 720 }))).toBe("12 minutes ago");
    expect(lastCheckText(update({ last_check: null }))).toBe("not since the board started");
  });

  it("says what the board is doing", () => {
    expect(describeState(update({ state: "idle" }))).toBe("Idle");
    expect(describeState(update({ state: "checking" }))).toBe("Checking for updates");
    expect(describeState(update({ state: "downloading", progress: 40 }))).toBe("Downloading, 40 %");
    expect(describeState(update({ state: "installing", progress: 99 }))).toBe("Installing, 99 %");
    expect(describeState(update({ state: "waiting_for_time" }))).toContain("install window");
  });

  it("has words for every update error and shows an unknown code as it is", () => {
    for (const code of [
      "network_error",
      "tls_error",
      "http_error",
      "bad_manifest",
      "checksum_mismatch",
      "invalid_file",
      "no_space",
      "out_of_memory",
      "storage_error",
      "flash_error",
    ])
      expect(describeResult(code), code).toMatch(new RegExp(`\\(${code}\\)$`));
    expect(describeResult("ok")).toBe("Done");
    // No release yet: a manifest that answered 404 has its own words, and the other HTTP errors keep theirs.
    expect(describeResult("http_error", "no_release")).toBe(
      "No release is published at this address yet. Check the animation source, or try again after the first release.",
    );
    expect(describeResult("http_error", null)).toBe("The server answered with an error (http_error)");
    expect(describeResult("http_error", "other_detail")).toBe("The server answered with an error (http_error)");
    expect(describeResult("network_error", "no_release")).toMatch(/\(network_error\)$/);
    expect(describeResult("from_the_future")).toBe("from_the_future");
    expect(describeResult("constructor")).toBe("constructor");
  });

  it("describes the last installation", () => {
    expect(describeInstall({ result: "updated", from: "1.2.0", to: "1.3.0" })).toBe("Updated from 1.2.0 to 1.3.0");
    expect(describeInstall({ result: "rolled_back", from: "1.2.0", to: "1.3.0" })).toContain("went back to 1.2.0");
    expect(describeInstall({ result: "x", from: "a", to: "b" })).toBe("x: a to b");
  });
});

describe("a firmware on the skip list", () => {
  const rolledBack = { result: "rolled_back", from: "1.2.0", to: "1.3.0" };

  it("is the available version a rollback left, and no other", () => {
    expect(firmwareSkipped(update({ firmware: "1.3.0", last_install: rolledBack }))).toBe(true);
    expect(firmwareSkipped(update({ firmware: "1.4.0", last_install: rolledBack }))).toBe(false);
    expect(firmwareSkipped(update({ firmware: "1.3.0", last_install: { ...rolledBack, result: "updated" } }))).toBe(
      false,
    );
    expect(firmwareSkipped(update({ firmware: "1.3.0", last_install: null }))).toBe(false);
    expect(firmwareSkipped(update({ firmware: null, last_install: rolledBack }))).toBe(false);
  });

  it("is said so where the available firmware is described", () => {
    expect(describeFirmware(update({ firmware: null }))).toBe("No firmware update");
    expect(describeFirmware(update({ firmware: "1.3.0" }))).toBe("Firmware 1.3.0");
    expect(describeFirmware(update({ firmware: "1.3.0", last_install: rolledBack }))).toContain("rolled back");
  });

  it("asks for another confirmation than a normal installation", () => {
    const normal = firmwareConfirmation("1.2.0", "1.3.0", false);
    expect(normal.title).toBe("Install firmware 1.3.0?");
    expect(normal.action).toBe("Install firmware");
    expect(normal.text).toContain("goes back to 1.2.0 by itself");
    const again = firmwareConfirmation("1.2.0", "1.3.0", true);
    expect(again.title).toBe("Install firmware 1.3.0 again?");
    expect(again.action).toBe("Install anyway");
    expect(again.text).toContain("did not start properly");
    expect(firmwareConfirmation(undefined, "1.3.0", false).text).toContain("the board goes back by itself");
  });
});

describe("why an Updates button is disabled", () => {
  const ready = { off: false, running: false, found: true, connected: true };
  it("names the first rule that applies: switch, running, nothing found, no WiFi", () => {
    const cases: Array<[Parameters<typeof disabledReason>[0], Partial<typeof ready>, string]> = [
      ["check", {}, ""],
      ["check", { off: true, running: true, connected: false }, "Updates are off."],
      ["animations", { off: true }, "Animation updates are off."],
      ["firmware", { off: true }, "Firmware updates are off."],
      ["check", { running: true, connected: false }, "A check or an installation is running."],
      ["animations", { running: true, found: false }, "A check or an installation is running."],
      ["animations", { found: false, connected: false }, "The last check found nothing to install."],
      ["firmware", { found: false }, "The last check found no firmware update."],
      ["check", { connected: false }, "The board is not connected to WiFi."],
      ["firmware", { connected: false }, "The board is not connected to WiFi."],
      ["animations", {}, ""],
    ];
    for (const [action, context, reason] of cases)
      expect(disabledReason(action, { ...ready, ...context }), `${action} ${JSON.stringify(context)}`).toBe(reason);
  });
});
