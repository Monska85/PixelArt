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

#include "animations.h"

// The layout flags must match the physical panel wiring, which the simulator
// and the live mirror also use: custom_panel_layout in platformio.ini.
PixelMatrix matrix(MATRIX_WIDTH, MATRIX_HEIGHT, PIN_WS2812B,
                   NEO_MATRIX_TOP + NEO_MATRIX_LEFT + NEO_MATRIX_COLUMNS + NEO_MATRIX_ZIGZAG, NEO_GRB + NEO_KHZ800);

void setup()
{
  Serial.begin(SERIAL_BAUD);
  matrix.begin();
  matrix.setBrightness(BRIGHTNESS);
}

void loop()
{
  for (size_t i = 0; i < ANIMATION_COUNT; i++)
  {
    ANIMATIONS[i].play();
  }
}
