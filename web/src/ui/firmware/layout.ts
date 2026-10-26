// SPDX-License-Identifier: GPL-3.0-or-later

// The flash layout a board was flashed with, as far as the app can tell from `info`.

import type { BoardInfo } from "../../protocol/client";

/**
 * The file system of the layout before the firmware with WiFi: the Arduino default for 4 MB flash, whose `spiffs`
 * partition holds 0x160000 bytes. The current layout's holds 0xF0000 (983,040 bytes).
 */
export const OLD_LAYOUT_STORAGE_BYTES = 0x160000;

/** Whether the board still has the old flash layout, which Update firmware cannot change. */
export function onOldLayout(info: BoardInfo | null): boolean {
  return info?.storage?.total === OLD_LAYOUT_STORAGE_BYTES;
}
