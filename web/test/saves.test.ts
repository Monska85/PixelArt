// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { newAnimation, setTopField, type Doc } from "../src/editor/doc";
import {
  deriveSaveState,
  hasCurrentCopy,
  withCopy,
  NO_SAVES,
  type BoardFiles,
  type SavedCopy,
} from "../src/editor/saves";
import { initialState, reduce } from "../src/editor/state";
import { summaryReport } from "../src/ui/queue/summary";
import type { QueueFile, QueueSummary } from "../src/queue/plan";
import { writeJson } from "../src/yaml/writeJson";

const named = (name: string): Doc => setTopField(newAnimation(), "name", name);
// 08:42 UTC; the header writes the local clock, so the tests build the expected text the same way.
const AT = Date.UTC(2026, 0, 15, 8, 42);
const clock = (at: number): string =>
  new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
const copy = (kind: SavedCopy["kind"], name: string, doc: Doc, at = AT, sha256?: string): SavedCopy => ({
  kind,
  name,
  at,
  json: writeJson(doc),
  ...(sha256 && { sha256 }),
});
const json = (doc: Doc): string => writeJson(doc);
const known = (
  entries: Array<{ id: string; sha256: string | null }>,
  staleSince: number | null = null,
): BoardFiles => ({
  entries,
  staleSince,
});

describe("the save state", () => {
  const doc = named("Ball");

  it("is a draft in this browser only while nothing was uploaded or downloaded", () => {
    const state = deriveSaveState(NO_SAVES, json(doc), null);
    expect(state).toMatchObject({ kind: "draft", text: "Draft in this browser only", warning: true });
  });

  it("names the board copy and its time after an upload, or after Edit on the board", () => {
    const saves = withCopy(NO_SAVES, copy("board", "ball", doc));
    expect(deriveSaveState(saves, json(doc), null)).toMatchObject({
      kind: "board",
      text: `Saved to board as ball at ${clock(AT)}`,
      warning: false,
    });
  });

  it("names the downloaded file, and the file the document came from", () => {
    expect(deriveSaveState(withCopy(NO_SAVES, copy("download", "ball.yaml", doc)), json(doc), null).text).toBe(
      `Downloaded as ball.yaml at ${clock(AT)}`,
    );
    expect(deriveSaveState(withCopy(NO_SAVES, copy("file", "mine.yaml", doc)), json(doc), null).text).toBe(
      "Same as mine.yaml",
    );
  });

  it("says what changed since the last copy, in the warning color", () => {
    const saved = withCopy(NO_SAVES, copy("board", "ball", doc));
    const changed = deriveSaveState(saved, json(named("Other")), null);
    expect(changed).toMatchObject({ kind: "changed", warning: true });
    expect(changed.text).toBe(`Changed since: saved to board as ball at ${clock(AT)}`);
    const fromFile = deriveSaveState(withCopy(NO_SAVES, copy("file", "mine.yaml", doc)), json(named("Other")), null);
    expect(fromFile.text).toBe("Changed since: opened from mine.yaml");
  });

  it("compares by content: the saved version again is shown as saved", () => {
    const saved = withCopy(NO_SAVES, copy("board", "ball", doc));
    expect(deriveSaveState(saved, json(named("Other")), null).kind).toBe("changed");
    expect(deriveSaveState(saved, json(named("Ball")), null).kind).toBe("board");
  });

  it("shows the most recent of two current copies and lists both in the tooltip", () => {
    const saves = withCopy(
      withCopy(NO_SAVES, copy("board", "ball", doc, AT)),
      copy("download", "ball.yaml", doc, AT + 60_000),
    );
    const state = deriveSaveState(saves, json(doc), null);
    expect(state.kind).toBe("download");
    expect(state.details).toHaveLength(2);
  });

  it("shows the current copy when the other one is older", () => {
    const old = named("Old");
    const saves = withCopy(
      withCopy(NO_SAVES, copy("board", "ball", old, AT + 60_000)),
      copy("download", "ball.yaml", doc, AT),
    );
    const state = deriveSaveState(saves, json(doc), null);
    expect(state.kind).toBe("download");
    expect(state.details.join("\n")).toContain("(older version)");
  });

  describe("against the connected board", () => {
    const saves = withCopy(NO_SAVES, copy("board", "ball", doc, AT, "aa"));

    it("stays saved while the board has the file with that SHA-256", () => {
      expect(deriveSaveState(saves, json(doc), known([{ id: "ball", sha256: "aa" }])).kind).toBe("board");
    });

    it("says the board copy is not checked while the list is unknown, and a file copy still counts", () => {
      expect(deriveSaveState(saves, json(doc), "unknown")).toMatchObject({
        kind: "unchecked",
        text: "Board copy not checked",
        warning: true,
      });
      const both = withCopy(saves, copy("file", "ball.yaml", doc, AT + 1));
      expect(deriveSaveState(both, json(doc), "unknown").kind).toBe("file");
    });

    it("says Not on the connected board when the ID is missing or the SHA-256 differs", () => {
      for (const files of [[], [{ id: "ball", sha256: "bb" }], [{ id: "ball", sha256: null }]]) {
        expect(deriveSaveState(saves, json(doc), known(files))).toMatchObject({
          kind: "not-on-board",
          text: "Not on the connected board",
          warning: true,
        });
      }
    });

    it("trusts its own board save over a list that is being read again, and no other copy", () => {
      const reading = (staleSince: number) => known([{ id: "ball", sha256: "old" }], staleSince);
      expect(deriveSaveState(saves, json(doc), reading(AT - 1)).kind).toBe("board");
      expect(deriveSaveState(saves, json(doc), reading(AT)).kind).toBe("board");
      expect(deriveSaveState(saves, json(doc), reading(AT + 1)).kind).toBe("not-on-board");
      expect(deriveSaveState(saves, json(doc), known([{ id: "ball", sha256: "old" }])).kind).toBe("not-on-board");
    });

    it("counts a copy saved after the first of two overlapping reads began", () => {
      const reading = known([{ id: "ball", sha256: "old" }], AT - 1000);
      expect(deriveSaveState(saves, json(doc), reading).kind).toBe("board");
    });

    it("shows a current download instead, when the board copy is gone", () => {
      const both = withCopy(saves, copy("download", "ball.yaml", doc, AT - 1));
      expect(deriveSaveState(both, json(doc), known([])).kind).toBe("download");
    });

    it("is not judged by a board it cannot read", () => {
      expect(deriveSaveState(saves, json(doc), null).kind).toBe("board");
    });
  });
});

