// SPDX-License-Identifier: GPL-3.0-or-later

// Power protection on the board: the reset reason, the marker in RTC memory and the record in NVS. See
// include/power.h.

#ifndef PIXELART_SIM

#include <esp_attr.h>
#include <esp_system.h>
#include <nvs.h>

#include "power.h"

namespace power
{
namespace detail
{

namespace
{

const char *NAMESPACE = "pixelart_power";
const char *KEY_RECORD = "record";

// Kept by a reset, random after a power cut: the magic value and the checks tell the two apart.
RTC_NOINIT_ATTR Marker rtc_marker;

} // namespace

pixelart::ResetReason boot_reason()
{
  switch (esp_reset_reason())
  {
  case ESP_RST_BROWNOUT:
    return pixelart::ResetReason::Brownout;
  case ESP_RST_POWERON:
    return pixelart::ResetReason::PowerOn;
  case ESP_RST_SW:
    return pixelart::ResetReason::Software;
  case ESP_RST_PANIC:
    return pixelart::ResetReason::Panic;
  case ESP_RST_INT_WDT:
  case ESP_RST_TASK_WDT:
  case ESP_RST_WDT:
    return pixelart::ResetReason::Watchdog;
  case ESP_RST_DEEPSLEEP:
    return pixelart::ResetReason::DeepSleep;
  default:
    return pixelart::ResetReason::Other;
  }
}

Marker &marker() { return rtc_marker; }

uint8_t model_version() { return pixelart::POWER_MODEL_VERSION; }

Load load_record(uint8_t *bytes, size_t capacity, size_t &size)
{
  nvs_handle_t handle;
  esp_err_t opened = nvs_open(NAMESPACE, NVS_READONLY, &handle);
  if (opened == ESP_ERR_NVS_NOT_FOUND)
    return Load::Missing;
  if (opened != ESP_OK)
    return Load::Failed;
  size = capacity;
  const esp_err_t read = nvs_get_blob(handle, KEY_RECORD, bytes, &size);
  nvs_close(handle);
  if (read == ESP_ERR_NVS_NOT_FOUND)
    return Load::Missing;
  return read == ESP_OK ? Load::Ok : Load::Failed;
}

bool store_record(const uint8_t *bytes, size_t size)
{
  nvs_handle_t handle;
  if (nvs_open(NAMESPACE, NVS_READWRITE, &handle) != ESP_OK)
    return false;
  const bool ok = nvs_set_blob(handle, KEY_RECORD, bytes, size) == ESP_OK && nvs_commit(handle) == ESP_OK;
  nvs_close(handle);
  return ok;
}

} // namespace detail
} // namespace power

#endif
