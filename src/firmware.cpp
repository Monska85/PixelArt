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
std::atomic<bool> confirm_unsaved{false};
std::atomic<uint64_t> confirm_retry_us{0};
std::atomic<bool> record_loaded{true};

bool valid_version(const std::string &version) { return !version.empty() && version.size() <= MAX_VERSION; }

namespace
{

// Time between two attempts to store, or to read, a record after one failed. A store that is only busy is
// tried again at the next frame; frames can last a minute, and the trial holds the next installation.
constexpr uint64_t RETRY_US = 2000000;

enum class Stored
{
  Done,
  Busy, // another store was running: nothing was tried
  Failed
};

std::mutex store_lock; // one store at a time, from the copy of the record to the last write
std::atomic<bool> evidence_stored{false};
std::atomic<bool> evidence_logged{false};
std::atomic<uint64_t> evidence_retry_us{0}; // not before this time after a failed attempt

// Records the running firmware as installed. The caller holds `lock`.
void record_confirmed(const std::string &running)
{
  record.last.present = true;
  record.last.rolled_back = false;
  record.last.from = record.pending_from;
  record.last.to = running;
  if (record.skip == running)
    record.skip.clear(); // a skipped version that was installed by force, and held
  record.pending = false;
  record.confirmed = false;
  record.pending_from.clear();
  record.pending_to.clear();
}

// Forgets the installation that was started. The caller holds `lock`.
void clear_pending()
{
  record.pending = false;
  record.confirmed = false;
  record.pending_from.clear();
  record.pending_to.clear();
}

// Stores the record. Nothing is stored while it was not loaded: an empty record would erase the stored one.
Stored try_persist(bool after_frame)
{
  // The loop task never waits for the network task's store, which waits for the loop task's frames.
  std::unique_lock<std::mutex> guard(store_lock, std::defer_lock);
  if (after_frame)
    guard.lock();
  else if (!guard.try_lock())
    return Stored::Busy;
  static Record snapshot; // under store_lock: no stack use on the loop task
  {
    std::lock_guard<std::mutex> state(lock);
    if (!record_loaded)
      return Stored::Failed;
    snapshot = record;
  }
  return save(snapshot, after_frame) ? Stored::Done : Stored::Failed;
}

// Stores the confirmation again, now and then, until it works.
void retry_unsaved_confirmation()
{
  if (!confirm_unsaved || platform::now_us() < confirm_retry_us)
    return;
  const Stored stored = try_persist(false);
  if (stored == Stored::Done)
    confirm_unsaved = false;
  else if (stored == Stored::Failed)
    confirm_retry_us = platform::now_us() + RETRY_US;
}

// While the new firmware is still on trial, stores that it booted, before it marks itself valid. A board
// that restarts after the mark and before the result is stored finds this and reports the installation;
// without it, a firmware flashed over USB with the same version would be taken for the installed one.
// False while it is not stored: the firmware then stays on trial, so a store that is busy or failing never
// lets it mark itself valid without the evidence. A busy store is tried again at the next frame, a failed
// one, or a record that cannot be read, after RETRY_US. If it never works the board restarts on the
// previous firmware.
bool store_evidence()
{
  if (evidence_stored)
    return true;
  if (platform::now_us() < evidence_retry_us)
    return false;
  {
    std::lock_guard<std::mutex> guard(lock);
    if (!ensure_loaded())
    {
      // An empty record does not prove that no installation is pending: nothing is confirmed from it.
      evidence_retry_us = platform::now_us() + RETRY_US;
      if (!evidence_logged.exchange(true))
        log_failure("the record of the installation could not be read");
      return false;
    }
    if (!record.pending || record.pending_to != running_version())
    {
      evidence_stored = true; // nothing was recorded for this boot
      return true;
    }
    record.confirmed = true;
  }
  const Stored stored = try_persist(false);
  if (stored == Stored::Done)
  {
    evidence_stored = true;
    return true;
  }
  if (stored == Stored::Failed)
  {
    evidence_retry_us = platform::now_us() + RETRY_US;
    if (!evidence_logged.exchange(true))
      log_failure("the installation could not be recorded as booted");
  }
  return false;
}

enum class Boot
{
  Nothing,
  Confirmed, // the installation booted and confirmed itself before the board restarted
  Dropped    // the installation did not boot: rolled back, or the board restarted before the switch
};

// What the record says about the installation that was pending before this boot. The caller holds `lock`.
Boot reconcile(const BootState &state, const std::string &running)
{
  if (!record.pending)
    return Boot::Nothing;
  if (record.confirmed && valid_version(record.pending_to) && record.pending_to == running)
  {
    record_confirmed(running);
    return Boot::Confirmed;
  }
  // The installation did not run to its confirmation. When its slot was marked invalid the bootloader rolled
  // back; otherwise the board restarted before the switch, or another firmware of the same version was
  // flashed, and nothing is reported.
  if (state.invalid && valid_version(record.pending_to))
  {
    record.skip = record.pending_to;
    record.last.present = true;
    record.last.rolled_back = true;
    record.last.from = record.pending_from;
    record.last.to = record.pending_to;
  }
  clear_pending();
  return Boot::Dropped;
}

} // namespace

