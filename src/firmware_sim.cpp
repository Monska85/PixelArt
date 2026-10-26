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
  int saves_left = -1; // writes that still work before every write fails; -1 for no limit
  std::function<void()> save_hook;
  bool fail_health = false;
  bool fail_marks = false;
  bool fail_loads = false;
  int loads_left = -1; // reads of a load that still work before the rest fail; -1 for no limit
  bool fail_clears = false;
  bool namespace_exists = false;
  std::string boot_as; // the version the next trial boot reports, when it differs from the installed one
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

// The board reads 7 values one at a time, in this order, into a record it keeps only when all of them are
// read. A read that fails at one value, as an error or a stored value that does not fit, leaves it unreadable.
bool load(Record &out)
{
  SimFlash &f = flash();
  if (f.fail_loads)
    return false;
  if (!f.namespace_exists)
  {
    out = Record();
    return true;
  }
  int reads = 0;
  const auto read = [&f, &reads](const std::function<void()> &copy)
  {
    if (f.loads_left >= 0 && reads++ >= f.loads_left)
      return false;
    copy();
    return true;
  };
  Record in;
  const Record &stored = f.record;
  const bool ok = read(
                      [&]
                      {
                        in.skip = stored.skip;
                      }) &&
                  read(
                      [&]
                      {
                        in.last.present = stored.last.present;
                        in.last.rolled_back = stored.last.rolled_back;
                      }) &&
                  read(
                      [&]
                      {
                        in.last.from = stored.last.from;
                      }) &&
                  read(
                      [&]
                      {
                        in.last.to = stored.last.to;
                      }) &&
                  read(
                      [&]
                      {
                        in.confirmed = stored.confirmed;
                      }) &&
                  read(
                      [&]
                      {
                        in.pending_from = stored.pending_from;
                      }) &&
                  read(
                      [&]
                      {
                        in.pending = stored.pending;
                        in.pending_to = stored.pending_to;
                      });
  if (!ok)
    return false;
  out = in;
  return true;
}

// Writes the values one at a time, in the order of the board's NVS writes, and stops at the first one
// that fails, so a test can break the store between any two of them.
bool save(const Record &in, bool)
{
  SimFlash &f = flash();
  if (f.save_hook)
  {
    const std::function<void()> hook = std::move(f.save_hook);
    f.save_hook = nullptr;
    hook();
  }
  Record &out = f.record;
  const auto write = [&f](const std::function<void()> &apply)
  {
    if (f.saves_left == 0)
      return false;
    if (f.saves_left > 0)
      --f.saves_left;
    f.namespace_exists = true; // the first write makes the namespace
    apply();
    return true;
  };
  return write(
             [&]
             {
               out.skip = in.skip;
             }) &&
         write(
             [&]
             {
               out.last.present = in.last.present;
               out.last.rolled_back = in.last.rolled_back;
             }) &&
         write(
             [&]
             {
               out.last.from = in.last.from;
             }) &&
         write(
             [&]
             {
               out.last.to = in.last.to;
             }) &&
         write(
             [&]
             {
               out.confirmed = in.confirmed;
             }) &&
         write(
             [&]
             {
               out.pending_from = in.pending_from;
             }) &&
         write(
             [&]
             {
               out.pending = in.pending;
               out.pending_to = in.pending ? in.pending_to : "";
             });
}

// The bootloader: a firmware that was staged boots on trial; one that was still on trial at this boot
// never confirmed itself, so the previous firmware starts and the other slot counts as invalid.
BootState boot()
{
  SimFlash &f = flash();
  if (!f.staged.empty())
  {
    f.previous = f.current;
    f.current = f.boot_as.empty() ? f.staged : f.boot_as;
    f.boot_as.clear();
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
  if (flash().fail_clears)
    return false;
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
  if (!store_pending(from, to))
    return false;
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
  confirm_unsaved = false;
  confirm_retry_us = 0;
  record_loaded = true;
  boot_unsettled = false;
  failures_logged = 0;
}

const char *sim_version() { return flash().current.c_str(); }
void sim_set_version(const std::string &version) { flash().current = version; }
void sim_fail_next_health(bool fail) { flash().fail_health = fail; }
void sim_set_skipped(const std::string &version)
{
  flash().record.skip = version;
  flash().namespace_exists = true;
  record.skip = version;
}
bool sim_restart_requested() { return flash().restart_requested; }
void sim_clear_restart() { flash().restart_requested = false; }
void sim_set_restart_hook(std::function<void()> hook) { flash().restart_hook = std::move(hook); }
void sim_set_slot_size(size_t bytes) { flash().slot = bytes; }
void sim_fail_writes(bool fail) { flash().fail_writes = fail; }
void sim_fail_saves(bool fail) { flash().saves_left = fail ? 0 : -1; }
void sim_fail_saves_after(unsigned writes) { flash().saves_left = static_cast<int>(writes); }
void sim_set_save_hook(std::function<void()> hook) { flash().save_hook = std::move(hook); }
std::string sim_pending_version()
{
  std::lock_guard<std::mutex> guard(lock);
  return record.pending ? record.pending_to : "";
}
void sim_fail_marks(bool fail) { flash().fail_marks = fail; }
void sim_fail_loads(bool fail)
{
  flash().fail_loads = fail;
  flash().loads_left = -1;
}
void sim_fail_loads_after(unsigned reads) { flash().loads_left = static_cast<int>(reads); }
void sim_fail_clears(bool fail) { flash().fail_clears = fail; }
bool sim_namespace_exists() { return flash().namespace_exists; }
void sim_boot_as(const std::string &version) { flash().boot_as = version; }
void sim_restart_before_switch() { flash().restart_before_switch = true; }
unsigned sim_failures_logged() { return failures_logged; }
bool sim_on_trial() { return flash().trial; }
const std::string &sim_image() { return flash().image; }

} // namespace firmware

#endif
