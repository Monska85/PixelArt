// SPDX-License-Identifier: GPL-3.0-or-later

#pragma once

#include <Adafruit_NeoMatrix.h>

constexpr uint32_t SERIAL_BAUD = 115200;
constexpr uint8_t PIN_WS2812B = 4;
constexpr int16_t MATRIX_WIDTH = 16;
constexpr int16_t MATRIX_HEIGHT = 16;
constexpr size_t SERIAL_RX_BUFFER = 4096;
constexpr size_t SERIAL_TX_BUFFER = 4096;

// Adafruit_NeoMatrix whose show() can also mirror the frame over serial.
// Build with -DPIXELART_MIRROR to enable the mirror (see `make mirror`).
class PixelMatrix : public Adafruit_NeoMatrix
{
public:
  using Adafruit_NeoMatrix::Adafruit_NeoMatrix;
  void show();

private:
  void mirror();
};

extern PixelMatrix matrix;
