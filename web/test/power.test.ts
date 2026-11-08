// SPDX-License-Identifier: GPL-3.0-or-later

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BoardClient, BoardError, parsePower, parseStatus, powerReset } from "../src/protocol";
import { readmeSection, REPOSITORY_URL } from "../src/ui/privacy";
import {
  POWER_DIMMING_TEXT,
  POWER_FLOOR_TEXT,
  POWER_RESET_CONFIRM,
  POWER_RESET_EXPLANATION,
  POWER_RESET_TITLE,
  restartSentence,
  scaleSentence,
  shownPower,
} from "../src/ui/board/power";
import { FakeBoard } from "./fakeBoard";
import { REPO, caseFiles } from "./helpers";

const valid = {
  brownouts: 3,
  limit_active: true,
  limit_ma: 1200,
  at_floor: false,
  scale: 60,
  last_brownout: { animation: "bear", frame: 2, date: "2026-11-08" },
  resets: ["power_on", "brownout", "brownout", "brownout"],
};

const parsed = {
  brownouts: 3,
  limitActive: true,
  limitMa: 1200,
  atFloor: false,
  scale: 60,
  lastBrownout: { animation: "bear", frame: 2, date: "2026-11-08" },
  resets: ["power_on", "brownout", "brownout", "brownout"],
};

/** A copy of `valid` with the given fields changed; `undefined` removes a field. */
function powerWith(changes: Record<string, unknown>): Record<string, unknown> {
  const object: Record<string, unknown> = { ...valid };
  for (const [field, value] of Object.entries(changes)) {
    if (value === undefined) delete object[field];
    else object[field] = value;
  }
  return object;
}

const off = { brownouts: 0, limit_active: false, limit_ma: null, at_floor: false, scale: 100, last_brownout: null };

