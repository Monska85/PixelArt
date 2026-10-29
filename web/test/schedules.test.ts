// SPDX-License-Identifier: GPL-3.0-or-later

// Schedules in the protocol client, the release manifest, the app's own file checks and the "Next" of the Automatic
// card. The rules of the format and of the choice are in conformance.test.ts, from the shared conformance files.

import { describe, expect, it } from "vitest";
import {
  NEXT_CHANGE_DAYS,
  loadSchedule,
  nextDay,
  nextScheduleChange,
  parseServerChoice,
  type LocalDate,
  type Schedule,
} from "../src/engine";
import {
  BoardClient,
  deleteAll,
  deleteFile,
  getSettings,
  getStatus,
  listFiles,
  setSettings,
  supportsPlayFile,
  supportsSchedules,
  uploadFile,
} from "../src/protocol";
import type { PlayStatus, SettingsChanges } from "../src/protocol";
import { parseManifest } from "../src/release/manifest";
import {
  addReason,
  automaticSchedule,
  describeEnd,
  describePlay,
  describeScheduleDeletion,
  describeAutomatic,
  describeToday,
  editReason,
  listToSend,
  ntpServerProblem,
  parseSyncHours,
  playlistList,
  removeReason,
} from "../src/ui/board/play";
import { localDateIn, zoneOfSetting } from "../src/ui/board/timezones";
import { detectKind, validateFile } from "../src/ui/files";
import { summaryReport } from "../src/ui/queue/summary";
import type { QueueFile } from "../src/queue/plan";
import { siteScheduleId } from "../src/ui/board/useScheduleSource";
import { FakeBoard } from "./fakeBoard";
import { text } from "./helpers";

const SCHEDULE = JSON.stringify({
  format: "pixelart-schedule/1",
  fallback: ["default"],
  entries: [
    { name: "Halloween", from: { month: 10, day: 1 }, to: { month: 11, day: 2 }, playlists: ["halloween"] },
    { name: "Christmas", from: { month: 12, day: 1 }, to: { month: 1, day: 6 }, playlists: ["christmas"] },
  ],
});
const PLAYLIST = text('{"format":"pixelart-playlist/1","canvas":{"width":16,"height":16},"items":[{"animation":"a"}]}');

const PLAY = (choice: object) => text(JSON.stringify({ format: "pixelart-play/1", default: choice }));

async function connected(schedules: boolean, playFiles = false): Promise<{ board: FakeBoard; client: BoardClient }> {
  const board = new FakeBoard();
  board.schedules = schedules;
  board.playFiles = playFiles;
  for (const id of ["default", "halloween", "christmas"]) board.files.playlist.set(id, PLAYLIST);
  const client = new BoardClient(board, { firstSeq: 1 });
  await client.handshake();
  return { board, client };
}

const loaded = (json: string): Schedule => {
  const result = loadSchedule(text(json));
  if (!result.schedule) throw new Error(JSON.stringify(result.diagnostics));
  return result.schedule;
};

