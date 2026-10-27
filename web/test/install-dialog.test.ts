// SPDX-License-Identifier: GPL-3.0-or-later

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { SCRATCH_MANIFEST, finishedScratchInstall, watchInstallDialogs } from "../src/ui/firmware/installDialog";

const PACKAGE = fileURLToPath(new URL("../node_modules/esp-web-tools/", import.meta.url));
const read = (path: string): string => readFileSync(PACKAGE + path, "utf8");

const port = { open: async () => undefined, close: async () => undefined };
const dialog = (extra: Record<string, unknown> = {}) =>
  Object.assign(new EventTarget(), {
    localName: "ewt-install-dialog",
    port,
    manifestPath: SCRATCH_MANIFEST,
    _installState: { state: "finished" },
    ...extra,
  });

describe("the ESP Web Tools dialog the first-install follow-up reads", () => {
  // The follow-up reads private state of a pinned version. If one of these fails after an update of ESP Web Tools,
  // finishedScratchInstall and watchInstallDialogs in src/ui/firmware/installDialog.ts must follow the new code.
  it("is the pinned version", () => {
    const wanted = (
      JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
        dependencies: Record<string, string>;
      }
    ).dependencies["esp-web-tools"];
    expect(wanted).toBe("10.4.0");
    expect((JSON.parse(read("package.json")) as { version: string }).version).toBe(wanted);
  });

  it("keeps the flashing state in _installState, which becomes finished when the flashing is done", () => {
    const source = read("dist/install-dialog.js");
    expect(source).toMatch(/flash\(\(state\) => \{\s*this\._installState = state;\s*if \(state\.state === "finished"/);
    expect(source).toMatch(/customElements\.define\("ewt-install-dialog"/);
  });

  it("is told its state by the flasher with the same word", () => {
    expect(read("dist/flash.js")).toMatch(/state: "finished" \/\* FlashStateType\.FINISHED \*\//);
  });

  it("gets its port and manifest from connect, and fires closed, bubbling and composed, when it closes", () => {
    const connect = read("dist/connect.js");
    expect(connect).toMatch(/document\.createElement\("ewt-install-dialog"\)/);
    expect(connect).toMatch(/el\.port = port;/);
    expect(connect).toMatch(/el\.manifestPath = button\.manifest \|\| button\.getAttribute\("manifest"\);/);
    expect(connect).toMatch(/addEventListener\("closed"/);
    expect(read("dist/install-dialog.js")).toMatch(/fireEvent\(this, "closed"\)/);
    expect(read("dist/util/fire-event.js")).toMatch(/bubbles: options\.bubbles === undefined \? true/);
    expect(read("dist/util/fire-event.js")).toMatch(/composed: options\.composed === undefined \? true/);
  });
});

describe("finishedScratchInstall", () => {
  it("gives the port of a dialog of Install from scratch whose installation finished", () => {
    expect(finishedScratchInstall(dialog())).toBe(port);
  });

  it("gives nothing before, during or after a failed installation", () => {
    expect(finishedScratchInstall(dialog({ _installState: undefined }))).toBeNull();
    expect(finishedScratchInstall(dialog({ _installState: { state: "writing" } }))).toBeNull();
    expect(finishedScratchInstall(dialog({ _installState: { state: "error" } }))).toBeNull();
  });

  it("gives nothing for Update firmware, another element, or a dialog without a port", () => {
    expect(finishedScratchInstall(dialog({ manifestPath: "./firmware/update.json" }))).toBeNull();
    expect(finishedScratchInstall(dialog({ localName: "div" }))).toBeNull();
    expect(finishedScratchInstall(dialog({ port: undefined }))).toBeNull();
    expect(finishedScratchInstall(dialog({ port: {} }))).toBeNull();
    expect(finishedScratchInstall(null)).toBeNull();
    expect(finishedScratchInstall("ewt-install-dialog")).toBeNull();
  });
});

describe("watchInstallDialogs", () => {
  it("reports the port when the dialog closes after a finished installation, and stops when asked", () => {
    const seen = vi.fn();
    const element = dialog();
    const stop = watchInstallDialogs(seen, element);
    element.dispatchEvent(new CustomEvent("closed"));
    expect(seen).toHaveBeenCalledExactlyOnceWith(port);
    stop();
    element.dispatchEvent(new CustomEvent("closed"));
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the installation did not finish", () => {
    const seen = vi.fn();
    const element = dialog({ _installState: { state: "error" } });
    watchInstallDialogs(seen, element);
    element.dispatchEvent(new CustomEvent("closed"));
    expect(seen).not.toHaveBeenCalled();
  });
});
