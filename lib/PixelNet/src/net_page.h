// SPDX-License-Identifier: GPL-3.0-or-later

// What the board's HTTP server answers apart from the WebSocket
// (docs/board/wifi-and-updates-v1.md#the-page-at-): the page at `/`, the 404 and the 405. Plain C++ so
// the texts and the headers have native tests; src/ws_server_board.cpp only sends them.

#pragma once

#include <cstddef>

namespace pixelart_net
{

// A response header.
struct Header
{
  const char *name;
  const char *value;
};

// The headers every answer carries, which keep it inert: no content other than itself, no guessing of
// the type, no cache, and the connection is closed afterwards.
constexpr size_t INERT_HEADER_COUNT = 4;
extern const Header INERT_HEADERS[INERT_HEADER_COUNT];

enum class Answer
{
  Page,
  NotFound,
  MethodNotAllowed
};

struct Response
{
  const char *status;       // the status line text, for example "404 Not Found"
  const char *content_type; // always with a charset
  const char *body;         // null for the page, which render_page makes
  const char *allow;        // the value of an `Allow` header, or null
};

const Response &response_for(Answer answer);

// The longest site address a build accepts (tools/site_url.py MAX_SITE_URL): its manifest must fit the
// animation_source limit of include/settings.h, 512 characters.
constexpr size_t MAX_SITE_URL = 499;
// Room that render_page needs for any site address the build accepts, whose characters need no escaping.
constexpr size_t PAGE_CAPACITY = 1280;

// Writes the page, with a link to `site_url` (the web app), into `out`, ending with NUL. Returns the
// length, or 0 when `site_url` is empty or the page does not fit in `capacity`. The characters that
// HTML treats specially are written as entities, whatever the address holds.
size_t render_page(char *out, size_t capacity, const char *site_url);

} // namespace pixelart_net
