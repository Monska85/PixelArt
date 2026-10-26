// SPDX-License-Identifier: GPL-3.0-or-later

// How long a WiFi connection may stay silent before the board closes it
// (docs/board/wifi-and-updates-v1.md#protocol-over-wifi). Plain C++: the caller gives the time and
// the open sockets, so the timing rules have native tests.

#pragma once

#include <cstddef>
#include <cstdint>

namespace pixelart_net
{

// A socket that has not finished its WebSocket handshake after this long is closed.
constexpr uint32_t HANDSHAKE_TIMEOUT_MS = 10000;
// With the network login on, the client that holds the slot must log in within this long.
constexpr uint32_t LOGIN_TIMEOUT_MS = 30000;

class ConnectionWatch
{
public:
  static constexpr size_t MAX_SOCKETS = 8;

  // `open` lists the sockets the server holds, `slot` is the one of the client that completed its
  // handshake (-1 for none), `generation` tells which client it is (it changes with every claim of the
  // slot, as the socket number alone may come back as another client), `login_pending` tells that the
  // network login is on and the client at the slot has not logged in. Times are milliseconds on a clock that wraps at
  // 2^32. Writes into `expired` the sockets to close (at most `capacity`) and returns how many: those other than the
  // slot that have been open for HANDSHAKE_TIMEOUT_MS, and the slot itself once the login has been pending for
  // LOGIN_TIMEOUT_MS. A socket reported is forgotten, so a close that fails is reported again only after the same wait.
  size_t check(const int *open, size_t count, int slot, uint32_t generation, bool login_pending, uint32_t now_ms,
               int *expired, size_t capacity);

private:
  int fd_[MAX_SOCKETS];
  uint32_t since_[MAX_SOCKETS];
  size_t used_ = 0;
  bool pending_ = false;
  int pending_slot_ = -1;
  uint32_t pending_generation_ = 0;
  uint32_t pending_since_ = 0;
};

} // namespace pixelart_net
