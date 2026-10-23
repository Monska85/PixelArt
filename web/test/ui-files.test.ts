import { describe, expect, it } from "vitest";
import { detectKind, idFromFileName, inspectFile, suggestId } from "../src/ui/files";
import { text } from "./helpers";

const animation =
  '{"format":"pixelart/1","name":"A","canvas":{"width":16,"height":16},"sprites":{"a":{"points":[[1,1,"#ff0000"]]}},"timeline":[{"show":["a"]}]}';

describe("picked files", () => {
  it("derives and suggests IDs", () => {
    expect(idFromFileName("Bad Name.YAML")).toBe("bad name");
    expect(suggestId("bad name")).toBe("bad_name");
    expect(suggestId("__x")).toBe("x");
  });

  it("detects the kind from the format", () => {
    expect(detectKind(new Map([["format", "pixelart-playlist/1"]]))).toEqual({ ok: true, kind: "playlist" });
    expect(detectKind(new Map([["format", null]]))).toMatchObject({
      ok: false,
      message: expect.stringContaining("not a text"),
    });
  });

  it("inspects a file without sending anything", async () => {
    expect(await inspectFile("a.json", text(animation))).toMatchObject({ ok: true, kind: "animation" });
    expect(await inspectFile("a.yaml", text("format: pixelart/1\nname: [")).then((r) => r.ok)).toBe(false);
    expect(await inspectFile("a.json", text('{"format":"x/1"}'))).toMatchObject({ ok: false, status: "refused" });
    expect(await inspectFile("a.json", text('{"format":"pixelart/1"}'))).toMatchObject({
      ok: false,
      status: "rejected",
      kind: "animation",
    });
    expect(await inspectFile("a.json", text("{"))).toMatchObject({ ok: false, status: "refused" });
  });
});
