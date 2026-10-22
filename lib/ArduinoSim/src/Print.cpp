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
