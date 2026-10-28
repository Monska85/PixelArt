// SPDX-License-Identifier: GPL-3.0-or-later

import { existsSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { decodeLine, encodeLine } from "../src/protocol/framing";
import { closeInstallDialog, fakeSerial, portLog } from "./first-install";
import { expect, stored, summary, test, type Simulator } from "./fixtures";
import type { Page } from "@playwright/test";

const published = JSON.parse(
  readFileSync(fileURLToPath(new URL("./site/published.json", import.meta.url)), "utf8"),
) as { animations: string[]; playlists: string[]; schedules: string[]; play: string[] };

const BOX = "Then install the animations, playlists and schedules";
const schedules = (simulator: Simulator): string[] =>
  published.schedules.map((id) => stored(simulator, "schedules", id));
const playFiles = (simulator: Simulator): string[] => published.play.map((id) => stored(simulator, "play", id));
const files = (simulator: Simulator): string[] => [
  ...published.animations.map((id) => stored(simulator, "animations", id)),
  ...published.playlists.map((id) => stored(simulator, "playlists", id)),
  ...schedules(simulator),
  ...playFiles(simulator),
];

/** The commands the page sends over any WebSocket it opens afterwards, in order, with the kind of an upload. */
function watchCommands(page: Page): Array<{ cmd: string; kind?: unknown }> {
  const sent: Array<{ cmd: string; kind?: unknown }> = [];
  page.on("websocket", (socket) =>
    socket.on("framesent", (frame) => {
      const request = decodeLine(new TextEncoder().encode(String(frame.payload)));
      if (typeof request?.cmd === "string") sent.push({ cmd: request.cmd, kind: request.kind });
    }),
  );
  return sent;
}

/** A board that has just been flashed with an empty file system: none of the published files is there. */
function emptyBoard(simulator: Simulator): void {
  for (const path of files(simulator)) rmSync(path, { force: true });
}

test("installs the published animations, playlists and schedules over the port ESP Web Tools used", async ({
  page,
  simulator,
}) => {
  emptyBoard(simulator);
  // The port fails twice first, as a port does while the board restarts: the app tries again every second.
  await fakeSerial(page, { board: simulator.address, failOpens: 2 });
  const commands = watchCommands(page);
  await page.goto("/#firmware");
  await expect(page.getByRole("checkbox", { name: BOX })).toBeChecked();
  await expect(page.getByText(/Keep the board connected until they are installed/)).toBeVisible();

  await closeInstallDialog(page, { state: "finished" });
  await expect(page.getByTestId("activity")).toContainText(
    "Installing the animations, playlists and schedules of release 0.2.0",
  );
  await expect(summary(page)).toContainText("Installed");
  for (const path of files(simulator)) expect(existsSync(path), path).toBe(true);
  await expect(page.getByTestId("connection-state")).toHaveText("Connected");
  expect(await portLog(page)).toEqual({ opens: 3, pickerRequests: 0 });
  await expect(page.getByTestId("content-not-installed")).toHaveCount(0);
  // The site's play file is the last file of the same queue, after the schedules it can name, and no command sets
  // the choice.
  const uploads = commands.filter((c) => c.cmd === "put_begin").map((c) => c.kind);
  expect(uploads.at(-1)).toBe("play");
  expect(uploads.indexOf("play")).toBeGreaterThan(uploads.lastIndexOf("schedule"));
  expect(commands.map((c) => c.cmd)).not.toContain("server_choice_set");
});

test("sends the published schedule only to a firmware that reports schedules", async ({ page, simulator }) => {
  emptyBoard(simulator);
  // The simulator plays a firmware from before schedules: its info has no formats.schedule.
  const port = new URL(simulator.address).port;
  const begun: unknown[] = [];
  await page.routeWebSocket(
    (url) => url.port === port,
    (socket) => {
      const server = socket.connectToServer();
      socket.onMessage((message) => {
        const request = decodeLine(new TextEncoder().encode(String(message)));
        if (request?.cmd === "put_begin") begun.push(request.kind);
        server.send(message);
      });
      server.onMessage((message) => {
        const reply = decodeLine(new TextEncoder().encode(String(message)));
        if (!reply || typeof reply.formats !== "object" || reply.formats === null) return socket.send(message);
        const formats = { ...(reply.formats as Record<string, unknown>) };
        const limits = { ...((reply.limits ?? {}) as Record<string, unknown>) };
        delete formats.schedule;
        delete limits.schedule;
        delete formats.play;
        delete limits.play;
        socket.send(encodeLine({ ...reply, formats, limits }));
      });
    },
  );
  await fakeSerial(page, { board: simulator.address });
  await page.goto("/#firmware");
  await expect(page.getByRole("checkbox", { name: BOX })).toBeChecked();
  await closeInstallDialog(page, { state: "finished" });
  await expect(summary(page)).toContainText("Installed");
  const newer = [...schedules(simulator), ...playFiles(simulator)];
  for (const path of files(simulator).filter((p) => !newer.includes(p))) expect(existsSync(path), path).toBe(true);
  for (const path of newer) expect(existsSync(path), path).toBe(false);
  expect(begun.length).toBeGreaterThan(0);
  expect(begun).not.toContain("schedule");
  // That firmware has no play file either.
  expect(begun).not.toContain("play");
  for (const path of playFiles(simulator)) expect(existsSync(path), path).toBe(false);
});

test("sends the published play file only to a firmware that reports it", async ({ page, simulator }) => {
  emptyBoard(simulator);
  // The simulator plays a firmware that knows schedules but not the play file: its info has no formats.play.
  const port = new URL(simulator.address).port;
  const begun: unknown[] = [];
  await page.routeWebSocket(
    (url) => url.port === port,
    (socket) => {
      const server = socket.connectToServer();
      socket.onMessage((message) => {
        const request = decodeLine(new TextEncoder().encode(String(message)));
        if (request?.cmd === "put_begin") begun.push(request.kind);
        server.send(message);
      });
      server.onMessage((message) => {
        const reply = decodeLine(new TextEncoder().encode(String(message)));
        if (!reply || typeof reply.formats !== "object" || reply.formats === null) return socket.send(message);
        const formats = { ...(reply.formats as Record<string, unknown>) };
        const limits = { ...((reply.limits ?? {}) as Record<string, unknown>) };
        delete formats.play;
        delete limits.play;
        socket.send(encodeLine({ ...reply, formats, limits }));
      });
    },
  );
  await fakeSerial(page, { board: simulator.address });
  await page.goto("/#firmware");
  await expect(page.getByRole("checkbox", { name: BOX })).toBeChecked();
  await closeInstallDialog(page, { state: "finished" });
  await expect(summary(page)).toContainText("Installed");
  for (const path of files(simulator).filter((p) => !playFiles(simulator).includes(p)))
    expect(existsSync(path), path).toBe(true);
  expect(begun).toContain("schedule");
  expect(begun).not.toContain("play");
  for (const path of playFiles(simulator)) expect(existsSync(path), path).toBe(false);
});

test("installs nothing when the box is unchecked", async ({ page, simulator }) => {
  emptyBoard(simulator);
  await fakeSerial(page, { board: simulator.address });
  await page.goto("/#firmware");
  await page.getByRole("checkbox", { name: BOX }).uncheck();
  await closeInstallDialog(page, { state: "finished" });
  await expect(page.getByTestId("connection-state")).toHaveText("Not connected");
  expect(await portLog(page)).toEqual({ opens: 0, pickerRequests: 0 });
  for (const path of files(simulator)) expect(existsSync(path), path).toBe(false);
});

test("does nothing when the dialog closes before its installation finished, or after Update firmware", async ({
  page,
  simulator,
}) => {
  emptyBoard(simulator);
  await fakeSerial(page, { board: simulator.address });
  await page.goto("/#firmware");
  await expect(page.getByRole("checkbox", { name: BOX })).toBeChecked();
  await closeInstallDialog(page, { state: null });
  await closeInstallDialog(page, { state: "preparing" });
  await closeInstallDialog(page, { state: "error" });
  await closeInstallDialog(page, { state: "finished", manifest: "./firmware/update.json" });
  await expect(page.getByTestId("connection-state")).toHaveText("Not connected");
  expect(await portLog(page)).toEqual({ opens: 0, pickerRequests: 0 });
  for (const path of files(simulator)) expect(existsSync(path), path).toBe(false);
  await expect(page.getByTestId("content-not-installed")).toHaveCount(0);
});

test.describe("a board that never answers", () => {
  // The app tries for 20 seconds, and the last try waits for the board's answer.
  test.setTimeout(120_000);

  test("gets the alert, with a way to connect and the Library", async ({ page, simulator }) => {
    emptyBoard(simulator);
    await fakeSerial(page, { board: null });
    await page.goto("/#firmware");
    await expect(page.getByRole("checkbox", { name: BOX })).toBeChecked();
    await closeInstallDialog(page, { state: "finished" });
    const alert = page.getByTestId("content-not-installed");
    await expect(alert).toContainText("The animations, playlists and schedules were not installed", {
      timeout: 90_000,
    });
    await expect(alert).toContainText("no animations");
    await expect(alert.getByRole("button", { name: "Connect board" })).toBeVisible();
    await expect(alert.getByRole("link", { name: "Library view" })).toHaveAttribute("href", "#library");
    await expect(page.getByTestId("activity")).toHaveCount(0);
    expect((await portLog(page)).opens).toBeGreaterThan(1);
    for (const path of files(simulator)) expect(existsSync(path), path).toBe(false);
  });
});
