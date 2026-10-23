// SPDX-License-Identifier: GPL-3.0-or-later

// When the board checks for updates and when it may install them
// (docs/board/wifi-and-updates-v1.md#checks, #install-window). Times are milliseconds from any
// monotonic origin, in 64 bits so a long run never wraps.

#pragma once

#include <cstdint>

namespace pixelart_update
{

constexpr uint64_t MS_PER_MINUTE = 60ULL * 1000;
constexpr uint64_t MS_PER_HOUR = 60 * MS_PER_MINUTE;
constexpr uint64_t FIRST_CHECK_DELAY_MS = 5 * MS_PER_MINUTE;
constexpr uint64_t RETRY_DELAY_MS = 30 * MS_PER_MINUTE;
constexpr uint32_t MAX_JITTER_MS = (uint32_t)(10 * MS_PER_MINUTE);

// The times of the checks. The first check is 5 minutes after the board first has an address after
// a restart. A check that ends well schedules the next one `check_hours` later plus a random delay
// of up to 10 minutes, so boards do not all ask at once; a failed one is retried after 30 minutes.
class Schedule
{
public:
  // The board has an address. Only the first call after a restart sets the time of the first check.
  void on_address(uint64_t now);
  // A check ended. `jitter_ms` is a random number from 0 to MAX_JITTER_MS (larger values are cut).
  void on_check_done(uint64_t now, bool ok, uint32_t check_hours, uint32_t jitter_ms);

  bool armed() const { return armed_; }
  // Whether a check is due. False until the board has had an address.
  bool due(uint64_t now) const { return armed_ && now >= next_; }
  // Milliseconds until a check is due, 0 when it is, UINT64_MAX before the first address.
  uint64_t wait_ms(uint64_t now) const;
  uint64_t next_at() const { return next_; }

private:
  bool armed_ = false;
  uint64_t next_ = 0;
};

// Whether an install may start now, in the window from `start` to `end` (minutes after midnight, 0
// to 1439). Equal values are the whole day. An end before the start runs over midnight. The start
// is in the window and the end is not.
enum class WindowState
{
  Open,
  Closed,
  WaitingForTime // narrower than the whole day and the time is not known
};

// `minutes` is the local time as minutes after midnight, valid when `time_known`.
WindowState window_state(uint16_t start, uint16_t end, bool time_known, uint16_t minutes);

} // namespace pixelart_update
