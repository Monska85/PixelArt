// SPDX-License-Identifier: GPL-3.0-or-later

import type { Page } from "@playwright/test";
import type { ServerChoice } from "../src/engine";
import { decodeLine, encodeLine } from "../src/protocol/framing";
import type { Simulator } from "./fixtures";

interface BoardWatch {
  /**
   * Keeps the reply to the next request of this command until `release`. The replies to its retries (the app asks
   * again with the same seq after 2 seconds) are dropped, so the state lasts however slow the run is.
   */
  hold: (cmd: string) => void;
  release: () => void;
  /**
   * Cuts the board off: nothing more goes from the page to the simulator, and the page sees the board close the
   * connection. A state that then stops the simulator does not race with it: the page's request in the moment between
   * the simulator going away and the app noticing would go to a closing socket, which Chrome logs as an error.
   */
  disconnect: () => Promise<void>;
}

/**
 * Stands between the page and the simulator. It writes a fixed firmware version into the replies, because the
 * simulator reports the one of the commit it was built from, and it can keep one reply back so a state that lasts
 * only a moment (connecting, an upload under way) can be drawn.
 */
export async function watchBoard(
  page: Page,
  simulator: Simulator,
  { firmware = "0.0.9", storage }: { firmware?: string; storage?: { total: number; used: number } } = {},
): Promise<BoardWatch> {
  const port = new URL(simulator.address).port;
  let heldCmd: string | null = null;
  let held: string | null = null;
  let send: ((message: string) => void) | null = null;
  let cut: (() => Promise<void>) | null = null;
  let open = true; // false once the board is cut off or its side has closed: nothing is forwarded to it

  await page.routeWebSocket(
    (url) => url.port === port,
    (socket) => {
      const server = socket.connectToServer();
      open = true;
      // With a handler on the server's side Playwright no longer closes the page's socket by itself.
      server.onClose((code, reason) => {
        open = false;
        void socket.close(code && code !== 1005 && code !== 1006 ? { code, reason } : {});
      });
      cut = async () => {
        open = false;
        await server.close();
        await socket.close({ code: 1001, reason: "board cut off" });
      };
      const commands = new Map<number, string>();
      send = (message) => socket.send(message);
      socket.onMessage((message) => {
        const request = decodeLine(new TextEncoder().encode(String(message)));
        if (request && typeof request.seq === "number" && typeof request.cmd === "string")
          commands.set(request.seq, request.cmd);
        if (open) server.send(message);
      });
      server.onMessage((message) => {
        const text = String(message);
        const reply = decodeLine(new TextEncoder().encode(text));
        if (!reply) return socket.send(text);
        const cmd = typeof reply.seq === "number" ? commands.get(reply.seq) : undefined;
        const out =
          typeof reply.firmware === "string" ? encodeLine({ ...reply, firmware, ...(storage && { storage }) }) : text;
        if (heldCmd !== null && cmd === heldCmd) {
          if (held === null) held = out;
          return;
        }
        socket.send(out);
      });
    },
  );

  return {
    hold: (cmd) => {
      heldCmd = cmd;
    },
    release: () => {
      heldCmd = null;
      if (held !== null) send?.(held);
      held = null;
    },
    disconnect: async () => {
      await cut?.();
    },
  };
}

/** What a firmware from before schedules leaves out of a reply (docs/protocol/protocol-v1.md#info). */
function withoutSchedules(reply: Record<string, unknown>): Record<string, unknown> {
  const out = { ...reply };
  for (const key of ["formats", "limits"] as const)
    if (typeof out[key] === "object" && out[key] !== null) {
      const part = { ...(out[key] as Record<string, unknown>) };
      delete part.schedule;
      out[key] = part;
    }
  if (typeof out.settings === "object" && out.settings !== null) {
    const settings = { ...(out.settings as Record<string, unknown>) };
    for (const key of ["play", "playlists", "schedule", "time_sync_hours", "ntp_server"]) delete settings[key];
    out.settings = settings;
  }
  delete out.play;
  delete out.schedules;
  return out;
}

/**
 * Makes the simulator look like a firmware from before schedules: its replies lose `formats.schedule`, the new
 * settings, `status.play` and the schedule count of `delete_all`. The simulator still takes the requests of such an
 * app, as every firmware since does. The requests and the (changed) replies are kept, by command, in order.
 */
export async function firmwareBeforeSchedules(
  page: Page,
  simulator: Simulator,
): Promise<{ requests: Array<Record<string, unknown>>; replies: (cmd: string) => Array<Record<string, unknown>> }> {
  const port = new URL(simulator.address).port;
  const requests: Array<Record<string, unknown>> = [];
  const replies: Array<{ cmd: string; reply: Record<string, unknown> }> = [];
  await page.routeWebSocket(
    (url) => url.port === port,
    (socket) => {
      const server = socket.connectToServer();
      const commands = new Map<number, string>();
      socket.onMessage((message) => {
        const request = decodeLine(new TextEncoder().encode(String(message)));
        if (request && typeof request.seq === "number" && typeof request.cmd === "string") {
          commands.set(request.seq, request.cmd);
          requests.push(request);
        }
        server.send(message);
      });
      server.onMessage((message) => {
        const reply = decodeLine(new TextEncoder().encode(String(message)));
        if (!reply) return socket.send(String(message));
        const changed = withoutSchedules(reply);
        const cmd = typeof reply.seq === "number" ? commands.get(reply.seq) : undefined;
        if (cmd) replies.push({ cmd, reply: changed });
        socket.send(encodeLine(changed));
      });
    },
  );
  return { requests, replies: (cmd) => replies.filter((r) => r.cmd === cmd).map((r) => r.reply) };
}

/**
 * Stores what the release says Automatic plays on the simulator, as an update check or the USB install would, over a
 * connection of its own that ends before the page's starts.
 */
export async function setServerChoice(simulator: Simulator, choice: ServerChoice | null): Promise<void> {
  const socket = new WebSocket(simulator.address);
  const answer = new Promise<Record<string, unknown> | null>((resolve, reject) => {
    socket.onopen = () => socket.send(encodeLine({ seq: 1, cmd: "server_choice_set", choice }));
    socket.onerror = () => reject(new Error("the simulator did not take the server choice"));
    socket.onmessage = (event) => resolve(decodeLine(new TextEncoder().encode(String(event.data))));
  });
  const closed = new Promise<void>((resolve) => (socket.onclose = () => resolve()));
  const reply = await answer;
  socket.close();
  await closed;
  if (reply?.ok !== true) throw new Error(`the simulator refused the server choice: ${JSON.stringify(reply)}`);
}
