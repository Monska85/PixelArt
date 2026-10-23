// SPDX-License-Identifier: GPL-3.0-or-later

#include "settings.h"

#include <pixelart_engine.h>

#ifndef PIXELART_SIM
#include <Preferences.h>
#endif

namespace settings
{

namespace
{

#ifdef PIXELART_SIM
bool brightness_saves_fail = false;
int playlist_saves_left = -1; // -1: every save works
#endif

uint8_t current_brightness = DEFAULT_BRIGHTNESS;
std::string current_playlist = DEFAULT_PLAYLIST;

#ifndef PIXELART_SIM
const char *NAMESPACE = "pixelart";
const char *KEY_SCHEMA = "schema";
const char *KEY_BRIGHTNESS = "brightness";
const char *KEY_PLAYLIST = "playlist";
constexpr uint8_t SCHEMA = 1;

Preferences prefs;
#endif

} // namespace

void begin()
{
  current_brightness = DEFAULT_BRIGHTNESS;
  current_playlist = DEFAULT_PLAYLIST;
#ifndef PIXELART_SIM
  if (!prefs.begin(NAMESPACE, false))
    return;
  if (prefs.getUChar(KEY_SCHEMA, 0) != SCHEMA)
    prefs.putUChar(KEY_SCHEMA, SCHEMA);
  current_brightness = prefs.getUChar(KEY_BRIGHTNESS, DEFAULT_BRIGHTNESS);
  // getString logs an error for a key that was never written
  if (prefs.isKey(KEY_PLAYLIST))
  {
    String playlist = prefs.getString(KEY_PLAYLIST, DEFAULT_PLAYLIST);
    if (pixelart::is_valid_id(playlist.c_str()))
      current_playlist = playlist.c_str();
  }
#endif
}

uint8_t brightness() { return current_brightness; }

const std::string &playlist() { return current_playlist; }

bool set_brightness(uint8_t value)
{
  if (value == current_brightness)
    return true;
#ifdef PIXELART_SIM
  if (brightness_saves_fail)
    return false;
#else
  if (prefs.putUChar(KEY_BRIGHTNESS, value) != sizeof(uint8_t))
    return false;
#endif
  current_brightness = value;
  return true;
}

bool set_playlist(const std::string &id)
{
  if (id == current_playlist)
    return true;
#ifdef PIXELART_SIM
  if (playlist_saves_left == 0)
    return false;
  if (playlist_saves_left > 0)
    playlist_saves_left--;
#else
  if (prefs.putString(KEY_PLAYLIST, id.c_str()) != id.size())
    return false;
#endif
  current_playlist = id;
  return true;
}

#ifdef PIXELART_SIM
void fail_brightness_saves(bool fail) { brightness_saves_fail = fail; }
void fail_playlist_saves_after(int successes) { playlist_saves_left = successes; }
#endif

} // namespace settings