describe("a board that knows schedules", () => {
  it("is told by info.formats.schedule, and an older one by its absence", async () => {
    const { client } = await connected(true);
    expect(supportsSchedules(client.info)).toBe(true);
    expect(client.info?.limits.schedule).toBe(16384);
    const old = await connected(false);
    expect(supportsSchedules(old.client.info)).toBe(false);
    expect(old.client.info?.formats.schedule).toBeNull();
    expect(supportsSchedules(null)).toBe(false);
  });

  it("lists, uploads, downloads and deletes schedules like playlists", async () => {
    const { board, client } = await connected(true);
    await uploadFile(client, "schedule", "default", text(SCHEDULE));
    expect(board.files.schedule.has("default")).toBe(true);
    expect((await listFiles(client, "schedule")).map((e) => e.id)).toEqual(["default"]);
    await deleteFile(client, "schedule", "default");
    expect(await listFiles(client, "schedule")).toEqual([]);
  });

  it("answers invalid_kind to schedule on an older firmware", async () => {
    const { client } = await connected(false);
    await expect(listFiles(client, "schedule")).rejects.toMatchObject({ code: "invalid_kind" });
  });

  it("reads the new settings and keeps only those of the right type", async () => {
    const { board, client } = await connected(true);
    expect(await getSettings(client)).toEqual({
      brightness: 100,
      playlist: "default",
      play: "auto",
      playlists: ["default"],
      schedule: "default",
      time_sync_hours: 6,
      ntp_server: "pool.ntp.org",
    });
    board.override = (r) =>
      r.cmd === "settings_get"
        ? {
            ok: true,
            settings: {
              brightness: 1,
              playlist: "x",
              play: "sometimes",
              playlists: ["a", 3],
              schedule: 5,
              time_sync_hours: -1,
              ntp_server: 5,
            },
          }
        : undefined;
    expect(await getSettings(client)).toEqual({ brightness: 1, playlist: "x" });
  });

  it("reads play and playlists as the fake board derives them on a board that never stored them", async () => {
    const { board, client } = await connected(true);
    board.settings.playlist = "halloween";
    expect(await getSettings(client)).toMatchObject({
      play: "playlists",
      playlists: ["halloween"],
      playlist: "halloween",
    });
  });

  it("sends only the settings it is given and reads the board's reply", async () => {
    const { board, client } = await connected(true);
    const changes: SettingsChanges[] = [
      { playlists: ["halloween", "christmas"] },
      { play: "playlists" },
      { play: "auto" },
      { play: "schedule", schedule: "seasons" },
      { schedule: "default" },
      { time_sync_hours: 24, ntp_server: "time.example.org" },
    ];
    board.files.schedule.set("seasons", text(SCHEDULE));
    board.files.schedule.set("default", text(SCHEDULE));
    for (const change of changes) {
      const settings = await setSettings(client, change);
      expect(board.requests.at(-1)).toEqual({ seq: board.requests.at(-1)?.seq, cmd: "settings_set", ...change });
      expect(settings).toMatchObject(change);
    }
  });

  it("checks that the fake board maps an older client's playlist as the firmware does", async () => {
    const { client } = await connected(true);
    await setSettings(client, { play: "auto", playlists: ["christmas"] });
    expect(await setSettings(client, { playlist: "halloween" })).toMatchObject({
      play: "playlists",
      playlists: ["halloween"],
    });
    expect(await setSettings(client, { playlist: "default" })).toMatchObject({ play: "auto", playlists: ["default"] });
  });

  it("keeps the schedule while another choice plays, and reports playlist default for My choice, Schedule", async () => {
    const { board, client } = await connected(true);
    board.files.schedule.set("seasons", text(SCHEDULE));
    expect(await setSettings(client, { play: "schedule", schedule: "seasons" })).toMatchObject({
      play: "schedule",
      schedule: "seasons",
      playlist: "default",
    });
    expect(await setSettings(client, { play: "playlists" })).toMatchObject({ schedule: "seasons" });
    await expect(setSettings(client, { schedule: "ghost" })).rejects.toMatchObject({ code: "not_found" });
    await expect(setSettings(client, { schedule: "Bad" })).rejects.toMatchObject({ code: "invalid_id" });
    await expect(setSettings(client, { play: "schedule", playlist: "halloween" })).rejects.toMatchObject({
      code: "bad_request",
    });
  });

  it("stores the play file like a schedule, and status.play reports its default as the server choice", async () => {
    const { board, client } = await connected(true, true);
    expect(client.info?.formats.play).toEqual(["pixelart-play/1"]);
    expect(client.info?.limits.play).toBe(1024);
    expect(supportsPlayFile(client.info)).toBe(true);
    expect((await getStatus(client)).play?.serverChoice).toBeNull();
    await uploadFile(client, "play", "default", PLAY({ schedule: "seasons" }));
    expect(board.requests.map((r) => r.cmd)).not.toContain("server_choice_set");
    expect(await listFiles(client, "play")).toMatchObject([{ id: "default" }]);
    expect((await getStatus(client)).play?.serverChoice).toEqual({ schedule: "seasons" });
    await deleteFile(client, "play", "default");
    expect((await getStatus(client)).play?.serverChoice).toBeNull();
  });

  it("does not offer the play file to a firmware older than it, which answers invalid_kind", async () => {
    const { client } = await connected(true);
    expect(client.info?.formats.play).toBeNull();
    expect(client.info?.limits.play).toBe(1024);
    expect(supportsPlayFile(client.info)).toBe(false);
    await expect(listFiles(client, "play")).rejects.toMatchObject({ code: "invalid_kind" });
    const old = await connected(false);
    expect(supportsPlayFile(old.client.info)).toBe(false);
  });

  it("reads a server choice by the rules of the format, and anything else as none", () => {
    expect(parseServerChoice({ schedule: "seasons" })).toEqual({ schedule: "seasons" });
    expect(parseServerChoice({ playlists: ["a", "b"] })).toEqual({ playlists: ["a", "b"] });
    const nine = Array.from({ length: 9 }, (_, i) => `p${i}`);
    for (const bad of [
      null,
      "seasons",
      [],
      {},
      { schedule: "seasons", playlists: ["a"] },
      { schedule: "Bad" },
      { schedule: 3 },
      { playlists: [] },
      { playlists: ["a", "a"] },
      { playlists: ["a", 3] },
      { playlists: nine },
      { other: "a" },
    ])
      expect(parseServerChoice(bad), JSON.stringify(bad)).toBeNull();
  });

  it("surfaces the board's error codes for a disagreeing playlist, a missing playlist and a bad time server", async () => {
    const { client } = await connected(true);
    await expect(setSettings(client, { play: "auto", playlist: "halloween" })).rejects.toMatchObject({
      code: "bad_request",
    });
    await expect(setSettings(client, { playlists: ["ghost"] })).rejects.toMatchObject({ code: "not_found" });
    await expect(setSettings(client, { playlists: ["Bad"] })).rejects.toMatchObject({ code: "invalid_id" });
    await expect(setSettings(client, { playlists: [] })).rejects.toMatchObject({ code: "bad_request" });
    await expect(setSettings(client, { ntp_server: "time server" })).rejects.toMatchObject({ code: "bad_request" });
    await expect(setSettings(client, { time_sync_hours: 169 })).rejects.toMatchObject({ code: "bad_request" });
  });

  it("reads status.play, and none from an older firmware", async () => {
    const { board, client } = await connected(true);
    board.files.schedule.set("default", text(SCHEDULE));
    expect((await getStatus(client)).play).toEqual({
      mode: "auto",
      source: "fallback",
      schedule: "default",
      reason: "no_time",
      entry: null,
      playlists: ["default"],
      playing: "default",
      serverChoice: null,
    });
    board.statusPlay = {
      mode: "auto",
      source: "server",
      schedule: "seasons",
      reason: "schedule",
      entry: 1,
      playlists: ["christmas"],
      playing: "christmas",
      server_choice: { schedule: "seasons" },
    };
    expect((await getStatus(client)).play).toMatchObject({
      source: "server",
      schedule: "seasons",
      reason: "schedule",
      entry: 1,
      serverChoice: { schedule: "seasons" },
    });
    board.statusPlay = { mode: "auto", source: "fallback", reason: "because", entry: 1, playlists: [], playing: null };
    expect((await getStatus(client)).play).toBeNull();
    board.statusPlay = {
      mode: "auto",
      source: "elsewhere",
      reason: "schedule",
      entry: 1,
      playlists: [],
      playing: null,
    };
    expect((await getStatus(client)).play).toBeNull();
    board.statusPlay = {
      mode: "playlists",
      source: "playlists",
      schedule: null,
      reason: "playlists",
      entry: null,
      playlists: ["a"],
      playing: null,
      server_choice: { schedule: "Bad" },
    };
    expect((await getStatus(client)).play).toEqual({
      mode: "playlists",
      source: "playlists",
      schedule: null,
      reason: "playlists",
      entry: null,
      playlists: ["a"],
      playing: null,
      serverChoice: null,
    });
  });

  it("derives status.play from the settings, the stored schedules and the server choice", async () => {
    const { board, client } = await connected(true, true);
    board.files.schedule.set("seasons", text(SCHEDULE));
    board.files.play.set("default", PLAY({ schedule: "seasons" }));
    expect((await getStatus(client)).play).toMatchObject({ source: "server", schedule: "seasons", reason: "no_time" });
    await setSettings(client, { play: "schedule", schedule: "seasons" });
    expect((await getStatus(client)).play).toMatchObject({ mode: "schedule", source: "schedule" });
    await setSettings(client, { play: "playlists", playlists: ["halloween"] });
    expect((await getStatus(client)).play).toMatchObject({
      mode: "playlists",
      source: "playlists",
      schedule: null,
      playlists: ["halloween"],
      serverChoice: { schedule: "seasons" },
    });
  });

  it("counts the schedules and play files delete_all removes, and the older firmware's reply has none", async () => {
    const { board, client } = await connected(true, true);
    board.files.schedule.set("default", text(SCHEDULE));
    board.files.play.set("default", PLAY({ schedule: "default" }));
    await setSettings(client, { play: "playlists", playlists: ["halloween"] });
    expect(await deleteAll(client, { resetSettings: true })).toMatchObject({
      play: 1,
      schedules: 1,
      settings: { play: "auto", playlists: ["default"], schedule: "default", playlist: "default", time_sync_hours: 6 },
    });
    expect((await getStatus(client)).play?.serverChoice).toBeNull();
    const old = await connected(false);
    expect((await deleteAll(old.client)).schedules).toBeNull();
    expect((await deleteAll(old.client)).play).toBeNull();
    const noPlay = await connected(true);
    expect((await deleteAll(noPlay.client)).play).toBeNull();
  });
});

