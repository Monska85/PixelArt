// SPDX-License-Identifier: GPL-3.0-or-later

// The board's settings (docs/protocol/protocol-v1.md#settings_get-settings_set).
// On the board they live in NVS, outside the file system that holds the
// animations. The simulator keeps them in memory for the length of a run.

#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "site.h"

namespace settings
{

constexpr uint8_t DEFAULT_BRIGHTNESS = 100;
constexpr const char *DEFAULT_PLAYLIST = "default";
constexpr const char *PLAY_AUTO = "auto";
constexpr const char *PLAY_PLAYLISTS = "playlists";
constexpr const char *DEFAULT_WIFI_POWER = "auto";
constexpr const char *DEFAULT_UPDATE_MODE = "automatic";
constexpr uint16_t DEFAULT_CHECK_HOURS = 6;
constexpr const char *DEFAULT_TIMEZONE = "UTC0";
constexpr uint16_t DEFAULT_TIME_SYNC_HOURS = 6;
constexpr const char *DEFAULT_NTP_SERVER = "pool.ntp.org";
constexpr const char *DEFAULT_ANIMATION_SOURCE = PIXELART_SITE_MANIFEST_URL;

constexpr size_t MAX_TIMEZONE = 64;
// The source of the limit of an animation_source: tools/site_url.py and web/src/ui/board/updates.ts repeat it.
constexpr size_t MAX_ANIMATION_SOURCE = 512;
static_assert(sizeof(PIXELART_SITE_MANIFEST_URL) - 1 <= MAX_ANIMATION_SOURCE,
              "the manifest of the site address must fit an animation_source: shorten PIXELART_SITE_URL");
constexpr size_t TOKEN_SIZE = 16;
constexpr uint16_t MAX_CHECK_HOURS = 168;
constexpr uint16_t MAX_TIME_SYNC_HOURS = 168;
constexpr size_t MAX_NTP_SERVER = 64;
// Playlists in the `playlists` setting, as many as in a schedule entry.
constexpr size_t MAX_PLAYLISTS = 8;
constexpr uint16_t MINUTES_PER_DAY = 1440;

// Every setting. The token is read only for clients: it changes through
// regenerate_token() and a reset.
struct Values
{
  uint8_t brightness = DEFAULT_BRIGHTNESS;
  // `playlist`, `play` and `playlists` always keep playlist == reported_playlist(play, playlists). `playlist` is the
  // one an older client and an older firmware see, stored under the key older firmware reads, so a rolled back
  // firmware plays the same. A commit() whose rollback cannot put back the `play` or `playlists` key sets the three
  // to what begin() reads back after a restart.
  std::string playlist = DEFAULT_PLAYLIST;
  std::string play = PLAY_AUTO; // `auto` or `playlists`
  std::vector<std::string> playlists = {DEFAULT_PLAYLIST};
  // True when the `play` and `playlists` keys exist in storage, hold valid values and agree with `playlist`: `play`
  // and `playlists` are then the stored values. False means derive_play() supplies them from `playlist`, so an
  // upgraded board plays as before without any write; the next change of either one writes both keys.
  bool play_stored = false;
  std::string wifi_power = DEFAULT_WIFI_POWER;
  std::string update_mode = DEFAULT_UPDATE_MODE;
  bool update_firmware = true;
  bool update_animations = true;
  uint16_t check_hours = DEFAULT_CHECK_HOURS;
  uint16_t install_start = 0;
  uint16_t install_end = 0;
  std::string timezone = DEFAULT_TIMEZONE;
  uint16_t time_sync_hours = DEFAULT_TIME_SYNC_HOURS;
  std::string ntp_server = DEFAULT_NTP_SERVER;
  std::string animation_source = DEFAULT_ANIMATION_SOURCE;
  bool network_login = false;
  std::string token;

  // Whether `other` differs in a setting the update task works from, so that a field added to the
  // update configuration is compared in one place.
  bool update_config_differs(const Values &other) const
  {
    return update_mode != other.update_mode || update_firmware != other.update_firmware ||
           update_animations != other.update_animations || check_hours != other.check_hours ||
           install_start != other.install_start || install_end != other.install_end || timezone != other.timezone ||
           time_sync_hours != other.time_sync_hours || ntp_server != other.ntp_server ||
           animation_source != other.animation_source;
  }
};

// The rules of each setting, for requests. Each returns true for a valid value.
bool valid_wifi_power(const std::string &value);
bool valid_update_mode(const std::string &value);
bool valid_check_hours(uint32_t value);
bool valid_minutes(uint32_t value);
bool valid_timezone(const std::string &value);
bool valid_play(const std::string &value);
bool valid_time_sync_hours(uint32_t value);
bool valid_ntp_server(const std::string &value);
bool valid_animation_source(const std::string &value);
bool valid_token(const std::string &value);

// Loads the stored settings. A missing or unusable value takes its default;
// the simulator starts from the defaults, except for the keys of
// sim_store_play_keys(). The first start makes the token with the hardware
// random number generator.
void begin();

const Values &current();

uint8_t brightness();
// The playlist an older client sees, see Values::playlist.
const std::string &playlist();

// What `playlist` reports for these `play` and `playlists`.
std::string reported_playlist(const std::string &play, const std::vector<std::string> &playlists);
// Sets `play` and `playlists` from `playlist`, as for a board that never stored them: `auto` for `default`,
// else `playlists` with that one playlist.
void derive_play(Values &values);

// A token of TOKEN_SIZE characters from a-z and 0-9, from the random number generator.
std::string make_token();

enum class Commit
{
  Ok,
  Failed,       // nothing changed
  PartlyChanged // a value could not be saved and the ones saved before it could not be put back
};

// Stores every setting of `next` that differs from the current one, all or
// nothing: when one cannot be saved, the ones saved before it are put back.
// Values are stored only when they differ, which saves flash writes. The
// order of saving is fixed: playlist, play, playlists, brightness, then the others.
Commit commit(const Values &next);

// Change one setting. Return false if the value could not be stored; the
// setting then keeps its previous value. set_playlist() sets the playlist as an older client does.
bool set_brightness(uint8_t value);
bool set_playlist(const std::string &id);

// The defaults, with a new token.
Values defaults_with_new_token();

#ifdef PIXELART_SIM
// The token the next begin() starts with, instead of a made one, so a client can log in. An empty text
// makes one again. The text must be a valid token.
void sim_set_start_token(const std::string &token);
// Makes set_brightness fail when the value changes, to test the error paths.
void fail_brightness_saves(bool fail);
// Lets `successes` more changes of the playlist succeed, then fails every one. -1 restores normal saving.
void fail_playlist_saves_after(int successes);
// The same for the `play` and the `playlists` keys.
void fail_play_saves_after(int successes);
void fail_playlists_saves_after(int successes);
// Makes every save of the token fail.
void fail_token_saves(bool fail);
// Keeps the `playlist`, `play` and `playlists` keys as the board stores them, starting from these texts (an
// empty text is a missing key, `playlists` holds the IDs joined by commas): the next begin() reads them, and
// every save updates them, so a test can restart the board with what it stored.
void sim_store_play_keys(const std::string &playlist, const std::string &play, const std::string &playlists);
// Goes back to starting from the defaults.
void sim_forget_play_keys();
#endif

} // namespace settings
