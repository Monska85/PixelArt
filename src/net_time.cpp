// SPDX-License-Identifier: GPL-3.0-or-later

#ifndef PIXELART_SIM

#include "net_time.h"

#include <Arduino.h>
#include <esp_sntp.h>

#include <atomic>
#include <cstdlib>
#include <cstring>
#include <ctime>

namespace net_time
{

namespace
{

constexpr uint32_t MS_PER_HOUR = 60UL * 60 * 1000;

std::atomic<bool> synced{false};
std::atomic<uint32_t> synced_at{0}; // millis() of the last answer
bool running = false;
std::string applied_timezone;
// SNTP keeps the pointer it is given, so the name lives here.
char server_name[65] = "";
uint32_t interval_ms = 0;
// The interval changed: SNTP is stopped and starts again when the next request is due, counted from the last answer.
bool resume_pending = false;
uint32_t resume_at = 0;

void on_sync(struct timeval *)
{
  synced_at = millis();
  synced = true;
}

void stop()
{
  if (running)
    esp_sntp_stop();
  running = false;
}

// Starts SNTP, which asks the server at once and then every `interval_ms`.
void start()
{
  esp_sntp_setoperatingmode(ESP_SNTP_OPMODE_POLL);
  esp_sntp_setservername(0, server_name);
  esp_sntp_set_time_sync_notification_cb(on_sync);
  esp_sntp_set_sync_interval(interval_ms);
  esp_sntp_init();
  running = true;
  resume_pending = false;
}

bool local_tm(struct tm &local)
{
  if (!synced)
    return false;
  const time_t now = time(nullptr);
  localtime_r(&now, &local);
  return true;
}

} // namespace

void configure(bool needed, bool online, const std::string &timezone, const std::string &server, uint32_t sync_hours)
{
  if (!needed)
  {
    stop();
    synced = false;
    resume_pending = false;
    return;
  }
  if (timezone != applied_timezone)
  {
    setenv("TZ", timezone.c_str(), 1);
    tzset();
    applied_timezone = timezone;
  }
  const uint32_t interval = sync_hours * MS_PER_HOUR;
  if (server != server_name)
  {
    stop(); // a new server is asked at once
    resume_pending = false;
    snprintf(server_name, sizeof(server_name), "%s", server.c_str());
  }
  if (interval != interval_ms)
  {
    interval_ms = interval;
    if (running && synced)
    {
      // SNTP would wait out the old interval: it starts again when the new one ends after the last answer.
      stop();
      resume_pending = true;
      resume_at = synced_at + interval_ms;
    }
    else if (running)
      esp_sntp_set_sync_interval(interval_ms); // still asking: the interval applies after the first answer
  }
  if (running || !online)
    return;
  if (resume_pending && (int32_t)(millis() - resume_at) < 0)
    return;
  start();
}

bool local_minutes(uint16_t &minutes)
{
  struct tm local;
  if (!local_tm(local))
    return false;
  minutes = (uint16_t)(local.tm_hour * 60 + local.tm_min);
  return true;
}

bool local_date(pixelart::LocalDate &date)
{
  struct tm local;
  if (!local_tm(local))
    return false;
  date.year = (uint16_t)(local.tm_year + 1900);
  date.month = (uint8_t)(local.tm_mon + 1);
  date.day = (uint8_t)local.tm_mday;
  return true;
}

} // namespace net_time

#endif
