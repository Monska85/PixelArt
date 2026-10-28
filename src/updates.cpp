// SPDX-License-Identifier: GPL-3.0-or-later

#include "updates.h"

#include <install.h>
#include <updater.h>

#include <algorithm>
#include <cstring>
#include <memory>

#include "app.h"
#include "firmware.h"
#include "network.h"
#include "platform.h"
#include "storage.h"
#include "update_host.h"

#ifndef PIXELART_SIM
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>

#include "mailbox.h"
#include "net_time.h"
#include "task_sync.h"
#include "update_http.h"
#endif

namespace updates
{

using pixelart_update::Error;
using pixelart_update::Kind;

namespace
{

bool network_online()
{
  const network::Snapshot s = network::snapshot();
  return s.state == wifi_logic::State::Connected && s.has_ip;
}

#ifdef PIXELART_SIM

struct Locked
{
  Locked() {}
};

#else

SemaphoreHandle_t mutex;
StaticSemaphore_t mutex_storage;

struct Locked
{
  Locked() { xSemaphoreTake(mutex, portMAX_DELAY); }
  ~Locked() { xSemaphoreGive(mutex); }
  Locked(const Locked &) = delete;
  Locked &operator=(const Locked &) = delete;
};

constexpr uint32_t INSTALL_QUEUE_WAIT_MS = 1000;
// The loop task answers within a frame and a validation; a wedged loop task must not hold the download forever.
constexpr uint32_t INSTALL_REPLY_WAIT_MS = 60000;

// A downloaded file the loop task validates and stores, and its result.
struct InstallRequest
{
  uint8_t kind;
  char id[33];
};
struct InstallReply
{
  uint8_t error;
};

Mailbox<InstallRequest, 1> to_loop;
Mailbox<InstallReply, 1> to_network;

class BoardHost : public StorageHost
{
public:
  bool online() override { return network_online(); }

  void begin_large_work() override { lock_.reset(new task_sync::HeapLock(task_sync::Owner::Network)); }
  void end_large_work() override { lock_.reset(); }

  Error fetch_manifest(const std::string &url, bool allow_http, pixelart_update::ByteBuffer &out) override
  {
    return http_fetch_manifest(url, allow_http, out);
  }

  // The WiFi stack and the other tasks keep at least this much while a manifest is parsed.
  static constexpr size_t PARSE_RESERVE = 16 * 1024;

  bool memory_available(size_t total, size_t block) override
  {
    return platform::free_heap() >= total + PARSE_RESERVE && platform::max_alloc() >= block;
  }

  Error download(const std::string &url, bool allow_http, size_t expected_size,
                 pixelart_update::Download &result) override
  {
    return http_download(url, allow_http, expected_size, result);
  }

  Error install(Kind kind, const std::string &id) override
  {
    InstallReply stale;
    while (to_network.receive(stale, 0))
    {
    }
    InstallRequest request = {};
    request.kind = (uint8_t)kind;
    snprintf(request.id, sizeof(request.id), "%s", id.c_str());
    if (!to_loop.send(request, pdMS_TO_TICKS(INSTALL_QUEUE_WAIT_MS)))
      return Error::StorageError;
    InstallReply reply;
    if (!to_network.receive(reply, pdMS_TO_TICKS(INSTALL_REPLY_WAIT_MS)))
      return Error::StorageError;
    return (Error)reply.error;
  }

  Error download_firmware(const std::string &url, bool allow_http, size_t expected_size,
                          pixelart_update::Download &result) override
  {
    return http_download_firmware(url, allow_http, expected_size, result);
  }

  bool local_minutes(uint16_t &minutes) override { return net_time::local_minutes(minutes); }

