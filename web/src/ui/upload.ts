// SPDX-License-Identifier: GPL-3.0-or-later

import { useSyncExternalStore } from "react";
import { createEmitter } from "./emitter";
import { BoardError, CONNECTION_LOST, NO_REPLY, UploadCancelled, uploadFile, type BoardClient } from "../protocol";
import { runSends, type PlanEntry, type QueueSummary, type SendOutcome } from "../queue/plan";
import { session, type Snapshot } from "./session";

export const UPLOAD_BUSY = "upload_busy";
export const SKIPPED_MESSAGE = "Skipped: the stored file was kept.";
export const CANCELLED_MESSAGE = "Cancelled: the upload was aborted.";
export const BUSY_MESSAGE = "Another upload is still running. Wait for it to finish or cancel it.";

/** Why a view cannot send files now, as text for the user, or null. `verb` is "upload" or "install". */
export function uploadBlockedReason(
  { state, client, uploadsBlocked }: Pick<Snapshot, "state" | "client" | "uploadsBlocked">,
  verb: "upload" | "install",
): string | null {
  if (state === "lost") return `Connection lost. Reconnect to ${verb}.`;
  if (!client || state !== "connected") return `Connect a board or the simulator to ${verb}.`;
  return uploadsBlocked;
}

/** `blocked`, or the busy reason when the upload queue is working: its questions and checks, or the sending. */
export function blockedOrBusy(blocked: string | null, queueBusy: boolean): string | null {
  return blocked ?? (queueBusy ? "Another upload is still running." : null);
}

/** What the activity panel shows about the work that runs: an upload, a queue of uploads, or the wipe. */
interface UploadActivity {
  /** "Uploading ball". */
  label: string;
  /** "File 2 of 5" when a view sends several files, else absent. */
  step?: string;
  done: number;
  total: number;
  /** Work with no byte count to show, such as the wipe: a bar that only says something runs. */
  indeterminate?: boolean;
  /** False when the work cannot be cancelled: the panel then has no Cancel button. */
  cancellable?: boolean;
}

let running: AbortController | null = null;
let reserved: QueueReservation | null = null;
let activity: UploadActivity | null = null;
const { subscribe, emit } = createEmitter();

/**
 * The upload queue's claim on the board from the first check to the last file. It covers the questions to the user,
 * which come before the upload lock: another queue or another lock user cannot start meanwhile, and the queue's own
 * sending passes the reservation to take the lock.
 */
export interface QueueReservation {
  release: () => void;
}

/** Reserves the one upload queue for the whole app, or returns null when a queue or an upload already holds it. */
export function reserveUploadQueue(): QueueReservation | null {
  if (running || reserved) return null;
  const reservation: QueueReservation = {
    release: () => {
      if (reserved !== reservation) return;
      reserved = null;
      emit();
    },
  };
  reserved = reservation;
  emit();
  return reservation;
}

function setRunning(controller: AbortController | null, next: UploadActivity | null = null): void {
  running = controller;
  activity = next;
  emit();
}

/** True while any view is uploading, or its queue is checking files and asking questions before the upload. */
export const useUploadRunning = (): boolean =>
  useSyncExternalStore(subscribe, () => running !== null || reserved !== null);

/** The work that runs now, for the activity panel, or null. */
export const useUploadActivity = (): UploadActivity | null => useSyncExternalStore(subscribe, () => activity);

export function cancelRunningUpload(): void {
  running?.abort();
}

interface LockHandle {
  /** Aborted by Cancel. */
  signal: AbortSignal;
  /** Changes what the activity panel shows. */
  update: (patch: Partial<UploadActivity>) => void;
}

/**
 * Runs `task` while holding the one upload lock; the board takes one upload at a time. Throws `upload_busy` when
 * the lock is taken or the queue is reserved by someone else: only the holder of `reservation` may take the lock
 * meanwhile. The lock lives here, not in a component that a view switch can unmount.
 */
export async function withUploadLock<T>(
  initial: UploadActivity,
  task: (lock: LockHandle) => Promise<T>,
  reservation?: QueueReservation,
): Promise<T> {
  if (running || (reserved && reserved !== reservation)) throw new BoardError(UPLOAD_BUSY, BUSY_MESSAGE);
  const controller = new AbortController();
  setRunning(controller, initial);
  try {
    return await task({
      signal: controller.signal,
      update: (patch) => {
        if (running !== controller || !activity) return;
        activity = { ...activity, ...patch };
        emit();
      },
    });
  } finally {
    setRunning(null);
  }
}

/** The outcome of one upload, from the error it ended with. A connection lost midway is remembered for put_abort. */
function outcomeOf(error: unknown): Exclude<SendOutcome, { status: "done" }> {
  if (error instanceof UploadCancelled) return { status: "cancelled" };
  if (error instanceof BoardError && (error.code === CONNECTION_LOST || error.code === NO_REPLY))
    session.markUploadInterrupted();
  return { status: "failed", error };
}

/**
 * Sends the planned files one after the other with the lock held for the whole queue, so no other upload slips
 * in between two files. Cancel stops after aborting the file in progress.
 */
export async function sendQueue(
  client: BoardClient,
  sends: PlanEntry[],
  skipped: QueueSummary["skipped"],
  reservation?: QueueReservation,
): Promise<QueueSummary> {
  const first = sends[0];
  const initial: UploadActivity = { label: "Preparing the upload", done: 0, total: first?.file.bytes.length ?? 0 };
  return withUploadLock(
    initial,
    (lock) =>
      runSends(sends, skipped, async (file, index, total) => {
        if (lock.signal.aborted) return { status: "cancelled" };
        lock.update({
          label: `Uploading ${file.kind} ${file.id}`,
          step: `File ${index + 1} of ${total}`,
          done: 0,
          total: file.bytes.length,
        });
        try {
          const warnings = await uploadFile(client, file.kind, file.id, file.bytes, {
            signal: lock.signal,
            onProgress: (done, size) => lock.update({ done, total: size }),
          });
          return { status: "done", warnings };
        } catch (error) {
          return outcomeOf(error);
        }
      }),
    reservation,
  );
}
