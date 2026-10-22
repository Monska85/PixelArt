// Arduino Print base class for the native simulator.

#pragma once

#include <cstddef>
#include <cstdint>

#include "WString.h"

class Print
{
public:
  virtual ~Print() = default;
  virtual size_t write(uint8_t c) = 0;
  virtual size_t write(const uint8_t *buffer, size_t size);
  size_t write(const char *str);
  size_t write(const char *buffer, size_t size) { return write((const uint8_t *)buffer, size); }

  size_t print(const char *s) { return write(s); }

  size_t println();
  template <typename T> size_t println(const T &v) { return print(v) + println(); }

  size_t printf(const char *format, ...) __attribute__((format(printf, 2, 3)));
};
