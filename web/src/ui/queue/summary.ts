// SPDX-License-Identifier: GPL-3.0-or-later

// What the user is told when a queue ends: a toast, and a detail alert when the story has more than one line.

import type { Diagnostic } from "../../engine";
import { BoardError, type WireDiagnostic } from "../../protocol";
import type { QueueFile, QueueSummary } from "../../queue/plan";
import type { Refusal, RunResult } from "../../queue/run";
import { shownError, toShownError, shownMessage, type ShownError } from "../errors";
import { formatSize, plural } from "../format";
import { BUSY_MESSAGE } from "../upload";

type Verb = "Uploaded" | "Installed";

const KIND_NAMES = {
  animation: "animation",
  playlist: "playlist",
  schedule: "schedule",
  schedule_v2: "timed schedule",
  play: "play file",
} as const;

/** "3 animations", "1 playlist", "2 animations and 1 playlist", "2 animations, 1 playlist and 1 play file". */
function describeCounts(files: QueueFile[]): string {
  const parts = (["animation", "playlist", "schedule", "schedule_v2", "play"] as const)
    .map((kind) => [kind, files.filter((f) => f.kind === kind).length] as const)
    .filter(([, n]) => n > 0)
    .map(([kind, n]) => plural(n, KIND_NAMES[kind]));
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : (parts[0] ?? "");
}

const ids = (files: QueueFile[]): string => files.map((f) => f.id).join(", ");

interface SummaryReport {
  toast: { title: string; description?: string; tone: "success" | "info" | "error" };
  /** The alert that stays until dismissed, or null when the toast says everything. */
  detail: {
    title: string;
    message: string;
    lines: string[];
    diagnostics: WireDiagnostic[];
    failed: boolean;
  } | null;
  /** Files that went through with warnings: the file's origin and the warnings. */
  warnings: Array<[string, Array<Diagnostic | WireDiagnostic>]>;
}

export function summaryReport(summary: QueueSummary, verb: Verb): SummaryReport {
  const { uploaded, skipped, failed, notAttempted, cancelled } = summary;
  const noun = verb === "Uploaded" ? "Upload" : "Install";
  const lower = verb === "Uploaded" ? "uploaded" : "installed";
  const failure = failed && toShownError(noun, failed.error);

  let toast: SummaryReport["toast"];
  if (failed && failure)
    toast = {
      title: `${noun} stopped at ${failed.file.id}`,
      description: shownMessage(failure),
      tone: "error",
    };
  else if (cancelled)
    toast = {
      title: "Cancelled",
      description: `${plural(uploaded.length, "file")} ${lower} before the stop.`,
      tone: "info",
    };
  else if (uploaded.length === 0)
    toast = {
      title: `Nothing to ${noun.toLowerCase()}`,
      description: skipped.every((s) => s.reason === "identical")
        ? "The board already has these files."
        : "The board's files were kept.",
      tone: "info",
    };
  else if (uploaded.length === 1 && skipped.length === 0) {
    const file = uploaded[0]?.file as QueueFile;
    toast = {
      title: `${verb} ${KIND_NAMES[file.kind]} ${file.id}`,
      description: formatSize(file.bytes.length),
      tone: "success",
    };
  } else
    toast = {
      title: `${verb} ${describeCounts(uploaded.map((u) => u.file))}`,
      ...(skipped.length > 0 && { description: `${plural(skipped.length, "file")} skipped.` }),
      tone: "success",
    };

  const total = uploaded.length + skipped.length + (failed ? 1 : 0) + notAttempted.length;
  const lines: string[] = [];
  if (uploaded.length > 0) lines.push(`${verb}: ${ids(uploaded.map((u) => u.file))}`);
  const identical = skipped.filter((s) => s.reason === "identical").map((s) => s.file);
  const kept = skipped.filter((s) => s.reason === "kept").map((s) => s.file);
  if (identical.length > 0) lines.push(`Skipped, the board has the same file: ${ids(identical)}`);
  if (kept.length > 0) lines.push(`Skipped, the board's file was kept: ${ids(kept)}`);
  if (failed && failure) lines.push(`Failed: ${failed.file.id}, ${shownMessage(failure)}`);
  if (notAttempted.length > 0) lines.push(`Not attempted: ${ids(notAttempted)}`);

  const needsDetail = failed !== null || cancelled || notAttempted.length > 0 || total > 1;
  let message = "Done.";
  if (failed)
    message = `The ${verb === "Uploaded" ? "upload" : "installation"} stopped at the first failure. Run it again to continue: files the board already has are skipped.`;
  else if (cancelled) message = "Cancelled. Run it again to continue: files the board already has are skipped.";

  const warnings: SummaryReport["warnings"] = [];
  for (const { file, warnings: fromBoard } of uploaded) {
    const local = (file.localWarnings ?? []).filter((d) => d.severity === "warning");
    const shown = fromBoard.length > 0 ? fromBoard : local;
    if (shown.length > 0) warnings.push([file.origin === "the Library" ? file.id : file.origin, shown]);
  }

  return {
    toast,
    detail: needsDetail
      ? {
          title: `${noun} summary`,
          message,
          lines,
          diagnostics: failed && failed.error instanceof BoardError ? failed.error.diagnostics : [],
          failed: failed !== null,
        }
      : null,
    warnings,
  };
}

/** What the user is told when the queue sent nothing and gave a reason. */
export function refusalProblem(refusal: Refusal): ShownError {
  switch (refusal.reason) {
    case "busy":
      return shownError("Uploading", "upload_busy", BUSY_MESSAGE);
    case "not_connected":
      return shownError("Uploading", "not_connected", "Connect a board or the simulator to send files.");
    case "read_failed":
      return toShownError("Reading the board", refusal.error);
    case "failed":
      return toShownError("Uploading", refusal.error);
    case "no_space": {
      const { needed, free, short } = refusal.space;
      return shownError(
        "Not enough space on the board",
        "no_space",
        `The files need ${formatSize(needed)}, and the board has ${formatSize(free)} free. ` +
          `${formatSize(short)} more is needed. ` +
          "Nothing was sent. Delete files from the board, or send fewer.",
      );
    }
  }
}

/** How a queue ended. A refusal carries what the user is told, which is already shown unless the call was quiet. */
export type QueueOutcome =
  Exclude<RunResult, { status: "refused" }> | { status: "refused"; refusal: Refusal; shown: ShownError };

type SingleResult =
  | { status: "stored"; identical: boolean; warnings: WireDiagnostic[] }
  /** `cancelled`: the upload was aborted. `declined`: the user answered Cancel to a question. `kept`: the board's file was kept. */
  | { status: "stopped"; reason: "cancelled" | "declined" | "kept" }
  | { status: "error"; shown: ShownError };

/** The end of a queue that held one file, for an editor that reports it itself. `what` is "the animation". */
export function singleFileResult(outcome: QueueOutcome, what: string): SingleResult {
  if (outcome.status === "refused") return { status: "error", shown: outcome.shown };
  if (outcome.status === "cancelled") return { status: "stopped", reason: "declined" };
  const { summary } = outcome;
  if (summary.failed) return { status: "error", shown: toShownError(`Uploading ${what}`, summary.failed.error) };
  if (summary.cancelled) return { status: "stopped", reason: "cancelled" };
  const uploaded = summary.uploaded[0];
  if (uploaded) return { status: "stored", identical: false, warnings: uploaded.warnings };
  if (summary.skipped[0]?.reason === "identical") return { status: "stored", identical: true, warnings: [] };
  return { status: "stopped", reason: "kept" };
}
