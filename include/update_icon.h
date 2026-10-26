// SPDX-License-Identifier: GPL-3.0-or-later

// The icon the matrix shows while a firmware installs (docs/board/wifi-and-updates-v1.md#update-icon):
// an arrow pointing down into a tray, and a progress bar on the bottom row.

#pragma once

#include <cstdint>

namespace update_icon
{

constexpr int SIZE = 16;
constexpr uint32_t ARROW = 0x00FFFF;    // cyan
constexpr uint32_t TRAY = 0x808080;     // grey
constexpr uint32_t PROGRESS = 0x00FF00; // green
constexpr uint32_t TRACK = 0x202020;    // dark grey, the unfilled part of the bottom row

// The color of the pixel at (x, y) as 0xRRGGBB, or 0 for a dark pixel. The bar fills `percent * 16 / 100`
// pixels of row 15 from the left.
uint32_t pixel(int x, int y, uint8_t percent);

} // namespace update_icon
