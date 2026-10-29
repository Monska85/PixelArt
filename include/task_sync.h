// SPDX-License-Identifier: GPL-3.0-or-later

// What the loop task and the network task agree on (docs/board/wifi-and-updates-v1.md#tasks-and-memory):
// one large allocation at a time, and flash writes right after a frame was shown. In the simulator
// there is one thread and nothing to agree on, so every call does nothing.

#pragma once

#include <cstdint>

namespace task_sync
{

// Creates the lock. Call it once from setup(), before the network task starts.
void begin();

enum class Owner
{
  Loop,   // the loop task: loading an animation or an uploaded file
  Network // the network task: one TLS connection
};

// How long the loop task waits for the lock before it gives up, in milliseconds.
constexpr uint32_t LOOP_WAIT_MS = 2000;

// How long the loop task waits for the lock. The network task always waits as long as it takes.
enum class Wait
{
  Limited, // at most LOOP_WAIT_MS
  None     // not at all: for work that must answer at once, such as `status`
};

// Holds the lock for large allocations from construction to destruction. The network task waits
// for it as long as it takes; the loop task waits at most LOOP_WAIT_MS (or not at all with
// Wait::None), because the network task may hold it for a whole download, and then does not hold
// it: check held() and do nothing that needs the memory when it is false. Not recursive. While the
// loop task waits, it shows no frames, so the network task may write to flash.
class HeapLock
{
public:
  explicit HeapLock(Owner owner, Wait wait = Wait::Limited);
  ~HeapLock();
  bool held() const { return held_; }
  HeapLock(const HeapLock &) = delete;
  HeapLock &operator=(const HeapLock &) = delete;

private:
  Owner owner_;
  bool held_ = false;
};

#ifdef PIXELART_SIM
// Test hook: while blocked, the network task holds the lock, and a loop-task HeapLock is not held, as after
// the 2 s timeout on the board.
void sim_block_loop(bool blocked);
// Test hook: blocks the loop as sim_block_loop(true) does once `frames` more frames were shown, as when the
// network task takes the lock while an animation plays. sim_block_loop() cancels it.
void sim_block_loop_after_frames(unsigned frames);
// Test hook: how many loop-task HeapLocks were made since the program started.
unsigned sim_loop_lock_attempts();
// Test hook: how many of them could wait, that is, were made with Wait::Limited.
unsigned sim_loop_waiting_lock_attempts();
#endif

// Whether the network task holds the lock now, that is, a TLS connection is open. Any task may ask.
bool network_holds_lock();

// The loop task calls this right after every show().
void frame_shown();

// The network task calls this before it writes to flash. It returns after a frame was shown, as soon
// as the loop task waits for the heap lock (no frame comes), or after `max_wait_ms`.
void wait_for_safe_write(uint32_t max_wait_ms);

} // namespace task_sync
