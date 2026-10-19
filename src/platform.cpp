// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

#include "platform.h"

#include <Arduino.h>

#ifdef PIXELART_SIM
#include <sim.h>

#include <random>
#else
#include <esp_heap_caps.h>
#include <esp_system.h>
#include <esp_timer.h>
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

const char *firmware_version() { return PIXELART_VERSION; }

#ifdef PIXELART_SIM

uint64_t now_us() { return sim::now_us(); }

// With a WebSocket the wait runs in short steps, each followed by a poll of
// the sockets. The total virtual time is the same as in one step.
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

// Not the seeded random(): --seed must keep animations reproducible, and the
// boot_id must differ on every run.
uint32_t random32()
{
  static std::random_device device;
  return (uint32_t)device();
}

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

#endif

} // namespace platform
