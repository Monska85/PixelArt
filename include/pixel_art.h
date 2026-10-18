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
constexpr uint32_t DEFAULT_DELAY_MS = 500;
constexpr int DEFAULT_TOTAL_FRAMES = 9;

constexpr int round_up_to_even(int n) { return n + n % 2; }

// Same packing as Adafruit_NeoMatrix::Color(), but usable in constant
// expressions, so frame data can be stored in flash.
constexpr uint16_t rgb565(uint8_t r, uint8_t g, uint8_t b)
{
  return ((uint16_t)(r & 0xF8) << 8) | ((uint16_t)(g & 0xFC) << 3) | (b >> 3);
}

struct Pixel
{
  int16_t x;
  int16_t y;
  uint16_t color;
};

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

// Draws every pixel of a fixed-size array: draw(frame0).
template <size_t N> void draw(const Pixel (&pixels)[N])
{
  for (const Pixel &p : pixels)
  {
    matrix.drawPixel(p.x, p.y, p.color);
  }
}

// Plays an animation: for each frame, clears the matrix, calls
// draw_frame(frame) with the frame index, shows the result and waits.
template <typename DrawFrame> void play_frames(int total_frames, uint32_t delay_ms, DrawFrame draw_frame)
{
  for (int frame = 0; frame < total_frames; frame++)
  {
    matrix.fillScreen(0);
    draw_frame(frame);
    matrix.show();
    delay(delay_ms);
  }
}