describe("status.power", () => {
  it("is null when the board does not report it", () => {
    expect(parseStatus({}).power).toBeNull();
    expect(parseStatus({ power: null }).power).toBeNull();
    expect(parseStatus({ power: "on" }).power).toBeNull();
  });

  it("reads a full object through parseStatus", () => {
    expect(parseStatus({ power: valid }).power).toEqual(parsed);
  });

  it("reads a board with the limit off", () => {
    expect(parsePower({ ...valid, ...off, resets: [] })).toEqual({
      ...parsed,
      brownouts: 0,
      limitActive: false,
      limitMa: null,
      scale: 100,
      lastBrownout: null,
      resets: [],
    });
  });

  it("reads the object of the specification's power_reset reply", () => {
    expect(
      parsePower({
        brownouts: 0,
        limit_active: false,
        limit_ma: null,
        at_floor: false,
        scale: 100,
        last_brownout: null,
        resets: [],
      }),
    ).toMatchObject({ brownouts: 0, limitActive: false, limitMa: null, atFloor: false, scale: 100, resets: [] });
  });

  it("refuses an object that is not a record", () => {
    for (const value of [undefined, null, 3, "x", true, [], [valid]])
      expect(parsePower(value), String(value)).toBeNull();
  });

  it("refuses a known field that is missing or malformed", () => {
    const bad: Record<string, unknown[]> = {
      brownouts: [undefined, "3", -1, 11, 1.5, Number.NaN, Infinity, 2 ** 53, null],
      limit_active: [undefined, "true", 1, null],
      limit_ma: [undefined, "1200", 12.5, Number.NaN, -5, 0, 299],
      at_floor: [undefined, "false", 0, null],
      scale: [undefined, "60", 0, -1, 101, 60.5, Number.NaN, null],
      last_brownout: [undefined, "x", 3, [], true],
      resets: [undefined, null, "brownout", 3, {}],
    };
    for (const [field, values] of Object.entries(bad))
      for (const value of values)
        expect(parsePower(powerWith({ [field]: value })), `${field}=${String(value)}`).toBeNull();
  });

  it("accepts the edges of the ranges", () => {
    expect(parsePower(powerWith({ brownouts: 0 }))?.brownouts).toBe(0);
    expect(parsePower(powerWith({ brownouts: 10 }))?.brownouts).toBe(10);
    expect(parsePower(powerWith({ scale: 1 }))?.scale).toBe(1);
    expect(parsePower(powerWith({ scale: 100 }))?.scale).toBe(100);
    expect(parsePower(powerWith({ limit_ma: 300, at_floor: true }))).toMatchObject({ limitMa: 300, atFloor: true });
  });

  it("ties limit_ma and at_floor to limit_active", () => {
    expect(parsePower(powerWith({ limit_ma: null }))).toBeNull();
    expect(parsePower(powerWith({ limit_active: false, limit_ma: 1200 }))).toBeNull();
    expect(parsePower(powerWith({ limit_active: false, limit_ma: null }))).toMatchObject({ limitMa: null });
    expect(parsePower(powerWith({ limit_active: false, limit_ma: null, at_floor: true }))).toBeNull();
    expect(parsePower(powerWith({ limit_active: false, limit_ma: null, at_floor: false }))).not.toBeNull();
  });

  it("reads at_floor as true exactly when the limit is on at the floor", () => {
    expect(parsePower(powerWith({ limit_ma: 1200, at_floor: true }))).toBeNull();
    expect(parsePower(powerWith({ limit_ma: 301, at_floor: true }))).toBeNull();
    expect(parsePower(powerWith({ limit_ma: 300, at_floor: false }))).toBeNull();
  });

  it("reads last_brownout as null or an object whose members are both known or both null", () => {
    expect(parsePower(powerWith({ last_brownout: null }))?.lastBrownout).toBeNull();
    expect(parsePower(powerWith({ last_brownout: { animation: "bear", frame: 0, date: null } }))?.lastBrownout).toEqual(
      {
        animation: "bear",
        frame: 0,
        date: null,
      },
    );
    expect(
      parsePower(powerWith({ last_brownout: { animation: null, frame: null, date: null } }))?.lastBrownout,
    ).toEqual({ animation: null, frame: null, date: null });
    for (const value of [
      {},
      { animation: "bear", frame: null, date: null },
      { animation: null, frame: 2, date: null },
      { animation: "bear", frame: -1, date: null },
      { animation: "bear", frame: 1.5, date: null },
      { animation: 7, frame: 2, date: null },
      { animation: "bear", frame: "2", date: null },
      { animation: "bear", frame: 2 },
      { animation: "bear", date: null },
      { frame: 2, date: null },
    ])
      expect(parsePower(powerWith({ last_brownout: value })), JSON.stringify(value)).toBeNull();
  });

  it("accepts real calendar dates and refuses the rest", () => {
    const withDate = (date: unknown) =>
      parsePower(powerWith({ last_brownout: { animation: null, frame: null, date } }));
    for (const date of ["2026-11-08", "2024-02-29", "2000-01-01", "2026-12-31"])
      expect(withDate(date)?.lastBrownout?.date, date).toBe(date);
    for (const date of [
      "2026-02-30",
      "2026-02-29",
      "2026-13-01",
      "2026-00-10",
      "2026-04-31",
      "2026-01-00",
      "2026-1-5",
      "20261108",
      "2026-11-08T10:00",
      " 2026-11-08",
      "08-11-2026",
      "x",
      "",
      20261108,
    ])
      expect(withDate(date), String(date)).toBeNull();
  });

  it("takes at most 10 reset reasons, all strings", () => {
    const ten = Array.from({ length: 10 }, () => "brownout");
    expect(parsePower(powerWith({ brownouts: 10, resets: ten }))?.resets).toEqual(ten);
    expect(parsePower(powerWith({ brownouts: 10, resets: [...ten, "brownout"] }))).toBeNull();
    expect(parsePower(powerWith({ resets: [] }))?.resets).toEqual([]);
    for (const entry of [4, null, {}, ["brownout"], undefined])
      expect(parsePower(powerWith({ resets: ["brownout", entry] })), String(entry)).toBeNull();
  });

  it("reads a reset reason it does not know as other, and keeps the object", () => {
    expect(
      parsePower(
        powerWith({
          resets: ["brownout", "power_on", "software", "panic", "watchdog", "deep_sleep", "other", "usb_attached", ""],
        }),
      )?.resets,
    ).toEqual(["brownout", "power_on", "software", "panic", "watchdog", "deep_sleep", "other", "other", "other"]);
  });

  it("ignores unknown fields at both levels", () => {
    expect(
      parsePower({
        ...valid,
        later: { x: 1 },
        last_brownout: { ...valid.last_brownout, estimate_ma: 2400, kind: "later" },
      }),
    ).toEqual(parsed);
  });
});

