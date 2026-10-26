// SPDX-License-Identifier: GPL-3.0-or-later

// The update state machine (docs/board/wifi-and-updates-v1.md#updates). It decides what to do and
// when; a Host does the work that differs between the board and the simulator: HTTP, the files,
// the clock. One tick() does one unit of work, a check or one file, so the caller keeps control
// between units: the board's network task answers its messages, the simulator keeps playing.

#pragma once

#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <string>
#include <vector>

#include "update_manifest.h"
#include "update_schedule.h"

namespace pixelart_update
{

// The update errors of docs/protocol/protocol-v1.md#update-errors.
enum class Error
{
  None,
  NetworkError,
  TlsError,
  HttpError,
  ManifestNotFound, // a manifest request was answered 404: reported as `http_error` with the detail `no_release`
  BadManifest,
  ChecksumMismatch,
  InvalidFile,
  NoSpace,
  OutOfMemory,
  StorageError,
  FlashError,
  Cancelled // an installation stopped by delete_all: never reported as a result
};

// The code the protocol reports, for example `network_error`. `None` is `ok`.
const char *error_code(Error error);
// The detail `status` reports next to the code, `no_release` for a manifest that answered 404, null for
// every other error and for success.
const char *error_detail(Error error);

// A buffer that holds at most `max` bytes and reports a failed allocation instead of ending the
// program, for a download whose size the server decides.
class ByteBuffer
{
public:
  enum class Append
  {
    Ok,
    TooLarge,
    OutOfMemory
  };

  explicit ByteBuffer(size_t max) : max_(max) {}
  ~ByteBuffer() { free(data_); }
  ByteBuffer(const ByteBuffer &) = delete;
  ByteBuffer &operator=(const ByteBuffer &) = delete;

  Append append(const void *bytes, size_t size);
  // Room for `size` bytes in one allocation, for a size the server announced.
  Append reserve(size_t size);
  const char *data() const { return data_; }
  size_t size() const { return size_; }
  void clear();

private:
  char *data_ = nullptr;
  size_t size_ = 0;
  size_t capacity_ = 0;
  size_t max_;
};

// What a finished download leaves in the temporary file.
struct Download
{
  size_t size = 0;
  std::string sha256;
};

// The work of the platform. The updater calls it from one task only.
class Host
{
public:
  virtual ~Host() = default;

  // The board has a network address.
  virtual bool online() = 0;
  // Brackets the work that needs a large allocation: reading and parsing a manifest, and downloading
  // one file. The board holds the lock for large allocations in between, so it never has two at once.
  virtual void begin_large_work() = 0;
  virtual void end_large_work() = 0;
  // Reads the manifest at `url` into `out`, which holds at most MAX_MANIFEST_SIZE bytes. The host
  // keeps the rules of the specification: at most 3 redirects, `http://` only when `allow_http`. A
  // final answer of 404 is ManifestNotFound, any other status other than 200 is HttpError.
  virtual Error fetch_manifest(const std::string &url, bool allow_http, ByteBuffer &out) = 0;
  // Whether `total` bytes more, the largest in one block of `block` bytes, can be allocated while a
  // manifest is parsed, with room to spare for the rest of the board. A manifest that does not fit is
  // refused with OutOfMemory.
  virtual bool memory_available(size_t, size_t) { return true; }
  // Downloads the file at `url` to the temporary file and reports its size and SHA-256. Stops as
  // soon as the body passes `expected_size` and then fails with ChecksumMismatch.
  virtual Error download(const std::string &url, bool allow_http, size_t expected_size, Download &result) = 0;
  // Validates the temporary file like an upload does and moves it over the stored file of that
  // kind and ID. The temporary file is gone afterwards, whatever the result.
  virtual Error install(Kind kind, const std::string &id) = 0;
  // Removes the temporary file.
  virtual void discard_download() = 0;
  // SHA-256 of a stored file, false when the file is not stored.
  virtual bool stored_digest(Kind kind, const std::string &id, std::string &sha256) = 0;
  // Free bytes of the file system, false when they cannot be read.
  virtual bool free_space(size_t &bytes) = 0;
  // The local time as minutes after midnight, false when the time is not known.
  virtual bool local_minutes(uint16_t &minutes) = 0;
  // A random number below `bound`.
  virtual uint32_t random_below(uint32_t bound) = 0;

  // ---- Firmware. A host without firmware slots keeps these defaults: nothing is ever available. ----

  // The running firmware's version, and the board name its manifest entry is looked up by.
  virtual std::string running_firmware() { return ""; }
  virtual std::string firmware_board() { return ""; }
  // The version on the skip list, empty when there is none, and ending the skip.
  virtual std::string skipped_firmware() { return ""; }
  virtual void clear_skipped_firmware() {}
  // Whether the running firmware is still on its trial boot. No new firmware is installed until the trial ends.
  virtual bool firmware_on_trial() { return false; }
  // False while the stored record of the last installation is unread or the boot's rollback is not recorded:
  // the skip list is unknown then, so a check offers no firmware.
  virtual bool firmware_record_ready() { return true; }
  // Size of the slot a new firmware goes to, false when there is none.
  virtual bool firmware_slot_size(size_t &) { return false; }
  // Streams the image at `url` into the inactive slot, stopping as soon as the body passes
  // `expected_size` (ChecksumMismatch). A failure leaves nothing open. Reports the size and SHA-256 of what it
  // got, and updates firmware_progress() as it goes.
  virtual Error download_firmware(const std::string &, bool, size_t, Download &) { return Error::FlashError; }
  // Closes the image, checks that it is a firmware, records `version` as the one installed and makes the new
  // slot the one to boot on trial. A failure leaves the boot slot as it was and nothing open.
  virtual Error activate_firmware(const std::string &) { return Error::FlashError; }
  // Drops an image that was downloaded but not activated.
  virtual void discard_firmware() {}
  // Restarts into the new firmware. The board does not come back from this.
  virtual void restart_firmware() {}
  // How much of the image is written, from 0 to 100.
  virtual uint8_t firmware_progress() { return 0; }

