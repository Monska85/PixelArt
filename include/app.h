// Plays the animations stored on the board, following the playlist rules of
// docs/format/playlist-v1.md#how-the-board-chooses-what-to-play.

#pragma once

#include <pixelart_engine.h>

#include <cstdint>
#include <string>
#include <vector>

// Folders of the animation and playlist files on the board.
constexpr const char *ANIMATIONS_FOLDER = "/animations";
constexpr const char *PLAYLISTS_FOLDER = "/playlists";

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

// Plays the active playlist (the `playlist` setting, `default` unless changed)
// once. Without a usable playlist, plays every valid animation in alphabetical
// order; without any, shows a built-in image. Returns early, after the
// current animation, when request_playlist_reload() was called meanwhile.
void play_from_storage();

// Asks the player to read the active playlist again and start it from its
// first item when the current animation ends. Called when a playlist file or
// the active playlist changes.
void request_playlist_reload();

// Whether a reload is requested and not yet done. For tests.
bool playlist_reload_pending();
