// SPDX-License-Identifier: GPL-3.0-or-later

#include "platform.h"

#include <Arduino.h>

#ifdef PIXELART_SIM
#include <sim.h>

#include <deque>
#include <random>

#include "firmware.h"
#else
#include <bootloader_random.h>
#include <esp_heap_caps.h>
#include <esp_random.h>
#include <esp_system.h>
#include <esp_timer.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#endif

#ifndef PIXELART_VERSION
#define PIXELART_VERSION "0.0.0-unknown"
#endif
#ifndef PIXELART_BOARD
#define PIXELART_BOARD "unknown"
#endif

namespace platform
{

const char *board_name() { return PIXELART_BOARD; }

#ifdef PIXELART_SIM
const char *firmware_version() { return firmware::sim_version(); }
#else
const char *firmware_version() { return PIXELART_VERSION; }
#endif

#ifdef PIXELART_SIM

uint64_t now_us() { return sim::now_us(); }

// With a WebSocket the wait runs in short steps, each followed by a read of
// the requests. The total virtual time is the same as in one step.
constexpr uint64_t WS_STEP_US = 2000;

void wait_us(uint64_t us)
{
  if (!sim::ws_active())
  {
    sim::advance_us(us);
    return;
  }
  sim::advance_us(us < WS_STEP_US ? us : WS_STEP_US);
  sim::sync_wall_clock();
}

size_t free_heap() { return 0; }

size_t max_alloc() { return 0; }

// The boot_id must differ on every run.
uint32_t random32()
{
  static std::random_device device;
  return (uint32_t)device();
}

std::deque<uint8_t> queued_random;

void secret_bytes(uint8_t *out, size_t size)
{
  static std::random_device device;
  for (size_t i = 0; i < size; i++)
    out[i] = (uint8_t)device();
}

void nonce_bytes(uint8_t *out, size_t size)
{
  static std::random_device device;
  for (size_t i = 0; i < size; i++)
  {
    if (queued_random.empty())
      out[i] = (uint8_t)device();
    else
    {
      out[i] = queued_random.front();
      queued_random.pop_front();
    }
  }
}

void sim_queue_random_bytes(const std::string &bytes) { queued_random.assign(bytes.begin(), bytes.end()); }

#else

uint64_t now_us() { return (uint64_t)esp_timer_get_time(); }

void wait_us(uint64_t us)
{
  if (us >= 1000)
    delay(1);
  else
    delayMicroseconds((unsigned int)us);
}

size_t free_heap() { return heap_caps_get_free_size(MALLOC_CAP_8BIT); }

size_t max_alloc() { return heap_caps_get_largest_free_block(MALLOC_CAP_8BIT); }

uint32_t random32() { return esp_random(); }

namespace
{

// The radio and the entropy source it feeds are exclusive: the hardware generator is only random while
// the radio runs or bootloader_random is on, and bootloader_random must be off before the radio starts.
SemaphoreHandle_t radio_mutex()
{
  static StaticSemaphore_t storage;
  static SemaphoreHandle_t handle = xSemaphoreCreateMutexStatic(&storage);
  return handle;
}

bool radio_running = false;

} // namespace

RadioLock::RadioLock() { xSemaphoreTake(radio_mutex(), portMAX_DELAY); }

RadioLock::~RadioLock() { xSemaphoreGive(radio_mutex()); }

void RadioLock::set_running(bool running) { radio_running = running; }

void secret_bytes(uint8_t *out, size_t size)
{
  RadioLock lock;
  if (radio_running)
  {
    esp_fill_random(out, size);
    return;
  }
  bootloader_random_enable();
  esp_fill_random(out, size);
  bootloader_random_disable();
}

void nonce_bytes(uint8_t *out, size_t size) { secret_bytes(out, size); }

#endif

} // namespace platform
