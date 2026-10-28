// SPDX-License-Identifier: GPL-3.0-or-later

#include "task_sync.h"

#ifdef PIXELART_SIM

namespace task_sync
{

namespace
{
bool loop_blocked = false;
unsigned loop_attempts = 0;
unsigned frames_until_block = 0; // 0: no block waits for a frame
} // namespace

void sim_block_loop(bool blocked)
{
  loop_blocked = blocked;
  frames_until_block = 0;
}
void sim_block_loop_after_frames(unsigned frames) { frames_until_block = frames; }
unsigned sim_loop_lock_attempts() { return loop_attempts; }

void begin() {}
HeapLock::HeapLock(Owner owner) : owner_(owner), held_(!(owner == Owner::Loop && loop_blocked))
{
  if (owner == Owner::Loop)
    loop_attempts++;
}
HeapLock::~HeapLock() {}
bool network_holds_lock() { return loop_blocked; }
void frame_shown()
{
  if (frames_until_block > 0 && --frames_until_block == 0)
    loop_blocked = true;
}
void wait_for_safe_write(uint32_t) {}

} // namespace task_sync

#else

#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>

#include <atomic>

namespace task_sync
{

namespace
{

StaticSemaphore_t lock_storage;
SemaphoreHandle_t lock_handle = nullptr;
std::atomic<uint32_t> frames{0};
std::atomic<bool> loop_waiting{false};
std::atomic<bool> network_holding{false};

} // namespace

void begin() { lock_handle = xSemaphoreCreateMutexStatic(&lock_storage); }

HeapLock::HeapLock(Owner owner) : owner_(owner)
{
  if (owner_ == Owner::Loop)
  {
    loop_waiting = true;
    held_ = xSemaphoreTake(lock_handle, pdMS_TO_TICKS(LOOP_WAIT_MS)) == pdTRUE;
    loop_waiting = false;
    return;
  }
  held_ = xSemaphoreTake(lock_handle, portMAX_DELAY) == pdTRUE;
  network_holding = held_;
}

HeapLock::~HeapLock()
{
  if (!held_)
    return;
  if (owner_ == Owner::Network)
    network_holding = false;
  xSemaphoreGive(lock_handle);
}

bool network_holds_lock() { return network_holding.load(); }

void frame_shown() { frames.fetch_add(1, std::memory_order_relaxed); }

void wait_for_safe_write(uint32_t max_wait_ms)
{
  const uint32_t seen = frames.load(std::memory_order_relaxed);
  const TickType_t start = xTaskGetTickCount();
  while (frames.load(std::memory_order_relaxed) == seen && !loop_waiting.load() &&
         (xTaskGetTickCount() - start) < pdMS_TO_TICKS(max_wait_ms))
    vTaskDelay(1);
}

} // namespace task_sync

#endif
