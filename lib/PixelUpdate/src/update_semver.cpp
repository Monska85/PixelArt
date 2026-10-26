// SPDX-License-Identifier: GPL-3.0-or-later

#include "update_semver.h"

#include <cstddef>

namespace pixelart_update
{

namespace
{

bool is_digit(char c) { return c >= '0' && c <= '9'; }

bool is_identifier_char(char c) { return is_digit(c) || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '-'; }

bool all_digits(const std::string &s)
{
  for (char c : s)
    if (!is_digit(c))
      return false;
  return !s.empty();
}

// A number of at most 18 digits without a leading zero (zero itself is one digit).
bool parse_number(const std::string &text, unsigned long long &out)
{
  if (!all_digits(text) || text.size() > 18 || (text.size() > 1 && text[0] == '0'))
    return false;
  out = 0;
  for (char c : text)
    out = out * 10 + (unsigned)(c - '0');
  return true;
}

// Splits `text` at '.', refusing empty parts.
bool split_identifiers(const std::string &text, std::vector<std::string> &out)
{
  size_t start = 0;
  for (;;)
  {
    size_t dot = text.find('.', start);
    std::string part = text.substr(start, dot == std::string::npos ? std::string::npos : dot - start);
    if (part.empty())
      return false;
    for (char c : part)
      if (!is_identifier_char(c))
        return false;
    out.push_back(part);
    if (dot == std::string::npos)
      return true;
    start = dot + 1;
  }
}

int compare_numbers(const std::string &a, const std::string &b)
{
  // Digit strings without leading zeros: the longer one is larger.
  if (a.size() != b.size())
    return a.size() < b.size() ? -1 : 1;
  int c = a.compare(b);
  return c < 0 ? -1 : (c > 0 ? 1 : 0);
}

} // namespace

bool parse_version(const std::string &text, Version &out)
{
  Version v;
  std::string core = text;
  const size_t plus = core.find('+');
  if (plus != std::string::npos)
  {
    std::vector<std::string> build;
    if (!split_identifiers(core.substr(plus + 1), build))
      return false;
    core.resize(plus);
  }
  const size_t dash = core.find('-');
  if (dash != std::string::npos)
  {
    if (!split_identifiers(core.substr(dash + 1), v.pre_release))
      return false;
    for (const std::string &id : v.pre_release)
      if (all_digits(id) && id.size() > 1 && id[0] == '0')
        return false;
    core.resize(dash);
  }
  const size_t first = core.find('.');
  const size_t second = first == std::string::npos ? first : core.find('.', first + 1);
  if (second == std::string::npos || core.find('.', second + 1) != std::string::npos)
    return false;
  if (!parse_number(core.substr(0, first), v.major) ||
      !parse_number(core.substr(first + 1, second - first - 1), v.minor) ||
      !parse_number(core.substr(second + 1), v.patch))
    return false;
  out = v;
  return true;
}

int compare_versions(const Version &a, const Version &b)
{
  if (a.major != b.major)
    return a.major < b.major ? -1 : 1;
  if (a.minor != b.minor)
    return a.minor < b.minor ? -1 : 1;
  if (a.patch != b.patch)
    return a.patch < b.patch ? -1 : 1;
  // A release is higher than any pre-release of the same number.
  if (a.pre_release.empty() != b.pre_release.empty())
    return a.pre_release.empty() ? 1 : -1;
  const size_t common = a.pre_release.size() < b.pre_release.size() ? a.pre_release.size() : b.pre_release.size();
  for (size_t i = 0; i < common; i++)
  {
    const std::string &x = a.pre_release[i], &y = b.pre_release[i];
    const bool x_numeric = all_digits(x), y_numeric = all_digits(y);
    if (x_numeric && y_numeric)
    {
      if (int c = compare_numbers(x, y))
        return c;
    }
    else if (x_numeric != y_numeric)
      return x_numeric ? -1 : 1; // numeric identifiers are lower than alphanumeric ones
    else if (int c = x.compare(y))
      return c < 0 ? -1 : 1;
  }
  if (a.pre_release.size() != b.pre_release.size())
    return a.pre_release.size() < b.pre_release.size() ? -1 : 1;
  return 0;
}

bool is_newer_version(const std::string &candidate, const std::string &running)
{
  Version a, b;
  return parse_version(candidate, a) && parse_version(running, b) && compare_versions(a, b) > 0;
}

} // namespace pixelart_update
