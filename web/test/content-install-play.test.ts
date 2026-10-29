// SPDX-License-Identifier: GPL-3.0-or-later
// @vitest-environment jsdom

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { sha256Hex } from "../src/protocol";
import { publishedPath, type Manifest, type Published, type PublishedKind } from "../src/release/manifest";
import { TooltipProvider } from "../src/ui/components/tooltip";
import { SCRATCH_MANIFEST } from "../src/ui/firmware/installDialog";
import { useContentInstall } from "../src/ui/firmware/useContentInstall";
import { session } from "../src/ui/session";
import { cancelRunningUpload, reserveUploadQueue } from "../src/ui/upload";
import { FakeBoard } from "./fakeBoard";
import { FakePort } from "./fakePort";

const text = (value: string): Uint8Array => new TextEncoder().encode(value);

const ANIMATION = text(
  '{"format":"pixelart/1","name":"Ball","canvas":{"width":16,"height":16},"sprites":{"a":{"points":[[1,1,"#ff0000"]]}},"timeline":[{"show":["a"]}]}',
);
const SCHEDULE = text('{"format":"pixelart-schedule/1","fallback":["default"],"entries":[]}');
const PLAY = text('{"format":"pixelart-play/1","default":{"schedule":"seasons"}}');

/** The files of the site, by the path the app asks for. */
const site = new Map<string, Uint8Array>();

async function published(kind: PublishedKind, id: string, bytes: Uint8Array): Promise<Published> {
  site.set(publishedPath(kind, id), bytes);
  return { id, name: null, version: null, size: bytes.length, sha256: await sha256Hex(bytes) };
}

async function release(): Promise<Manifest> {
  return {
    version: "1.0.0",
    contentVersion: "0.2.0",
    hasFirmware: true,
    animations: [await published("animation", "ball", ANIMATION)],
    playlists: [],
    schedules: [await published("schedule", "seasons", SCHEDULE)],
    play: [await published("play", "default", PLAY)],
  };
}

describe("the play file after a first install", () => {
  let root: Root | null = null;

  beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    globalThis.ResizeObserver ??= class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  });

  afterEach(async () => {
    await act(async () => root?.unmount());
    root = null;
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    site.clear();
    await session.disconnect();
  });

  /** Runs the install of `manifest` against `board` through a closed ESP Web Tools dialog, up to the handshake. */
  async function install(manifest: Manifest, board: FakeBoard): Promise<void> {
    vi.stubGlobal("fetch", async (url: string) => {
      const bytes = site.get(String(url));
      return bytes ? new Response(bytes as BlobPart) : new Response("not found", { status: 404 });
    });
    const Probe = (): ReactNode => {
      const { notice, following } = useContentInstall(manifest, true);
      return createElement(TooltipProvider, null, createElement("div", null, notice, following ? "following" : "idle"));
    };
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root?.render(createElement(Probe)));
    await act(async () => {
      const dialog = Object.assign(document.createElement("ewt-install-dialog"), {
        port: new FakePort("port", [], board),
        manifestPath: SCRATCH_MANIFEST,
        _installState: { state: "finished" },
      });
      document.body.append(dialog);
      dialog.dispatchEvent(new CustomEvent("closed", { bubbles: true, composed: true }));
      dialog.remove();
    });
    await vi.waitFor(() => expect(board.requests.some((r) => r.cmd === "info")).toBe(true));
  }

  const begun = (board: FakeBoard): unknown[] => board.requests.filter((r) => r.cmd === "put_begin").map((r) => r.kind);
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 300));

  function modern(): FakeBoard {
    const board = new FakeBoard();
    board.schedules = true;
    board.playFiles = true;
    return board;
  }

  it("uploads it last, in the same queue, to a board that reports formats.play", async () => {
    const board = modern();
    await install(await release(), board);
    await vi.waitFor(() => expect(board.files.play.has("default")).toBe(true));
    expect(begun(board)).toEqual(["animation", "schedule", "play"]);
    expect(board.serverChoice).toEqual({ schedule: "seasons" });
    expect(board.requests.map((r) => r.cmd)).not.toContain("server_choice_set");
  });

  it("uploads none to a board that knows schedules but not the play file", async () => {
    const board = modern();
    board.playFiles = false;
    await install(await release(), board);
    await vi.waitFor(() => expect(board.files.schedule.has("seasons")).toBe(true));
    await settle();
    expect(begun(board)).toEqual(["animation", "schedule"]);
    expect(board.files.play.size).toBe(0);
  });

  it("uploads none to a firmware older than schedules", async () => {
    const board = new FakeBoard();
    await install(await release(), board);
    await vi.waitFor(() => expect(board.files.animation.has("ball")).toBe(true));
    await settle();
    expect(begun(board)).toEqual(["animation"]);
  });

  it("uploads nothing, so Automatic does not change, when the queue refuses the install as busy", async () => {
    const board = modern();
    board.files.play.set("default", text('{"format":"pixelart-play/1","default":{"playlists":["old"]}}'));
    const other = reserveUploadQueue();
    expect(other).not.toBeNull();
    try {
      await install(await release(), board);
      await settle();
    } finally {
      other?.release();
    }
    expect(begun(board)).toEqual([]);
    expect(board.serverChoice).toEqual({ playlists: ["old"] });
  });

  it("uploads no play file, so Automatic does not change, when the install is cancelled", async () => {
    const board = modern();
    // The user cancels as the schedule starts: the play file after it is never sent.
    board.override = (request) => {
      if (request.cmd === "put_begin" && request.kind === "schedule") cancelRunningUpload();
      return undefined;
    };
    await install(await release(), board);
    await settle();
    expect(begun(board)).toContain("schedule");
    expect(begun(board)).not.toContain("play");
    expect(board.serverChoice).toBeNull();
  });

  it("uploads no play file when an upload before it fails", async () => {
    const board = modern();
    board.override = (request) =>
      request.cmd === "put_end" && board.requests.some((r) => r.cmd === "put_begin" && r.kind === "schedule")
        ? { ok: false, error: "storage_error", message: "full" }
        : undefined;
    await install(await release(), board);
    await settle();
    expect(begun(board)).toContain("schedule");
    expect(begun(board)).not.toContain("play");
    expect(board.serverChoice).toBeNull();
  });
});