  // Tells the host whether the time of day is needed (the install window is narrower than the whole day)
  // and in which POSIX time zone. The board starts and stops SNTP from it.
  virtual void time_config(bool, const std::string &) {}
};

// The update settings the updater follows.
struct Config
{
  bool enabled = false;   // update_mode is not `off` and a switch is on
  bool automatic = false; // update_mode is `automatic`
  bool animations = true; // update_animations
  bool firmware = true;   // update_firmware
  uint32_t check_hours = 6;
  uint16_t install_start = 0;
  uint16_t install_end = 0;
  std::string animation_source;
  std::string firmware_manifest;    // the project's manifest, HTTPS only; empty: no firmware checks
  bool firmware_allow_http = false; // a test build only: the manifest and its firmware may be http://
  std::string timezone;             // POSIX TZ string of the install window
};

enum class State
{
  Idle,
  Checking,
  Downloading,
  Installing, // a firmware is being written; the board restarts when it is done
  WaitingForTime
};

struct Status
{
  State state = State::Idle;
  uint8_t progress = 0;
  bool has_last_check = false;
  uint64_t last_check_at = 0; // when the last check ended, the clock of tick()
  bool has_result = false;
  Error result = Error::None; // of the last check or installation
  uint16_t failed_files = 0;  // in the last animation update
  uint16_t files = 0;         // animations and playlists still to add or replace
  // The firmware the last check found, newer than the running one and in the manifest for this board; empty when
  // none. A version on the skip list is reported too, with `firmware_skipped`, so a client can ask for it by force.
  std::string firmware;
  bool firmware_skipped = false;
};

// Manifests that cannot be read are reported as `bad_manifest`; `last_reason()` says why, for logs.
class Updater
{
public:
  explicit Updater(Host &host) : host_(host) {}

  void configure(const Config &config);
  const Config &config() const { return config_; }

  // Asks for a check as soon as the updater is idle. False when it is busy or the updates are off.
  bool request_check();
  // Asks to install what the last check found. False when it is busy, the updates are off, or
  // nothing was found.
  bool request_install();
  // Asks to install the firmware the last check found. False when it is busy, the updates or the firmware switch
  // are off, nothing was found, the version is on the skip list and `force` is false, or the running firmware is
  // still on its trial boot.
  bool request_firmware(bool force);

  // Stops what installs animations and playlists, and forgets the files the last check found: a running
  // installation skips the files it has not stored and counts no failure, and one that was asked for does
  // not start. `last_result` stays as it was. The firmware is not touched.
  void cancel_install();

  // Does one unit of work, if there is one.
  void tick(uint64_t now);
  // Milliseconds until tick() has work: 0 when it has, UINT64_MAX when only a request, a new setting or
  // the address coming back can give it some (the caller ticks now and then anyway). While it waits
  // for the install window, no more than a minute.
  uint64_t wait_ms(uint64_t now) const;

  bool busy() const
  {
    return phase_ != Phase::Idle || check_requested_ || install_requested_ || firmware_requested_ || restarting_;
  }
  Status status() const;
  const std::string &last_reason() const { return reason_; }
  const Schedule &schedule() const { return schedule_; }

private:
  enum class Phase
  {
    Idle,
    Check,
    Download,
    Firmware
  };

  void start_check(bool install_after);
  void run_check(uint64_t now);
  Error read_manifest(const std::string &url, bool allow_http, Manifest &manifest);
  Error check_animations(Manifest &manifest);
  Error check_firmware(const Manifest &manifest);
  bool automatic_firmware() const;
  bool automatic_work() const;
  void start_automatic_install();
  void start_install();
  void run_file();
  Error install_file(const PlanItem &item);
  void finish_install();
  void after_install();
  void start_firmware();
  void run_firmware();
  Error install_firmware();
  // Forgets that an automatic install waits for the install window.
  void clear_pending();
  // Where the install window stands now, by the host's local time.
  WindowState current_window();

  Host &host_;
  Config config_;
  Schedule schedule_;
  Phase phase_ = Phase::Idle;
  bool check_requested_ = false;
  bool install_requested_ = false;
  bool firmware_requested_ = false;
  bool firmware_after_ = false; // the firmware follows the animations of an automatic install
  bool restarting_ = false;     // the firmware is installed and the board is about to restart
  bool install_after_check_ = false;
  bool pending_install_ = false; // a check found files and the install window is not open
  bool waiting_for_time_ = false;
  bool has_last_check_ = false;
  uint64_t last_check_at_ = 0;
  bool has_result_ = false;
  Error result_ = Error::None;
  std::string source_;           // the animation_source the plan comes from
  std::string firmware_version_; // the firmware the last check found, empty when none
  bool firmware_skipped_ = false;
  FirmwareEntry firmware_entry_;
  std::string firmware_source_; // the manifest URL the firmware entry comes from
  std::vector<PlanItem> plan_;
  std::vector<PlanItem> failed_;
  size_t index_ = 0;
  Error first_error_ = Error::None;
  uint16_t failed_files_ = 0;
  std::string reason_;
};

} // namespace pixelart_update
