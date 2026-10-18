// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

#pragma once

#include "pixel_art.h"

// An animation that loop() can play, and the simulator can run by name.
struct Animation
{
  const char *name;
  void (*play)();
};

// The animations in the order loop() plays them (src/playlist.cpp).
extern const Animation ANIMATIONS[];
extern const size_t ANIMATION_COUNT;

// One file per animation in src/animations/.
void ball();
void bear();
void bell();
void candle();
void candy_cane();
void christmas_lights();
void elf();
void fireplace();
void gingerbread_man();
void holly();
void jumping_reindeer();
void open_gift();
void panettone();
void penguin();
void pine_ball();
void poinsettia();
void reindeer();
void santa();
void santa_bag();
void santa_hat();
void sleigh();
void snow_globe();
void snow_trees();
void snowflake();
void snowman();
void star();
void steaming_mug();
void teddy_bear();
void wreath();
void xmas_tree();
