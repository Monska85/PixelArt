// SPDX-License-Identifier: GPL-3.0-or-later

import { expect, test as base, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, connect } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeLine, type Body } from "../src/protocol/framing";

// The simulator and the board files it starts from: the built simulator and `make data`.
const SIMULATOR =
  process.env.PIXELART_SIM ?? fileURLToPath(new URL("../../.pio/build/native/program", import.meta.url));
const DATA = process.env.PIXELART_DATA ?? fileURLToPath(new URL("../../data", import.meta.url));

export interface Simulator {
  address: string;
  /** The data folder the simulator reads and writes: a copy, per test. */
  dataDir: string;
  stop: () => void;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        typeof address === "object" && address ? resolve(address.port) : reject(new Error("no port")),
      );
    });
  });
}

function accepts(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(port, "127.0.0.1");
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

export const test = base.extend<{
  simulator: Simulator;
  consoleProblems: string[];
  /** The files of the simulated update server, by path (`manifest.json`, `animations/a.json`), or null for none. */
  updateSource: Record<string, string> | null;
  /** The failures the simulated update server injects, as the simulator's `--update-fail` takes them. */
  updateFail: string[];
  /** More options for the simulator, such as `--firmware-version 1.2.0`. */
  simulatorArgs: string[];
}>({
  updateSource: [null, { option: true }],
  updateFail: [[], { option: true }],
  simulatorArgs: [[], { option: true }],
  simulator: async ({ page, updateSource, updateFail, simulatorArgs }, use) => {
    const folder = mkdtempSync(join(tmpdir(), "pixelart-e2e-"));
    const dataDir = join(folder, "data");
    cpSync(DATA, dataDir, { recursive: true });
    const args = ["--data", dataDir, "--realtime", "--no-files", "--loops", "0"];
    if (updateSource) {
      const updateDir = join(folder, "update");
      for (const [path, content] of Object.entries(updateSource)) {
        mkdirSync(dirname(join(updateDir, path)), { recursive: true });
        writeFileSync(join(updateDir, path), content);
      }
      args.push("--update-source", updateDir);
    }
    for (const failure of updateFail) args.push("--update-fail", failure);
    args.push(...simulatorArgs);
    const port = await freePort();
    const child: ChildProcess = spawn(SIMULATOR, [...args, "--ws", String(port)], { stdio: "ignore" });
    const stop = (): void => void child.kill("SIGTERM");
    try {
      for (let i = 0; i < 100 && !(await accepts(port)); i++) await new Promise((r) => setTimeout(r, 100));
      await use({ address: `ws://127.0.0.1:${port}`, dataDir, stop });
    } finally {
      // The page goes first: its sockets close by themselves, not through a simulator that has just been killed,
      // which would log an error to the console while the page is still open. Errors of the test are kept.
      await page.close().catch(() => undefined);
      stop();
      rmSync(folder, { recursive: true, force: true });
    }
  },

  // Fails a test that logged an error to the console, which includes a Content Security Policy violation.
  consoleProblems: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on("console", (message) => {
        // Chrome logs a refused or failed WebSocket handshake itself; the app reports it in the page.
        if (message.type() !== "error" || message.text().startsWith("WebSocket connection to")) return;
        // A site without a release answers 404 for the manifest, and Chrome logs every failed request itself.
        if (message.text().includes("status of 404") && message.location().url.endsWith("/manifest.json")) return;
        problems.push(message.text());
      });
      page.on("pageerror", (error) => problems.push(error.message));
      await use(problems);
      expect(problems).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** The toast with this text. A screen reader copy of it sits in a live region, so text alone would match twice. */
export const toastWith = (page: Page, text: string | RegExp) => page.locator("ol > li").filter({ hasText: text });

/** Opens the panel of the connection chip. Close it with Escape. */
export async function openConnection(page: Page): Promise<void> {
  await page.getByTestId("connection-state").click();
}

/** Opens the app and asks the connect card of the Board view to connect to the simulator at `address`. */
export async function openConnectCard(page: Page, address: string): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Use the simulator" }).click();
  await page.getByLabel("Simulator address").fill(address);
  await page.getByRole("button", { name: "Connect simulator" }).click();
}

/** Opens the app and connects it to the simulator, through the connect card of the Board view. */
export async function connectSimulator(page: Page, simulator: Simulator): Promise<void> {
  await openConnectCard(page, simulator.address);
  await expect(page.getByTestId("connection-state")).toHaveText("Connected");
}

/** A file of e2e/files/. */
export const file = (name: string): string => fileURLToPath(new URL(`./files/${name}`, import.meta.url));

/** Where the simulator stores a file of `kind` ("animations" or "playlists"). */
export const stored = (simulator: Simulator, kind: string, id: string): string =>
  join(simulator.dataDir, kind, `${id}.json`);

export const animationYaml = (name: string): string =>
  `format: pixelart/1\nname: ${name}\ncanvas: { width: 16, height: 16 }\nsprites:\n  dot:\n    points: [[7, 7, "#ff0000"]]\ntimeline:\n  - show: [dot]\n`;
export const playlistYaml = (...ids: string[]): string =>
  `format: pixelart-playlist/1\nname: Mix\ncanvas: { width: 16, height: 16 }\nitems:\n${ids.map((id) => `  - animation: ${id}\n`).join("")}`;
/** A YAML or JSON file, by its extension, for a file input. */
export const upload = (name: string, text: string) => ({
  name,
  mimeType: name.endsWith(".json") ? "application/json" : "application/yaml",
  buffer: Buffer.from(text),
});
/** Picks files with the Board view's Upload files input: paths, or files made with `upload`. */
export const pick = (page: Page, ...files: string[] | Array<ReturnType<typeof upload>>) =>
  page.locator("#upload-input").setInputFiles(files);

export const summary = (page: Page) => page.getByRole("status").filter({ hasText: /(Upload|Install) summary/ });
export const animations = (page: Page) => page.getByRole("table", { name: "Animations on the board" });
export const showPlaylists = (page: Page) => page.getByRole("tab", { name: /^Playlists/ }).click();
/** The editor has validated the document it shows. */
export const settled = (page: Page) => expect(page.getByTestId("diagnostics")).toHaveAttribute("aria-busy", "false");

/** Types a value into the editor field `label` and commits it with Enter. */
export async function text(page: Page, label: string, value: string): Promise<void> {
  const field = page.getByLabel(label, { exact: true });
  await field.fill(value);
  await field.press("Enter");
}

/**
 * Drags the brightness slider with the mouse to a value and lets go, or stays holding it. The pointer lands on the
 * nearest pixel, so the value is close to the one asked for; the slider's own value is returned.
 */
export async function dragBrightness(page: Page, to: number, hold = false): Promise<number> {
  const thumb = page.getByRole("slider", { name: "Brightness" });
  const root = page.locator('span[data-orientation="horizontal"]').filter({ has: thumb });
  // The lists finish loading after the connection and shift the Settings card: measure once the layout is still.
  await expect(page.locator("#main")).not.toHaveAttribute("data-list-animations", "loading");
  await expect(page.locator("#main")).not.toHaveAttribute("data-list-playlists", "loading");
  await thumb.scrollIntoViewIfNeeded();
  const track = await root.boundingBox();
  const grip = await thumb.boundingBox();
  if (!track || !grip) throw new Error("the slider is not shown");
  const radius = grip.width / 2;
  await page.mouse.move(grip.x + radius, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(track.x + radius + ((track.width - 2 * radius) * to) / 255, grip.y + grip.height / 2, {
    steps: 5,
  });
  if (!hold) await page.mouse.up();
  return Number(await thumb.getAttribute("aria-valuenow"));
}

/** Opens an animation of the Library in the editor, with its Open in editor button. Without an ID, the first one. */
export async function openFromLibrary(page: Page, id?: string): Promise<void> {
  const open = page.getByRole("button", { name: id ? `Open ${id} in editor` : /^Open .+ in editor$/ });
  await open.first().click();
}

/** Collects the replies the page received to requests of a command, over any WebSocket it opens afterwards. */
export function watchReplies(page: Page, cmd: string): { count: () => number; replies: Body[] } {
  const replies: Body[] = [];
  page.on("websocket", (socket) => {
    const sent = new Set<number>();
    const decode = (payload: string | Buffer) => decodeLine(new TextEncoder().encode(String(payload)));
    socket.on("framesent", (frame) => {
      const request = decode(frame.payload);
      if (request?.cmd === cmd && typeof request.seq === "number") sent.add(request.seq);
    });
    socket.on("framereceived", (frame) => {
      const reply = decode(frame.payload);
      if (reply && typeof reply.seq === "number" && sent.delete(reply.seq)) replies.push(reply);
    });
  });
  return { count: () => replies.length, replies };
}

/** Collects the requests the page sent for a command, over any WebSocket it opens afterwards. */
export function watchRequests(page: Page, cmd: string): Body[] {
  const requests: Body[] = [];
  page.on("websocket", (socket) => {
    socket.on("framesent", (frame) => {
      const request = decodeLine(new TextEncoder().encode(String(frame.payload)));
      if (request?.cmd === cmd) requests.push(request);
    });
  });
  return requests;
}