describe("the manifest's schedules", () => {
  const manifest = (schedules: unknown) =>
    JSON.stringify({ format: "pixelart-manifest/1", version: "1.0.0", animations: [], playlists: [], schedules });
  const sha = "b".repeat(64);

  it("are read from their folder, and an older manifest has none", () => {
    expect(
      parseManifest(
        manifest([{ id: "default", name: "Seasons", file: "schedules/default.json", size: 300, sha256: sha }]),
      )?.schedules,
    ).toEqual([{ id: "default", name: "Seasons", version: null, size: 300, sha256: sha }]);
    expect(parseManifest(manifest(undefined))?.schedules).toEqual([]);
  });

  it("come with the play file of the release, and an older manifest has none", () => {
    const withPlay = (play: unknown) =>
      parseManifest(JSON.stringify({ format: "pixelart-manifest/1", version: "1.0.0", play }))?.play;
    expect(withPlay([{ id: "default", file: "play/default.json", size: 61, sha256: sha }])).toEqual([
      { id: "default", name: null, version: null, size: 61, sha256: sha },
    ]);
    expect(withPlay(undefined)).toEqual([]);
    // Another folder, or larger than the 1 KiB a board stores: not read.
    expect(withPlay([{ id: "default", file: "schedules/default.json", size: 61, sha256: sha }])).toEqual([]);
    expect(withPlay([{ id: "default", file: "play/default.json", size: 1025, sha256: sha }])).toEqual([]);
    expect(
      parseManifest(JSON.stringify({ format: "pixelart-manifest/1", version: "1.0.0", default: { schedule: "x" } })),
    ).not.toHaveProperty("default");
  });

  it("leave out an entry in another folder or larger than a board stores", () => {
    expect(
      parseManifest(
        manifest([
          { id: "a", file: "playlists/a.json", size: 300, sha256: sha },
          { id: "b", file: "schedules/b.json", size: 16385, sha256: sha },
        ]),
      )?.schedules,
    ).toEqual([]);
  });
});

