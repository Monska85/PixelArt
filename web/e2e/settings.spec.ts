// SPDX-License-Identifier: GPL-3.0-or-later

import type { Page } from "@playwright/test";
import { decodeLine } from "../src/protocol/framing";
import { connectSimulator, dragBrightness, expect, test, type Simulator } from "./fixtures";

/**
 * Passes everything between the page and the simulator, but keeps the reply to the first `settings_set` until
 * `release` is called. `sent` lists the brightness of every distinct `settings_set` request, in order.
 */
async function holdFirstSettingsReply(page: Page, simulator: Simulator) {
  const port = new URL(simulator.address).port;
  const sent: number[] = [];
  const seen = new Set<number>();
  let heldSeq: number | null = null;
  let held: string | null = null;
  let send: ((message: string) => void) | null = null;

  await page.routeWebSocket(
    (url) => url.port === port,
    (socket) => {
      const server = socket.connectToServer();
      send = (message) => socket.send(message);
      socket.onMessage((message) => {
        const request = decodeLine(new TextEncoder().encode(String(message)));
        if (request?.cmd === "settings_set" && typeof request.seq === "number" && !seen.has(request.seq)) {
          seen.add(request.seq);
          sent.push(request.brightness as number);
          if (heldSeq === null) heldSeq = request.seq;
        }
        server.send(message);
      });
      server.onMessage((message) => {
        const reply = decodeLine(new TextEncoder().encode(String(message)));
        if (reply && heldSeq !== null && reply.seq === heldSeq && held === null) held = String(message);
        else socket.send(message);
      });
    },
  );

  return {
    sent,
    release: async () => {
      await expect.poll(() => held).not.toBeNull();
      send?.(held as unknown as string);
      held = null;
      heldSeq = -1;
    },
  };
}

test("sends a brightness released during a request after it, and shows the board's last answer", async ({
  page,
  simulator,
}) => {
  const board = await holdFirstSettingsReply(page, simulator);
  await connectSimulator(page, simulator);
  const first = await dragBrightness(page, 40);
  await expect.poll(() => board.sent).toEqual([first]);
  const second = await dragBrightness(page, 200);
  await expect(page.getByTestId("brightness-value")).toHaveText(String(second));
  expect(board.sent).toEqual([first]);

  await board.release();
  await expect.poll(() => board.sent).toEqual([first, second]);
  await expect(page.getByTestId("brightness-value")).toHaveText(String(second));
  await page.waitForTimeout(300);
  expect(board.sent).toEqual([first, second]);
  await expect(page.getByTestId("brightness-value")).toHaveText(String(second));
});

test("keeps the slider where the user is dragging when a reply arrives", async ({ page, simulator }) => {
  const board = await holdFirstSettingsReply(page, simulator);
  await connectSimulator(page, simulator);
  const first = await dragBrightness(page, 40);
  await expect.poll(() => board.sent).toEqual([first]);
  const dragging = await dragBrightness(page, 160, true);
  await board.release();
  await page.waitForTimeout(300);
  await expect(page.getByTestId("brightness-value")).toHaveText(String(dragging));

  await page.mouse.up();
  await expect.poll(() => board.sent).toEqual([first, dragging]);
  await expect(page.getByTestId("brightness-value")).toHaveText(String(dragging));
});
