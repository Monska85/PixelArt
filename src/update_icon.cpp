// SPDX-License-Identifier: GPL-3.0-or-later

#include "update_icon.h"

namespace update_icon
{

namespace
{

// 'A' is the arrow, 'T' the tray. Row 15 is the progress bar and is drawn by pixel().
const char *const ROWS[SIZE - 1] = {"................", ".......AA.......", ".......AA.......", ".......AA.......",
                                    ".......AA.......", ".......AA.......", "....AAAAAAAA....", ".....AAAAAA.....",
                                    "......AAAA......", ".......AA.......", "................", "..T..........T..",
                                    "..T..........T..", "..TTTTTTTTTTTT..", "................"};

} // namespace

uint32_t pixel(int x, int y, uint8_t percent)
{
  if (x < 0 || x >= SIZE || y < 0 || y >= SIZE)
    return 0;
  if (y == SIZE - 1)
  {
    const int filled = (percent > 100 ? 100 : percent) * SIZE / 100;
    return x < filled ? PROGRESS : TRACK;
  }
  switch (ROWS[y][x])
  {
  case 'A':
    return ARROW;
  case 'T':
    return TRAY;
  }
  return 0;
}

} // namespace update_icon
