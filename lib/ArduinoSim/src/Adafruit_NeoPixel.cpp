// SPDX-License-Identifier: GPL-3.0-or-later

#include "Adafruit_NeoPixel.h"

#include <cstdlib>
#include <cstring>

#include "sim.h"

Adafruit_NeoPixel::Adafruit_NeoPixel(uint16_t n, int16_t p, neoPixelType t)
{
  updateType(t);
  updateLength(n);
  setPin(p);
}

Adafruit_NeoPixel::~Adafruit_NeoPixel() { free(pixels); }

bool Adafruit_NeoPixel::begin()
{
  begun = true;
  return true;
}

void Adafruit_NeoPixel::show() { sim::on_show(pixels, numLEDs, rOffset, gOffset, bOffset, wOffset == rOffset ? 3 : 4); }

void Adafruit_NeoPixel::updateLength(uint16_t n)
{
  free(pixels);
  numBytes = n * ((wOffset == rOffset) ? 3 : 4);
  pixels = (uint8_t *)calloc(numBytes, 1);
  numLEDs = pixels ? n : 0;
  if (!pixels)
    numBytes = 0;
}

void Adafruit_NeoPixel::updateType(neoPixelType t)
{
  bool oldThreeBytesPerPixel = (wOffset == rOffset);
  wOffset = (t >> 6) & 0b11;
  rOffset = (t >> 4) & 0b11;
  gOffset = (t >> 2) & 0b11;
  bOffset = t & 0b11;
  if (pixels && oldThreeBytesPerPixel != (wOffset == rOffset))
    updateLength(numLEDs);
}

void Adafruit_NeoPixel::setPixelColor(uint16_t n, uint8_t r, uint8_t g, uint8_t b, uint8_t w)
{
  if (n >= numLEDs)
    return;
  if (brightness)
  {
    r = (r * brightness) >> 8;
    g = (g * brightness) >> 8;
    b = (b * brightness) >> 8;
    w = (w * brightness) >> 8;
  }
  uint8_t *p;
  if (wOffset == rOffset)
  {
    p = &pixels[n * 3];
  }
  else
  {
    p = &pixels[n * 4];
    p[wOffset] = w;
  }
  p[rOffset] = r;
  p[gOffset] = g;
  p[bOffset] = b;
}

void Adafruit_NeoPixel::setPixelColor(uint16_t n, uint32_t c)
{
  setPixelColor(n, (uint8_t)(c >> 16), (uint8_t)(c >> 8), (uint8_t)c, (uint8_t)(c >> 24));
}

// Same rescaling math as the real library, so stored values match the hardware.
void Adafruit_NeoPixel::setBrightness(uint8_t b)
{
  uint8_t newBrightness = b + 1;
  if (newBrightness == brightness)
    return;
  uint8_t oldBrightness = brightness - 1;
  uint16_t scale;
  if (oldBrightness == 0)
    scale = 0;
  else if (b == 255)
    scale = 65535 / oldBrightness;
  else
    scale = (((uint16_t)newBrightness << 8) - 1) / oldBrightness;
  for (uint16_t i = 0; i < numBytes; i++)
    pixels[i] = (pixels[i] * scale) >> 8;
  brightness = newBrightness;
}
