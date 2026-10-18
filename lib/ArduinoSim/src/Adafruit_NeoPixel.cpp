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

Adafruit_NeoPixel::Adafruit_NeoPixel() {}

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

void Adafruit_NeoPixel::setPixelColor(uint16_t n, uint8_t r, uint8_t g, uint8_t b)
{
  if (n >= numLEDs)
    return;
  if (brightness)
  {
    r = (r * brightness) >> 8;
    g = (g * brightness) >> 8;
    b = (b * brightness) >> 8;
  }
  uint8_t *p;
  if (wOffset == rOffset)
  {
    p = &pixels[n * 3];
  }
  else
  {
    p = &pixels[n * 4];
    p[wOffset] = 0;
  }
  p[rOffset] = r;
  p[gOffset] = g;
  p[bOffset] = b;
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

void Adafruit_NeoPixel::fill(uint32_t c, uint16_t first, uint16_t count)
{
  if (first >= numLEDs)
    return;
  uint16_t end = (count == 0) ? numLEDs : (uint16_t)std::min<uint32_t>((uint32_t)first + count, numLEDs);
  for (uint16_t i = first; i < end; i++)
    setPixelColor(i, c);
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

void Adafruit_NeoPixel::clear()
{
  if (pixels)
    memset(pixels, 0, numBytes);
}

uint32_t Adafruit_NeoPixel::getPixelColor(uint16_t n) const
{
  if (n >= numLEDs)
    return 0;
  const bool rgbw = wOffset != rOffset;
  const uint8_t *p = &pixels[n * (rgbw ? 4 : 3)];
  uint32_t r = p[rOffset], g = p[gOffset], b = p[bOffset], w = rgbw ? p[wOffset] : 0;
  if (brightness)
  {
    r = (r << 8) / brightness;
    g = (g << 8) / brightness;
    b = (b << 8) / brightness;
    w = (w << 8) / brightness;
  }
  return (w << 24) | (r << 16) | (g << 8) | b;
}

uint8_t Adafruit_NeoPixel::sine8(uint8_t x) { return (uint8_t)((std::sin(x / 128.0 * PI) + 1.0) * 127.5 + 0.5); }

uint8_t Adafruit_NeoPixel::gamma8(uint8_t x) { return (uint8_t)(std::pow(x / 255.0, 2.6) * 255.0 + 0.5); }

uint32_t Adafruit_NeoPixel::gamma32(uint32_t x)
{
  uint8_t *y = (uint8_t *)&x;
  for (uint8_t i = 0; i < 4; i++)
    y[i] = gamma8(y[i]);
  return x;
}

uint32_t Adafruit_NeoPixel::ColorHSV(uint16_t hue, uint8_t sat, uint8_t val)
{
  uint8_t r, g, b;
  hue = (hue * 1530L + 32768) / 65536;
  if (hue < 510)
  {
    b = 0;
    if (hue < 255)
    {
      r = 255;
      g = hue;
    }
    else
    {
      r = 510 - hue;
      g = 255;
    }
  }
  else if (hue < 1020)
  {
    r = 0;
    if (hue < 765)
    {
      g = 255;
      b = hue - 510;
    }
    else
    {
      g = 1020 - hue;
      b = 255;
    }
  }
  else if (hue < 1530)
  {
    g = 0;
    if (hue < 1275)
    {
      r = hue - 1020;
      b = 255;
    }
    else
    {
      r = 255;
      b = 1530 - hue;
    }
  }
  else
  {
    r = 255;
    g = b = 0;
  }
  uint32_t v1 = 1 + val;
  uint16_t s1 = 1 + sat;
  uint8_t s2 = 255 - sat;
  return ((((((r * s1) >> 8) + s2) * v1) & 0xff00) << 8) | (((((g * s1) >> 8) + s2) * v1) & 0xff00) |
         (((((b * s1) >> 8) + s2) * v1) >> 8);
}
