// SPDX-License-Identifier: GPL-3.0-or-later

#ifndef PIXELART_SIM

#include "net_time.h"

#include <esp_sntp.h>

#include <atomic>
#include <cstdlib>
#include <ctime>

namespace net_time
{

namespace
{

constexpr uint32_t RESYNC_MS = 12UL * 60 * 60 * 1000;
constexpr const char *SERVER = "pool.ntp.org";

std::atomic<bool> synced{false};
bool running = false;
std::string applied_timezone;

void on_sync(struct timeval *) { synced = true; }

} // namespace

void configure(bool needed, bool online, const std::string &timezone)
{
  if (!needed)
  {
    if (running)
      esp_sntp_stop();
    running = false;
    synced = false;
    return;
  }
  if (timezone != applied_timezone)
  {
    setenv("TZ", timezone.c_str(), 1);
    tzset();
    applied_timezone = timezone;
  }
  if (running || !online)
    return;
  esp_sntp_setoperatingmode(ESP_SNTP_OPMODE_POLL);
  esp_sntp_setservername(0, SERVER);
  esp_sntp_set_time_sync_notification_cb(on_sync);
  esp_sntp_set_sync_interval(RESYNC_MS);
  esp_sntp_init();
  running = true;
}

bool local_minutes(uint16_t &minutes)
{
  if (!synced)
    return false;
  const time_t now = time(nullptr);
  struct tm local;
  localtime_r(&now, &local);
  minutes = (uint16_t)(local.tm_hour * 60 + local.tm_min);
  return true;
}

} // namespace net_time

#endif