describe("powerReset", () => {
  async function connected(board: FakeBoard): Promise<BoardClient> {
    const client = new BoardClient(board);
    await client.handshake();
    return client;
  }

  it("sends power_reset with no fields and returns the cleared object", async () => {
    const board = new FakeBoard();
    const sent: Array<Record<string, unknown>> = [];
    board.override = (r) => {
      if (r.cmd !== "power_reset") return undefined;
      sent.push(r);
      return {
        ok: true,
        power: {
          ...valid,
          ...off,
          resets: [],
        },
      };
    };
    const result = await powerReset(await connected(board));
    expect(Object.keys(sent[0] ?? {}).sort()).toEqual(["cmd", "seq"]);
    expect(result).toMatchObject({ brownouts: 0, limitActive: false, limitMa: null, scale: 100, lastBrownout: null });
  });

  it("throws protocol when the reply holds no readable power object", async () => {
    const board = new FakeBoard();
    const client = await connected(board);
    for (const reply of [
      { ok: true },
      { ok: true, power: null },
      { ok: true, power: "off" },
      { ok: true, power: { ...valid, scale: 101 } },
      { ok: true, power: { ...valid, brownouts: "3" } },
      { ok: true, power: powerWith({ resets: undefined }) },
      { ok: true, power: powerWith({ limit_ma: null }) },
    ]) {
      board.override = (r) => (r.cmd === "power_reset" ? reply : undefined);
      await expect(powerReset(client)).rejects.toMatchObject({ code: "protocol" });
    }
  });

  it("throws protocol when the power object is readable but not cleared", async () => {
    const board = new FakeBoard();
    const client = await connected(board);
    const cleared = { ...off, resets: [] };
    for (const power of [
      valid,
      { ...cleared, brownouts: 1 },
      { ...cleared, scale: 60 },
      { ...cleared, last_brownout: { animation: null, frame: null, date: null } },
      { ...cleared, resets: ["power_on"] },
    ]) {
      board.override = (r) => (r.cmd === "power_reset" ? { ok: true, power } : undefined);
      await expect(powerReset(client), JSON.stringify(power)).rejects.toMatchObject({ code: "protocol" });
    }
  });

  it("propagates the board's error, unknown_command from a board without the feature", async () => {
    const board = new FakeBoard();
    const client = await connected(board);
    await expect(powerReset(client)).rejects.toMatchObject({ code: "unknown_command" });
    await expect(powerReset(client)).rejects.toBeInstanceOf(BoardError);
  });
});

describe("readmeSection", () => {
  it("points a release build at the text of its tag", () => {
    expect(readmeSection("power-supply-improvement", "1.4.0")).toBe(
      `${REPOSITORY_URL}/blob/web-v1.4.0/README.md#power-supply-improvement`,
    );
  });

  it("points any other build at main", () => {
    for (const version of ["0.0.0", "1.4.0-dev", "dev", ""])
      expect(readmeSection("power-supply-improvement", version), version).toBe(
        `${REPOSITORY_URL}/blob/main/README.md#power-supply-improvement`,
      );
  });
});

