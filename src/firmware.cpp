// SPDX-License-Identifier: GPL-3.0-or-later

// The trial boot, the rollback and the skip list, the same on the board and in the simulator. The slots and
// the records are in src/firmware_board.cpp and src/firmware_sim.cpp.

#include "firmware.h"

#include "firmware_detail.h"
#include "platform.h"

namespace firmware
{

namespace detail
{

std::mutex lock;
Record record;
std::atomic<bool> on_trial{false};
std::atomic<uint8_t> written_percent{0};
std::atomic<bool> mark_failure_logged{false};

bool valid_version(const std::string &version) { return !version.empty() && version.size() <= MAX_VERSION; }

} // namespace detail

using namespace detail;

void begin()
{
  std::lock_guard<std::mutex> guard(lock);
  load(record);
  const BootState state = boot();
  on_trial = state.trial;
  mark_failure_logged = false;
  if (state.trial)
    return;
  if (record.pending)
  {
    // An installation was started and this is not the new firmware. When its slot was marked invalid
    // the bootloader rolled back; otherwise the board restarted before the switch.
    if (state.invalid && valid_version(record.pending_to))
    {
      record.skip = record.pending_to;
      record.last.present = true;
      record.last.rolled_back = true;
      record.last.from = record.pending_from;
      record.last.to = record.pending_to;
    }
    record.pending = false;
    record.pending_from.clear();
    record.pending_to.clear();
    if (!save(record, false))
      return; // the invalid slot stays, so the next boot records the rollback again
  }
  // The invalid state of a slot lasts until a new firmware is switched to. Once recorded it is
  // forgotten, so a restart between the next installation's record and its switch is not taken
  // for a rollback of the new version.
  if (state.invalid && !clear_invalid())
    log_failure("the rolled back slot could not be cleared");
}

void health(bool ok)
{
  if (on_trial && take_forced_health_failure())
    ok = false;
  if (on_trial && !ok && !mark_invalid_and_restart())
  {
    // The slot keeps its state and the pending record stays. On a board the bootloader finds the
    // firmware still unconfirmed at the next boot and rolls back, so begin() then records the rollback.
    log_failure("the new firmware could not be marked invalid, restarting");
    restart();
  }
}

void first_frame_shown()
{
  if (!on_trial.exchange(false))
    return;
  if (!mark_valid())
  {
    on_trial = true; // no successful installation is recorded; the next call tries again
    if (!mark_failure_logged.exchange(true))
      log_failure("the new firmware could not be marked valid");
    return;
  }
  Record copy;
  {
    std::lock_guard<std::mutex> guard(lock);
    const std::string running = running_version();
    record.last.present = true;
    record.last.rolled_back = false;
    record.last.from = record.pending_from;
    record.last.to = running;
    if (record.skip == running)
      record.skip.clear(); // a skipped version that was installed by force, and held
    record.pending = false;
    record.pending_from.clear();
    record.pending_to.clear();
    copy = record;
  }
  if (!save(copy, false))
    log_failure("the installation result could not be stored");
}

LastInstall last_install()
{
  std::lock_guard<std::mutex> guard(lock);
  return record.last;
}

std::string skipped()
{
  std::lock_guard<std::mutex> guard(lock);
  return record.skip;
}

void clear_skipped()
{
  Record copy;
  {
    std::lock_guard<std::mutex> guard(lock);
    if (record.skip.empty())
      return;
    record.skip.clear();
    copy = record;
  }
  if (!save(copy, true))
    log_failure("the skip list could not be stored");
}

std::string running_version() { return platform::firmware_version(); }

void set_progress(uint8_t percent) { written_percent = percent > 100 ? 100 : percent; }

uint8_t progress() { return written_percent; }

} // namespace firmware