  void time_config(bool needed, const std::string &timezone, const std::string &server, uint32_t sync_hours) override
  {
    net_time::configure(needed, online(), timezone, server, sync_hours);
  }

private:
  std::unique_ptr<task_sync::HeapLock> lock_;
};

BoardHost board_host;

#endif

// Everything the loop task and the update task share, under `mutex` on the board.
struct Shared
{
  pixelart_update::Config config;
  bool config_dirty = false;
  bool check_requested = false;
  bool install_requested = false;
  bool firmware_requested = false;
  bool firmware_force = false;
  // delete_all stopped the installation of animations and playlists: the update task drops it, and the loop
  // task discards a file that arrives meanwhile.
  bool cancel_install = false;
  bool busy = false;
  pixelart_update::Status status;
  bool time_known = false;
  bool schedule_needs_time = false; // the player plays a schedule
};

Shared shared;
std::unique_ptr<pixelart_update::Updater> updater;
pixelart_update::Host *host = nullptr;

pixelart_update::Config make_config(const settings::Values &v)
{
  pixelart_update::Config c;
  c.enabled = v.update_mode != "off" && (v.update_animations || v.update_firmware);
  c.automatic = v.update_mode == "automatic";
  c.animations = v.update_animations;
  c.firmware = v.update_firmware;
  c.check_hours = v.check_hours;
  c.install_start = v.install_start;
  c.install_end = v.install_end;
  c.animation_source = v.animation_source;
  c.firmware_manifest = FIRMWARE_MANIFEST;
  c.firmware_allow_http = FIRMWARE_ALLOW_HTTP;
  c.timezone = v.timezone;
  c.ntp_server = v.ntp_server;
  c.time_sync_hours = v.time_sync_hours;
  return c;
}

uint64_t now_ms() { return platform::now_us() / 1000; }

// One unit of the updater's work, with the requests and settings the loop task left for it. Returns
// the milliseconds until the updater needs to run again.
uint64_t step()
{
  pixelart_update::Config config;
  bool dirty, check, install, firmware_install, force, cancel;
  {
    Locked guard;
    cancel = shared.cancel_install;
    shared.cancel_install = false;
    dirty = shared.config_dirty;
    config = shared.config;
    check = shared.check_requested;
    install = shared.install_requested;
    firmware_install = shared.firmware_requested;
    force = shared.firmware_force;
    shared.config_dirty = shared.check_requested = shared.install_requested = shared.firmware_requested = false;
  }
  if (dirty)
    updater->configure(config);
  if (cancel)
  {
    updater->cancel_install();
    install = false;
  }
  if (check)
    updater->request_check();
  if (install)
    updater->request_install();
  if (firmware_install)
    updater->request_firmware(force);
  const uint64_t now = now_ms();
  updater->tick(now);

  uint16_t minutes;
  const bool time_known = host->local_minutes(minutes);
  const pixelart_update::Status status = updater->status();
  const bool busy = updater->busy();
  {
    Locked guard;
    shared.status = status;
    shared.time_known = time_known;
    shared.busy = busy || shared.check_requested || shared.install_requested || shared.firmware_requested;
  }
  return updater->wait_ms(now);
}

const char *state_name(pixelart_update::State state)
{
  switch (state)
  {
  case pixelart_update::State::Idle:
    return "idle";
  case pixelart_update::State::Checking:
    return "checking";
  case pixelart_update::State::Downloading:
    return "downloading";
  case pixelart_update::State::Installing:
    return "installing";
  case pixelart_update::State::WaitingForTime:
    return "waiting_for_time";
  }
  return "idle";
}

enum class Work
{
  Check,
  Animations,
  Firmware
};

// Leaves a request for the update task. The answers come in this order: updates off (the update mode, or the
// switch of what is asked for), no network, busy (a request is waiting or running; for a firmware, also the
// running one still on trial), and, for an installation,
// nothing to install. Returns Started when it was queued.
Request request(Work work, bool force = false)
{
  bool enabled;
  {
    Locked guard;
    const pixelart_update::Config &c = shared.config;
    enabled = c.enabled && (work == Work::Check || (work == Work::Animations ? c.animations : c.firmware));
  }
  if (!enabled)
    return Request::UpdatesOff;
  if (!network_online())
    return Request::NoNetwork;
  {
    Locked guard;
    if (shared.busy)
      return Request::Busy;
    if (work == Work::Firmware && firmware::is_on_trial())
      return Request::FirmwareConfirming; // a firmware is installed only when the running one has ended its trial
    if (work == Work::Animations && shared.status.files == 0)
      return Request::NothingToInstall;
    if (work == Work::Firmware && (shared.status.firmware.empty() || (shared.status.firmware_skipped && !force)))
      return Request::NothingToInstall;
    shared.check_requested = work == Work::Check;
    shared.install_requested = work == Work::Animations;
    shared.firmware_requested = work == Work::Firmware;
    shared.firmware_force = force;
    if (work == Work::Animations)
      shared.cancel_install = false; // an earlier delete_all does not apply to this one
    shared.busy = true;
    if (work == Work::Firmware)
      firmware::set_progress(0);
  }
  network::wake();
  return Request::Started;
}

} // namespace

pixelart_update::Error install_temp_file(Kind kind, const std::string &id)
{
  struct RemoveTemp
  {
    ~RemoveTemp() { storage::remove(TEMP_FILE); }
  } remove_temp;
  std::vector<pixelart::Diagnostic> diagnostics;
  const install::Kind install_kind = kind == Kind::Animation  ? install::Kind::Animation
                                     : kind == Kind::Playlist ? install::Kind::Playlist
                                                              : install::Kind::Schedule;
  switch (install::check(install_kind, TEMP_FILE, install::SIZE_ANY, diagnostics))
  {
  case install::Result::Ok:
    break;
  case install::Result::OutOfMemory:
    return Error::OutOfMemory;
  case install::Result::StorageError:
    return Error::StorageError;
  case install::Result::Invalid:
    return Error::InvalidFile;
  }
  const std::string target = kind == Kind::Animation  ? animation_file(id)
                             : kind == Kind::Playlist ? playlist_file(id)
                                                      : schedule_file(id);
  if (!install::commit(install_kind, TEMP_FILE, target))
    return Error::StorageError;
  return Error::None;
}

void begin(const settings::Values &values)
{
  storage::remove(TEMP_FILE);
#ifdef PIXELART_SIM
  host = &sim_host();
#else
  mutex = xSemaphoreCreateMutexStatic(&mutex_storage);
  host = &board_host;
#endif
  updater.reset(new pixelart_update::Updater(*host));
  Locked guard;
  shared = Shared();
  shared.config = make_config(values);
  shared.config_dirty = true;
}

void apply(const settings::Values &values)
{
  {
    Locked guard;
    shared.config = make_config(values);
    shared.config.schedule_needs_time = shared.schedule_needs_time;
    shared.config_dirty = true;
  }
  network::wake();
}

void set_schedule_needs_time(bool needed)
{
  {
    Locked guard;
    if (shared.schedule_needs_time == needed)
      return;
    shared.schedule_needs_time = needed;
    shared.config.schedule_needs_time = needed;
    shared.config_dirty = true;
  }
  network::wake();
}

#ifndef PIXELART_SIM
bool local_date(pixelart::LocalDate &date) { return net_time::local_date(date); }
#endif

Snapshot snapshot()
{
  pixelart_update::Status status;
  bool check, install, firmware_install, time_known;
  {
    Locked guard;
    status = shared.status;
    check = shared.check_requested;
    install = shared.install_requested;
    firmware_install = shared.firmware_requested;
    time_known = shared.time_known;
  }
  Snapshot s;
  s.state = state_name(status.state);
  // A request the update task has not picked up yet is not in the updater's status:
  // the updater reports only the requests it was given.
  if (check)
    s.state = "checking";
  else if (install)
    s.state = "downloading";
  else if (firmware_install)
    s.state = "installing";
  // The firmware's progress moves while the update task is inside one step, so it is read live.
  s.progress = !strcmp(s.state, "installing") ? firmware::progress() : status.progress;
  s.has_last_check = status.has_last_check;
  if (status.has_last_check)
  {
    const uint64_t now = now_ms();
    s.last_check_seconds =
        (uint32_t)std::min<uint64_t>(now > status.last_check_at ? (now - status.last_check_at) / 1000 : 0, UINT32_MAX);
  }
  s.last_result = status.has_result ? pixelart_update::error_code(status.result) : nullptr;
  s.last_detail = status.has_result ? pixelart_update::error_detail(status.result) : nullptr;
  s.failed_files = status.failed_files;
  s.files = status.files;
  s.firmware = status.firmware;
  s.firmware_skipped = status.firmware_skipped;
  s.time_known = time_known;
  return s;
}

Request check() { return request(Work::Check); }

Request install_animations() { return request(Work::Animations); }

Request install_firmware(bool force) { return request(Work::Firmware, force); }

void cancel_install()
{
  Locked guard;
  const bool running = shared.status.state == pixelart_update::State::Downloading || shared.install_requested;
  if (!running)
    return;
  shared.install_requested = false;
  shared.cancel_install = true;
  // What status reports changes at once: the update task catches up at its next step.
  shared.status.state = pixelart_update::State::Idle;
  shared.status.progress = 0;
  shared.status.files = 0;
  shared.status.failed_files = 0;
}

bool firmware_installing()
{
  Locked guard;
  return shared.status.state == pixelart_update::State::Installing || shared.firmware_requested;
}

uint8_t firmware_progress() { return firmware::progress(); }

void poll()
{
#ifdef PIXELART_SIM
  if (updater)
    step();
#else
  InstallRequest job;
  if (to_loop.receive(job, 0))
  {
    bool cancelled;
    {
      Locked guard;
      cancelled = shared.cancel_install;
    }
    InstallReply reply;
    if (cancelled)
    {
      storage::remove(TEMP_FILE); // delete_all ran while this file was downloading: it is not stored
      reply.error = (uint8_t)Error::Cancelled;
    }
    else
      reply.error = (uint8_t)install_temp_file((Kind)job.kind, job.id);
    to_network.send(reply, 0);
  }
#endif
}

#ifndef PIXELART_SIM
uint32_t net_tick()
{
  const uint64_t wait = step();
  return wait > UINT32_MAX ? UINT32_MAX : (uint32_t)wait;
}
#endif

} // namespace updates
