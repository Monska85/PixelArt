// SPDX-License-Identifier: GPL-3.0-or-later

// The board's settings (docs/protocol/protocol-v1.md#settings_get-settings_set).
// On the board they live in NVS, outside the file system that holds the
// animations. The simulator keeps them in memory for the length of a run.

#pragma once

#include <cstdint>
#include <string>

namespace settings
{

constexpr uint8_t DEFAULT_BRIGHTNESS = 100;
constexpr const char *DEFAULT_PLAYLIST = "default";

// Loads the stored settings. A missing or unusable value takes its default;
// the simulator always starts from the defaults.
void begin();

uint8_t brightness();
// ID of the active playlist.
const std::string &playlist();

// Change a setting. The value is stored only when it differs from the current
// one, which saves flash writes. Return false if the value could not be
// stored; the setting then keeps its previous value.
bool set_brightness(uint8_t value);
bool set_playlist(const std::string &id);

#ifdef PIXELART_SIM
// Makes set_brightness fail when the value changes, to test the error paths.
void fail_brightness_saves(bool fail);
// Lets `successes` more changes of the playlist succeed, then fails every one. -1 restores normal saving.
void fail_playlist_saves_after(int successes);
#endif

} // namespace settings
