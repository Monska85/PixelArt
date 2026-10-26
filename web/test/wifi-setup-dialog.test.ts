// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-3.0-or-later

import { StrictMode, act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { FrameType, IMPROV_HEADER, checksum, scanFrame, type ImprovFrame, type ImprovLink } from "../src/protocol";
import { WifiSetupDialog } from "../src/ui/board/WifiSetupDialog";

const encoder = new TextEncoder();

/** An RPC result of the scan command with the given texts, as the board sends it. */
function scanResult(...texts: string[]): ImprovFrame {
  const body = texts.flatMap((t) => [t.length, ...encoder.encode(t)]);
  return { type: FrameType.RpcResult, data: Uint8Array.from([0x04, body.length, ...body]) };
}

/** The frame the app would send for a scan, byte for byte: IMPROV, version 1, RPC command, length 2, command 4, no data. */
const SCAN_REQUEST = Uint8Array.from([...IMPROV_HEADER, 0x03, 0x02, 0x04, 0x00]);

describe("WifiSetupDialog under StrictMode", () => {
  let root: Root | null = null;

  beforeAll(() => {
    // React reads this flag to allow act() outside a test renderer.
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    // Radix measures its content with these in a browser.
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
  });

  it("sends one scan request, shows no busy warning and is ready after the scan", async () => {
    const sent: Uint8Array[] = [];
    const link: ImprovLink = {
      send: async (frame) => {
        sent.push(frame);
      },
      onFrame: null,
    };
    expect(scanFrame()).toEqual(Uint8Array.from([...SCAN_REQUEST, checksum(SCAN_REQUEST)]));

    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () =>
      root?.render(
        createElement(
          StrictMode,
          null,
          createElement(WifiSetupDialog, { link, onConnected: () => {}, onClose: () => {} }),
        ),
      ),
    );

    // The scan is still pending: both effect runs joined one request, and the dialog waits.
    expect(sent).toHaveLength(1);
    expect(document.body.textContent).toContain("Looking for networks...");
    expect(document.body.textContent).not.toContain("Another WiFi request is running.");
    const scanAgain = (): HTMLButtonElement => {
      const button = [...document.body.querySelectorAll("button")].find((b) => b.textContent?.includes("Scan again"));
      if (!button) throw new Error("no Scan again button");
      return button;
    };
    expect(scanAgain().disabled).toBe(true);

    // The board lists one network, then ends the list with the empty result.
    await act(async () => {
      link.onFrame?.(scanResult("Home", "-50", "YES"));
      link.onFrame?.(scanResult());
    });

    expect(sent).toHaveLength(1);
    expect(document.body.textContent).not.toContain("Looking for networks...");
    expect(document.body.textContent).not.toContain("Another WiFi request is running.");
    expect(document.body.textContent).toContain("Home");
    expect(scanAgain().disabled).toBe(false);
  });
});
