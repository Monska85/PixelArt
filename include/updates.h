// SPDX-License-Identifier: GPL-3.0-or-later

// Updates over the network, as the loop task sees them (docs/board/wifi-and-updates-v1.md#updates).
// The decisions are in lib/PixelUpdate. On the board, the network task runs the checks and the
// downloads, and hands each downloaded file to the loop task, which validates and stores it. The
// simulator runs the same steps on the loop task, between frames, against a folder
// (docs/protocol/protocol-v1.md#update_check) it is given with --update-source.

#pragma once

#include <pixelart_engine.h>

#include <cstdint>
#include <map>
#include <string>

#include "settings.h"
#include "site.h"

// URL of the firmware manifest. A test build replaces it with -DPIXELART_FIRMWARE_MANIFEST=..., and may add
// -DPIXELART_FIRMWARE_ALLOW_HTTP to reach a local test server over http://. The second flag does nothing
// without the first. Release builds define neither.
#ifdef PIXELART_FIRMWARE_MANIFEST
#ifdef PIXELART_FIRMWARE_ALLOW_HTTP
#define PIXELART_FIRMWARE_HTTP_ALLOWED true
#else
#define PIXELART_FIRMWARE_HTTP_ALLOWED false
#endif
#else
#define PIXELART_FIRMWARE_MANIFEST PIXELART_SITE_MANIFEST_URL
#define PIXELART_FIRMWARE_HTTP_ALLOWED false
#endif

namespace updates
{

constexpr const char *FIRMWARE_MANIFEST = PIXELART_FIRMWARE_MANIFEST;
constexpr bool FIRMWARE_ALLOW_HTTP = PIXELART_FIRMWARE_HTTP_ALLOWED;
// A download goes to this file, outside the animation, playlist and schedule folders, until it is checked.
constexpr const char *TEMP_FILE = "/update.tmp";

// What `status` reports about updates, copied under a lock so it is always consistent.
struct Snapshot
{
  const char *state = "idle"; // idle, checking, downloading, installing or waiting_for_time
  uint8_t progress = 0;
  bool has_last_check = false;
  uint32_t last_check_seconds = 0;   // since the last check ended
  const char *last_result = nullptr; // `ok` or an update error, null before the first one
  const char *last_detail = nullptr; // `no_release` when the manifest answered 404, null otherwise
  uint16_t failed_files = 0;
  uint16_t files = 0;   // animations, playlists and schedules to add or replace
  std::string firmware; // the firmware version the last check found, empty when none
  bool firmware_skipped = false;
  bool time_known = false;
};

// Starts the updates with the settings: removes a temporary file an earlier run left, starts
// following the update settings. Call it once from setup(), after the file system is mounted.
void begin(const settings::Values &values);

// The settings changed.
void apply(const settings::Values &values);

Snapshot snapshot();

// Whether the player plays a schedule, which needs the local date: the board then asks for the time whatever
// the update settings (docs/board/wifi-and-updates-v1.md#time).
void set_schedule_needs_time(bool needed);

// The local date in the board's time zone, false while the time is not known. On the board it is known only
// while the time is needed, and it is the date the network task published at its last step: steps run about every
// 2 seconds while the board is connected and every 10 seconds otherwise, and again when a download ends. A busy
// network task, for example with a download or a WiFi scan, publishes it later.
bool local_date(pixelart::LocalDate &date);

// How a request for a check or an installation ends.
enum class Request
{
  Started,
  UpdatesOff,       // update_mode is `off`, or the switch of what the request asks for is off
  NothingToInstall, // the last check found nothing for the target
  NoNetwork,
  Busy,
  FirmwareConfirming // the running firmware is on trial and cannot be replaced yet
};

// `update_check`, and `update_install` for animations, playlists and schedules and for the firmware (`force`
// installs a version on the skip list). They return at once; the work goes on in the background.
Request check();
Request install_animations();
Request install_firmware(bool force);

// `delete_all` calls this: an installation of animations, playlists and schedules that is running or asked for
// stops. A file being downloaded is discarded when it arrives, the files not yet stored are skipped, and the files
// the last check found are forgotten (`update.files` is 0, `update.last_result` stays as it was). Nothing
// changes when no such installation is running. A firmware installation is not touched.
void cancel_install();

// The loop task calls this in the waits between frames: it validates and stores a downloaded file,
// and in the simulator it also runs the next step of a check or an installation.
void poll();

// Whether a firmware is being installed: the loop task then shows the update icon instead of the
// animation, with the progress, until the board restarts or the installation fails.
bool firmware_installing();
uint8_t firmware_progress();

#ifndef PIXELART_SIM
// The network task calls this in its loop. It does one unit of work, if there is one, and returns
// the milliseconds until it needs to run again: 0 right away, UINT32_MAX when only a message
// can give it work.
uint32_t net_tick();
#endif

#ifdef PIXELART_SIM
// ---- The simulator's update source and failure injection, for tests and --update-source ----

enum class Failure
{
  ServerDown, // every request fails with network_error
  TlsError,   // the request of the path fails with tls_error
  HttpError,  // the request of the path is answered with a status other than 200
  Cut,        // the download of the path ends halfway with network_error
  Corrupt,    // the download of the path arrives with its first byte changed
  TooLong     // the download of the path arrives with one more byte than the manifest says
};

// Serves the files of a folder: the path of a URL below the host is looked up in it, and when the
// folder has no copy of the folders of the path, in the part after them, so a folder with the
// published site answers for the site address's manifest.json (include/site.h).
void sim_use_folder(const std::string &folder);
// Serves these files, by path without a leading slash, for tests.
void sim_use_files(const std::map<std::string, std::string> &files);
// Serves nothing: every request fails with network_error. The default without --update-source, and
// then the simulator does not check on a schedule either.
void sim_use_nothing();
// The failure a test or --update-fail names: down, tls, http, cut, corrupt or too_long. False for any other name.
bool sim_failure_from_name(const std::string &name, Failure &failure);
// Makes requests fail. `path` is empty for every request (ServerDown always is).
void sim_inject(Failure failure, const std::string &path = "");
void sim_clear_failures();
// The local time for the install window, minutes after midnight; negative: not known. Without a date, the
// date is then 2000-01-01.
void sim_set_local_minutes(int minutes);
// The local date for the schedule; a year of 0: not known. Without a time, the time is then 12:00.
void sim_set_local_date(const pixelart::LocalDate &date);
// Whether the board asks for the time, as set_schedule_needs_time() and the update settings make it, for tests.
bool sim_time_needed();
// Forgets what a test did: the source, the failures and the time.
void sim_reset();
#endif

} // namespace updates
