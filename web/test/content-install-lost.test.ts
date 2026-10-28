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
import { useUploadActivity } from "../src/ui/upload";
import { FakeBoard } from "./fakeBoard";
import { FakePort } from "./fakePort";

const manifest: Manifest = {
  version: "1.0.0",
  contentVersion: "0.2.0",
  hasFirmware: true,
  animations: [],
  playlists: [],
  schedules: [],
  play: [],
};

describe("a first-install job whose link drops after the port connected", () => {
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

  it("clears the announcement and shows the not-installed alert instead of waiting for a queue", async () => {
    let announced = "";
    const Probe = (): ReactNode => {
      const { notice, following } = useContentInstall(manifest, true);
      const activity = useUploadActivity();
      announced = activity?.label ?? "";
      return createElement(TooltipProvider, null, createElement("div", null, notice, following ? "following" : "idle"));
    };
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root?.render(createElement(Probe)));

    // The port connects, then the device goes away before the queue could start.
    const connectPort = session.connectPort.bind(session);
    vi.spyOn(session, "connectPort").mockImplementation(async (port) => {
      const connected = await connectPort(port);
      (port as FakePort).vanish();
      await vi.waitFor(() => expect(session.getSnapshot().state).toBe("lost"));
      return connected;
    });
    const refresh = vi.spyOn(session, "refreshInfo");

    await act(async () => {
      const dialog = Object.assign(document.createElement("ewt-install-dialog"), {
        port: new FakePort("port", [], new FakeBoard()),
        manifestPath: SCRATCH_MANIFEST,
        _installState: { state: "finished" },
      });
      document.body.append(dialog);
      dialog.dispatchEvent(new CustomEvent("closed", { bubbles: true, composed: true }));
      dialog.remove();
    });

    // The handshake and the loss take real time: wait for the alert, then check the rest.
    await vi.waitFor(() => expect(document.body.querySelector('[data-testid="content-not-installed"]')).not.toBeNull());
    expect(session.connectPort).toHaveBeenCalledTimes(1);
    expect(announced).toBe("");
    expect(refresh).not.toHaveBeenCalled();
  });
});
