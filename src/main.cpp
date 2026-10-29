// SPDX-License-Identifier: GPL-3.0-or-later

#include "app.h"
#include "firmware.h"
#include "network.h"
#include "pixel_art.h"
#include "protocol.h"
#include "settings.h"
#include "storage.h"
#include "task_sync.h"
#include "updates.h"

// The layout flags must match the physical panel wiring, which the simulator
// and the live mirror also use: custom_panel_layout in platformio.ini.
PixelMatrix matrix(MATRIX_WIDTH, MATRIX_HEIGHT, PIN_WS2812B,
                   NEO_MATRIX_TOP + NEO_MATRIX_LEFT + NEO_MATRIX_COLUMNS + NEO_MATRIX_ZIGZAG, NEO_GRB + NEO_KHZ800);

#ifndef PIXELART_SIM
// A newly installed firmware boots on trial: the bootloader returns to the previous one unless this
// one confirms itself with firmware::first_frame_shown(). The core would otherwise confirm it before
// setup().
extern "C" bool verifyRollbackLater() { return true; }
#endif

void setup()
{
  // The USB serial driver keeps 256 bytes per direction by default and drops
  // bytes when full: size the buffers before the port opens.
  Serial.setRxBufferSize(SERIAL_RX_BUFFER);
  Serial.setTxBufferSize(SERIAL_TX_BUFFER);
  Serial.begin(SERIAL_BAUD);
  settings::begin();
  firmware::begin();
  matrix.begin();
  matrix.setBrightness(settings::brightness());
  const bool mounted = storage::begin();
  if (!mounted)
    Serial.println("pixelart: cannot mount the file system");
  firmware::health(mounted); // settings are read and the file system is mounted: a trial that is not healthy ends here
  protocol::begin();
  task_sync::begin();
  updates::begin(settings::current());
  begin_player(); // its first choice reads the files before the network task can hold the memory
  network::begin(settings::current().wifi_power);
}

void loop() { play_from_storage(); }
