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

#include <Adafruit_NeoMatrix.h>

constexpr uint32_t SERIAL_BAUD = 115200;
constexpr uint8_t PIN_WS2812B = 4;
constexpr int16_t MATRIX_WIDTH = 16;
constexpr int16_t MATRIX_HEIGHT = 16;
constexpr uint8_t BRIGHTNESS = 100;

// Same packing as Adafruit_NeoMatrix::Color(), usable in constant expressions.
// Animation colors go through it, then through the NeoMatrix gamma tables.
constexpr uint16_t rgb565(uint8_t r, uint8_t g, uint8_t b)
{
  return ((uint16_t)(r & 0xF8) << 8) | ((uint16_t)(g & 0xFC) << 3) | (b >> 3);
}

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
