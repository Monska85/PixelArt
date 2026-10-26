// SPDX-License-Identifier: GPL-3.0-or-later

// What the board reads from a WebSocket handshake (docs/board/wifi-and-updates-v1.md#protocol-over-wifi).
// The ESP-IDF HTTP server answers a handshake on its own and never calls the URI handler for it, and the
// Arduino core's libraries are built without its handshake callbacks, so the board watches the bytes of
// the socket instead: the request head as it is received, for its `Origin`
// header, and the server's answer as it is sent, which tells that the handshake is done. Plain C++ so the
// rules have native tests.

#pragma once

#include <cstddef>

namespace pixelart_net
{

// The longest `Origin` value read; a longer one is refused.
constexpr size_t MAX_ORIGIN = 255;

// Reads the `Origin` header of one request head, fed in pieces as they arrive.
class HeadScanner
{
public:
  // Bytes received on the socket. A byte after the blank line that ends the head starts the head of
  // the next request on the connection, which replaces the one before.
  void feed(const char *data, size_t size);

  // Whether the blank line that ends the head has arrived.
  bool complete() const { return complete_; }

  // Whether the origin rule accepts the head: the first `Origin` header, its name in any case, its value
  // without the spaces and tabs around it, or no header at all. A head that is not complete, or an
  // origin longer than MAX_ORIGIN or holding a NUL, is refused.
  // `site_origin` is passed on to pixelart_net::origin_allowed.
  bool origin_allowed(const char *site_origin = nullptr) const;

  void reset();

private:
  void end_line();

  char value_[MAX_ORIGIN + 1] = {};
  size_t value_size_ = 0;
  size_t line_ = 0;   // lines finished, the request line included
  size_t column_ = 0; // characters of the current line, without carriage returns
  bool complete_ = false;
  bool name_matches_ = true; // the current line still starts like "origin:"
  bool in_value_ = false;
  bool found_ = false;
  bool unreadable_ = false; // too long, or holds a NUL
};

// Whether `data`, which the server sends on a socket, starts its answer to a WebSocket handshake.
bool is_handshake_answer(const char *data, size_t size);

} // namespace pixelart_net
