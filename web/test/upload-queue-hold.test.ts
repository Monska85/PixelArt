// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-3.0-or-later

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { BoardClient } from "../src/protocol";
import type { QueueOutcome } from "../src/ui/queue/summary";
import { useUploadQueue, type UploadQueue } from "../src/ui/queue/useUploadQueue";

const client = {} as BoardClient;
const hook = { client, onProblem: () => {}, onFinished: () => {} };

describe("the upload queue while the ID question is open", () => {
  let root: Root | null = null;

  beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    globalThis.ResizeObserver ??= class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  });

  afterEach(async () => {
    await act(async () => root?.unmount());
    root = null;
    document.body.replaceChildren();
  });

  it("refuses a second entry point as busy until the question is answered, then frees the queue", async () => {
    // Two views of the app, each with its own queue hook: the editor and, for instance, the Board view.
    let editor: UploadQueue | null = null;
    let other: UploadQueue | null = null;
    const Both = (): ReactNode => {
      editor = useUploadQueue(hook);
      other = useUploadQueue(hook);
      return createElement("div", null, editor.dialogs);
    };
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root?.render(createElement(Both)));

    // The editor asks for an ID before it has a file: the answer ends the upload, as a cancelled question does.
    let editorOutcome: Promise<QueueOutcome | null> | null = null;
    await act(async () => {
      editorOutcome = (editor as unknown as UploadQueue).uploadAfter(async () => {
        await (editor as unknown as UploadQueue).askId("The ID is the file name of the animation", "ball");
        return null;
      });
    });
    expect(document.body.textContent).toContain("Choose an ID");
    expect((editor as unknown as UploadQueue).busy).toBe(true);

    let refused: QueueOutcome | null = null;
    await act(async () => {
      refused = await (other as unknown as UploadQueue).uploadPrepared([], { quiet: true });
    });
    expect(refused).toMatchObject({ status: "refused", refusal: { reason: "busy" } });
    // The refused call did not close the question.
    expect(document.body.textContent).toContain("Choose an ID");

    const cancel = [...document.body.querySelectorAll("button")].find((b) => b.textContent === "Cancel");
    if (!cancel) throw new Error("no Cancel button");
    await act(async () => {
      cancel.click();
      await editorOutcome;
    });
    expect(await editorOutcome).toBeNull();
    expect((editor as unknown as UploadQueue).busy).toBe(false);
    expect((other as unknown as UploadQueue).busy).toBe(false);
  });
});