describe("the words of the power note", () => {
  it("counts the restarts: none omits the count, one is once, more are times", () => {
    expect(restartSentence(0)).toBe("The board restarted because its power supply could not deliver enough current.");
    expect(restartSentence(1)).toBe(
      "The board restarted once because its power supply could not deliver enough current.",
    );
    expect(restartSentence(2)).toBe(
      "The board restarted 2 times because its power supply could not deliver enough current.",
    );
    expect(restartSentence(3)).toBe(
      "The board restarted 3 times because its power supply could not deliver enough current.",
    );
  });

  it("says the percentage, or that the animation is not dimmed at 100", () => {
    expect(scaleSentence(60)).toBe("Playing now at 60%.");
    expect(scaleSentence(99)).toBe("Playing now at 99%.");
    expect(scaleSentence(100)).toBe("The animation playing now is not dimmed.");
  });

  it("keeps the approved dimming sentence", () => {
    expect(POWER_DIMMING_TEXT).toBe(
      "Bright animations now play dimmer so the board stops restarting; other animations are unchanged.",
    );
  });

  it("keeps the approved texts of the explanation, the dialog and the lowest level", () => {
    expect(POWER_RESET_EXPLANATION).toBe(
      "Use this only after you changed the power hardware: a stronger 5 V supply, a separate supply for the LED matrix, a shorter or thicker cable, or a capacitor on the matrix power. The board forgets its past restarts and plays every animation at full brightness again. Changing the brightness, WiFi or playlists is not a reason to press it. If the supply is still too weak, the board will restart again during bright animations, and after 3 restarts the protection turns back on.",
    );
    expect(POWER_RESET_TITLE).toBe("Turn power protection off?");
    expect(POWER_RESET_CONFIRM).toBe(
      "The board forgets its past restarts and plays every animation at full brightness again. If the supply is still too weak, the protection turns back on after 3 more restarts.",
    );
    expect(POWER_FLOOR_TEXT).toBe("Your power supply is not adequate even at the lowest level.");
  });
});

describe("shownPower", () => {
  it("shows the object while the limit is on, with or without a count", () => {
    const power = parsePower(valid);
    expect(shownPower(power)).toBe(power);
    const noCount = parsePower(powerWith({ brownouts: 0 }));
    expect(shownPower(noCount)).toBe(noCount);
  });

  it("hides the card for no object or a limit that is off", () => {
    expect(shownPower(null)).toBeNull();
    expect(shownPower(parsePower({ ...valid, ...off, resets: [] }))).toBeNull();
  });
});

type Reply = Record<string, unknown> & { power?: Record<string, unknown> };

/** Every expected reply of the protocol cases that holds a full `power` object, with the name of its case. */
function conformancePowerReplies(): Array<{ name: string; reply: Reply }> {
  const found: Array<{ name: string; reply: Reply }> = [];
  for (const file of caseFiles(`${REPO}conformance/protocol`)) {
    const steps: Array<{ expect?: Reply }> = JSON.parse(readFileSync(file, "utf8")).steps ?? [];
    steps.forEach((step, index) => {
      const reply = step.expect;
      const power = reply?.power;
      if (reply?.ok !== true || typeof power !== "object" || power === null) return;
      // A wildcard is not a value the reader can check, so a reply whose power holds one is skipped.
      if (JSON.stringify(power).includes("<any>")) return;
      found.push({ name: `${file.slice(file.lastIndexOf("/") + 1)} step ${index}`, reply });
    });
  }
  return found;
}

const camel = (power: Record<string, unknown>) => ({
  brownouts: power.brownouts,
  limitActive: power.limit_active,
  limitMa: power.limit_ma,
  atFloor: power.at_floor,
  scale: power.scale,
  lastBrownout: power.last_brownout,
  resets: power.resets,
});

describe("the power objects of the conformance cases", () => {
  const replies = conformancePowerReplies();

  it("has cases", () => expect(replies.length).toBeGreaterThan(0));

  it("are all read, field by field", () => {
    for (const { name, reply } of replies) {
      expect(parsePower(reply.power!), name).toEqual(camel(reply.power!));
    }
  });

  it("come back from powerReset when they are the reply of power_reset", async () => {
    // A power_reset reply has no wifi, time, play or update, which every status reply has.
    const resetReplies = replies.filter(({ reply }) => reply.wifi === undefined);
    expect(resetReplies.length).toBeGreaterThan(0);
    for (const { name, reply } of resetReplies) {
      const board = new FakeBoard();
      const client = new BoardClient(board);
      await client.handshake();
      board.override = (r) => (r.cmd === "power_reset" ? { ok: true, power: reply.power! } : undefined);
      expect(await powerReset(client), name).toEqual(camel(reply.power!));
    }
  });
});

describe("the status rows of conformance/power.json", () => {
  const rows: Array<{ name: string; power: unknown; valid: boolean }> = JSON.parse(
    readFileSync(`${REPO}conformance/power.json`, "utf8"),
  ).status;

  it("has rows", () => expect(rows.length).toBeGreaterThan(0));

  it.each(rows.map((row) => [row.name, row] as const))("%s", (_name, row) => {
    expect(parsePower(row.power) !== null).toBe(row.valid);
  });
});
