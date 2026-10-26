// SPDX-License-Identifier: GPL-3.0-or-later

// The board's firmware slots: the ESP-IDF OTA API and a namespace of NVS. See include/firmware.h.

#ifndef PIXELART_SIM

#include "firmware.h"

#include <Arduino.h>
#include <Preferences.h>
#include <esp_ota_ops.h>
#include <esp_partition.h>
#include <esp_system.h>

#include "firmware_detail.h"
#include "task_sync.h"

namespace firmware
{

namespace detail
{

namespace
{

const char *NAMESPACE = "pixelart_fw";
const char *KEY_SKIP = "skip";
const char *KEY_RESULT = "res";
const char *KEY_FROM = "from";
const char *KEY_TO = "to";
const char *KEY_CONFIRMED = "conf";
const char *KEY_PENDING_FROM = "pfrom";
const char *KEY_PENDING_TO = "pto";
constexpr uint8_t RESULT_UPDATED = 1;
constexpr uint8_t RESULT_ROLLED_BACK = 2;
constexpr uint32_t WRITE_WAIT_MS = 2000;

const esp_partition_t *target = nullptr;
esp_ota_handle_t handle = 0;
bool image_open = false;
size_t image_limit = 0;

std::string read_text(Preferences &prefs, const char *key)
{
  if (!prefs.isKey(key))
    return "";
  std::string text = prefs.getString(key, "").c_str();
  return text.size() <= MAX_VERSION ? text : "";
}

// An empty value is stored as an absent key: putString cannot tell a write of "" from a failure.
bool put_text(Preferences &prefs, const char *key, const std::string &value)
{
  if (value.empty())
    return !prefs.isKey(key) || prefs.remove(key);
  return prefs.putString(key, value.c_str()) == value.size();
}

} // namespace

void log_failure(const char *what) { Serial.printf("pixelart: %s\n", what); }

void load(Record &out)
{
  out = Record();
  Preferences prefs;
  if (!prefs.begin(NAMESPACE, true))
    return;
  out.skip = read_text(prefs, KEY_SKIP);
  const uint8_t result = prefs.getUChar(KEY_RESULT, 0);
  out.last.from = read_text(prefs, KEY_FROM);
  out.last.to = read_text(prefs, KEY_TO);
  out.last.present = (result == RESULT_UPDATED || result == RESULT_ROLLED_BACK) && !out.last.to.empty();
  out.last.rolled_back = result == RESULT_ROLLED_BACK;
  out.confirmed = prefs.getUChar(KEY_CONFIRMED, 0) == 1;
  out.pending_from = read_text(prefs, KEY_PENDING_FROM);
  out.pending_to = read_text(prefs, KEY_PENDING_TO);
  out.pending = !out.pending_to.empty();
  prefs.end();
}

// A write to NVS stops the flash cache, so the network task waits for a frame to be shown first. The loop
// task writes right after one, or at boot when it shows none. Each put or removal commits on its own, so the
// writes stop at the first failure: a later write must never land when an earlier one did not.
bool save(const Record &in, bool after_frame)
{
  if (after_frame)
    task_sync::wait_for_safe_write(WRITE_WAIT_MS);
  Preferences prefs;
  if (!prefs.begin(NAMESPACE, false))
    return false;
  const uint8_t result = !in.last.present ? 0 : (in.last.rolled_back ? RESULT_ROLLED_BACK : RESULT_UPDATED);
  const bool ok = put_text(prefs, KEY_SKIP, in.skip) && prefs.putUChar(KEY_RESULT, result) == 1 &&
                  put_text(prefs, KEY_FROM, in.last.from) && put_text(prefs, KEY_TO, in.last.to) &&
                  prefs.putUChar(KEY_CONFIRMED, in.confirmed ? 1 : 0) == 1 &&
                  put_text(prefs, KEY_PENDING_FROM, in.pending_from) &&
                  put_text(prefs, KEY_PENDING_TO, in.pending ? in.pending_to : "");
  prefs.end();
  return ok;
}

BootState boot()
{
  BootState state;
  esp_ota_img_states_t image_state;
  const esp_partition_t *running = esp_ota_get_running_partition();
  state.trial = running && esp_ota_get_state_partition(running, &image_state) == ESP_OK &&
                image_state == ESP_OTA_IMG_PENDING_VERIFY;
  // The slot of a rolled back firmware keeps its state until a new image is activated in it.
  state.invalid = esp_ota_get_last_invalid_partition() != nullptr;
  return state;
}

bool mark_valid() { return esp_ota_mark_app_valid_cancel_rollback() == ESP_OK; }

// Erases the OTA data of the other slot: its invalid state is gone, its image stays.
bool clear_invalid() { return esp_ota_invalidate_inactive_ota_data_slot() == ESP_OK; }

// Returns only when the mark failed: on success the board reboots.
bool mark_invalid_and_restart() { return esp_ota_mark_app_invalid_rollback_and_reboot() == ESP_OK; }

bool take_forced_health_failure() { return false; }

} // namespace detail

using namespace detail;

bool slot_size(size_t &bytes)
{
  const esp_partition_t *next = esp_ota_get_next_update_partition(nullptr);
  if (!next)
    return false;
  bytes = next->size;
  return true;
}

void abort_image()
{
  if (image_open)
    esp_ota_abort(handle);
  image_open = false;
}

bool begin_image(size_t size)
{
  abort_image();
  target = esp_ota_get_next_update_partition(nullptr);
  if (!target || size > target->size)
    return false;
  image_limit = size;
  // Sequential writes erase the slot as it is written, so the first block does not wait for the whole erase.
  image_open = esp_ota_begin(target, OTA_WITH_SEQUENTIAL_WRITES, &handle) == ESP_OK;
  return image_open;
}

bool write_image(const void *data, size_t size)
{
  if (!image_open || size > image_limit)
    return false;
  image_limit -= size;
  if (esp_ota_write(handle, data, size) != ESP_OK)
  {
    abort_image();
    return false;
  }
  return true;
}

bool end_image()
{
  if (!image_open)
    return false;
  image_open = false;
  return esp_ota_end(handle) == ESP_OK;
}

bool activate(const std::string &from, const std::string &to)
{
  if (!target || !valid_version(to) || from.size() > MAX_VERSION)
    return false;
  // Without the stored record a rollback could not skip this version, so the boot slot stays as it is.
  if (!store_pending(from, to))
    return false;
  task_sync::wait_for_safe_write(WRITE_WAIT_MS);
  if (esp_ota_set_boot_partition(target) == ESP_OK)
    return true;
  drop_pending();
  persist(true);
  return false;
}

void restart()
{
  delay(200); // lets the log line out
  esp_restart();
}

} // namespace firmware

#endif
