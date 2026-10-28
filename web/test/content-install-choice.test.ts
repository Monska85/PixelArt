// SPDX-License-Identifier: GPL-3.0-or-later
// @vitest-environment jsdom

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Manifest } from "../src/release/manifest";
import { TooltipProvider } from "../src/ui/components/tooltip";
import { SCRATCH_MANIFEST } from "../src/ui/firmware/installDialog";
import { useContentInstall } from "../src/ui/firmware/useContentInstall";
import { session } from "../src/ui/session";
import { FakeBoard } from "./fakeBoard";
import { FakePort } from "./fakePort";

const release = (choice: Manifest["default"]): Manifest => ({
  version: "1.0.0",
  contentVersion: "0.2.0",
  hasFirmware: true,
  animations: [],
  playlists: [],
  schedules: [],
  default: choice,
});

describe("the server choice after a first install", () => {
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
    await session.disconnect();
  });

  /** Runs the install of `manifest` against `board` through a closed ESP Web Tools dialog, up to the handshake. */
  async function install(manifest: Manifest, board: FakeBoard): Promise<void> {
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

  const sent = (board: FakeBoard) => board.requests.filter((r) => r.cmd === "server_choice_set");

  it("sends the manifest's default after the files, to a board that knows schedules", async () => {
    const board = new FakeBoard();
    board.schedules = true;
    await install(release({ schedule: "seasons" }), board);
    await vi.waitFor(() => expect(sent(board)).toHaveLength(1));
    expect(sent(board)[0]).toMatchObject({ choice: { schedule: "seasons" } });
    expect(board.serverChoice).toEqual({ schedule: "seasons" });
  });

  it("sends none when the manifest has no default, which clears the board's choice", async () => {
    const board = new FakeBoard();
    board.schedules = true;
    board.serverChoice = { schedule: "old" };
    await install(release(null), board);
    await vi.waitFor(() => expect(sent(board)).toHaveLength(1));
    expect(sent(board)[0]).toMatchObject({ choice: null });
    expect(board.serverChoice).toBeNull();
  });

  it("sends nothing to a firmware older than schedules", async () => {
    const board = new FakeBoard();
    await install(release({ schedule: "seasons" }), board);
    // The install of the files follows the handshake and ends in a few requests: nothing more is sent after it.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(sent(board)).toHaveLength(0);
  });
});
