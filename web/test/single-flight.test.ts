// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { singleFlight } from "../src/ui/singleFlight";

describe("singleFlight", () => {
  it("runs the task once for callers that arrive while it is pending, and gives them all its result", async () => {
    const flight = singleFlight();
    let runs = 0;
    let finish: (value: string) => void = () => undefined;
    const task = (): Promise<string> => {
      runs++;
      return new Promise((resolve) => (finish = resolve));
    };
    const first = flight(task);
    const second = flight(task);
    expect(runs).toBe(1);
    finish("networks");
    expect(await first).toBe("networks");
    expect(await second).toBe("networks");
  });

  it("runs the task again once it ended, after a failure too", async () => {
    const flight = singleFlight();
    let runs = 0;
    await expect(
      flight(async () => {
        runs++;
        throw new Error("busy");
      }),
    ).rejects.toThrow("busy");
    await expect(flight(async () => ++runs)).resolves.toBe(2);
    await expect(flight(async () => ++runs)).resolves.toBe(3);
  });
});
