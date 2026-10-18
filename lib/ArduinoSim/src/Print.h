// Arduino Print base class for the native simulator.

#pragma once

#include <cstddef>
#include <cstdint>

#include "WString.h"

#define DEC 10
#define HEX 16
#define OCT 8
#define BIN 2

class Print
{
public:
  virtual ~Print() = default;
  virtual size_t write(uint8_t c) = 0;
  virtual size_t write(const uint8_t *buffer, size_t size);
  size_t write(const char *str);
  size_t write(const char *buffer, size_t size) { return write((const uint8_t *)buffer, size); }

  size_t print(const __FlashStringHelper *s);
  size_t print(const String &s);
  size_t print(const char *s);
  size_t print(char c);
  size_t print(unsigned char v, int base = DEC);
  size_t print(int v, int base = DEC);
  size_t print(unsigned int v, int base = DEC);
  size_t print(long v, int base = DEC);
  size_t print(unsigned long v, int base = DEC);
  size_t print(long long v, int base = DEC);
  size_t print(unsigned long long v, int base = DEC);
  size_t print(double v, int digits = 2);

  size_t println();
  template <typename T> size_t println(const T &v) { return print(v) + println(); }
  template <typename T> size_t println(const T &v, int fmt) { return print(v, fmt) + println(); }

  size_t printf(const char *format, ...) __attribute__((format(printf, 2, 3)));
};
