// SPDX-License-Identifier: GPL-3.0-or-later

// The conformance suite of conformance/README.md, with the comparison rules of
// test/test_conformance/test_conformance.cpp.

import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import {
  Player,
  choosePlaylists,
  effectiveBrightness,
  loadAnimation,
  loadPlaylist,
  loadSchedule,
  scheduleWinner,
  type Diagnostic,
  type LocalDate,
  type PlayMode,
  type Schedule,
  type ServerChoice,
} from "../src/engine";
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

describe("schedules that must load", () => {
  const files = caseFiles(`${SUITE}/schedule/valid`);
  it("has cases", () => expect(files.length).toBeGreaterThan(0));
  it.each(files.map((f) => [basename(f, ".json"), f]))("%s", (_name, file) => {
    const result = loadSchedule(readBytes(file as string));
    expect(result.schedule, `rejected:${describeAll(result.diagnostics)}`).not.toBeNull();
    const { fallback, entries } = result.schedule!;
    // The expected file leaves out the names: fallback and the entries in file order.
    expect({ fallback, entries: entries.map(({ from, to, playlists }) => ({ from, to, playlists })) }).toEqual(
      json(expectedPath(file as string)),
    );
  });
});

describe("schedules that must be rejected", () => {
  const files = caseFiles(`${SUITE}/schedule/invalid`);
  it("has cases", () => expect(files.length).toBeGreaterThan(0));
  it.each(files.map((f) => [basename(f, ".json"), f]))("%s", (_name, file) => {
    const result = loadSchedule(readBytes(file as string));
    expect(result.schedule, "accepted").toBeNull();
    expectRejection(json(expectedPath(file as string)), result.diagnostics);
  });
});

/** The schedules of a row file, loaded by the app's own loader from their JSON text. */
function rowSchedules(documents: Record<string, unknown>): Map<string, Schedule> {
  const out = new Map<string, Schedule>();
  for (const [key, document] of Object.entries(documents)) {
    const result = loadSchedule(new TextEncoder().encode(JSON.stringify(document)));
    expect(result.schedule, `schedule ${key} rejected:${describeAll(result.diagnostics)}`).not.toBeNull();
    out.set(key, result.schedule!);
  }
  return out;
}

const localDate = (text: string): LocalDate => {
  const [year, month, day] = text.split("-").map(Number) as [number, number, number];
  return { year, month, day };
};

describe("schedule winner rules", () => {
  const file = json(`${SUITE}/schedule/winner.json`);
  const schedules = rowSchedules(file.schedules);
  const rows: { schedule: string; date: string; entry: number | null }[] = file.rows;
  it("has rows", () => expect(rows.length).toBeGreaterThan(0));
  it.each(rows.map((r) => [`${r.schedule} on ${r.date}`, r] as const))("%s", (_name, row) => {
    const winner = scheduleWinner(schedules.get(row.schedule)!, localDate(row.date));
    expect(winner === -1 ? null : winner).toBe(row.entry);
  });
});

describe("how the board chooses what to play", () => {
  const file = json(`${SUITE}/schedule/resolver.json`);
  const documents = rowSchedules(file.schedules);
  const rows: {
    name: string;
    play: PlayMode;
    playlists: string[];
    schedule: string;
    stored: Record<string, string>;
    server_choice: ServerChoice | null;
    date: string | null;
    playable: string[];
    expected: {
      source: string;
      schedule: string | null;
      reason: string;
      entry: number | null;
      playlists: string[];
      playing: string | null;
    };
  }[] = file.rows;
  it("has rows", () => expect(rows.length).toBeGreaterThan(0));
  it.each(rows.map((r) => [r.name, r] as const))("%s", (_name, row) => {
    // `stored` maps each stored ID to the document it holds.
    const schedules = new Map(Object.entries(row.stored).map(([id, key]) => [id, documents.get(key)!]));
    const choice = choosePlaylists({
      mode: row.play,
      playlists: row.playlists,
      schedule: row.schedule,
      serverChoice: row.server_choice,
      schedules,
      date: row.date === null ? null : localDate(row.date),
      playable: (id) => row.playable.includes(id),
    });
    expect(choice).toEqual(row.expected);
  });
});
