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
// and not yet confirmed (`from` and `to`). `confirmed` is written while the new firmware is still on trial,
// just before it marks itself valid: it proves that the pending installation really booted.
struct Record
{
  std::string skip;
  LastInstall last;
  bool pending = false;
  std::string pending_from;
  std::string pending_to;
  bool confirmed = false;
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

extern std::atomic<bool> confirm_unsaved;      // the confirmed installation is not stored yet
extern std::atomic<uint64_t> confirm_retry_us; // not before this time is another attempt made to store it
// False while the stored record could not be read: `record` is empty then and stands for nothing, so
// nothing is stored from it and nothing is confirmed by it.
extern std::atomic<bool> record_loaded;

bool valid_version(const std::string &version);

// Stores the current record. The record is copied under the store lock, so of two stores that overlap the
// later one always writes the newer record. `after_frame` is for the network task: it waits for a frame
// before the write. Without it (the loop task, boot) a store that finds the store busy returns false.
bool persist(bool after_frame);
// Reads the stored record again when the boot could not. The caller holds `lock`. False while it cannot be
// read; the record is then neither used nor stored.
bool ensure_loaded();
// Records the installation as pending and stores it. False when it was not stored; nothing is pending then.
bool store_pending(const std::string &from, const std::string &to);
// Forgets the pending installation, in memory only.
void drop_pending();

// Each platform's slots and records.
void log_failure(const char *what);
// Reads the stored record. False when it cannot be read; `out` is not touched then.
bool load(Record &out);
// Only persist() calls it, one call at a time. It writes the values in this order and stops at the first
// failure: skip, result, from, to, confirmed, pending from, pending to. So the pending installation, which
// is written and removed last, stays stored until everything before it is. True only when every value was
// stored. `after_frame`: wait for a shown frame before the write.
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