describe("the editor state and its copies", () => {
  const edit = (state: ReturnType<typeof initialState>, doc: Doc) => reduce(state, { type: "edit", doc });

  it("remembers a copy and clears the changed mark for the saved document only", () => {
    const first = edit(initialState(), named("One"));
    const saved = reduce(first, { type: "saved", doc: first.doc, copy: copy("board", "one", first.doc) });
    expect(saved.dirty).toBe(false);
    expect(saved.saves.board?.name).toBe("one");
  });

  it("is no longer changed after an undo back to the saved version, and changed again after a redo", () => {
    let state = edit(initialState(), named("One"));
    state = reduce(state, { type: "saved", doc: state.doc, copy: copy("download", "one.yaml", state.doc) });
    state = edit(state, named("Two"));
    expect(state.dirty).toBe(true);
    state = reduce(state, { type: "undo" });
    expect(state.dirty).toBe(false);
    state = reduce(state, { type: "redo" });
    expect(state.dirty).toBe(true);
  });

  it("stays changed after an undo when no copy has that content", () => {
    let state = edit(initialState(), named("One"));
    state = edit(state, named("Two"));
    expect(reduce(state, { type: "undo" }).dirty).toBe(true);
  });

  it("starts a loaded document with the copies it came with, and a new one with none", () => {
    const doc = named("Loaded");
    const saves = withCopy(NO_SAVES, copy("file", "mine.yaml", doc));
    const loaded = reduce(initialState(), { type: "load", doc, id: "loaded", source: "x", saves });
    expect(hasCurrentCopy(loaded.saves, json(doc))).toBe(true);
    expect(loaded.dirty).toBe(false);
    expect(reduce(loaded, { type: "load", doc, id: null, source: "y" }).saves).toEqual(NO_SAVES);
  });
});

describe("the summary of a queue", () => {
  const file = (kind: "animation" | "playlist", id: string): QueueFile => ({
    kind,
    id,
    bytes: new Uint8Array(200),
    sha256: "0".repeat(64),
    origin: `${id}.yaml`,
  });
  const empty: QueueSummary = { uploaded: [], skipped: [], failed: null, notAttempted: [], cancelled: false };

  it("keeps the short toast for one uploaded file", () => {
    const report = summaryReport(
      { ...empty, uploaded: [{ file: file("animation", "dot"), warnings: [] }] },
      "Uploaded",
    );
    expect(report.toast).toEqual({ title: "Uploaded animation dot", description: "200 B", tone: "success" });
    expect(report.detail).toBeNull();
  });

  it("counts several files and lists uploaded, skipped, failed and not attempted", () => {
    const report = summaryReport(
      {
        uploaded: [
          { file: file("animation", "a"), warnings: [] },
          { file: file("playlist", "p"), warnings: [] },
        ],
        skipped: [
          { file: file("animation", "same"), reason: "identical" },
          { file: file("animation", "kept"), reason: "kept" },
        ],
        failed: null,
        notAttempted: [],
        cancelled: false,
      },
      "Installed",
    );
    expect(report.toast.title).toBe("Installed 1 animation and 1 playlist");
    expect(report.toast.description).toBe("2 files skipped.");
    expect(report.detail?.lines).toEqual([
      "Installed: a, p",
      "Skipped, the board has the same file: same",
      "Skipped, the board's file was kept: kept",
    ]);
  });

  it("says where a failed queue stopped and what was not attempted", () => {
    const report = summaryReport(
      {
        ...empty,
        uploaded: [{ file: file("animation", "a"), warnings: [] }],
        failed: { file: file("animation", "b"), error: new Error("boom") },
        notAttempted: [file("playlist", "p")],
      },
      "Uploaded",
    );
    expect(report.toast).toMatchObject({ title: "Upload stopped at b", tone: "error" });
    expect(report.detail).toMatchObject({ failed: true });
    expect(report.detail?.lines).toEqual(["Uploaded: a", "Failed: b, boom", "Not attempted: p"]);
  });

  it("says nothing was sent when the board has everything", () => {
    const report = summaryReport(
      { ...empty, skipped: [{ file: file("animation", "a"), reason: "identical" }] },
      "Uploaded",
    );
    expect(report.toast).toMatchObject({ title: "Nothing to upload", tone: "info" });
  });

  it("reports the warnings of the files that went through, from the board first", () => {
    const warning = { severity: "warning", code: "unknown_animation", where: "", message: "x" };
    const report = summaryReport(
      { ...empty, uploaded: [{ file: { ...file("playlist", "p"), origin: "p.yaml" }, warnings: [warning] }] },
      "Uploaded",
    );
    expect(report.warnings).toEqual([["p.yaml", [warning]]]);
  });
});
