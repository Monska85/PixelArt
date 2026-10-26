// SPDX-License-Identifier: GPL-3.0-or-later

// The time of day, from SNTP, for an install window narrower than the whole day
// (docs/board/wifi-and-updates-v1.md#time). Board only: the simulator's time comes from --update-time.

#pragma once

#ifndef PIXELART_SIM

#include <cstdint>
#include <string>

namespace net_time
{

// Called by the network task. While `needed`, applies the POSIX TZ string and, once `online`, asks
// pool.ntp.org for the time now and every 12 hours. When not needed it stops and forgets the time.
void configure(bool needed, bool online, const std::string &timezone);

// The local time as minutes after midnight, false until SNTP has set the clock.
bool local_minutes(uint16_t &minutes);

} // namespace net_time

#endif
