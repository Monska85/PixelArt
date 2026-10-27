// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { jobLost } from "../src/ui/firmware/useContentInstall";

describe("a first-install job that waits for the queue to start", () => {
  it("is lost when the link drops before the session is seen connected", () => {
    for (const state of ["lost", "disconnected", "connecting"] as const) expect(jobLost("connected", state)).toBe(true);
  });

  it("goes on while the session is connected, and is not judged in the other phases", () => {
    expect(jobLost("connected", "connected")).toBe(false);
    for (const phase of ["idle", "connecting", "running", "failed"] as const)
      expect(jobLost(phase, "lost")).toBe(false);
  });
});
