// SPDX-License-Identifier: GPL-3.0-or-later

#include "update_schedule.h"

namespace pixelart_update
{

void Schedule::on_address(uint64_t now)
{
  if (armed_)
    return;
  armed_ = true;
  next_ = now + FIRST_CHECK_DELAY_MS;
}

void Schedule::on_check_done(uint64_t now, bool ok, uint32_t check_hours, uint32_t jitter_ms)
{
  armed_ = true;
  if (!ok)
  {
    next_ = now + RETRY_DELAY_MS;
    return;
  }
  if (jitter_ms > MAX_JITTER_MS)
    jitter_ms = MAX_JITTER_MS;
  next_ = now + (uint64_t)check_hours * MS_PER_HOUR + jitter_ms;
}

uint64_t Schedule::wait_ms(uint64_t now) const
{
  if (!armed_)
    return UINT64_MAX;
  return now >= next_ ? 0 : next_ - now;
}

WindowState window_state(uint16_t start, uint16_t end, bool time_known, uint16_t minutes)
{
  if (start == end)
    return WindowState::Open;
  if (!time_known)
    return WindowState::WaitingForTime;
  const bool inside = start < end ? (minutes >= start && minutes < end) : (minutes >= start || minutes < end);
  return inside ? WindowState::Open : WindowState::Closed;
}

} // namespace pixelart_update
