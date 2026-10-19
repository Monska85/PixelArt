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

#include "app.h"
#include "pixel_art.h"
#include "protocol.h"
#include "settings.h"
#include "storage.h"

// The layout flags must match the physical panel wiring, which the simulator
// and the live mirror also use: custom_panel_layout in platformio.ini.
PixelMatrix matrix(MATRIX_WIDTH, MATRIX_HEIGHT, PIN_WS2812B,
                   NEO_MATRIX_TOP + NEO_MATRIX_LEFT + NEO_MATRIX_COLUMNS + NEO_MATRIX_ZIGZAG, NEO_GRB + NEO_KHZ800);

void setup()
{
  // The USB serial driver keeps 256 bytes per direction by default and drops
  // bytes when full: size the buffers before the port opens.
  Serial.setRxBufferSize(SERIAL_RX_BUFFER);
  Serial.setTxBufferSize(SERIAL_TX_BUFFER);
  Serial.begin(SERIAL_BAUD);
  settings::begin();
  matrix.begin();
  matrix.setBrightness(settings::brightness());
  if (!storage::begin())
    Serial.println("pixelart: cannot mount the file system");
  protocol::begin();
}

void loop() { play_from_storage(); }
