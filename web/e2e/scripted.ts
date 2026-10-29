// SPDX-License-Identifier: GPL-3.0-or-later

import { createHash } from "node:crypto";
import type { Page } from "@playwright/test";
import { decodeLine, encodeLine, type Body } from "../src/protocol/framing";
import { openConnectCard } from "./fixtures";

type Kind = "animation" | "playlist" | "schedule";

export interface Scripted {
  /** Every request the page sent, in order. */
  requests: Body[];
  /** What the board stores: kind, then ID. */
  files: Record<Kind, Map<string, Buffer>>;
  /** IDs whose upload the board refuses at `put_end` with `invalid_file`. */
  refuse: Set<string>;
  /** The answer to `delete_all`, called for every request. */
  deleteAll: (call: number) => Body;
  storage: { total: number; used: number };
  /** The board cannot read its files: every `list` fails with `storage_error`. */
  failLists: boolean;
  /** How many of the next `settings_get` requests fail with `storage_error`. */
  failSettings: number;
  /** The address to connect to. */
  address: string;
  /** Fields that replace those of the `info` reply, for a board of another firmware. */
  info: Body;
  /** The settings, as a firmware from before schedules has them; `settings_set` changes the ones it names. */
  settings: Body;
}

/**
 * A board that lives in the page's WebSocket: it answers the commands the web app needs from state the test sets,
 * so a case the simulator cannot produce (a small storage, a refused file, an old firmware) can be drawn.
 */
export async function scriptedBoard(page: Page, port = 9): Promise<Scripted> {
  const board: Scripted = {
    requests: [],
    files: { animation: new Map(), playlist: new Map(), schedule: new Map() },
    refuse: new Set(),
    deleteAll: () => ({ ok: true, playlists: 0, animations: 0 }),
    storage: { total: 1_441_792, used: 8192 },
    failLists: false,
    failSettings: 0,
    address: `ws://127.0.0.1:${port}/`,
    info: {},
    settings: { brightness: 100, playlist: "default" },
  };
  let uploading: { kind: Kind; id: string; data: Buffer[] } | null = null;
  let deleteCalls = 0;

  const run = (request: Body): Body => {
    const kind = request.kind as Kind;
    // Like a firmware from before schedules, unless the test says the board reports them.
    const formats = (board.info.formats ?? {}) as Body;
    if (kind === "schedule" && formats.schedule === undefined)
      return { ok: false, error: "invalid_kind", message: "unknown kind" };
    switch (request.cmd) {
      case "info":
        return {
          ok: true,
          protocol: 1,
          firmware: "0.0.9",
          board: "scripted",
          boot_id: 1,
          formats: { animation: ["pixelart/1"], playlist: ["pixelart-playlist/1"] },
          canvas: { width: 16, height: 16 },
          storage: board.storage,
          memory: { free: 0, largest: 0 },
          limits: { line: 1024, chunk: 512, page: 8, animation: 65536, playlist: 16384 },
          ...board.info,
        };
      case "list": {
        if (board.failLists) return { ok: false, error: "storage_error", message: "the files cannot be read" };
        const ids = [...board.files[kind].keys()]
          .sort()
          .filter((id) => request.after === undefined || id > String(request.after));
        const page = ids.slice(0, 8);
        return {
          ok: true,
          kind,
          more: ids.length > page.length,
          entries: page.map((id) => {
            const data = board.files[kind].get(id) as Buffer;
            return { id, size: data.length, sha256: createHash("sha256").update(data).digest("hex") };
          }),
        };
      }
      case "settings_get":
        if (board.failSettings > 0) {
          board.failSettings -= 1;
          return { ok: false, error: "storage_error", message: "the settings cannot be read" };
        }
        return { ok: true, settings: { ...board.settings } };
      case "settings_set":
        for (const key of ["brightness", "playlist"]) if (key in request) board.settings[key] = request[key];
        return { ok: true, settings: { ...board.settings } };
      case "put_begin":
        uploading = { kind, id: String(request.id), data: [] };
        return { ok: true };
      case "put_chunk":
        uploading?.data.push(Buffer.from(String(request.data), "base64"));
        return { ok: true, received: uploading?.data.reduce((n, d) => n + d.length, 0) ?? 0 };
      case "put_end": {
        const up = uploading;
        uploading = null;
        if (!up) return { ok: false, error: "no_upload", message: "no upload in progress" };
        if (board.refuse.has(up.id))
          return {
            ok: false,
            error: "invalid_file",
            message: "the file is not valid",
            diagnostics: [{ severity: "error", code: "structure", where: "", message: "refused by the test" }],
          };
        board.files[up.kind].set(up.id, Buffer.concat(up.data));
        return { ok: true, warnings: [] };
      }
      case "put_abort":
        uploading = null;
        return { ok: true };
      case "delete":
        board.files[kind].delete(String(request.id));
        return { ok: true };
      case "delete_all":
        return board.deleteAll(++deleteCalls);
      default:
        return { ok: false, error: "unknown_command", message: "not scripted" };
    }
  };

  await page.routeWebSocket(board.address, (socket) => {
    socket.onMessage((message) => {
      const request = decodeLine(new TextEncoder().encode(String(message)));
      if (!request) return;
      board.requests.push(request);
      const reply = run(request);
      if (request.cmd === "delete_all" && reply.ok === true) {
        board.files.animation.clear();
        board.files.playlist.clear();
        board.files.schedule.clear();
      }
      socket.send(encodeLine({ seq: request.seq, ...reply }));
    });
  });
  return board;
}

/** Connects the page to the scripted board through the connect card of the Board view. */
export async function connectScripted(page: Page, board: Scripted): Promise<void> {
  await openConnectCard(page, board.address);
}
