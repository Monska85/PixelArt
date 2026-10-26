// SPDX-License-Identifier: GPL-3.0-or-later

// The firmware slots, the trial boot and the rollback (docs/board/wifi-and-updates-v1.md#firmware-updates,
// #rollback). On the board this is the ESP-IDF OTA API and a namespace of NVS; the simulator keeps
// two simulated slots and the same records in memory, so a test can run an install, the trial boot
// and the rollback. The simulator's state outlives setup(), as flash does outlive a restart.

#pragma once

#include <cstddef>
#include <cstdint>
#include <functional>
#include <string>

namespace firmware
{

// A firmware version is at most this long, so it fits the records of NVS.
constexpr size_t MAX_VERSION = 64;

// The last firmware installation, as `status` reports it.
struct LastInstall
{
  bool present = false;
  bool rolled_back = false; // false: updated
  std::string from;
  std::string to;
};

// Works out how this boot came about: a trial boot of a firmware that was just installed, or a boot
// after a rollback, in which case the version that failed goes on the skip list. Call it once from
// setup(), after settings::begin() and before the network task starts.
void begin();

// The health check of a trial boot: the file system is mounted and the settings are read. A trial
// that is not healthy marks the new firmware invalid and restarts, so the bootloader starts the
// previous one; on the board this does not return. Nothing happens when this boot is not a trial.
void health(bool ok);

// The loop task calls this right after every frame it shows. The first one confirms a firmware on
// trial: it is marked valid and the installation is recorded as `updated`.
void first_frame_shown();

LastInstall last_install();

// The version on the skip list, empty when there is none. A newer release than this version ends the
// skip. The list holds one version: the one the last rollback left.
std::string skipped();
void clear_skipped();

// The version of the running firmware.
std::string running_version();

// ---- Writing a new firmware (the network task) ----

// The size of the slot a new firmware goes to, false when there is none.
bool slot_size(size_t &bytes);
// Opens the inactive slot for an image of at most `size` bytes. False when it does not fit or the
// slot cannot be opened. An image still open is dropped.
bool begin_image(size_t size);
bool write_image(const void *data, size_t size);
// Closes the image and lets the platform check it. False when the image is not a valid firmware.
bool end_image();
// Drops the image being written. The boot slot stays as it was.
void abort_image();
// Records the installation (`from` the running version, `to` the new one) and makes the new slot the
// one to boot on trial. False when it could not be done, and then the boot slot is unchanged.
bool activate(const std::string &from, const std::string &to);
// Restarts the board. In the simulator it asks for a restart, see sim_set_restart_hook().
void restart();

// How much of the new firmware is written, from 0 to 100, for the progress bar.
void set_progress(uint8_t percent);
uint8_t progress();

#ifdef PIXELART_SIM
// Forgets everything: the version the simulated firmware reports (`version`, or the build's version
// when empty), both slots, the records, the skip list. For tests and for the start of a run.
void sim_reset(const std::string &version = "");
// The version of the simulated running firmware, which platform::firmware_version() reports.
const char *sim_version();
// Sets that version before the first boot.
void sim_set_version(const std::string &version);
// Makes the health check of the next trial boot fail (or not, with false).
void sim_fail_next_health(bool fail = true);
// Puts a version on the skip list, as a rollback in an earlier life of the board would have.
void sim_set_skipped(const std::string &version);
// Whether the firmware asked for a restart that did not happen yet: a test then calls setup() again.
bool sim_restart_requested();
void sim_clear_restart();
// Called by restart(). The simulator's program restarts the sketch from it; tests leave it empty.
void sim_set_restart_hook(std::function<void()> hook);
// Makes the slot smaller or larger than the 0x180000 bytes of the board's layout.
void sim_set_slot_size(size_t bytes);
// Makes every write to the slot fail, as a worn flash chip would.
void sim_fail_writes(bool fail);
// Makes every write of the stored record fail, as a full or broken NVS would.
void sim_fail_saves(bool fail);
// Lets `writes` single writes of the stored record work, then fails every one after them, as NVS can
// between two of its separate writes. A record is stored in 7 writes.
void sim_fail_saves_after(unsigned writes);
// Runs `hook` once, at the start of the next write of the record, while the store is held.
void sim_set_save_hook(std::function<void()> hook);
// The installation the running firmware has recorded as pending, empty when none.
std::string sim_pending_version();
// Makes marking the running firmware valid or invalid fail, as the bootloader's call can.
void sim_fail_marks(bool fail);
// Makes the next activate() restart after storing its record and before the boot slot changes,
// as a power loss there would.
void sim_restart_before_switch();
// How many failures the module logged since sim_reset(), for tests.
unsigned sim_failures_logged();
// Whether a trial boot is waiting to be confirmed.
bool sim_on_trial();
// The image the last installation wrote, for tests.
const std::string &sim_image();
#endif

} // namespace firmware
