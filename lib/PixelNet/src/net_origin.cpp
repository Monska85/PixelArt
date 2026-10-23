// SPDX-License-Identifier: GPL-3.0-or-later

#include "net_origin.h"

#include <cctype>
#include <cstddef>
#include <cstring>
#include <string>

namespace pixelart_net
{

namespace
{

constexpr size_t MAX_ORIGIN = 255;
// The project's own site, used without a site origin; tools/test_site_url.py (ProjectAddressTest) keeps it in step.
const char SITE_ORIGIN[] = "https://monska85.github.io";

bool is_digit(char c) { return c >= '0' && c <= '9'; }

// Four decimal numbers from 0 to 255 without leading zeros, separated by dots.
bool parse_ipv4(const std::string &host, unsigned out[4])
{
  size_t at = 0;
  for (int part = 0; part < 4; part++)
  {
    const size_t start = at;
    unsigned value = 0;
    while (at < host.size() && is_digit(host[at]))
    {
      value = value * 10 + (unsigned)(host[at] - '0');
      if (++at - start > 3)
        return false;
    }
    const size_t digits = at - start;
    if (digits == 0 || (digits > 1 && host[start] == '0') || value > 255)
      return false;
    out[part] = value;
    if (part < 3)
    {
      if (at >= host.size() || host[at] != '.')
        return false;
      at++;
    }
  }
  return at == host.size();
}

bool private_ipv4(const unsigned a[4])
{
  return a[0] == 10 || a[0] == 127 || (a[0] == 172 && a[1] >= 16 && a[1] <= 31) || (a[0] == 192 && a[1] == 168) ||
         (a[0] == 169 && a[1] == 254);
}

// Labels of lowercase letters, digits and hyphens, none empty, none starting or ending with a hyphen.
bool valid_name(const std::string &host)
{
  size_t label = 0;
  for (size_t i = 0; i <= host.size(); i++)
  {
    if (i == host.size() || host[i] == '.')
    {
      if (label == 0 || host[i - 1] == '-')
        return false;
      label = 0;
      continue;
    }
    const char c = host[i];
    if (!((c >= 'a' && c <= 'z') || is_digit(c) || c == '-'))
      return false;
    if (label == 0 && c == '-')
      return false;
    label++;
  }
  return true;
}

bool ends_with(const std::string &text, const char *suffix)
{
  const size_t n = strlen(suffix);
  return text.size() > n && text.compare(text.size() - n, n, suffix) == 0;
}

bool valid_port(const std::string &port)
{
  if (port.empty() || port.size() > 5)
    return false;
  unsigned value = 0;
  for (char c : port)
  {
    if (!is_digit(c))
      return false;
    value = value * 10 + (unsigned)(c - '0');
  }
  return value <= 65535;
}

bool allowed_host(const std::string &host)
{
  if (host == "localhost")
    return true;
  unsigned address[4];
  if (parse_ipv4(host, address))
    return private_ipv4(address);
  return ends_with(host, ".local") && valid_name(host);
}

} // namespace

std::string site_origin_of(const char *site_url)
{
  const std::string url(site_url ? site_url : "");
  if (url.compare(0, 8, "https://") != 0)
    return "";
  const size_t end = url.find_first_of("/?#", 8);
  std::string origin = url.substr(0, end);
  // As a browser writes an origin: lowercase, and without the port 443 of https.
  for (char &c : origin)
    c = (char)tolower((unsigned char)c);
  if (origin.size() > 4 && origin.compare(origin.size() - 4, 4, ":443") == 0)
    origin.erase(origin.size() - 4);
  return origin.size() > 8 ? origin : "";
}

bool origin_allowed(const char *origin, const char *site_origin)
{
  if (!origin)
    return true;
  const std::string text(origin);
  if (text.size() > MAX_ORIGIN)
    return false;
  if (text == (site_origin && *site_origin ? site_origin : SITE_ORIGIN))
    return true;

  size_t scheme_size = 0;
  if (text.compare(0, 7, "http://") == 0)
    scheme_size = 7;
  else if (text.compare(0, 8, "https://") == 0)
    scheme_size = 8;
  else
    return false;

  const std::string authority = text.substr(scheme_size);
  const size_t colon = authority.find(':');
  const std::string host = authority.substr(0, colon);
  if (colon != std::string::npos && !valid_port(authority.substr(colon + 1)))
    return false;
  return allowed_host(host);
}

} // namespace pixelart_net