describe("the app's check of a picked file", () => {
  it("knows a schedule by its format and validates it", () => {
    const document = new Map([["format", "pixelart-schedule/1"]]);
    expect(detectKind(document)).toEqual({ ok: true, kind: "schedule" });
    expect(validateFile("schedule", text(SCHEDULE)).ok).toBe(true);
    const bad = validateFile("schedule", text('{"format":"pixelart-schedule/1","fallback":[]}'));
    expect(bad.ok).toBe(false);
    expect(bad.diagnostics[0]?.code).toBe("structure");
  });

  it("names the schedules in a summary", () => {
    const file = (kind: QueueFile["kind"], id: string): QueueFile => ({
      kind,
      id,
      bytes: new Uint8Array(1),
      sha256: "",
      origin: id,
    });
    const uploaded = [file("animation", "a"), file("playlist", "p"), file("schedule", "default")].map((f) => ({
      file: f,
      warnings: [],
    }));
    const report = summaryReport(
      { uploaded, skipped: [], failed: null, notAttempted: [], cancelled: false },
      "Installed",
    );
    expect(report.toast.title).toBe("Installed 1 animation, 1 playlist and 1 schedule");
    const withPlay = [...uploaded, { file: file("play", "default"), warnings: [] }];
    expect(
      summaryReport({ uploaded: withPlay, skipped: [], failed: null, notAttempted: [], cancelled: false }, "Installed")
        .toast.title,
    ).toBe("Installed 1 animation, 1 playlist, 1 schedule and 1 play file");
    const alone = [{ file: file("play", "default"), warnings: [] }];
    expect(
      summaryReport({ uploaded: alone, skipped: [], failed: null, notAttempted: [], cancelled: false }, "Installed")
        .toast.title,
    ).toBe("Installed play file default");
  });

  it("checks a play file of the site, which the user cannot pick", () => {
    expect(validateFile("play", PLAY({ schedule: "seasons" })).ok).toBe(true);
    const bad = validateFile("play", PLAY({ schedule: "seasons", playlists: ["a"] }));
    expect(bad.ok).toBe(false);
    expect(bad.diagnostics[0]?.code).toBe("structure");
    expect(detectKind(new Map([["format", "pixelart-play/1"]])).ok).toBe(false);
  });
});

