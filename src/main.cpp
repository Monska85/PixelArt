// SPDX-License-Identifier: GPL-3.0-or-later

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
