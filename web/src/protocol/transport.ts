/** One line at a time, in both directions, whatever the link. */
export interface Transport {
  /** Sends one line, without the newline. */
  send(line: string): Promise<void>;
  close(): Promise<void>;
  /** Called with every line received, without its newline. */
  onLine: ((line: Uint8Array) => void) | null;
  /** Called once when the link ends, on its own or after close(). */
  onClose: ((reason?: string) => void) | null;
}