describe("the next change of a schedule", () => {
  const seasons = loaded(SCHEDULE);
  const on = (year: number, month: number, day: number): LocalDate => ({ year, month, day });

  it("is the first day that plays other playlists", () => {
    expect(nextScheduleChange(seasons, on(2026, 10, 28))).toEqual({
      date: on(2026, 11, 3),
      entry: null,
      playlists: ["default"],
    });
    expect(nextScheduleChange(seasons, on(2026, 11, 3))).toEqual({
      date: on(2026, 12, 1),
      entry: 1,
      playlists: ["christmas"],
    });
    expect(nextScheduleChange(seasons, on(2026, 12, 31))).toEqual({
      date: on(2027, 1, 7),
      entry: null,
      playlists: ["default"],
    });
  });

  it("looks at most one year ahead, one day at a time", () => {
    const once = loaded(
      JSON.stringify({
        format: "pixelart-schedule/1",
        fallback: ["default"],
        entries: [{ from: { year: 2030, month: 1, day: 1 }, to: { year: 2030, month: 1, day: 1 }, playlists: ["x"] }],
      }),
    );
    expect(NEXT_CHANGE_DAYS).toBe(366);
    // January 1, 2030 is 366 days after December 31, 2028, and 367 after December 30.
    expect(nextScheduleChange(once, on(2028, 12, 30))).toBeNull();
    expect(nextScheduleChange(once, on(2028, 12, 31))?.date).toEqual(on(2030, 1, 1));
    expect(nextScheduleChange(loaded('{"format":"pixelart-schedule/1","fallback":["a"]}'), on(2026, 1, 1))).toBeNull();
  });

  it("stops at the end of 2999", () => {
    const late = loaded(
      JSON.stringify({
        format: "pixelart-schedule/1",
        fallback: ["a"],
        entries: [{ from: { month: 6 }, to: { month: 6 }, playlists: ["b"] }],
      }),
    );
    expect(nextScheduleChange(late, on(2999, 7, 1))).toBeNull();
  });

  it("steps over the ends of months and years, and February 29", () => {
    expect(nextDay(on(2028, 2, 28))).toEqual(on(2028, 2, 29));
    expect(nextDay(on(2027, 2, 28))).toEqual(on(2027, 3, 1));
    expect(nextDay(on(2026, 4, 30))).toEqual(on(2026, 5, 1));
    expect(nextDay(on(2026, 12, 31))).toEqual(on(2027, 1, 1));
  });
});

