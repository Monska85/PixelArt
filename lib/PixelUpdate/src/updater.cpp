// SPDX-License-Identifier: GPL-3.0-or-later

#include "updater.h"

#include "update_semver.h"

#include <algorithm>
#include <cstring>

namespace pixelart_update
{

namespace
{

// The file system allocates whole blocks (storage.h BLOCK_SIZE).
constexpr size_t BLOCK_SIZE = 4096;
// A firmware version fits the records of the board (firmware.h MAX_VERSION).
constexpr size_t MAX_VERSION_SIZE = 64;

size_t round_up_to_block(size_t size) { return (size + BLOCK_SIZE - 1) / BLOCK_SIZE * BLOCK_SIZE; }

struct LargeWork
{
  explicit LargeWork(Host &host) : host_(host) { host_.begin_large_work(); }
  ~LargeWork() { host_.end_large_work(); }
  LargeWork(const LargeWork &) = delete;
  LargeWork &operator=(const LargeWork &) = delete;
  Host &host_;
};

} // namespace

const char *error_code(Error error)
{
  switch (error)
  {
  case Error::None:
    return "ok";
  case Error::NetworkError:
    return "network_error";
  case Error::TlsError:
    return "tls_error";
  case Error::HttpError:
  case Error::ManifestNotFound:
    return "http_error";
  case Error::BadManifest:
    return "bad_manifest";
  case Error::ChecksumMismatch:
    return "checksum_mismatch";
  case Error::InvalidFile:
    return "invalid_file";
  case Error::NoSpace:
    return "no_space";
  case Error::OutOfMemory:
    return "out_of_memory";
  case Error::StorageError:
    return "storage_error";
  case Error::FlashError:
    return "flash_error";
  case Error::Cancelled:
    return "cancelled";
  }
  return "storage_error";
}

const char *error_detail(Error error) { return error == Error::ManifestNotFound ? "no_release" : nullptr; }

ByteBuffer::Append ByteBuffer::reserve(size_t size)
{
  if (size > max_)
    return Append::TooLarge;
  if (size <= capacity_)
    return Append::Ok;
  char *grown = static_cast<char *>(realloc(data_, size));
  if (!grown)
    return Append::OutOfMemory;
  data_ = grown;
  capacity_ = size;
  return Append::Ok;
}

ByteBuffer::Append ByteBuffer::append(const void *bytes, size_t size)
{
  if (size > max_ - size_)
    return Append::TooLarge;
  const size_t needed = size_ + size;
  if (needed > capacity_)
  {
    size_t target = capacity_ < 1024 ? 1024 : capacity_ * 2;
    target = std::min(std::max(target, needed), max_);
    if (Append r = reserve(target); r != Append::Ok)
      return r;
  }
  if (size)
    memcpy(data_ + size_, bytes, size);
  size_ = needed;
  return Append::Ok;
}

void ByteBuffer::clear()
{
  free(data_);
  data_ = nullptr;
  size_ = capacity_ = 0;
}

void Updater::configure(const Config &config)
{
  const bool source_changed = config.animation_source != config_.animation_source;
  config_ = config;
  if (!config_.enabled || !config_.firmware || config_.firmware_manifest.empty())
    firmware_version_.clear(); // nothing is offered while the switch is off
  if (!config_.enabled || !config_.animations || source_changed)
  {
    if (phase_ != Phase::Download) // a running installation finishes the files it has
      plan_.clear();
    // Only the animation findings are forgotten: a firmware install that waits for the window stays.
    const bool firmware_waits = !firmware_version_.empty() && !firmware_skipped_;
    if (!firmware_waits)
      clear_pending();
  }
  if (!config_.automatic)
  {
    clear_pending();
    firmware_after_ = false;
  }
}

bool Updater::request_check()
{
  if (!config_.enabled || busy())
    return false;
  check_requested_ = true;
  return true;
}

bool Updater::request_install()
{
  if (!config_.enabled || !config_.animations || busy() || plan_.empty())
    return false;
  install_requested_ = true;
  return true;
}

bool Updater::request_firmware(bool force)
{
  if (!config_.enabled || !config_.firmware || busy() || firmware_version_.empty() || (firmware_skipped_ && !force) ||
      host_.firmware_on_trial())
    return false;
  firmware_requested_ = true;
  return true;
}

void Updater::start_check(bool install_after)
{
  phase_ = Phase::Check;
  install_after_check_ = install_after;
}

void Updater::start_install()
{
  phase_ = Phase::Download;
  index_ = 0;
  failed_.clear();
  failed_files_ = 0;
  first_error_ = Error::None;
  clear_pending();
}

void Updater::clear_pending()
{
  pending_install_ = false;
  waiting_for_time_ = false;
}

WindowState Updater::current_window()
{
  uint16_t minutes = 0;
  const bool known = host_.local_minutes(minutes);
  return window_state(config_.install_start, config_.install_end, known, minutes);
}

void Updater::tick(uint64_t now)
{
  if (restarting_)
    return;
  const bool online = host_.online();
  if (online)
    schedule_.on_address(now);
  host_.time_config(config_.enabled && config_.install_start != config_.install_end, config_.timezone);

  switch (phase_)
  {
  case Phase::Check:
    run_check(now);
    return;
  case Phase::Download:
    run_file();
    return;
  case Phase::Firmware:
    run_firmware();
    return;
  case Phase::Idle:
    break;
  }

  if (check_requested_)
  {
    check_requested_ = false;
    start_check(config_.automatic);
    return;
  }
  if (install_requested_)
  {
    install_requested_ = false;
    start_install();
    return;
  }
  if (firmware_requested_)
  {
    firmware_requested_ = false;
    start_firmware();
    return;
  }
  if (!config_.enabled || !online)
    return;
  if (schedule_.due(now))
  {
    start_check(config_.automatic);
    return;
  }
  if (pending_install_ && config_.automatic)
  {
    const WindowState window = current_window();
    if (window == WindowState::Open)
      start_check(true); // the window opened: a fresh manifest, then the install
    else
      waiting_for_time_ = window == WindowState::WaitingForTime;
  }
}

uint64_t Updater::wait_ms(uint64_t now) const
{
  if (restarting_)
    return UINT64_MAX;
  if (busy())
    return 0;
  // Offline or off: only a request, a new setting or the address coming back gives work.
  if (!config_.enabled || !host_.online())
    return UINT64_MAX;
  uint64_t wait = schedule_.wait_ms(now);
  if (pending_install_ && config_.automatic)
    wait = std::min(wait, MS_PER_MINUTE);
  return wait;
}

Error Updater::read_manifest(const std::string &url, bool allow_http, Manifest &manifest)
{
  Url parsed;
  if (!parse_url(url, parsed))
    return Error::NetworkError;
  LargeWork large(host_);
  ByteBuffer bytes(MAX_MANIFEST_SIZE);
  if (Error e = host_.fetch_manifest(url, allow_http, bytes); e != Error::None)
    return e;
  ManifestMemory memory;
  memory.affordable = [this](size_t total, size_t block)
  {
    return host_.memory_available(total, block);
  };
  memory.release_input = [&bytes]
  {
    bytes.clear();
  };
  if (!parse_manifest(bytes.data(), bytes.size(), manifest, reason_, memory))
    return memory.out_of_memory ? Error::OutOfMemory : Error::BadManifest;
  return Error::None;
}

Error Updater::check_animations(Manifest &manifest)
{
  plan_.clear();
  const size_t block = plan_block(manifest);
  if (!host_.memory_available(block, block))
    return Error::OutOfMemory;
  plan_ = plan_sync(manifest,
                    [this](Kind kind, const std::string &id, std::string &sha256)
                    {
                      return host_.stored_digest(kind, id, sha256);
                    });
  source_ = config_.animation_source;
  return Error::None;
}

Error Updater::check_firmware(const Manifest &manifest)
{
  const std::string board = host_.firmware_board(), running = host_.running_firmware();
  const FirmwareEntry *entry = find_firmware(manifest, board);
  if (!entry || manifest.version.size() > MAX_VERSION_SIZE || !firmware_available(manifest, board, running, "", false))
  {
    firmware_version_.clear();
    return Error::None;
  }
  std::string skipped = host_.skipped_firmware();
  // A release newer than the skipped version ends the skip.
  if (!skipped.empty() && skipped != manifest.version && is_newer_version(manifest.version, skipped))
  {
    host_.clear_skipped_firmware();
    skipped.clear();
  }
  firmware_version_ = manifest.version;
  firmware_entry_ = *entry;
  firmware_skipped_ = !skipped.empty() && skipped == manifest.version;
  firmware_source_ = config_.firmware_manifest;
  return Error::None;
}

// Whether an automatic install takes the firmware the last check found: it is not skipped, and the running firmware
// is not on trial, so two installations never overlap. The next check installs it once the trial has ended.
bool Updater::automatic_firmware() const
{
  return config_.firmware && !firmware_version_.empty() && !firmware_skipped_ && !host_.firmware_on_trial();
}

// Whether a check left something an automatic install does: files, or a firmware that is not skipped.
bool Updater::automatic_work() const { return (config_.animations && !plan_.empty()) || automatic_firmware(); }

void Updater::start_automatic_install()
{
  firmware_after_ = automatic_firmware();
  if (config_.animations && !plan_.empty())
    start_install();
  else if (firmware_after_)
    start_firmware();
}

void Updater::run_check(uint64_t now)
{
  // The plan of the last check can take tens of kilobytes, the room a TLS connection needs: it is freed, its buffer
  // included, before any manifest is read, and the firmware manifest of another address is read before the
  // animations are planned.
  std::vector<PlanItem>().swap(plan_);
  const bool read_firmware = config_.firmware && !config_.firmware_manifest.empty();
  const bool shared_manifest =
      config_.animations && read_firmware && config_.firmware_manifest == config_.animation_source;
  Error firmware_error = Error::None;
  if (read_firmware && !shared_manifest)
  {
    Manifest project;
    firmware_error = read_manifest(config_.firmware_manifest, config_.firmware_allow_http, project);
    if (firmware_error == Error::None)
      firmware_error = check_firmware(project);
  }
  Error error = Error::None;
  Manifest animations;
  if (config_.animations)
    error = read_manifest(config_.animation_source, true, animations);
  if (error == Error::None && config_.animations)
    error = check_animations(animations);
  if (read_firmware && shared_manifest)
    firmware_error = error == Error::None ? check_firmware(animations) : error;
  // The animations' error is the one reported when both fail.
  if (read_firmware && error == Error::None)
    error = firmware_error;
  schedule_.on_check_done(now, error == Error::None, config_.check_hours, host_.random_below(MAX_JITTER_MS + 1));
  has_last_check_ = true;
  last_check_at_ = now;
  has_result_ = true;
  result_ = error;
  const bool install = install_after_check_;
  install_after_check_ = false;
  phase_ = Phase::Idle;
  clear_pending();
  if (error != Error::None || !install || !automatic_work())
    return;
  switch (current_window())
  {
  case WindowState::Open:
    start_automatic_install();
    break;
  case WindowState::Closed:
    pending_install_ = true;
    break;
  case WindowState::WaitingForTime:
    pending_install_ = true;
    waiting_for_time_ = true;
    break;
  }
}

Error Updater::install_file(const PlanItem &item)
{
  if (item.size > size_limit(item.kind))
    return Error::InvalidFile; // the engine would refuse it: larger than the limit of its kind
  size_t free_bytes = 0;
  if (!host_.free_space(free_bytes))
    return Error::StorageError;
  if (free_bytes < round_up_to_block(item.size))
    return Error::NoSpace;
  std::string url;
  if (!resolve_file_url(source_, item.file, url))
    return Error::BadManifest;
  Download download;
  {
    LargeWork large(host_);
    if (Error e = host_.download(url, true, item.size, download); e != Error::None)
    {
      host_.discard_download();
      return e;
    }
  }
  if (download.size != item.size || download.sha256 != item.sha256)
  {
    host_.discard_download();
    return Error::ChecksumMismatch;
  }
  return host_.install(item.kind, item.id);
}

void Updater::cancel_install()
{
  install_requested_ = false;
  plan_.clear();
  failed_files_ = 0;
  if (phase_ != Phase::Download)
    return;
  failed_.clear();
  first_error_ = Error::None;
  index_ = 0;
  phase_ = Phase::Idle;
  after_install();
}

void Updater::run_file()
{
  if (index_ < plan_.size())
  {
    const PlanItem &item = plan_[index_];
    const Error error = install_file(item);
    if (error == Error::Cancelled)
    {
      cancel_install();
      return;
    }
    if (error != Error::None)
    {
      failed_.push_back(item);
      failed_files_++;
      if (first_error_ == Error::None)
        first_error_ = error;
    }
    index_++;
  }
  if (index_ >= plan_.size())
    finish_install();
}

void Updater::finish_install()
{
  plan_ = std::move(failed_);
  failed_.clear();
  has_result_ = true;
  result_ = first_error_;
  phase_ = Phase::Idle;
  index_ = 0;
  after_install();
}

void Updater::after_install()
{
  if (firmware_after_)
  {
    firmware_after_ = false;
    if (automatic_firmware())
      start_firmware();
  }
}

void Updater::start_firmware()
{
  phase_ = Phase::Firmware;
  clear_pending();
}

void Updater::run_firmware()
{
  const Error error = install_firmware();
  phase_ = Phase::Idle;
  if (error == Error::None)
  {
    restarting_ = true;
    host_.restart_firmware();
    return;
  }
  has_result_ = true;
  result_ = error;
}

Error Updater::install_firmware()
{
  size_t slot = 0;
  if (!host_.firmware_slot_size(slot) || firmware_entry_.size > slot)
    return Error::FlashError;
  std::string url;
  if (!resolve_file_url(firmware_source_, firmware_entry_.file, url))
    return Error::BadManifest;
  Download download;
  {
    LargeWork large(host_);
    if (Error e = host_.download_firmware(url, config_.firmware_allow_http, firmware_entry_.size, download);
        e != Error::None)
    {
      host_.discard_firmware();
      return e;
    }
  }
  if (download.size != firmware_entry_.size || download.sha256 != firmware_entry_.sha256)
  {
    host_.discard_firmware();
    return Error::ChecksumMismatch;
  }
  if (Error e = host_.activate_firmware(firmware_version_); e != Error::None)
  {
    host_.discard_firmware();
    return e;
  }
  return Error::None;
}

Status Updater::status() const
{
  Status s;
  switch (phase_)
  {
  case Phase::Check:
    s.state = State::Checking;
    break;
  case Phase::Download:
    s.state = State::Downloading;
    s.progress = plan_.empty() ? 0 : (uint8_t)(index_ * 100 / plan_.size());
    break;
  case Phase::Firmware:
    s.state = State::Installing;
    s.progress = host_.firmware_progress();
    break;
  case Phase::Idle:
    if (restarting_)
    {
      s.state = State::Installing;
      s.progress = 100;
    }
    else if (check_requested_)
      s.state = State::Checking;
    else if (install_requested_)
      s.state = State::Downloading;
    else if (firmware_requested_)
      s.state = State::Installing;
    else if (waiting_for_time_)
      s.state = State::WaitingForTime;
    break;
  }
  s.has_last_check = has_last_check_;
  s.last_check_at = last_check_at_;
  s.has_result = has_result_;
  s.result = result_;
  s.failed_files = failed_files_;
  s.firmware = firmware_version_;
  s.firmware_skipped = firmware_skipped_;
  const size_t files = phase_ == Phase::Download ? plan_.size() - index_ + failed_.size() : plan_.size();
  s.files = (uint16_t)std::min<size_t>(files, UINT16_MAX);
  return s;
}

} // namespace pixelart_update
