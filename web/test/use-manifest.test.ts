// SPDX-License-Identifier: GPL-3.0-or-later
// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadManifest } from "../src/release/manifest";
import { useManifest } from "../src/ui/useManifest";

vi.mock("../src/release/manifest", () => ({ loadManifest: vi.fn() }));

describe("published manifest loading", () => {
  let root: Root | null = null;

  beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(async () => {
    await act(async () => root?.unmount());
    root = null;
    document.body.replaceChildren();
    vi.clearAllMocks();
  });

  it("settles a failed load and retries on a later opening", async () => {
    vi.mocked(loadManifest).mockRejectedValueOnce(new Error("chunk unavailable")).mockResolvedValueOnce(null);
    const host = document.createElement("div");
    document.body.append(host);
    const Probe = (): string => useManifest().status;
    root = createRoot(host);
    await act(async () => root?.render(createElement(Probe)));
    expect(host.textContent).toBe("none");
    await act(async () => root?.unmount());
    root = createRoot(host);
    await act(async () => root?.render(createElement(Probe)));
    expect(host.textContent).toBe("none");
    expect(loadManifest).toHaveBeenCalledTimes(2);
  });
});
