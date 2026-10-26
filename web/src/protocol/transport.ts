// SPDX-License-Identifier: GPL-3.0-or-later

import type { ImprovLink } from "./improv";

/** One line at a time, in both directions, whatever the link. */
export interface Transport {
  /** Sends one line, without the newline. */
  send(line: string): Promise<void>;
  close(): Promise<void>;
  /** Called with every line received, without its newline. */
  onLine: ((line: Uint8Array) => void) | null;
  /** Called once when the link ends, on its own or after close(). */
  onClose: ((reason?: string) => void) | null;
  /** The link to the board's Improv frames, on the transports that carry them: the serial port only. */
  improv?: ImprovLink;
}
