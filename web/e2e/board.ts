import type { Page } from "@playwright/test";
import { decodeLine, encodeLine } from "../src/protocol/framing";
import type { Simulator } from "./fixtures";

interface BoardWatch {
  /**
   * Keeps the reply to the next request of this command until `release`. The replies to its retries (the app asks
   * again with the same seq after 2 seconds) are dropped, so the state lasts however slow the run is.
   */
  hold: (cmd: string) => void;
  release: () => void;
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

  await page.routeWebSocket(
    (url) => url.port === port,
    (socket) => {
      const server = socket.connectToServer();
      const commands = new Map<number, string>();
      send = (message) => socket.send(message);
      socket.onMessage((message) => {
        const request = decodeLine(new TextEncoder().encode(String(message)));
        if (request && typeof request.seq === "number" && typeof request.cmd === "string")
          commands.set(request.seq, request.cmd);
        server.send(message);
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
  };
}
