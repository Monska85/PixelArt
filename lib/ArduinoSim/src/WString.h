// Small subset of the Arduino String class, backed by std::string.

#pragma once

#include <string>

class __FlashStringHelper;

class String
{
public:
  String() = default;
  String(const char *s) : s_(s ? s : "") {}
  String(const std::string &s) : s_(s) {}
  String(const __FlashStringHelper *s) : s_(reinterpret_cast<const char *>(s)) {}
  explicit String(char c) : s_(1, c) {}
  explicit String(int v, unsigned char base = 10) : s_(fmt((long)v, base)) {}
  explicit String(unsigned int v, unsigned char base = 10) : s_(fmtu(v, base)) {}
  explicit String(long v, unsigned char base = 10) : s_(fmt(v, base)) {}
  explicit String(unsigned long v, unsigned char base = 10) : s_(fmtu(v, base)) {}
  explicit String(float v, unsigned char decimals = 2) : s_(fmtf(v, decimals)) {}
  explicit String(double v, unsigned char decimals = 2) : s_(fmtf(v, decimals)) {}

  unsigned int length() const { return (unsigned int)s_.size(); }
  const char *c_str() const { return s_.c_str(); }
  char charAt(unsigned int i) const { return i < s_.size() ? s_[i] : 0; }
  char operator[](unsigned int i) const { return charAt(i); }
  int indexOf(char c, unsigned int from = 0) const { return pos(s_.find(c, from)); }
  int indexOf(const String &s, unsigned int from = 0) const { return pos(s_.find(s.s_, from)); }
  String substring(unsigned int from) const { return from < s_.size() ? String(s_.substr(from)) : String(); }
  String substring(unsigned int from, unsigned int to) const
  {
    return from < s_.size() && to > from ? String(s_.substr(from, to - from)) : String();
  }
  long toInt() const { return std::strtol(s_.c_str(), nullptr, 10); }
  float toFloat() const { return std::strtof(s_.c_str(), nullptr); }
  bool equals(const String &o) const { return s_ == o.s_; }
  bool startsWith(const String &p) const { return s_.rfind(p.s_, 0) == 0; }
  bool endsWith(const String &p) const
  {
    return s_.size() >= p.s_.size() && s_.compare(s_.size() - p.s_.size(), p.s_.size(), p.s_) == 0;
  }
  void toUpperCase()
  {
    for (auto &c : s_)
      c = (char)std::toupper((unsigned char)c);
  }
  void toLowerCase()
  {
    for (auto &c : s_)
      c = (char)std::tolower((unsigned char)c);
  }
  void trim()
  {
    auto b = s_.find_first_not_of(" \t\r\n");
    auto e = s_.find_last_not_of(" \t\r\n");
    s_ = b == std::string::npos ? "" : s_.substr(b, e - b + 1);
  }

  String &operator+=(const String &o)
  {
    s_ += o.s_;
    return *this;
  }
  String &operator+=(const char *o)
  {
    s_ += o;
    return *this;
  }
  String &operator+=(char c)
  {
    s_ += c;
    return *this;
  }
  String &operator+=(int v)
  {
    s_ += fmt(v, 10);
    return *this;
  }
  String &operator+=(long v)
  {
    s_ += fmt(v, 10);
    return *this;
  }
  String &operator+=(unsigned int v)
  {
    s_ += fmtu(v, 10);
    return *this;
  }
  String &operator+=(unsigned long v)
  {
    s_ += fmtu(v, 10);
    return *this;
  }
  bool operator==(const String &o) const { return s_ == o.s_; }
  bool operator!=(const String &o) const { return s_ != o.s_; }
  bool operator<(const String &o) const { return s_ < o.s_; }

  friend String operator+(String a, const String &b) { return a += b; }
  friend String operator+(String a, const char *b) { return a += b; }
  friend String operator+(String a, char b) { return a += b; }
  friend String operator+(String a, int b) { return a += b; }
  friend String operator+(String a, long b) { return a += b; }
  friend String operator+(String a, unsigned int b) { return a += b; }
  friend String operator+(String a, unsigned long b) { return a += b; }

private:
  std::string s_;

  static int pos(size_t p) { return p == std::string::npos ? -1 : (int)p; }
  static std::string fmtu(unsigned long v, unsigned char base)
  {
    if (base < 2)
      base = 10;
    std::string out;
    do
    {
      unsigned d = v % base;
      out.insert(out.begin(), (char)(d < 10 ? '0' + d : 'a' + d - 10));
      v /= base;
    } while (v);
    return out;
  }
  static std::string fmt(long v, unsigned char base)
  {
    if (v < 0 && base == 10)
      return "-" + fmtu((unsigned long)(-v), base);
    return fmtu((unsigned long)v, base);
  }
  static std::string fmtf(double v, unsigned char decimals)
  {
    char buf[64];
    std::snprintf(buf, sizeof(buf), "%.*f", decimals, v);
    return buf;
  }
};
