// SPDX-License-Identifier: GPL-3.0-or-later

#include "net_page.h"

#include <cstring>

namespace pixelart_net
{

const Header INERT_HEADERS[INERT_HEADER_COUNT] = {
    {"Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'"},
    {"X-Content-Type-Options", "nosniff"},
    {"Cache-Control", "no-store"},
    {"Connection", "close"},
};

namespace
{

const Response RESPONSES[] = {
    {"200 OK", "text/html; charset=utf-8", nullptr, nullptr},
    {"404 Not Found", "text/plain; charset=utf-8", "Not found", nullptr},
    {"405 Method Not Allowed", "text/plain; charset=utf-8", "Method not allowed", "GET"},
};

const char PAGE_HEAD[] = "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\">"
                         "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
                         "<meta name=\"color-scheme\" content=\"light dark\"><title>PixelArt board</title>"
                         "<h1>PixelArt board</h1><p>This is a PixelArt board. Manage it with the "
                         "<a href=\"";
const char PAGE_TAIL[] = "\" rel=\"noopener noreferrer\">PixelArt web app</a>.</p>";

// The page with the longest address a build accepts fits, with its end.
static_assert(sizeof(PAGE_HEAD) - 1 + MAX_SITE_URL + sizeof(PAGE_TAIL) < PAGE_CAPACITY, "PAGE_CAPACITY is too small");

const char *entity(char c)
{
  switch (c)
  {
  case '&':
    return "&amp;";
  case '<':
    return "&lt;";
  case '>':
    return "&gt;";
  case '"':
    return "&quot;";
  case '\'':
    return "&#39;";
  default:
    return nullptr;
  }
}

} // namespace

const Response &response_for(Answer answer) { return RESPONSES[static_cast<size_t>(answer)]; }

size_t render_page(char *out, size_t capacity, const char *site_url)
{
  if (!out || !site_url || !*site_url)
    return 0;
  size_t at = 0;
  auto put = [&](const char *text, size_t size)
  {
    if (at + size >= capacity)
      return false;
    memcpy(out + at, text, size);
    at += size;
    return true;
  };
  if (!put(PAGE_HEAD, sizeof(PAGE_HEAD) - 1))
    return 0;
  for (const char *p = site_url; *p; p++)
  {
    const char *replacement = entity(*p);
    if (replacement ? !put(replacement, strlen(replacement)) : !put(p, 1))
      return 0;
  }
  if (!put(PAGE_TAIL, sizeof(PAGE_TAIL) - 1))
    return 0;
  out[at] = '\0';
  return at;
}

} // namespace pixelart_net
