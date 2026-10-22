// Simulated Adafruit_NeoPixel: the part of the real library's API that
// NeoMatrix and the sketch use, but show() hands the pixel buffer to the
// simulator instead of driving a pin. Pixels are stored in wire order with
// brightness pre-applied, like the real library.

#pragma once

#include <Arduino.h>

// Color order: ((w_offset << 6) | (r_offset << 4) | (g_offset << 2) | b_offset)
#define NEO_GRB ((1 << 6) | (1 << 4) | (0 << 2) | (2))

#define NEO_KHZ800 0x0000

typedef uint16_t neoPixelType;

class Adafruit_NeoPixel
{
public:
  Adafruit_NeoPixel(uint16_t n, int16_t pin = 6, neoPixelType type = NEO_GRB + NEO_KHZ800);
  ~Adafruit_NeoPixel();

  bool begin();
  void show();
  void setPin(int16_t p) { pin = p; }
  void setPixelColor(uint16_t n, uint8_t r, uint8_t g, uint8_t b, uint8_t w);
  void setPixelColor(uint16_t n, uint32_t c);
  void setBrightness(uint8_t b);
  void updateLength(uint16_t n);
  void updateType(neoPixelType t);

  uint8_t getBrightness() const { return brightness - 1; }
  uint16_t numPixels() const { return numLEDs; }

protected:
  bool begun = false;
  uint16_t numLEDs = 0;
  uint16_t numBytes = 0;
  int16_t pin = -1;
  uint8_t brightness = 0; // stored as user value + 1, 0 means "no scaling"
  uint8_t *pixels = nullptr;
  uint8_t rOffset = 1, gOffset = 0, bOffset = 2, wOffset = 1;
};
