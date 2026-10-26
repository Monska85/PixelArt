// SPDX-License-Identifier: GPL-3.0-or-later

// What src/firmware.cpp shares with the slots of the board (src/firmware_board.cpp) and of the simulator
// (src/firmware_sim.cpp). Only those three files include it.

#pragma once

#include <atomic>
#include <cstdint>
#include <mutex>
#include <string>

#include "firmware.h"

namespace firmware
{
namespace detail
{

// What is left from before: the skip list, the last installation, and an installation that was started
// and not yet confirmed (`from` and `to`).
struct Record
{
  std::string skip;
  LastInstall last;
  bool pending = false;
  std::string pending_from;
  std::string pending_to;
};

struct BootState
{
  bool trial = false;   // the running firmware is on trial
  bool invalid = false; // the other slot holds a firmware that was marked invalid
};

extern std::mutex lock; // the records below
extern Record record;
extern std::atomic<bool> on_trial;
extern std::atomic<uint8_t> written_percent;
extern std::atomic<bool> mark_failure_logged; // one log line per trial, however often the mark is retried

extern std::atomic<bool> confirm_unsaved;    // the confirmed installation is not stored yet
extern std::atomic<uint16_t> confirm_frames; // frames since the last attempt to store it

bool valid_version(const std::string &version);

// Each platform's slots and records.
void log_failure(const char *what);
void load(Record &out);
// True only when every value was stored. `after_frame`: wait for a shown frame before the write.
bool save(const Record &in, bool after_frame);
BootState boot();
bool mark_valid();
// Forgets the invalid state of the other slot.
bool clear_invalid();
// Returns only when the mark failed.
bool mark_invalid_and_restart();
// Whether the health check of this trial must fail whatever it found: once, in the simulator only.
bool take_forced_health_failure();

} // namespace detail
} // namespace firmware
