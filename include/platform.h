// SPDX-License-Identifier: GPL-3.0-or-later

// What differs between the board and the simulator: the clock, free memory,
// randomness and the build identity.

#pragma once

#include <cstddef>
#include <cstdint>
#include <string>

namespace platform
{

// Monotonic time in microseconds. In the simulator this is the virtual clock,
// and reading it does not advance it.
uint64_t now_us();

// Lets time pass while a frame waits for its deadline, for at most `us`
// microseconds. The board returns after about a millisecond so the caller
// can poll the serial port; the simulator runs the virtual clock to the end,
// except with a WebSocket, where it returns after 2 ms to read the requests.
void wait_us(uint64_t us);

// Free heap in bytes and the largest block that can be allocated. The
// simulator reports 0 for both.
size_t free_heap();
size_t max_alloc();

// A random word for uses that need no secrecy (the boot id, update jitter). On the board it may be
// pseudo-random while the radio is off.
uint32_t random32();

// Fills `out` with bytes fit for secrets (the token, the login nonce). On the board they come from the
// hardware generator, which is only a true one while the radio runs, so with the radio off the draw is
// bracketed by bootloader_random_enable() and bootloader_random_disable().
void secret_bytes(uint8_t *out, size_t size);

// The bytes of an authentication nonce: secret_bytes() on the board. The simulator takes the ones a test
// queued first (sim_queue_random_bytes), so that a test knows the nonce.
void nonce_bytes(uint8_t *out, size_t size);

#ifndef PIXELART_SIM
// Held by the network task around starting and stopping the radio, so that it never overlaps a draw
// of secret_bytes(). Not recursive.
class RadioLock
{
public:
  RadioLock();
  ~RadioLock();
  RadioLock(const RadioLock &) = delete;
  RadioLock &operator=(const RadioLock &) = delete;
  // Records whether the radio runs now, before the lock is released.
  void set_running(bool running);
};
#endif

#ifdef PIXELART_SIM
// Replaces the bytes the next nonce_bytes() calls take first, for tests that need to know the nonce.
// An empty string empties the queue.
void sim_queue_random_bytes(const std::string &bytes);
#endif

// Set at build time by scripts/firmware_version.py.
const char *board_name();
const char *firmware_version();

} // namespace platform
