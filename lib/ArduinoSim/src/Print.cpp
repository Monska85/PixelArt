#include "Print.h"

#include <cstdarg>
#include <cstdio>
#include <cstring>
#include <string>

size_t Print::write(const uint8_t *buffer, size_t size)
{
  size_t n = 0;
  while (size--)
    n += write(*buffer++);
  return n;
}

size_t Print::write(const char *str) { return str ? write((const uint8_t *)str, strlen(str)) : 0; }

static std::string toBase(unsigned long long v, int base)
{
  if (base < 2)
    base = 10;
  std::string out;
  do
  {
    int d = (int)(v % base);
    out.insert(out.begin(), (char)(d < 10 ? '0' + d : 'A' + d - 10));
    v /= base;
  } while (v);
  return out;
}

size_t Print::print(const __FlashStringHelper *s) { return write(reinterpret_cast<const char *>(s)); }
size_t Print::print(const String &s) { return write(s.c_str()); }
size_t Print::print(const char *s) { return write(s); }
size_t Print::print(char c) { return write((uint8_t)c); }
size_t Print::print(unsigned char v, int base) { return print((unsigned long long)v, base); }
size_t Print::print(int v, int base) { return print((long long)v, base); }
size_t Print::print(unsigned int v, int base) { return print((unsigned long long)v, base); }
size_t Print::print(long v, int base) { return print((long long)v, base); }
size_t Print::print(unsigned long v, int base) { return print((unsigned long long)v, base); }

size_t Print::print(long long v, int base)
{
  if (base == 10 && v < 0)
    return write("-") + write(toBase((unsigned long long)(-v), 10).c_str());
  return write(toBase((unsigned long long)v, base).c_str());
}

size_t Print::print(unsigned long long v, int base) { return write(toBase(v, base).c_str()); }

size_t Print::print(double v, int digits)
{
  char buf[64];
  snprintf(buf, sizeof(buf), "%.*f", digits, v);
  return write(buf);
}

size_t Print::println() { return write("\r\n"); }

size_t Print::printf(const char *format, ...)
{
  char buf[512];
  va_list args;
  va_start(args, format);
  int len = vsnprintf(buf, sizeof(buf), format, args);
  va_end(args);
  if (len < 0)
    return 0;
  if ((size_t)len < sizeof(buf))
    return write((const uint8_t *)buf, len);
  std::string big(len + 1, '\0');
  va_start(args, format);
  vsnprintf(&big[0], big.size(), format, args);
  va_end(args);
  return write((const uint8_t *)big.data(), len);
}
