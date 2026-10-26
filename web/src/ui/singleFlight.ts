// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Runs a task unless one started through the same gate is still pending, in which case the caller joins the pending
 * run and gets its result. An effect that React starts twice (StrictMode in development) therefore does the work once.
 */
export function singleFlight(): <T>(task: () => Promise<T>) => Promise<T> {
  let pending: Promise<unknown> | null = null;
  return <T>(task: () => Promise<T>): Promise<T> => {
    if (pending) return pending as Promise<T>;
    const run = task().finally(() => {
      pending = null;
    });
    pending = run;
    return run;
  };
}
