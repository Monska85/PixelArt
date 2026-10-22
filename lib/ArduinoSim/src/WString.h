// Small subset of the Arduino String class, backed by std::string.

#pragma once

#include <string>

class __FlashStringHelper;

class String
{
public:
  String(const char *s) : s_(s ? s : "") {}
  String(const __FlashStringHelper *s) : s_(reinterpret_cast<const char *>(s)) {}

  unsigned int length() const { return (unsigned int)s_.size(); }
  const char *c_str() const { return s_.c_str(); }

private:
  std::string s_;
};
