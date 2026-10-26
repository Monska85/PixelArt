// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { documentFromModel, modelFromBytes } from "../src/ui/board/playlistModel";
import { jsonBytes } from "../src/yaml/writeJson";
import { text } from "./helpers";

const stored = text(
  JSON.stringify({
    format: "pixelart-playlist/1",
    name: "Mine",
    canvas: { width: 16, height: 16 },
    items: [
      { animation: "a", repeat: 1, enabled: true },
      { animation: "b", repeat: 3, enabled: false },
      { animation: "c" },
    ],
  }),
);

const written = (model: ReturnType<typeof modelFromBytes>): unknown => {
  if (typeof model === "string") throw new Error(model);
  return JSON.parse(new TextDecoder().decode(jsonBytes(documentFromModel(model))));
};

describe("playlist document from the editor model", () => {
  it("keeps the original fields and writes repeat and enabled only when they differ from the defaults", () => {
    expect(written(modelFromBytes("mine", stored))).toEqual({
      format: "pixelart-playlist/1",
      name: "Mine",
      canvas: { width: 16, height: 16 },
      items: [{ animation: "a" }, { animation: "b", repeat: 3, enabled: false }, { animation: "c" }],
    });
  });

  it("writes the changes made in the editor over the original", () => {
    const model = modelFromBytes("mine", stored);
    if (typeof model === "string") throw new Error(model);
    model.name = "";
    model.items[0]!.repeat = 2;
    model.items[1]!.enabled = true;
    model.items[1]!.repeat = 1;
    expect(written(model)).toEqual({
      format: "pixelart-playlist/1",
      canvas: { width: 16, height: 16 },
      items: [{ animation: "a", repeat: 2 }, { animation: "b" }, { animation: "c" }],
    });
  });
});
