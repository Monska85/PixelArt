// SPDX-License-Identifier: GPL-3.0-or-later

#include "settings.h"

#include <pixelart_engine.h>

#include <algorithm>
#include <cctype>
#include <vector>

#include "platform.h"
#include "wifi_logic.h"

#ifndef PIXELART_SIM
#include <Preferences.h>
#endif

namespace settings
{

static_assert(MAX_PLAYLISTS == pixelart::MAX_SCHEDULE_PLAYLISTS, "the playlists setting holds as many as an entry");

namespace
{

#ifdef PIXELART_SIM
bool brightness_saves_fail = false;
bool token_saves_fail = false;
std::string start_token;
// Saves of `playlist`, `play` and `playlists` that still work. -1: every save works.
int playlist_saves_left = -1;
int play_saves_left = -1;
int playlists_saves_left = -1;
int schedule_saves_left = -1;
// The `playlist`, `play` and `playlists` keys, kept once sim_store_play_keys() was called. An empty text is a
// missing key.
bool play_keys_kept = false;
std::string playlist_key;
std::string play_key;
std::string playlists_key;
std::string schedule_key;

bool use_save(int &saves_left)
{
  if (saves_left == 0)
    return false;
  if (saves_left > 0)
    saves_left--;
  return true;
}
#endif

Values values;

// The order the settings are saved in, and put back in reverse. `playlist` goes first: it is what an older
// firmware reads.
enum class Field
{
  Playlist,
  Play,
  Playlists,
  Schedule,
  Brightness,
  WifiPower,
  UpdateMode,
  UpdateFirmware,
  UpdateAnimations,
  CheckHours,
  InstallStart,
  InstallEnd,
  Timezone,
  TimeSyncHours,
  NtpServer,
  AnimationSource,
  NetworkLogin,
  Token,
  Count
};
constexpr int FIELD_COUNT = (int)Field::Count;

bool differs(Field field, const Values &a, const Values &b)
{
  switch (field)
  {
  case Field::Playlist:
    return a.playlist != b.playlist;
  case Field::Play:
    return a.play != b.play || a.play_stored != b.play_stored;
  case Field::Playlists:
    return a.playlists != b.playlists || a.play_stored != b.play_stored;
  case Field::Schedule:
    return a.schedule != b.schedule;
  case Field::Brightness:
    return a.brightness != b.brightness;
  case Field::WifiPower:
    return a.wifi_power != b.wifi_power;
  case Field::UpdateMode:
    return a.update_mode != b.update_mode;
  case Field::UpdateFirmware:
    return a.update_firmware != b.update_firmware;
  case Field::UpdateAnimations:
    return a.update_animations != b.update_animations;
  case Field::CheckHours:
    return a.check_hours != b.check_hours;
  case Field::InstallStart:
    return a.install_start != b.install_start;
  case Field::InstallEnd:
    return a.install_end != b.install_end;
  case Field::Timezone:
    return a.timezone != b.timezone;
  case Field::TimeSyncHours:
    return a.time_sync_hours != b.time_sync_hours;
  case Field::NtpServer:
    return a.ntp_server != b.ntp_server;
  case Field::AnimationSource:
    return a.animation_source != b.animation_source;
  case Field::NetworkLogin:
    return a.network_login != b.network_login;
  case Field::Token:
    return a.token != b.token;
  case Field::Count:
    break;
  }
  return false;
}

#ifndef PIXELART_SIM
const char *NAMESPACE = "pixelart";
const char *KEY_SCHEMA = "schema";
constexpr uint8_t SCHEMA = 1;

// NVS keys are at most 15 characters.
// A switch, not a table in the order of Field: each key sits next to its field,
// so adding or moving a field cannot store it under another field's key.
const char *key_of(Field field)
{
  switch (field)
  {
  case Field::Playlist:
    return "playlist";
  case Field::Play:
    return "play";
  case Field::Playlists:
    return "playlists";
  case Field::Schedule:
    return "schedule";
  case Field::Brightness:
    return "brightness";
  case Field::WifiPower:
    return "wifi_power";
  case Field::UpdateMode:
    return "update_mode";
  case Field::UpdateFirmware:
    return "upd_firmware";
  case Field::UpdateAnimations:
    return "upd_anims";
  case Field::CheckHours:
    return "check_hours";
  case Field::InstallStart:
    return "inst_start";
  case Field::InstallEnd:
    return "inst_end";
  case Field::Timezone:
    return "timezone";
  case Field::TimeSyncHours:
    return "time_sync_h";
  case Field::NtpServer:
    return "ntp_server";
  case Field::AnimationSource:
    return "anim_source";
  case Field::NetworkLogin:
    return "net_login";
  case Field::Token:
    return "token";
  case Field::Count:
    break;
  }
  return ""; // not a valid NVS key: a write with it fails and is reported
}

Preferences prefs;

bool put_text(Field field, const std::string &text)
{
  return prefs.putString(key_of(field), text.c_str()) == text.size();
}
bool put_number(Field field, uint16_t value) { return prefs.putUShort(key_of(field), value) == sizeof(uint16_t); }
bool put_flag(Field field, bool value) { return prefs.putBool(key_of(field), value) == sizeof(uint8_t); }
// Removes a key, as for a value that was never stored. A key that is not there is already removed.
bool remove_key(Field field) { return !prefs.isKey(key_of(field)) || prefs.remove(key_of(field)); }

// A stored text, or `fallback` when the key was never written (getString logs an error then) or is not valid.
std::string stored_text(Field field, const std::string &fallback, bool (*valid)(const std::string &))
{
  if (!prefs.isKey(key_of(field)))
    return fallback;
  String text = prefs.getString(key_of(field), fallback.c_str());
  return valid(text.c_str()) ? std::string(text.c_str()) : fallback;
}

bool valid_any(const std::string &) { return true; }

uint16_t stored_number(Field field, uint16_t fallback, bool (*valid)(uint32_t))
{
  uint16_t value = prefs.getUShort(key_of(field), fallback);
  return valid(value) ? value : fallback;
}
#endif

bool valid_playlist_id(const std::string &id) { return pixelart::is_valid_id(id.c_str()); }

// `playlists` is stored as its IDs joined by commas, a character IDs never hold.
std::string join_playlists(const std::vector<std::string> &ids)
{
  std::string text;
  for (const std::string &id : ids)
    text += (text.empty() ? "" : ",") + id;
  return text;
}

// The stored list, or false when it is not a valid `playlists` value.
bool split_playlists(const std::string &text, std::vector<std::string> &out)
{
  out.clear();
  size_t start = 0;
  for (;;)
  {
    const size_t comma = text.find(',', start);
    std::string id = text.substr(start, comma == std::string::npos ? std::string::npos : comma - start);
    if (!pixelart::is_valid_id(id.c_str()) || out.size() == MAX_PLAYLISTS ||
        std::find(out.begin(), out.end(), id) != out.end())
      return false;
    out.push_back(std::move(id));
    if (comma == std::string::npos)
      return true;
    start = comma + 1;
  }
}

// Saves one field of `v`. Returns false when it cannot be saved.
bool write(Field field, const Values &v)
{
#ifdef PIXELART_SIM
  if (field == Field::Brightness && brightness_saves_fail)
    return false;
  if (field == Field::Token && token_saves_fail)
    return false;
  if (field == Field::Playlist && !use_save(playlist_saves_left))
    return false;
  if (field == Field::Play && !use_save(play_saves_left))
    return false;
  if (field == Field::Playlists && !use_save(playlists_saves_left))
    return false;
  if (field == Field::Schedule && !use_save(schedule_saves_left))
    return false;
  if (play_keys_kept && field == Field::Playlist)
    playlist_key = v.playlist;
  else if (play_keys_kept && field == Field::Play)
    play_key = v.play_stored ? v.play : "";
  else if (play_keys_kept && field == Field::Playlists)
    playlists_key = v.play_stored ? join_playlists(v.playlists) : "";
  else if (play_keys_kept && field == Field::Schedule)
    schedule_key = v.schedule;
  return true;
#else
  switch (field)
  {
  case Field::Playlist:
    return put_text(field, v.playlist);
  case Field::Play:
    return v.play_stored ? put_text(field, v.play) : remove_key(field);
  case Field::Playlists:
    return v.play_stored ? put_text(field, join_playlists(v.playlists)) : remove_key(field);
  case Field::Schedule:
    return put_text(field, v.schedule);
  case Field::Brightness:
    return prefs.putUChar(key_of(field), v.brightness) == sizeof(uint8_t);
  case Field::WifiPower:
    return put_text(field, v.wifi_power);
  case Field::UpdateMode:
    return put_text(field, v.update_mode);
  case Field::UpdateFirmware:
    return put_flag(field, v.update_firmware);
  case Field::UpdateAnimations:
    return put_flag(field, v.update_animations);
  case Field::CheckHours:
    return put_number(field, v.check_hours);
  case Field::InstallStart:
    return put_number(field, v.install_start);
  case Field::InstallEnd:
    return put_number(field, v.install_end);
  case Field::Timezone:
    return put_text(field, v.timezone);
  case Field::TimeSyncHours:
    return put_number(field, v.time_sync_hours);
  case Field::NtpServer:
    return put_text(field, v.ntp_server);
  case Field::AnimationSource:
    return put_text(field, v.animation_source);
  case Field::NetworkLogin:
    return put_flag(field, v.network_login);
  case Field::Token:
    return put_text(field, v.token);
  case Field::Count:
    break;
  }
  return false;
#endif
}

// Copies the saved field of `from` into `to`.
void take(Field field, Values &to, const Values &from)
{
  switch (field)
  {
  case Field::Playlist:
    to.playlist = from.playlist;
    break;
  case Field::Play:
    to.play = from.play;
    to.play_stored = from.play_stored;
    break;
  case Field::Playlists:
    to.playlists = from.playlists;
    to.play_stored = from.play_stored;
    break;
  case Field::Schedule:
    to.schedule = from.schedule;
    break;
  case Field::Brightness:
    to.brightness = from.brightness;
    break;
  case Field::WifiPower:
    to.wifi_power = from.wifi_power;
    break;
  case Field::UpdateMode:
    to.update_mode = from.update_mode;
    break;
  case Field::UpdateFirmware:
    to.update_firmware = from.update_firmware;
    break;
  case Field::UpdateAnimations:
    to.update_animations = from.update_animations;
    break;
  case Field::CheckHours:
    to.check_hours = from.check_hours;
    break;
  case Field::InstallStart:
    to.install_start = from.install_start;
    break;
  case Field::InstallEnd:
    to.install_end = from.install_end;
    break;
  case Field::Timezone:
    to.timezone = from.timezone;
    break;
  case Field::TimeSyncHours:
    to.time_sync_hours = from.time_sync_hours;
    break;
  case Field::NtpServer:
    to.ntp_server = from.ntp_server;
    break;
  case Field::AnimationSource:
    to.animation_source = from.animation_source;
    break;
  case Field::NetworkLogin:
    to.network_login = from.network_login;
    break;
  case Field::Token:
    to.token = from.token;
    break;
  case Field::Count:
    break;
  }
}

bool printable_ascii(const std::string &text, bool allow_space)
{
  for (unsigned char c : text)
    if (c < (allow_space ? 0x20 : 0x21) || c > 0x7E)
      return false;
  return true;
}

} // namespace

bool valid_wifi_power(const std::string &value) { return wifi_logic::is_valid_power_setting(value); }

bool valid_update_mode(const std::string &value) { return value == "off" || value == "notify" || value == "automatic"; }

bool valid_check_hours(uint32_t value) { return value >= 1 && value <= MAX_CHECK_HOURS; }

bool valid_minutes(uint32_t value) { return value < MINUTES_PER_DAY; }

bool valid_timezone(const std::string &value)
{
  return !value.empty() && value.size() <= MAX_TIMEZONE && printable_ascii(value, true);
}

bool valid_play(const std::string &value)
{
  return value == PLAY_AUTO || value == PLAY_PLAYLISTS || value == PLAY_SCHEDULE;
}

bool valid_schedule_id(const std::string &value) { return pixelart::is_valid_id(value.c_str()); }

bool valid_time_sync_hours(uint32_t value) { return value >= 1 && value <= MAX_TIME_SYNC_HOURS; }

bool valid_ntp_server(const std::string &value)
{
  if (value.empty() || value.size() > MAX_NTP_SERVER)
    return false;
  for (unsigned char c : value)
    if (!isalnum(c) && c != '.' && c != '-')
      return false;
  return true;
}

std::string reported_playlist(const std::string &play, const std::vector<std::string> &playlists)
{
  return play != PLAY_PLAYLISTS || playlists.empty() ? DEFAULT_PLAYLIST : playlists.front();
}

void derive_play(Values &v)
{
  v.play = v.playlist == DEFAULT_PLAYLIST ? PLAY_AUTO : PLAY_PLAYLISTS;
  v.playlists = {v.playlist};
}

bool valid_animation_source(const std::string &value)
{
  if (value.size() > MAX_ANIMATION_SOURCE || !printable_ascii(value, false))
    return false;
  size_t start;
  if (value.compare(0, 8, "https://") == 0)
    start = 8;
  else if (value.compare(0, 7, "http://") == 0)
    start = 7;
  else
    return false;
  // The host: up to the path, query or fragment. It starts with a letter, a digit or `[`. User info
  // (`user:pass@host`) is refused: the URL is returned by settings_get and would hold a credential.
  size_t end = value.find_first_of("/?#", start);
  std::string host = value.substr(start, end == std::string::npos ? std::string::npos : end - start);
  return !host.empty() && host.find('@') == std::string::npos && (isalnum((unsigned char)host[0]) || host[0] == '[');
}

bool valid_token(const std::string &value)
{
  if (value.size() != TOKEN_SIZE)
    return false;
  for (char c : value)
    if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')))
      return false;
  return true;
}

std::string make_token()
{
  static const char ALPHABET[] = "abcdefghijklmnopqrstuvwxyz0123456789";
  constexpr unsigned SYMBOLS = 36;
  // Bytes from 252 up are skipped, so every symbol is equally likely.
  constexpr unsigned LIMIT = 256 / SYMBOLS * SYMBOLS;
  std::string token;
  while (token.size() < TOKEN_SIZE)
  {
    uint8_t bytes[TOKEN_SIZE];
    platform::secret_bytes(bytes, sizeof(bytes));
    for (uint8_t byte : bytes)
      if (byte < LIMIT && token.size() < TOKEN_SIZE)
        token += ALPHABET[byte % SYMBOLS];
  }
  return token;
}

Values defaults_with_new_token()
{
  Values fresh;
  fresh.token = make_token();
  return fresh;
}

namespace
{

// Sets `play` and `playlists` of `v` from the stored `play` key (empty when missing) and `playlists` key. When
// they are missing, unusable or do not agree with `playlist`, both are derived from `playlist` and count as not
// stored, so the next change of either one writes both keys.
void load_play(Values &v, const std::string &play, const std::string &playlists_text)
{
  derive_play(v);
  v.play_stored = false;
  std::vector<std::string> playlists;
  // An older firmware, run after a rollback, may have changed `playlist` alone: its choice is the newer one.
  if (valid_play(play) && split_playlists(playlists_text, playlists) &&
      reported_playlist(play, playlists) == v.playlist)
  {
    v.play = play;
    v.playlists = std::move(playlists);
    v.play_stored = true;
  }
}

} // namespace

void begin()
{
  values = Values();
#ifndef PIXELART_SIM
  if (prefs.begin(NAMESPACE, false))
  {
    if (prefs.getUChar(KEY_SCHEMA, 0) != SCHEMA)
      prefs.putUChar(KEY_SCHEMA, SCHEMA);
    values.brightness = prefs.getUChar(key_of(Field::Brightness), DEFAULT_BRIGHTNESS);
    values.playlist = stored_text(Field::Playlist, DEFAULT_PLAYLIST, valid_playlist_id);
    values.wifi_power = stored_text(Field::WifiPower, DEFAULT_WIFI_POWER, valid_wifi_power);
    values.update_mode = stored_text(Field::UpdateMode, DEFAULT_UPDATE_MODE, valid_update_mode);
    values.update_firmware = prefs.getBool(key_of(Field::UpdateFirmware), true);
    values.update_animations = prefs.getBool(key_of(Field::UpdateAnimations), true);
    values.check_hours = stored_number(Field::CheckHours, DEFAULT_CHECK_HOURS, valid_check_hours);
    values.install_start = stored_number(Field::InstallStart, 0, valid_minutes);
    values.install_end = stored_number(Field::InstallEnd, 0, valid_minutes);
    values.timezone = stored_text(Field::Timezone, DEFAULT_TIMEZONE, valid_timezone);
    values.time_sync_hours = stored_number(Field::TimeSyncHours, DEFAULT_TIME_SYNC_HOURS, valid_time_sync_hours);
    values.ntp_server = stored_text(Field::NtpServer, DEFAULT_NTP_SERVER, valid_ntp_server);
    values.animation_source = stored_text(Field::AnimationSource, DEFAULT_ANIMATION_SOURCE, valid_animation_source);
    values.network_login = prefs.getBool(key_of(Field::NetworkLogin), false);
    values.token = stored_text(Field::Token, "", valid_token);
    // No write here: a board upgraded from a firmware without `play` derives it from `playlist`.
    load_play(values, stored_text(Field::Play, "", valid_play), stored_text(Field::Playlists, "", valid_any));
    values.schedule = stored_text(Field::Schedule, DEFAULT_SCHEDULE, valid_schedule_id);
  }
#endif
#ifdef PIXELART_SIM
  if (play_keys_kept)
  {
    values.playlist = valid_playlist_id(playlist_key) ? playlist_key : DEFAULT_PLAYLIST;
    load_play(values, play_key, playlists_key);
    values.schedule = valid_schedule_id(schedule_key) ? schedule_key : DEFAULT_SCHEDULE;
  }
  values.token = start_token;
#endif
  if (values.token.empty())
  {
    // First start, or an unusable token: make one. When it cannot be stored it lasts until the next restart.
    values.token = make_token();
    write(Field::Token, values);
  }
}

const Values &current() { return values; }

uint8_t brightness() { return values.brightness; }

const std::string &playlist() { return values.playlist; }

namespace
{

// Sets the play settings of `v` to what begin() reads back when the `play` key holds the value of `play_from`
// and the `playlists` key the value of `playlists_from`, so a failed rollback of one of the two keys cannot
// leave a pair the board would not read after a restart.
void settle_play(Values &v, const Values &play_from, const Values &playlists_from)
{
  load_play(v, play_from.play_stored ? play_from.play : "",
            playlists_from.play_stored ? join_playlists(playlists_from.playlists) : "");
}

} // namespace

Commit commit(const Values &next)
{
  const Values previous = values;
  std::vector<Field> saved;
  for (int i = 0; i < FIELD_COUNT; i++)
  {
    const Field field = (Field)i;
    if (!differs(field, values, next))
      continue;
    if (write(field, next))
    {
      saved.push_back(field);
      continue;
    }
    // Put back what was saved, newest first. A value that cannot be put back stays as saved.
    Values after = previous;
    bool partly = false;
    // Whose value the `play` and `playlists` keys hold once the rollback ends.
    const Values *play_key = &previous;
    const Values *playlists_key = &previous;
    for (auto it = saved.rbegin(); it != saved.rend(); ++it)
      if (!write(*it, previous))
      {
        take(*it, after, next);
        partly = true;
        if (*it == Field::Play)
          play_key = &next;
        else if (*it == Field::Playlists)
          playlists_key = &next;
      }
    settle_play(after, *play_key, *playlists_key); // what the board reads after a restart
    values = after;
    return partly ? Commit::PartlyChanged : Commit::Failed;
  }
  values = next;
  return Commit::Ok;
}

bool set_brightness(uint8_t value)
{
  Values next = values;
  next.brightness = value;
  return commit(next) == Commit::Ok;
}

bool set_playlist(const std::string &id)
{
  Values next = values;
  next.playlist = id;
  derive_play(next);
  return commit(next) == Commit::Ok;
}

#ifdef PIXELART_SIM
void fail_brightness_saves(bool fail) { brightness_saves_fail = fail; }
void fail_playlist_saves_after(int successes) { playlist_saves_left = successes; }
void fail_play_saves_after(int successes) { play_saves_left = successes; }
void fail_playlists_saves_after(int successes) { playlists_saves_left = successes; }
void fail_schedule_saves_after(int successes) { schedule_saves_left = successes; }
void fail_token_saves(bool fail) { token_saves_fail = fail; }
void sim_set_start_token(const std::string &token) { start_token = token; }
void sim_store_play_keys(const std::string &playlist, const std::string &play, const std::string &playlists,
                         const std::string &schedule)
{
  play_keys_kept = true;
  schedule_key = schedule;
  playlist_key = playlist;
  play_key = play;
  playlists_key = playlists;
}
void sim_forget_play_keys() { play_keys_kept = false; }
#endif

} // namespace settings
