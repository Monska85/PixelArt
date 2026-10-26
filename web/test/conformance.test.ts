// SPDX-License-Identifier: GPL-3.0-or-later

// The conformance suite of conformance/README.md, with the comparison rules of
// test/test_conformance/test_conformance.cpp.

import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import { Player, effectiveBrightness, loadAnimation, loadPlaylist, type Diagnostic } from "../src/engine";
import { REPO, caseFiles, expectedPath, readBytes } from "./helpers";

const SUITE = `${REPO}conformance`;

const describeAll = (diagnostics: Diagnostic[]): string =>
  diagnostics.map((d) => ` ${d.severity} ${d.code} at ${d.where}: ${d.message};`).join("");

const json = (path: string): any => JSON.parse(readFileSync(path, "utf8")); // eslint-disable-line @typescript-eslint/no-explicit-any

function expectRejection(expected: { error: string; max_diagnostics?: number }, diagnostics: Diagnostic[]): void {
  const found = diagnostics.some((d) => d.severity === "error" && d.code === expected.error);
  expect(found, `expected error ${expected.error}, got:${describeAll(diagnostics)}`).toBe(true);
  if (expected.max_diagnostics !== undefined) expect(diagnostics.length).toBeLessThanOrEqual(expected.max_diagnostics);
}

interface ExpectedFrame {
  ms: number;
  background?: string;
  pixels?: Record<string, number[][]>;
}

const rgb = (hex: string): number => parseInt(hex.slice(1), 16);

describe("animations that must load", () => {
  const files = caseFiles(`${SUITE}/valid`);
  it("has cases", () => expect(files.length).toBeGreaterThan(0));
  it.each(files.map((f) => [basename(f, ".json"), f]))("%s", (_name, file) => {
    const result = loadAnimation(readBytes(file as string));
    expect(result.animation, `rejected:${describeAll(result.diagnostics)}`).not.toBeNull();
    const animation = result.animation!;
    const expected = json(expectedPath(file as string));

    const want = new Set<string>(expected.warnings ?? []);
    const got = new Set(result.diagnostics.filter((d) => d.severity === "warning").map((d) => d.code));
    expect(got, `warnings differ:${describeAll(result.diagnostics)}`).toEqual(want);
    expect(animation.brightness).toBe(expected.brightness ?? 100);

    const player = new Player(animation);
    (expected.frames as ExpectedFrame[]).forEach((wantFrame, index) => {
      const frame = player.next();
      expect(frame, `frame ${index} missing`).not.toBeNull();
      expect(frame!.ms, `frame ${index} duration`).toBe(wantFrame.ms);
      const grid = new Uint32Array(256).fill(wantFrame.background ? rgb(wantFrame.background) : 0);
      for (const [color, positions] of Object.entries<number[][]>(wantFrame.pixels ?? {}))
        for (const [x, y] of positions) grid[(y as number) * 16 + (x as number)] = rgb(color);
      for (let i = 0; i < 256; i++) {
        if (grid[i] !== frame!.pixels[i])
          expect.fail(
            `frame ${index} pixel [${i % 16}, ${Math.floor(i / 16)}]: expected #${grid[i]!.toString(16).padStart(6, "0")}, got #${frame!.pixels[i]!.toString(16).padStart(6, "0")}`,
          );
      }
    });
    expect(player.next(), "more frames than expected").toBeNull();
  });
});

describe("animations that must be rejected", () => {
  const files = caseFiles(`${SUITE}/invalid`);
  it("has cases", () => expect(files.length).toBeGreaterThan(0));
  it.each(files.map((f) => [basename(f, ".json"), f]))("%s", (_name, file) => {
    const expected = json(expectedPath(file as string));
    const result = loadAnimation(readBytes(file as string));
    expect(result.animation, `accepted, expected error ${expected.error}`).toBeNull();
    expectRejection(expected, result.diagnostics);
  });
});

describe("playlists that must load", () => {
  const files = caseFiles(`${SUITE}/playlist/valid`);
  it("has cases", () => expect(files.length).toBeGreaterThan(0));
  it.each(files.map((f) => [basename(f, ".json"), f]))("%s", (_name, file) => {
    const result = loadPlaylist(readBytes(file as string));
    expect(result.items, `rejected:${describeAll(result.diagnostics)}`).not.toBeNull();
    expect(result.items).toEqual(json(expectedPath(file as string)).items);
  });
});

describe("playlists that must be rejected", () => {
  const files = caseFiles(`${SUITE}/playlist/invalid`);
  it("has cases", () => expect(files.length).toBeGreaterThan(0));
  it.each(files.map((f) => [basename(f, ".json"), f]))("%s", (_name, file) => {
    const result = loadPlaylist(readBytes(file as string));
    expect(result.items, "accepted").toBeNull();
    expectRejection(json(expectedPath(file as string)), result.diagnostics);
  });
});

it("a player replays from the start after restart()", () => {
  const result = loadAnimation(readBytes(`${SUITE}/valid/timeline_loops_and_ms.json`));
  const player = new Player(result.animation!);
  const run = (): number => {
    let n = 0;
    while (player.next()) n++;
    return n;
  };
  expect(run()).toBe(8);
  player.restart();
  expect(run()).toBe(8);
});

describe("brightness rule", () => {
  it("has the shared vectors", () => expect(existsSync(`${SUITE}/brightness.json`)).toBe(true));
  const rows: { board: number; percent: number; expected: number }[] = existsSync(`${SUITE}/brightness.json`)
    ? json(`${SUITE}/brightness.json`).rows
    : [];
  it.each(rows.map((r) => [`board ${r.board}, ${r.percent} percent`, r] as const))("%s", (_name, row) => {
    expect(effectiveBrightness(row.board, row.percent)).toBe(row.expected);
  });
});
