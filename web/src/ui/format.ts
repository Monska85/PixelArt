// SPDX-License-Identifier: GPL-3.0-or-later

/** A size as people read it: `845 B`, `2.9 KB`, `1.4 MB`, base 1,024, one decimal above 1,023 bytes. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  // 1,048,575 bytes rounds to 1024.0 KB: it reads better as 1.0 MB.
  if (kb < 1023.95) return `${kb.toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** A count and its noun: `1 file`, `2 files`. */
export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;
