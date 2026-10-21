import type { Page } from "@playwright/test";
import { decodeLine, encodeLine } from "../src/protocol/framing";
import { expect, test } from "./fixtures";

/** A board that answers `info` only, with the given protocol version and file formats. */
async function oldBoard(page: Page, info: { protocol: number; formats: { animation: string[]; playlist: string[] } }) {
  await page.routeWebSocket("ws://127.0.0.1:9/", (socket) => {
    socket.onMessage((message) => {
      const request = decodeLine(new TextEncoder().encode(String(message)));
      if (!request) return;
      socket.send(
        encodeLine({
          seq: request.seq,
          ok: true,
          firmware: "0.0.1",
          board: "old",
          boot_id: 1,
          canvas: { width: 16, height: 16 },
          storage: { total: 1000, used: 10 },
          memory: { free: 0, largest: 0 },
          limits: { line: 1024, chunk: 512, page: 8, animation: 65536, playlist: 16384 },
          ...info,
        }),
      );
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Use the simulator" }).click();
  await page.getByLabel("Simulator address").fill("ws://127.0.0.1:9/");
  await page.getByRole("button", { name: "Connect simulator" }).click();
}

test("offers the Firmware view when the board speaks another protocol", async ({ page }) => {
  await oldBoard(page, { protocol: 2, formats: { animation: ["pixelart/1"], playlist: ["pixelart-playlist/1"] } });
  const message = page.getByTestId("connection-message");
  await expect(message).toContainText("protocol 2");
  await message.getByRole("link", { name: "Open the Firmware view" }).click();
  await expect(page.getByRole("link", { name: "Firmware", exact: true })).toHaveAttribute("aria-current", "page");
});

test("offers the Firmware view where uploads are blocked by the file formats of the board", async ({ page }) => {
  await oldBoard(page, { protocol: 1, formats: { animation: ["pixelart/0"], playlist: ["pixelart-playlist/1"] } });
  await expect(page.getByTestId("connection-state")).toHaveText("Connected");
  for (const view of ["Board", "Library", "Editor"]) {
    await page.getByRole("link", { name: view, exact: true }).click();
    const note = page.getByTestId("blocked-note");
    await expect(note).toContainText("does not read the file formats");
    await expect(note.getByRole("link", { name: "Open the Firmware view" })).toBeVisible();
  }
  await page.getByTestId("blocked-note").getByRole("link", { name: "Open the Firmware view" }).click();
  await expect(page.getByRole("link", { name: "Firmware", exact: true })).toHaveAttribute("aria-current", "page");
});
