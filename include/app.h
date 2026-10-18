// Plays the animations stored on the board, following the playlist rules of
// docs/format/playlist-v1.md#how-the-board-chooses-what-to-play.

#pragma once

#include <pixelart_engine.h>

#include <cstdint>
#include <string>
#include <vector>

// Path of an animation or playlist file on the board, from its ID or name.
std::string animation_file(const std::string &id);
std::string playlist_file(const std::string &name);

// IDs of the animation files in /animations, and names of the playlists in
// /playlists, sorted.
std::vector<std::string> stored_animations();
std::vector<std::string> stored_playlists();

// Read and validate a stored file with the engine. On failure, `diagnostics`
// says why: the engine's codes, or `missing_file`, `limit_exceeded` (file too
// large), `out_of_memory` and `unreadable` when the file cannot be read.
bool load_stored_animation(const std::string &id, pixelart::Animation &animation,
                           std::vector<pixelart::Diagnostic> &diagnostics);
bool load_stored_playlist(const std::string &name, pixelart::Playlist &playlist,
                          std::vector<pixelart::Diagnostic> &diagnostics);

// Loads /animations/<id>.json and plays it `times` times. Returns false, and
// reports the reason on the serial port once, if the file is missing or invalid.
bool play_stored_animation(const std::string &id, uint16_t times = 1);

// Plays the default playlist once. Without a usable playlist, plays every
// valid animation in alphabetical order; without any, shows a built-in image.
void play_from_storage();
