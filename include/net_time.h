// SPDX-License-Identifier: GPL-3.0-or-later

// The local time and date, from SNTP, for an install window narrower than the whole day and for a schedule
// (docs/board/wifi-and-updates-v1.md#time). Board only: the simulator's time comes from --update-time and --date.

#pragma once

#ifndef PIXELART_SIM

#include <pixelart_engine.h>

#include <cstdint>
#include <string>

namespace net_time
{

// Called by the network task. While `needed`, applies the POSIX TZ string and, once `online`, asks `server` for
// the time now and every `sync_hours` hours, and again at once when the server changes. When not needed it stops
// and forgets the time.
void configure(bool needed, bool online, const std::string &timezone, const std::string &server, uint32_t sync_hours);

// The local time as minutes after midnight, false until SNTP has set the clock.
bool local_minutes(uint16_t &minutes);

// The local date, false until SNTP has set the clock.
bool local_date(pixelart::LocalDate &date);

} // namespace net_time

#endif
