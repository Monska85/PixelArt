// SPDX-License-Identifier: GPL-3.0-or-later

// Whether the client that holds the WiFi slot still answers
// (docs/board/wifi-and-updates-v1.md#protocol-over-wifi). A client that stalls keeps the slot, so when
// another client is refused the board pings the holder and closes it if nothing comes back. Plain C++:
// the caller gives the time and what the server saw, so the decision has native tests.

#pragma once

#include <cstdint>

namespace pixelart_net
{

// A holder that sends nothing for this long after the ping is closed at the next refusal. Any client on the
// network can start a check by being refused, so the wait is long enough for a holder that is merely slow.
constexpr uint32_t PONG_WAIT_MS = 3000;

class HolderCheck
{
public:
  enum class Action : uint8_t
  {
    Ping, // no check was running: ping the holder, the check has started
    Wait, // a check is running and its time is not up
    Close // nothing was heard for PONG_WAIT_MS: close the holder, the check has ended
  };

  // A new connection was refused because a client holds the slot. Times are milliseconds on a clock
  // that wraps at 2^32.
  Action refused(uint32_t now_ms);

  // A frame of any kind was read from the holder: it is alive, a running check ends.
  void heard() { running_ = false; }

  // The slot changed hands.
  void reset() { running_ = false; }

private:
  bool running_ = false;
  uint32_t since_ = 0;
};

} // namespace pixelart_net
