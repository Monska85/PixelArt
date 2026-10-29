// SPDX-License-Identifier: GPL-3.0-or-later

import { useState, type ReactNode } from "react";
import { isValidId } from "../../engine";
import { sha256Hex, supportsSchedules, type BoardClient } from "../../protocol";
import type { ListedKind } from "../fileLists";
import { type QueueFile, type QueueSummary } from "../../queue/plan";
import { runQueue, type Refusal } from "../../queue/run";
import { downloadPublished } from "../../release/library";
import { type Manifest, type Published, type PublishedKind } from "../../release/manifest";
import { useUploadDialogs } from "../common/UploadDialogs";
import { toast } from "../components/toast";
import { shownError, toShownError, type ShownError } from "../errors";
import { SUPPORTED_FILE, idFromFileName, inspectFile, readPicked, suggestId, validateFile } from "../files";
import { session } from "../session";
import { reserveUploadQueue, sendQueue, useUploadRunning, type QueueReservation } from "../upload";
import { refusalProblem, summaryReport, type QueueOutcome } from "./summary";

/** A schedule picked for a board whose firmware knows none. */
export const SCHEDULES_NEED_FIRMWARE =
  "This board's firmware does not know schedules, so the file was not uploaded. Update the firmware to use schedules.";

interface QueueOptions {
  /**
   * The published release to take missing animations from. `undefined` reads it when a playlist needs it, `null`
   * says there is none (the editor's single animation never needs it).
   */
  manifest?: Manifest | null;
  /** "Installed" for files that come from the Library, "Uploaded" for the rest. */
  verb?: "Uploaded" | "Installed";
  /** Upload a playlist whose animations the board lacks without asking: the board stores it with a warning. */
  acceptMissing?: boolean;
  /** Replace a differing stored file without the question, for an editor whose user asked to save over it. */
  replaceWithoutAsking?: boolean;
  /** The caller reports the outcome itself: no toast, no summary alert, no warnings alert, no refusal alert. */
  quiet?: boolean;
}

interface Hook {
  /** The connected board, or null when there is none: the queue then refuses to start. */
  client: BoardClient | null;
  /** A file left out, a refusal or a summary: shown as an alert next to the list. */
  onProblem: (problem: ShownError) => void;
  /** The board's files changed or may have: read them again. `stored` is true when at least one file was uploaded. */
  onFinished: (stored: boolean) => void;
}

export interface UploadQueue {
  /** Render once, anywhere in the view. */
  dialogs: ReactNode;
  /** True from the first question to the last file: the pickers stay disabled meanwhile. */
  busy: boolean;
  /** Files picked or dropped: converted, checked, then planned and sent. */
  uploadFiles: (files: File[]) => Promise<QueueOutcome | null>;
  /** Published files: downloaded, checked against the manifest, then planned and sent. */
  install: (
    items: Array<{ kind: PublishedKind; entry: Published }>,
    manifest: Manifest,
  ) => Promise<QueueOutcome | null>;
  /** Files the caller already checked. */
  uploadPrepared: (files: QueueFile[], options?: QueueOptions) => Promise<QueueOutcome>;
  /**
   * Like `uploadPrepared`, but holds the queue while `prepare` runs, so a question it asks (an ID) is covered by
   * the same reservation. `prepare` returns the files, or null to stop; the outcome is then null.
   */
  uploadAfter: (prepare: () => Promise<QueueFile[] | null>, options?: QueueOptions) => Promise<QueueOutcome | null>;
  /** Asks for an ID, through the queue's own dialogs. */
  askId: ReturnType<typeof useUploadDialogs>["askId"];
}

/**
 * The one upload queue behind Upload files, Upload folder, the Library's Install and the editor's Upload to board
 * (docs/web/web-app-v1.md#upload-queue): check, plan against the board, ask once about differing files, check the
 * space, send under the upload lock, report.
 */
