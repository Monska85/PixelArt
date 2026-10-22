// SPDX-License-Identifier: GPL-3.0-or-later

// Minimal Arduino core for the native (host) simulator.
// Covers the API used by Adafruit GFX/NeoMatrix and the sketch.
// Time is virtual: delay() advances a simulated clock instead of sleeping.

#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <cstring>

#include "WString.h"
#include "Print.h"

typedef bool boolean;

#define DEG_TO_RAD 0.017453292519943295769236907684886

#define PROGMEM
#define pgm_read_byte(addr) (*(const uint8_t *)(addr))
#define pgm_read_word(addr) (*(const uint16_t *)(addr))
#define pgm_read_dword(addr) (*(const uint32_t *)(addr))

using std::abs;
using std::min;

#define radians(deg) ((deg) * DEG_TO_RAD)

void delay(unsigned long ms);
void delayMicroseconds(unsigned int us);
void yield();

class HardwareSerial : public Print
{
public:
  void begin(unsigned long baud) { (void)baud; }
  // Buffer sizes are only recorded by the board's core; the simulator has no buffers to size.
  size_t setRxBufferSize(size_t size) { return size; }
  size_t setTxBufferSize(size_t size) { return size; }
  // Input comes from the queue that tests and transports fill with sim::serial_input().
  int available();
  int read();
  void flush() {}
  size_t write(uint8_t c) override;
  using Print::write;
  operator bool() const { return true; }
};

extern HardwareSerial Serial;

void setup();
void loop();
