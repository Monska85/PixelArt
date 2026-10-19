// What differs between the board and the simulator: the clock, free memory,
// randomness and the build identity.

#pragma once

#include <cstddef>
#include <cstdint>

namespace platform
{

// Monotonic time in microseconds. In the simulator this is the virtual clock,
// and reading it does not advance it.
uint64_t now_us();

// Lets time pass while a frame waits for its deadline, for at most `us`
// microseconds. The board returns after about a millisecond so the caller
// can poll the serial port; the simulator runs the virtual clock to the end,
// except with a WebSocket, where it returns after 2 ms to poll the sockets.
void wait_us(uint64_t us);

// Free heap in bytes and the largest block that can be allocated. The
// simulator reports 0 for both.
size_t free_heap();
size_t max_alloc();

uint32_t random32();

// Set at build time by scripts/firmware_version.py.
const char *board_name();
const char *firmware_version();

} // namespace platform