export function useUploadQueue({ client, onProblem, onFinished }: Hook): UploadQueue {
  const [busy, setBusy] = useState(false);
  const uploading = useUploadRunning();
  const { dialogs, askId, askDiffering, askMissing } = useUploadDialogs();

  const refuse = (refusal: Refusal, quiet: boolean | undefined): QueueOutcome => {
    const shown = refusalProblem(refusal);
    if (!quiet) onProblem(shown);
    return { status: "refused", refusal, shown };
  };

  /**
   * Holds the app's one upload queue from the preparation to the last file, and ends it the same way every time, so a
   * failure on the way never leaves the pickers disabled or the queue reserved.
   */
  async function exclusive<T extends QueueOutcome | null>(
    quiet: boolean | undefined,
    task: (client: BoardClient, reservation: QueueReservation) => Promise<T>,
  ): Promise<QueueOutcome | T> {
    if (!client) return refuse({ reason: "not_connected" }, quiet);
    const reservation = reserveUploadQueue();
    if (!reservation) return refuse({ reason: "busy" }, quiet);
    setBusy(true);
    try {
      return await task(client, reservation);
    } catch (error) {
      return refuse({ reason: "failed", error }, quiet);
    } finally {
      reservation.release();
      setBusy(false);
    }
  }

  /** Runs the queue once and hands the user's side of it (questions, notices, space, sending) to the page. */
  async function run(
    client: BoardClient,
    input: QueueFile[],
    options: QueueOptions,
    reservation: QueueReservation,
  ): Promise<QueueOutcome> {
    const result = await runQueue(
      {
        client,
        ask: {
          differing: options.replaceWithoutAsking ? async () => "replace" : askDiffering,
          missing: options.acceptMissing ? async () => true : askMissing,
        },
        notify: ({ context, code, message, error, diagnostics, warning }) =>
          onProblem(
            error !== undefined
              ? toShownError(context, error)
              : shownError(context, code ?? "error", message ?? "", { diagnostics: diagnostics ?? [], warning }),
          ),
        storage: async () => {
          if (!(await session.refreshInfo())) throw new Error("The board did not report its free space.");
          return session.getSnapshot().info?.storage ?? null;
        },
        send: (sends, skipped) => sendQueue(client, sends, skipped, reservation),
        manifest: options.manifest,
      },
      input,
    );
    if (result.status === "refused") return refuse(result.refusal, options.quiet);
    if (result.status === "summary") {
      // A file that failed may still have been stored: its list is read again too. The views do not wait for it.
      const { uploaded, failed } = result.summary;
      // The play file has no list: its effect shows in the status, which the views read again when the queue ends.
      const touched = [
        ...new Set<ListedKind>(
          [...uploaded.map((u) => u.file.kind), ...(failed ? [failed.file.kind] : [])].filter(
            (kind): kind is ListedKind => kind !== "play",
          ),
        ),
      ];
      if (touched.length > 0) void session.refreshFiles(touched);
      if (!options.quiet) report(result.summary, options.verb ?? "Uploaded");
      if (result.summary.uploaded.length > 0 || result.summary.failed || result.summary.cancelled)
        onFinished(result.summary.uploaded.length > 0);
    }
    return result;
  }

  function report(summary: QueueSummary, verb: "Uploaded" | "Installed"): void {
    const { toast: message, detail, warnings } = summaryReport(summary, verb);
    toast(message);
    if (detail)
      onProblem(
        shownError(detail.title, "summary", detail.message, {
          lines: detail.lines,
          diagnostics: detail.diagnostics,
          info: !detail.failed,
        }),
      );
    for (const [origin, diagnostics] of warnings)
      onProblem(
        shownError(`Uploading ${origin}`, "warnings", "The file was uploaded with warnings.", {
          diagnostics,
          warning: true,
        }),
      );
  }

  const uploadPrepared = async (files: QueueFile[], options: QueueOptions = {}): Promise<QueueOutcome> =>
    exclusive(options.quiet, (client, reservation) => run(client, files, options, reservation));

  const uploadAfter = async (
    prepare: () => Promise<QueueFile[] | null>,
    options: QueueOptions = {},
  ): Promise<QueueOutcome | null> =>
    exclusive(options.quiet, async (client, reservation) => {
      const files = await prepare();
      return files && files.length > 0 ? run(client, files, options, reservation) : null;
    });

  async function uploadFiles(picked: File[]): Promise<QueueOutcome | null> {
    const list = picked.filter((file) => SUPPORTED_FILE.test(file.name));
    if (list.length === 0) return null;
    return exclusive(false, async (client, reservation) => {
      const files: QueueFile[] = [];
      for (const file of list) {
        let bytes: Uint8Array;
        try {
          bytes = await readPicked(file);
        } catch (error) {
          onProblem(shownError(`Uploading ${file.name}`, "refused", toShownError("Reading the file", error).message));
          continue;
        }
        const id = await chooseId(file.name);
        if (id === null) {
          toast({ title: `Skipped ${file.name}`, tone: "info" });
          continue;
        }
        const inspected = await inspectFile(file.name, bytes);
        if (!inspected.ok) {
          onProblem(
            shownError(`Uploading ${file.name}`, inspected.status, inspected.message, {
              diagnostics: inspected.diagnostics,
            }),
          );
          continue;
        }
        if (inspected.kind === "schedule" && !supportsSchedules(client.info)) {
          onProblem(shownError(`Uploading ${file.name}`, "refused", SCHEDULES_NEED_FIRMWARE));
          continue;
        }
        files.push({
          kind: inspected.kind,
          id,
          bytes: inspected.bytes,
          sha256: await sha256Hex(inspected.bytes),
          origin: file.name,
          localWarnings: inspected.diagnostics,
        });
      }
      if (files.length === 0) return null;
      return run(client, files, {}, reservation);
    });
  }

  async function chooseId(fileName: string): Promise<string | null> {
    const id = idFromFileName(fileName);
    if (isValidId(id)) return id;
    return askId("The file name does not follow the ID rule", suggestId(id));
  }

  async function install(
    items: Array<{ kind: PublishedKind; entry: Published }>,
    manifest: Manifest,
  ): Promise<QueueOutcome | null> {
    return exclusive(false, async (client, reservation) => {
      const files: QueueFile[] = [];
      for (const { kind, entry } of items) {
        const where = `Installing ${kind} ${entry.id}`;
        try {
          const bytes = await downloadPublished(kind, entry);
          const checked = validateFile(kind, bytes);
          if (!checked.ok) {
            onProblem(
              shownError(where, "rejected", "The published file has errors and was not installed.", {
                diagnostics: checked.diagnostics,
              }),
            );
            continue;
          }
          files.push({ kind, id: entry.id, bytes, sha256: entry.sha256, origin: "the Library" });
        } catch (error) {
          onProblem(toShownError(where, error));
        }
      }
      if (files.length === 0) return null;
      return run(client, files, { manifest, verb: "Installed" }, reservation);
    });
  }

  return { dialogs, busy: busy || uploading, uploadFiles, install, uploadPrepared, uploadAfter, askId };
}
