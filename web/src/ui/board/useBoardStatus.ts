// SPDX-License-Identifier: GPL-3.0-or-later

import { useCallback, useEffect, useState } from "react";
import { BoardError, getStatus, isUpdateRunning, type BoardClient, type BoardStatus } from "../../protocol";

/**
 * How often the status is read while a check or an installation runs, and otherwise. The WiFi state changes with the
 * network, so the idle interval stays short.
 */
export const RUNNING_POLL_MS = 2_000;
export const IDLE_POLL_MS = 10_000;

/** The wait before the next read of the status. */
export const pollIntervalMs = (running: boolean): number => (running ? RUNNING_POLL_MS : IDLE_POLL_MS);

interface StatusState {
  status: BoardStatus | null;
  /** The firmware has no `status` command: the cards that show it are not shown. */
  unsupported: boolean;
  /** The last read failed; the previous status, if any, is still shown. */
  failed: boolean;
}

export interface BoardStatusPoll extends StatusState {
  refresh: () => void;
}

/**
 * The board's `status`, read when it mounts, every 2 seconds while something runs and every 10 seconds otherwise, and
 * on `refresh`. One reader per view, shared by its cards: the board serves one client. Nothing is read while `paused`.
 */
export function useBoardStatus(client: BoardClient, restarts: number, paused: boolean): BoardStatusPoll {
  const [state, setState] = useState<StatusState>({ status: null, unsupported: false, failed: false });
  const running = state.status !== null && isUpdateRunning(state.status.update);

  const read = useCallback(
    async (isCurrent: () => boolean): Promise<void> => {
      try {
        const status = await getStatus(client);
        if (isCurrent()) setState({ status, unsupported: false, failed: false });
      } catch (error) {
        if (!isCurrent()) return;
        if (error instanceof BoardError && error.code === "unknown_command")
          setState({ status: null, unsupported: true, failed: false });
        else setState((previous) => ({ ...previous, failed: true }));
      }
    },
    [client],
  );

  useEffect(() => {
    if (paused) return;
    let current = true;
    const poll = (): void => {
      void read(() => current);
    };
    poll();
    const timer = setInterval(poll, pollIntervalMs(running));
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [read, restarts, paused, running]);

  return { ...state, refresh: () => void read(() => true) };
}