bool persist(bool after_frame) { return try_persist(after_frame) == Stored::Done; }

bool ensure_loaded()
{
  if (record_loaded)
    return true;
  if (!load(record))
    return false;
  record_loaded = true;
  return true;
}

bool store_pending(const std::string &from, const std::string &to)
{
  {
    std::lock_guard<std::mutex> guard(lock);
    // The record of a trial that is not confirmed yet is not touched: its confirmation reads it.
    if (on_trial || !ensure_loaded())
      return false;
    record.pending = true;
    record.confirmed = false;
    record.pending_from = from;
    record.pending_to = to;
  }
  if (persist(true))
    return true;
  drop_pending();
  return false;
}

void drop_pending()
{
  std::lock_guard<std::mutex> guard(lock);
  clear_pending();
}

} // namespace detail

using namespace detail;

void begin()
{
  BootState state;
  Boot outcome = Boot::Nothing;
  {
    std::lock_guard<std::mutex> guard(lock);
    record_loaded = load(record);
    if (!record_loaded)
      log_failure("the record of the installation could not be read");
    state = boot();
    on_trial = state.trial;
    mark_failure_logged = false;
    evidence_stored = false;
    evidence_logged = false;
    evidence_retry_us = 0;
    confirm_unsaved = false;
    confirm_retry_us = 0;
    // A record that could not be read says nothing about a pending installation: it is not reconciled, and
    // an invalid slot stays, so the next boot reports the rollback.
    if (state.trial || !record_loaded)
      return;
    outcome = reconcile(state, running_version());
  }
  if (outcome != Boot::Nothing && !persist(false))
  {
    if (outcome == Boot::Confirmed)
    {
      confirm_unsaved = true;
      log_failure("the installation result could not be stored");
    }
    return; // an invalid slot stays, so the next boot records the rollback again
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
  if (!on_trial)
  {
    retry_unsaved_confirmation();
    return;
  }
  // Only the loop task gets here. The firmware stays on trial, which keeps a second installation from
  // changing the record, until the evidence is stored, the mark worked and the result is in the record.
  if (!store_evidence())
    return;
  if (!mark_valid())
  {
    if (!mark_failure_logged.exchange(true)) // no successful installation is recorded; the next frame tries again
      log_failure("the new firmware could not be marked valid");
    return;
  }
  {
    std::lock_guard<std::mutex> guard(lock);
    record_confirmed(running_version());
    on_trial = false;
  }
  if (!persist(false))
  {
    confirm_retry_us = platform::now_us() + RETRY_US;
    confirm_unsaved = true;
    log_failure("the installation result could not be stored");
  }
}

bool is_on_trial() { return on_trial; }

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
  {
    std::lock_guard<std::mutex> guard(lock);
    if (!ensure_loaded() || record.skip.empty())
      return;
    record.skip.clear();
  }
  if (!persist(true))
    log_failure("the skip list could not be stored");
}

std::string running_version() { return platform::firmware_version(); }

void set_progress(uint8_t percent) { written_percent = percent > 100 ? 100 : percent; }

uint8_t progress() { return written_percent; }

} // namespace firmware
