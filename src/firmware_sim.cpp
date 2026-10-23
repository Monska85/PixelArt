// SPDX-License-Identifier: GPL-3.0-or-later

// The simulator's firmware slots: two simulated slots and the records in memory, with hooks for the tests.
// See include/firmware.h.

#ifdef PIXELART_SIM

#include "firmware.h"

#include "firmware_detail.h"

namespace firmware
{

namespace detail
{

namespace
{

struct SimFlash
{
  std::string current;  // the version that runs
  std::string previous; // the version in the other slot, empty when there is none
  std::string staged;   // the version the next boot starts, empty when none
  bool trial = false;
  bool invalid = false;
  Record record;
  std::string image;
  bool image_open = false;
  size_t image_limit = 0;
  size_t slot = 0x180000;
  bool fail_writes = false;
  bool fail_saves = false;
  bool fail_health = false;
  bool fail_marks = false;
  bool restart_before_switch = false;
  bool restart_requested = false;
  std::function<void()> restart_hook;
};

SimFlash sim;

#ifndef PIXELART_VERSION
#define PIXELART_VERSION "0.0.0-unknown"
#endif

SimFlash &flash()
{
  if (sim.current.empty())
    sim.current = PIXELART_VERSION;
  return sim;
}

unsigned failures_logged = 0;

} // namespace

void log_failure(const char *) { ++failures_logged; }

void load(Record &out) { out = flash().record; }
bool save(const Record &in, bool)
{
  if (flash().fail_saves)
    return false;
  flash().record = in;
  return true;
}

// The bootloader: a firmware that was staged boots on trial; one that was still on trial at this boot
// never confirmed itself, so the previous firmware starts and the other slot counts as invalid.
BootState boot()
{
  SimFlash &f = flash();
  if (!f.staged.empty())
  {
    f.previous = f.current;
    f.current = f.staged;
    f.staged.clear();
    f.trial = true;
  }
  else if (f.trial)
  {
    f.current = f.previous;
    f.previous.clear();
    f.trial = false;
    f.invalid = true;
  }
  return {f.trial, f.invalid};
}

bool mark_valid()
{
  if (flash().fail_marks)
    return false;
  flash().trial = false;
  return true;
}

// Forgets the invalid state of the other slot, as the board erases its slot of the OTA data.
bool clear_invalid()
{
  flash().invalid = false;
  return true;
}

// The next boot finds the firmware still on trial and rolls back. Returns only when the mark failed.
bool mark_invalid_and_restart()
{
  if (flash().fail_marks)
    return false;
  restart();
  return true;
}

bool take_forced_health_failure()
{
  if (!flash().fail_health)
    return false;
  flash().fail_health = false;
  return true;
}

} // namespace detail

using namespace detail;

bool slot_size(size_t &bytes)
{
  bytes = flash().slot;
  return true;
}

bool begin_image(size_t size)
{
  SimFlash &f = flash();
  f.image.clear();
  f.image_open = false;
  if (size > f.slot || f.fail_writes)
    return false;
  f.image_limit = size;
  f.image_open = true;
  return true;
}

bool write_image(const void *data, size_t size)
{
  SimFlash &f = flash();
  if (!f.image_open || f.fail_writes || f.image.size() + size > f.image_limit)
    return false;
  f.image.append(static_cast<const char *>(data), size);
  return true;
}

bool end_image() { return flash().image_open; }

void abort_image()
{
  flash().image_open = false;
  flash().image.clear();
}

bool activate(const std::string &from, const std::string &to)
{
  SimFlash &f = flash();
  if (!f.image_open || !valid_version(to) || from.size() > MAX_VERSION)
    return false;
  {
    std::lock_guard<std::mutex> guard(lock);
    const Record before = record;
    record.pending = true;
    record.pending_from = from;
    record.pending_to = to;
    if (!save(record, true))
    {
      record = before;
      return false;
    }
  }
  if (f.restart_before_switch)
  {
    f.restart_before_switch = false; // a power loss after the record, before the boot slot changed
    f.image_open = false;
    restart();
    return false;
  }
  f.staged = to;
  f.invalid = false;
  f.image_open = false;
  return true;
}

void restart()
{
  flash().restart_requested = true;
  if (flash().restart_hook)
    flash().restart_hook();
}

void sim_reset(const std::string &version)
{
  const std::function<void()> hook = sim.restart_hook;
  sim = SimFlash();
  sim.current = version.empty() ? PIXELART_VERSION : version;
  sim.restart_hook = hook;
  record = Record();
  on_trial = false;
  written_percent = 0;
  mark_failure_logged = false;
  failures_logged = 0;
}

const char *sim_version() { return flash().current.c_str(); }
void sim_set_version(const std::string &version) { flash().current = version; }
void sim_fail_next_health(bool fail) { flash().fail_health = fail; }
void sim_set_skipped(const std::string &version)
{
  flash().record.skip = version;
  record.skip = version;
}
bool sim_restart_requested() { return flash().restart_requested; }
void sim_clear_restart() { flash().restart_requested = false; }
void sim_set_restart_hook(std::function<void()> hook) { flash().restart_hook = std::move(hook); }
void sim_set_slot_size(size_t bytes) { flash().slot = bytes; }
void sim_fail_writes(bool fail) { flash().fail_writes = fail; }
void sim_fail_saves(bool fail) { flash().fail_saves = fail; }
void sim_fail_marks(bool fail) { flash().fail_marks = fail; }
void sim_restart_before_switch() { flash().restart_before_switch = true; }
unsigned sim_failures_logged() { return failures_logged; }
bool sim_on_trial() { return flash().trial; }
const std::string &sim_image() { return flash().image; }

} // namespace firmware

#endif