describe("the words of What to play and of the time settings", () => {
  const seasons = loaded(SCHEDULE);
  const play = (fields: Partial<PlayStatus>): PlayStatus => ({
    mode: "auto",
    source: "fallback",
    schedule: "default",
    reason: "schedule",
    entry: null,
    playlists: ["default"],
    playing: "default",
    serverChoice: null,
    ...fields,
  });
  const names = (...ids: Array<[string, string | null]>) => new Map<string, string | null>(ids);

  it("say what the board plays and why", () => {
    expect(describePlay(play({ entry: 1, playlists: ["christmas"], playing: "christmas" }), seasons)).toBe(
      "Christmas is on: the board plays christmas.",
    );
    expect(describePlay(play({ reason: "fallback" }), seasons)).toBe(
      "No entry of the schedule is on today: the board plays the fallback, default.",
    );
    expect(describePlay(play({ reason: "fallback", entry: 0 }), seasons)).toBe(
      "Halloween is on, but none of its playlists can play: the board plays the fallback, default.",
    );
    expect(describePlay(play({ reason: "no_time", playlists: ["a", "b"], playing: null }), seasons)).toBe(
      "The board does not know the date yet: it plays the fallback, a and b. None of them can play, so it plays every animation.",
    );
    expect(describePlay(play({ reason: "no_schedule" }), null)).toBe(
      "The board stores no valid schedule default: it plays the playlist default.",
    );
  });

  describe("the Automatic explanation comes from status.play", () => {
    const stored = { schedules: names(["seasons", "Seasons"]), playlists: names(["a", "Alpha"], ["b", null]) };

    it("says the site's schedule is followed", () => {
      const status = play({
        source: "server",
        schedule: "seasons",
        playlists: ["christmas"],
        serverChoice: { schedule: "seasons" },
      });
      expect(describeAutomatic(status, stored)).toBe("The site plays the schedule Seasons.");
    });

    it("says the site's playlists are followed", () => {
      const status = (list: string[]) =>
        play({
          source: "server",
          schedule: null,
          reason: "playlists",
          playlists: list,
          serverChoice: { playlists: list },
        });
      expect(describeAutomatic(status(["a", "b"]), stored)).toBe("The site plays the playlists Alpha and b.");
      expect(describeAutomatic(status(["a"]), stored)).toBe("The site plays the playlist Alpha.");
    });

    it("says the site's choice cannot be followed, and what the board plays instead", () => {
      // The file of the schedule or of every playlist can be stored and still not play: only the status knows.
      const ghost = play({
        source: "fallback",
        schedule: null,
        reason: "no_schedule",
        serverChoice: { schedule: "ghost" },
      });
      expect(describeAutomatic(ghost, stored)).toBe(
        "The site chose the schedule ghost, which the board cannot follow, so it plays the playlist default.",
      );
      const seasons = play({ source: "fallback", serverChoice: { schedule: "seasons" } });
      expect(describeAutomatic(seasons, stored)).toBe(
        "The site chose the schedule Seasons, which the board cannot follow, so it plays the schedule default.",
      );
      const listed = play({
        source: "fallback",
        schedule: null,
        reason: "no_schedule",
        serverChoice: { playlists: ["x", "y"] },
      });
      expect(describeAutomatic(listed, stored)).toBe(
        "The site chose the playlists x and y, which the board cannot follow, so it plays the playlist default.",
      );
    });

    it("says the site has not chosen, and what the board plays", () => {
      expect(describeAutomatic(play({}), stored)).toBe(
        "The site has not chosen what to play, so the board plays the schedule default.",
      );
      expect(describeAutomatic(play({ schedule: null, reason: "no_schedule" }), stored)).toBe(
        "The site has not chosen what to play, so the board plays the playlist default.",
      );
    });

    it("names only the site's choice while My choice is in force", () => {
      const mine = play({
        mode: "playlists",
        source: "playlists",
        schedule: null,
        serverChoice: { schedule: "seasons" },
      });
      expect(describeAutomatic(mine, stored)).toBe("The site chose the schedule Seasons for Automatic.");
      expect(describeAutomatic({ ...mine, serverChoice: null }, stored)).toBe(
        "The site has not chosen what to play, so Automatic plays the board's own rule: the schedule default, else the playlist default.",
      );
    });
  });

  it("find the schedule the Automatic card shows", () => {
    const stored = new Set(["default", "seasons"]);
    expect(automaticSchedule({ schedule: "seasons" }, stored, null)).toBe("seasons");
    expect(automaticSchedule({ schedule: "ghost" }, stored, null)).toBe("default");
    expect(automaticSchedule(null, stored, null)).toBe("default");
    expect(automaticSchedule(null, new Set(["seasons"]), null)).toBeNull();
    expect(automaticSchedule({ playlists: ["a"] }, stored, null)).toBeNull();
    // While Automatic plays, the board's own word wins.
    expect(automaticSchedule({ schedule: "seasons" }, stored, play({ schedule: "default" }))).toBe("default");
    expect(automaticSchedule(null, stored, play({ schedule: null }))).toBeNull();
    expect(automaticSchedule(null, stored, play({ mode: "playlists", schedule: null }))).toBe("default");
  });

  it("say what deleting the schedule the board plays from does", () => {
    const left = new Set<string>();
    expect(describeScheduleDeletion(play({ source: "fallback" }), left)).toBe(
      "Automatic plays this schedule: the board will then play the playlist default.",
    );
    expect(describeScheduleDeletion(play({ source: "server", schedule: "seasons" }), new Set(["default"]))).toBe(
      "The site chose this schedule for Automatic: the board will then play the schedule default.",
    );
    expect(describeScheduleDeletion(play({ mode: "schedule", source: "schedule", schedule: "mine" }), left)).toBe(
      "My choice plays this schedule: the board will then play the playlist default.",
    );
  });

  it("say what plays today by the stored schedule", () => {
    expect(describeToday(seasons, 1)).toBe("Christmas plays today: christmas.");
    expect(describeToday(seasons, -1)).toBe("The fallback plays today: default.");
    const unnamed = loaded(
      JSON.stringify({
        format: "pixelart-schedule/1",
        fallback: ["a", "b"],
        entries: [{ from: { month: 6 }, to: { month: 6 }, playlists: ["c", "d", "e"] }],
      }),
    );
    expect(describeToday(unnamed, 0)).toBe("entry 1 plays today: c, d and e.");
    expect(describeToday(unnamed, -1)).toBe("The fallback plays today: a and b.");
  });

  it("write the ends of every part set", () => {
    expect(describeEnd({ year: 2026, month: 12, day: 24 })).toBe("December 24, 2026");
    expect(describeEnd({ month: 12, day: 1 })).toBe("December 1");
    expect(describeEnd({ year: 2026, month: 11 })).toBe("November 2026");
    expect(describeEnd({ day: 28 })).toBe("day 28");
    expect(describeEnd({ month: 2 })).toBe("February");
    expect(describeEnd({ year: 2027 })).toBe("2027");
    expect(playlistList(["a", "b", "c"])).toBe("a, b and c");
  });

  it("check a time server as the board does", () => {
    for (const ok of ["pool.ntp.org", "192.168.1.1", "a", "x".repeat(64), "time-1.example.org"])
      expect(ntpServerProblem(ok), ok).toBeNull();
    for (const bad of ["", "x".repeat(65), "time server", "time_server", "ntp.example.org:123", "zé.org"])
      expect(ntpServerProblem(bad), bad).not.toBeNull();
  });

  it("take time sync hours from 1 to 168 as whole numbers", () => {
    expect(parseSyncHours("1")).toBe(1);
    expect(parseSyncHours(" 168 ")).toBe(168);
    for (const bad of ["0", "169", "", "x", "1.5", "-1"]) expect(parseSyncHours(bad), bad).toBeNull();
  });

  it("send only stored playlists, never an empty list or more than 8", () => {
    const stored = new Set(["a", "b"]);
    expect(listToSend(["ghost", "b", "a"], stored)).toEqual(["b", "a"]);
    expect(listToSend(["ghost"], stored)).toBeNull();
    expect(
      listToSend(
        Array.from({ length: 9 }, (_, i) => `p${i}`),
        new Set(Array.from({ length: 9 }, (_, i) => `p${i}`)),
      ),
    ).toBeNull();
  });

  it("say why My playlists cannot be reordered, or a playlist removed or added", () => {
    const stored = new Set(["a", "b", "c"]);
    const reading = "Reading the playlists on the board.";
    expect(editReason(["a", "b"], null)).toBe(reading);
    expect(editReason(["a", "ghost"], stored)).toBe("");
    expect(editReason(["ghost"], stored)).toBe(
      "Add a stored playlist first: the board takes only playlists it stores.",
    );

    expect(removeReason(["a"], "a", null)).toBe("The list keeps at least one playlist.");
    expect(removeReason(["a", "b"], "a", null)).toBe(reading);
    expect(removeReason(["a", "b"], "a", stored)).toBe("");
    expect(removeReason(["a", "ghost"], "a", stored)).toBe("The list keeps at least one stored playlist.");

    expect(addReason(["a"], null)).toBe(reading);
    expect(addReason(["a"], stored)).toBe("");
    expect(addReason(["a", "b", "c"], stored)).toBe("Every stored playlist is in the list.");
    const eight = Array.from({ length: 8 }, (_, i) => `p${i}`);
    expect(addReason(eight, new Set([...eight, "z"]))).toBe("The list holds at most 8 playlists.");
  });

  it("find the zone of a board's time zone, preferring the browser's", () => {
    expect(zoneOfSetting("CET-1CEST,M3.5.0,M10.5.0/3", "Europe/Rome")).toBe("Europe/Rome");
    expect(zoneOfSetting("CET-1CEST,M3.5.0,M10.5.0/3", "Asia/Tokyo")).toBe("Europe/Madrid");
    expect(zoneOfSetting("UTC0", null)).toBe("UTC");
    expect(zoneOfSetting("XYZ5", "Europe/Rome")).toBeNull();
    expect(zoneOfSetting(undefined, "Europe/Rome")).toBeNull();
  });

  it("read today's date in a zone", () => {
    const now = new Date("2026-12-31T23:30:00Z");
    expect(localDateIn("UTC", now)).toEqual({ year: 2026, month: 12, day: 31 });
    expect(localDateIn("Europe/Rome", now)).toEqual({ year: 2027, month: 1, day: 1 });
    expect(localDateIn("America/New_York", now)).toEqual({ year: 2026, month: 12, day: 31 });
  });
});

describe("the schedule the site publishes for a board that stores none", () => {
  it("is the one the site's play file names", () => {
    expect(siteScheduleId({ schedule: "seasons" })).toBe("seasons");
  });

  it("is none when the site chose playlists, even if it publishes a schedule default", () => {
    expect(siteScheduleId({ playlists: ["quiet"] })).toBeNull();
  });

  it("is default without a play file, or with one that cannot be read", () => {
    expect(siteScheduleId(null)).toBe("default");
  });
});
