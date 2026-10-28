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
std::string applied_timezone;
// SNTP keeps the pointer it is given, so the name lives here.
char server_name[65] = "";
uint32_t interval_ms = 0;

enum class Sntp
{
  Off,      // stopped
  Running,  // asks the server, at once and then every `interval_ms`
  Resuming, // stopped after an interval change: starts again at `resume_at`
};
Sntp state = Sntp::Off;
uint32_t resume_at = 0; // millis() when a Resuming SNTP starts again

void on_sync(struct timeval *)
{
  synced_at = millis();
  synced = true;
}

void stop()
{
  if (state == Sntp::Running)
    esp_sntp_stop();
  state = Sntp::Off;
}

// Starts SNTP, which asks the server at once and then every `interval_ms`.
void start()
{
  esp_sntp_setoperatingmode(ESP_SNTP_OPMODE_POLL);
  esp_sntp_setservername(0, server_name);
  esp_sntp_set_time_sync_notification_cb(on_sync);
  esp_sntp_set_sync_interval(interval_ms);
  esp_sntp_init();
  state = Sntp::Running;
}

// A new server is asked at once: stop() leaves SNTP Off, also from Resuming, so configure() starts it again.
void apply_server(const std::string &server)
{
  if (server == server_name)
    return;
  stop();
  snprintf(server_name, sizeof(server_name), "%s", server.c_str());
}

// SNTP waits out the interval it was started with before it asks again. So after an answer a new interval
// stops it, and it starts again when the new interval ends after the last answer, also when the interval
// changes again while it waits. While it still waits for its first answer, the new interval applies after
// that answer.
void apply_interval(uint32_t interval)
{
  if (interval == interval_ms)
    return;
  interval_ms = interval;
  if (state == Sntp::Resuming)
    resume_at = synced_at + interval_ms;
  if (state != Sntp::Running)
    return;
  if (synced)
  {
    stop();
    state = Sntp::Resuming;
    resume_at = synced_at + interval_ms;
  }
  else
    esp_sntp_set_sync_interval(interval_ms);
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
    return;
  }
  if (timezone != applied_timezone)
  {
    setenv("TZ", timezone.c_str(), 1);
    tzset();
    applied_timezone = timezone;
  }
  apply_server(server);
  apply_interval(sync_hours * MS_PER_HOUR);
  // Checked on every call, online or not, so a reached deadline is seen at the next call: left unchecked for
  // about 24.8 days, the wrapping comparison would read it as still ahead.
  if (state == Sntp::Resuming && (int32_t)(millis() - resume_at) >= 0)
    state = Sntp::Off;
  if (state != Sntp::Off || !online)
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
