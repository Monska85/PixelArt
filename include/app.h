// SPDX-License-Identifier: GPL-3.0-or-later

// Plays the animations stored on the board, following the rules of
// docs/format/playlist-v1.md#how-the-board-chooses-what-to-play: the list of playlists comes from the
// play settings, the server choice (the play file) and the schedules, and changes when the current animation ends.

#pragma once

#include <pixelart_engine.h>

#include <cstdint>
#include <string>
#include <vector>

#include "settings.h"
#include "task_sync.h"

// Folders of the animation, playlist, schedule and play files on the board.
constexpr const char *ANIMATIONS_FOLDER = "/animations";
constexpr const char *PLAYLISTS_FOLDER = "/playlists";
constexpr const char *SCHEDULES_FOLDER = "/schedules";
constexpr const char *SCHEDULES_V2_FOLDER = "/schedules-v2";
constexpr const char *PLAY_FOLDER = "/play";
// The only play file the board uses: its `default` is the server choice.
constexpr const char *SERVER_CHOICE_PLAY_FILE = "default";

// Path of an animation, playlist, schedule or play file on the board, from its ID or name.
std::string animation_file(const std::string &id);
std::string playlist_file(const std::string &name);
std::string schedule_file(const std::string &id);
std::string schedule_v2_file(const std::string &id);
std::string play_file(const std::string &id);

// IDs of the animation files in /animations, and names of the playlists in
// /playlists, of the schedules in /schedules and of the play files in /play, sorted.
std::vector<std::string> stored_animations();
std::vector<std::string> stored_playlists();
std::vector<std::string> stored_schedules();
std::vector<std::string> stored_schedules_v2();
std::vector<std::string> stored_play_files();

// Read and validate a stored file with the engine. On failure, `diagnostics`
// says why: the engine's codes, or `missing_file`, `limit_exceeded` (file too
// large), `out_of_memory` and `unreadable` when the file cannot be read.
bool load_stored_animation(const std::string &id, pixelart::Animation &animation,
                           std::vector<pixelart::Diagnostic> &diagnostics);
// The same for a playlist and a schedule. `wait` says how long the loop task waits for the memory an update
// holds.
bool load_stored_playlist(const std::string &name, pixelart::Playlist &playlist,
                          std::vector<pixelart::Diagnostic> &diagnostics,
                          task_sync::Wait wait = task_sync::Wait::Limited);
bool load_stored_schedule(const std::string &id, pixelart::Schedule &schedule,
                          std::vector<pixelart::Diagnostic> &diagnostics,
                          task_sync::Wait wait = task_sync::Wait::Limited);
bool load_stored_schedule_v2(const std::string &id, pixelart::Schedule &schedule,
                             std::vector<pixelart::Diagnostic> &diagnostics,
                             task_sync::Wait wait = task_sync::Wait::Limited);

// The same for a play file: `choice` is its `default`.
bool load_stored_play(const std::string &id, pixelart::ServerChoice &choice,
                      std::vector<pixelart::Diagnostic> &diagnostics, task_sync::Wait wait = task_sync::Wait::Limited);

// The server choice: the `default` of /play/default.json, none when that file is missing or not valid. Reads the
// file each time. `busy` is set, and the result is none, when an update holds the memory.
pixelart::ServerChoice load_server_choice(bool &busy, task_sync::Wait wait = task_sync::Wait::Limited);

// Loads /animations/<id>.json and plays it `times` times. Returns false, and
// reports the reason on the serial port once, if the file is missing or invalid.
bool play_stored_animation(const std::string &id, uint16_t times = 1);

// Forgets what the player chose and where it was, and makes the first choice. Called at boot once the storage and
// the updates are ready and before the network task starts, so the choice cannot wait for an update and `status`
// always has one to report. When it cannot be made, the first pass chooses again.
void begin_player();

// Plays the list of playlists once, each playlist in full, from the playlist it was at. Without a playlist it
// can play, plays every valid animation in alphabetical order; without any, shows a built-in image. Returns
// early, after the current animation, when the list changed meanwhile.
void play_from_storage();

// Both make the player choose its list again when the current animation ends; only the first one also starts
// the list from its first playlist when the new list is the same.

// A playlist was stored or deleted: the player chooses its list again and starts it from its first playlist
// when the current animation ends.
void request_choice_and_restart();

// The play settings, the play file, the time zone or a schedule changed: the player chooses its list again when the
// current animation ends, and keeps its position when the list is the same.
void request_choice();

// Whether a new choice is requested and not yet applied. For tests.
bool choice_pending();

// How many playlists the player skips until the next event. For tests.
size_t skipped_playlist_count();

// Chooses the list again when a choice is requested or the local date moved, as `status` calls it before
// play_status(). It never waits for the memory an update holds: the last choice stays until the next call.
void refresh_choice();

// What `status` reports in `play`: the newest choice, and the playlist playing or the next one to start. Before
// the first choice, the list the setting asks for (`default` for Automatic) and nothing playing. Reads only.
struct PlayStatus
{
  const char *mode = settings::PLAY_AUTO; // the `play` setting the list was chosen for
  pixelart::PlaySource source = pixelart::PlaySource::Fallback;
  std::string schedule; // empty: no schedule is used
  bool schedule_v2 = false;
  pixelart::PlayReason reason = pixelart::PlayReason::NoSchedule;
  int entry = -1;
  std::vector<std::string> playlists;
  std::string playing;                  // empty: every animation plays, or the "no animations" image
  pixelart::ServerChoice server_choice; // the one of the play file, whatever the list was chosen from
};
PlayStatus play_status();
