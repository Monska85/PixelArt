// SPDX-License-Identifier: GPL-3.0-or-later

#include "app.h"

#include <algorithm>
#include <cstring>
#include <set>
#include <utility>

#include "firmware.h"
#include "pixel_art.h"
#include "platform.h"
#include "protocol.h"
#include "settings.h"
#include "storage.h"
#include "task_sync.h"
#include "update_icon.h"
#include "updates.h"

namespace
{

const char *JSON_SUFFIX = ".json";
const char *BUSY_CODE = "busy";
constexpr uint32_t NO_ANIMATIONS_MS = 2000;
// How long the player waits before it tries again when an update connection holds the memory.
constexpr uint32_t BUSY_RETRY_MS = 200;
// Distinct problems remembered by report_once; beyond this they are not
// printed again, so the memory used stays bounded.
constexpr size_t MAX_REPORTED = 64;
// A frame this far behind its schedule starts a new schedule instead of
// catching up with a burst of frames.
constexpr uint64_t MAX_LAG_US = 1000000;

// What the board plays: the list of docs/format/playlist-v1.md#how-the-board-chooses-what-to-play and what it
// was chosen from.
struct Choice
{
  bool made = false;
  bool automatic = true;
  pixelart::PlayChoice play;
  // Automatic with a valid schedule: the choice depends on the local date, which it was made for.
  bool dated = false;
  bool date_known = false;
  pixelart::LocalDate date;
};

Choice newest;            // the latest choice, the one `status` reports
Choice applied;           // the choice the player plays
bool choose_again = true; // a setting, a file or the time changed since `newest` was made
bool in_pass = false;     // play_from_storage() runs: the end of an animation may change the list
bool leave_list = false;  // the list changed: play_from_storage() returns after the current animation

// Where the player is in `applied`. A new list, or a request to restart it, starts again from reset().
struct Place
{
  bool restart_list = false; // a playlist was stored or deleted: the list starts again
  size_t index = 0;          // the playlist of `applied` the player is at, at most its size
  int current = -1;          // the playlist of `applied` that plays, -1 before one starts
  bool pass_played = false;  // an animation of the list played in this pass

  void reset() { *this = Place(); }
};
Place place;

// Playlists that played nothing since the last event, so the next choice falls back past them. Each ID is in
// it once, so it holds at most the distinct playlists a choice can list. A new list keeps it: the fallback is
// chosen past these playlists.
std::vector<std::string> skipped;

void skip(const std::string &id)
{
  if (std::find(skipped.begin(), skipped.end(), id) == skipped.end())
    skipped.push_back(id);
}

// Deadline of the frame being waited for. Each frame's deadline follows the
// previous one, so a command that delays one frame does not shift the frames
// after it, and the schedule does not drift.
uint64_t deadline_us = 0;
bool has_deadline = false;

// Starts a new schedule at the next wait: the first frame of an animation.
void restart_schedule() { has_deadline = false; }

void show_update_icon();

// Waits for the end of a frame of `ms` milliseconds, handling protocol
// commands meanwhile. A command that runs long delays this frame only.
void wait(uint32_t ms)
{
  uint64_t now = platform::now_us();
  if (!has_deadline || now > deadline_us + MAX_LAG_US)
    deadline_us = now;
  has_deadline = true;
  deadline_us += (uint64_t)ms * 1000;
  for (;;)
  {
    protocol::poll();
    updates::poll();
    if (updates::firmware_installing())
    {
      show_update_icon();
      return; // the animation's schedule is gone
    }
    now = platform::now_us();
    if (now >= deadline_us)
      return;
    platform::wait_us(deadline_us - now);
  }
}

void apply_brightness(uint8_t percent)
{
  const uint8_t target = pixelart::effective_brightness(settings::brightness(), percent);
  if (matrix.getBrightness() != target)
    matrix.setBrightness(target);
}

bool restart_pending()
{
#ifdef PIXELART_SIM
  return firmware::sim_restart_requested(); // the simulated board does not restart by itself
#else
  return false;
#endif
}

// The update icon is shown again this often, so the network task, which writes the firmware to flash only
// after a frame, never waits long. The picture is drawn only when it changes.
constexpr uint64_t ICON_FRAME_US = 25000;

// Shows the update icon, at the brightness of the board's setting, for as long as a firmware installs.
// The animation stops. It resumes with a new schedule when the installation fails; when it succeeds the
// board restarts and this does not return.
void show_update_icon()
{
  int drawn_progress = -1;
  int drawn_brightness = -1;
  while (updates::firmware_installing() && !restart_pending())
  {
    apply_brightness(100);
    const uint8_t progress = updates::firmware_progress();
    if (progress != drawn_progress || matrix.getBrightness() != drawn_brightness)
    {
      for (int y = 0; y < update_icon::SIZE; y++)
        for (int x = 0; x < update_icon::SIZE; x++)
        {
          const uint32_t c = update_icon::pixel(x, y, progress);
          matrix.drawPixel(x, y, Adafruit_NeoMatrix::Color(c >> 16, c >> 8, c));
        }
      matrix.show();
      drawn_progress = progress;
      drawn_brightness = matrix.getBrightness();
    }
    task_sync::frame_shown();
    // platform::wait_us returns after about a millisecond on the board, so wait out the whole period.
    const uint64_t period_end = platform::now_us() + ICON_FRAME_US;
    for (;;)
    {
      protocol::poll();
      updates::poll();
      const uint64_t now = platform::now_us();
      if (now >= period_end || !updates::firmware_installing() || restart_pending())
        break;
      platform::wait_us(period_end - now);
    }
  }
  restart_schedule();
}

// Reports each problem once per boot, so a broken file does not flood the
// serial port on every pass of the playlist.
void report_once(const std::string &file, const std::vector<pixelart::Diagnostic> &diagnostics)
{
  static std::set<std::string> reported;
  for (const pixelart::Diagnostic &d : diagnostics)
  {
    if (d.severity != pixelart::Severity::Error || reported.size() >= MAX_REPORTED)
      continue;
    std::string line = file + ": " + d.code + (d.where.empty() ? "" : " at " + d.where) + ": " + d.message;
    if (reported.insert(line).second)
      Serial.printf("pixelart: %s\n", line.c_str());
  }
}

// Whether a load failed only because an update connection holds the memory: nothing is wrong with the file.
bool is_busy(const std::vector<pixelart::Diagnostic> &diagnostics)
{
  return !diagnostics.empty() && diagnostics.front().code == BUSY_CODE;
}

// Reads a file for the engine, turning read failures into diagnostics.
bool read_for_engine(const std::string &file, size_t max_size, storage::Buffer &buffer,
                     std::vector<pixelart::Diagnostic> &diagnostics)
{
  switch (storage::read(file, buffer, max_size))
  {
  case storage::ReadResult::Ok:
    return true;
  case storage::ReadResult::Missing:
    diagnostics.push_back({pixelart::Severity::Error, "missing_file", "", "the file does not exist"});
    return false;
  case storage::ReadResult::TooLarge:
    diagnostics.push_back({pixelart::Severity::Error, "limit_exceeded", "",
                           "file larger than " + std::to_string(max_size / 1024) + " KiB"});
    return false;
  case storage::ReadResult::OutOfMemory:
    diagnostics.push_back({pixelart::Severity::Error, "out_of_memory", "", "not enough free memory to read the file"});
    return false;
  case storage::ReadResult::Unreadable:
    diagnostics.push_back({pixelart::Severity::Error, "unreadable", "", "the file exists but could not be read"});
    return false;
  }
  return false;
}

std::vector<std::string> json_names(const char *folder)
{
  std::vector<std::string> names;
  const size_t suffix = strlen(JSON_SUFFIX);
  for (const std::string &name : storage::list(folder))
    if (name.size() > suffix && name.compare(name.size() - suffix, suffix, JSON_SUFFIX) == 0)
    {
      std::string id = name.substr(0, name.size() - suffix);
      if (pixelart::is_valid_id(id.c_str()))
        names.push_back(id);
    }
  return names;
}

void draw(const pixelart::Frame &frame, uint8_t percent)
{
  apply_brightness(percent);
  matrix.fillScreen(0);
  for (int y = 0; y < pixelart::CANVAS_HEIGHT; y++)
    for (int x = 0; x < pixelart::CANVAS_WIDTH; x++)
    {
      pixelart::Rgb c = frame.pixels[y][x];
      if (c)
        matrix.drawPixel(x, y, Adafruit_NeoMatrix::Color(c >> 16, c >> 8, c));
    }
  matrix.show();
  task_sync::frame_shown();
  firmware::first_frame_shown();
  wait(frame.ms);
}

// A dim question mark, shown when the board has nothing to play.
void show_no_animations()
{
  static const uint8_t QUESTION_MARK[][2] = {{6, 4}, {7, 3}, {8, 3}, {9, 4}, {9, 5}, {8, 6}, {7, 7}, {7, 8}, {7, 11}};
  apply_brightness(pixelart::DEFAULT_BRIGHTNESS_PERCENT);
  restart_schedule();
  matrix.fillScreen(0);
  for (const auto &p : QUESTION_MARK)
    matrix.drawPixel(p[0], p[1], Adafruit_NeoMatrix::Color(96, 96, 96));
  matrix.show();
  task_sync::frame_shown();
  firmware::first_frame_shown();
  wait(NO_ANIMATIONS_MS);
}

} // namespace

std::string animation_file(const std::string &id) { return std::string(ANIMATIONS_FOLDER) + "/" + id + JSON_SUFFIX; }

std::string playlist_file(const std::string &name) { return std::string(PLAYLISTS_FOLDER) + "/" + name + JSON_SUFFIX; }

std::string schedule_file(const std::string &id) { return std::string(SCHEDULES_FOLDER) + "/" + id + JSON_SUFFIX; }

std::vector<std::string> stored_animations() { return json_names(ANIMATIONS_FOLDER); }

std::vector<std::string> stored_playlists() { return json_names(PLAYLISTS_FOLDER); }

std::vector<std::string> stored_schedules() { return json_names(SCHEDULES_FOLDER); }

bool load_stored_animation(const std::string &id, pixelart::Animation &animation,
                           std::vector<pixelart::Diagnostic> &diagnostics)
{
  task_sync::HeapLock lock(task_sync::Owner::Loop);
  if (!lock.held())
  {
    diagnostics.push_back({pixelart::Severity::Error, BUSY_CODE, "", "an update holds the memory"});
    return false;
  }
  storage::Buffer buffer;
  if (!read_for_engine(animation_file(id), pixelart::MAX_FILE_SIZE, buffer, diagnostics))
    return false;
  return animation.load(buffer.data.get(), buffer.size, diagnostics);
}

bool load_stored_playlist(const std::string &name, pixelart::Playlist &playlist,
                          std::vector<pixelart::Diagnostic> &diagnostics, task_sync::Wait wait)
{
  task_sync::HeapLock lock(task_sync::Owner::Loop, wait);
  if (!lock.held())
  {
    diagnostics.push_back({pixelart::Severity::Error, BUSY_CODE, "", "an update holds the memory"});
    return false;
  }
  storage::Buffer buffer;
  if (!read_for_engine(playlist_file(name), pixelart::MAX_PLAYLIST_FILE_SIZE, buffer, diagnostics))
    return false;
  return playlist.load(buffer.data.get(), buffer.size, diagnostics);
}

namespace
{

bool same_list(const Choice &a, const Choice &b)
{
  return a.play.playlists == b.play.playlists && (a.play.playing < 0) == (b.play.playing < 0);
}

// Whether the local date is not the one `choice` was made for: local midnight, or the time became known or
// was forgotten. A comparison, cheap enough for the end of every animation.
bool date_moved(const Choice &choice)
{
  pixelart::LocalDate today;
  const bool known = updates::local_date(today);
  return known != choice.date_known || (known && today != choice.date);
}

// After `file` failed to load: true when an update holds the memory. Otherwise reports the problem once,
// unless the file is missing, which is normal for a playlist or the schedule.
bool load_failed_busy(const std::string &file, const std::vector<pixelart::Diagnostic> &diagnostics)
{
  if (is_busy(diagnostics))
    return true;
  if (diagnostics.empty() || diagnostics.front().code != "missing_file")
    report_once(file, diagnostics);
  return false;
}

// Loads /schedules/default.json. False when there is no valid one, and `busy` when an update holds the memory.
bool load_played_schedule(pixelart::Schedule &schedule, bool &busy, task_sync::Wait wait)
{
  std::vector<pixelart::Diagnostic> diagnostics;
  if (load_stored_schedule(PLAYED_SCHEDULE, schedule, diagnostics, wait))
    return true;
  if (load_failed_busy(schedule_file(PLAYED_SCHEDULE), diagnostics))
    busy = true;
  return false;
}

// Whether a playlist is valid and has an item whose animation is stored. `busy` when an update holds the memory.
bool playlist_playable(const std::string &id, bool &busy, task_sync::Wait wait)
{
  pixelart::Playlist playlist;
  std::vector<pixelart::Diagnostic> diagnostics;
  if (!load_stored_playlist(id, playlist, diagnostics, wait))
  {
    if (load_failed_busy(playlist_file(id), diagnostics))
      busy = true;
    return false;
  }
  for (const pixelart::PlaylistItem &item : playlist.items())
    if (storage::exists(animation_file(item.animation)))
      return true;
  return false;
}

// Chooses what to play into `newest`. False, with `newest` unchanged, when an update holds the memory: the
// files are read again at the next try. `wait` says how long each file read waits for that memory. See
// choose_without_waiting() for the choices that must not wait.
bool make_choice(task_sync::Wait wait = task_sync::Wait::Limited)
{
  const settings::Values &values = settings::current();
  Choice choice;
  choice.made = true;
  choice.automatic = values.play == settings::PLAY_AUTO;
  bool busy = false;
  pixelart::Schedule schedule;
  const bool scheduled = choice.automatic && load_played_schedule(schedule, busy, wait);
  if (busy)
    return false;
  if (scheduled)
  {
    choice.dated = true;
    choice.date_known = updates::local_date(choice.date);
  }
  // A playlist can come up more than once (in an entry, the fallback and `default`): each is read once.
  std::vector<std::pair<std::string, bool>> seen;
  auto playable = [&](const std::string &id)
  {
    for (const auto &known : seen)
      if (known.first == id)
        return known.second;
    const bool ok =
        !busy && std::find(skipped.begin(), skipped.end(), id) == skipped.end() && playlist_playable(id, busy, wait);
    seen.emplace_back(id, ok);
    return ok;
  };
  choice.play = pixelart::choose_playlists(choice.automatic ? pixelart::PlayMode::Auto : pixelart::PlayMode::Playlists,
                                           values.playlists, scheduled ? &schedule : nullptr,
                                           choice.date_known ? &choice.date : nullptr, playable);
  if (busy)
    return false;
  newest = std::move(choice);
  choose_again = false;
  updates::set_schedule_needs_time(newest.dated);
  return true;
}

// make_choice() for `status` and between two animations of a list, which never wait for the memory an update
// holds: the choice is made again later. The check skips the reads at once; the zero wait covers an update
// that takes the memory right after it.
bool choose_without_waiting() { return !task_sync::network_holds_lock() && make_choice(task_sync::Wait::None); }

// Called when an animation ends while the player plays its list: notices local midnight, chooses again when
// something changed, and says whether the player must leave its place for a new list.
bool list_changed()
{
  if (!in_pass)
    return false;
  if (newest.dated && date_moved(newest))
    choose_again = true;
  // When an update holds the memory, the choice is tried again when the next animation ends.
  if (choose_again && !choose_without_waiting())
    return false;
  return place.restart_list || !same_list(newest, applied);
}

// Plays every valid animation in alphabetical order of ID, or shows the "no animations" image.
void play_every_animation()
{
  bool played = false;
  for (const std::string &id : stored_animations())
  {
    played = play_stored_animation(id) || played;
    if (leave_list)
      return;
  }
  if (!played)
    show_no_animations();
}

} // namespace

bool load_stored_schedule(const std::string &id, pixelart::Schedule &schedule,
                          std::vector<pixelart::Diagnostic> &diagnostics, task_sync::Wait wait)
{
  task_sync::HeapLock lock(task_sync::Owner::Loop, wait);
  if (!lock.held())
  {
    diagnostics.push_back({pixelart::Severity::Error, BUSY_CODE, "", "an update holds the memory"});
    return false;
  }
  storage::Buffer buffer;
  if (!read_for_engine(schedule_file(id), pixelart::MAX_SCHEDULE_FILE_SIZE, buffer, diagnostics))
    return false;
  return schedule.load(buffer.data.get(), buffer.size, diagnostics);
}

bool play_stored_animation(const std::string &id, uint16_t times)
{
  pixelart::Animation animation;
  std::vector<pixelart::Diagnostic> diagnostics;
  if (!load_stored_animation(id, animation, diagnostics))
  {
    if (is_busy(diagnostics))
    {
      // The last frame stays on the matrix. Counted as played, so the playlist is not given up.
      restart_schedule();
      wait(BUSY_RETRY_MS);
      return true;
    }
    report_once(animation_file(id), diagnostics);
    return false;
  }

  static pixelart::Frame frame; // 1 KiB: kept off the loop task's small stack
  pixelart::Player player(animation);
  restart_schedule();
  for (uint16_t i = 0; i < times; i++)
  {
    player.restart();
    while (player.next(frame))
      draw(frame, animation.brightness());
    if (list_changed())
    {
      leave_list = true;
      break; // the list changed: leave the repeats
    }
  }
  return true;
}

void request_choice_and_restart()
{
  choose_again = true;
  place.restart_list = true;
  skipped.clear();
}

void request_choice()
{
  choose_again = true;
  skipped.clear();
}

bool choice_pending() { return choose_again || place.restart_list || (applied.made && !same_list(newest, applied)); }

size_t skipped_playlist_count() { return skipped.size(); }

void refresh_choice()
{
  // The time became known or local midnight passed: `status` reports the newest list at once.
  if (newest.made && newest.dated && date_moved(newest))
    choose_again = true;
  if (!newest.made || choose_again)
    choose_without_waiting();
}

PlayStatus play_status()
{
  PlayStatus status;
  if (!newest.made)
  {
    // The first choice could not be made at boot: what the setting asks for, as without a schedule, and nothing
    // playing yet.
    const settings::Values &values = settings::current();
    status.automatic = values.play == settings::PLAY_AUTO;
    status.reason = status.automatic ? pixelart::PlayReason::NoSchedule : pixelart::PlayReason::User;
    status.playlists = status.automatic ? std::vector<std::string>{settings::DEFAULT_PLAYLIST} : values.playlists;
    return status;
  }
  status.automatic = newest.automatic;
  status.reason = newest.play.reason;
  status.entry = newest.play.entry;
  status.playlists = newest.play.playlists;
  // The playlist that plays, or the one that starts when the current animation ends.
  int playing = newest.play.playing;
  if (applied.made && !place.restart_list && same_list(newest, applied) && applied.play.playing >= 0 &&
      place.current >= 0)
    playing = place.current;
  if (playing >= 0)
    status.playing = newest.play.playlists[playing];
  return status;
}

void begin_player()
{
  newest = Choice();
  applied = Choice();
  choose_again = true;
  in_pass = false;
  leave_list = false;
  place.reset();
  skipped.clear();
  make_choice();
}

namespace
{

enum class PlaylistOutcome
{
  Played,  // an animation of it played
  Skipped, // it is missing, invalid, or nothing of it plays now
  Busy,    // an update holds the memory: it is read again at the next pass
  Left,    // the list changed while it played
};

// Plays the playlist `id`, at `place.index` of `applied`, in full.
PlaylistOutcome play_playlist(const std::string &id)
{
  pixelart::Playlist playlist;
  std::vector<pixelart::Diagnostic> diagnostics;
  if (!load_stored_playlist(id, playlist, diagnostics))
    return load_failed_busy(playlist_file(id), diagnostics) ? PlaylistOutcome::Busy : PlaylistOutcome::Skipped;
  place.current = (int)place.index;
  bool played = false;
  for (const pixelart::PlaylistItem &item : playlist.items())
  {
    played = play_stored_animation(item.animation, item.repeat) || played;
    if (leave_list)
      return PlaylistOutcome::Left;
  }
  return played ? PlaylistOutcome::Played : PlaylistOutcome::Skipped;
}

} // namespace

void play_from_storage()
{
  struct Pass
  {
    Pass() { in_pass = true; }
    ~Pass() { in_pass = false; }
  } pass;
  leave_list = false;
  for (;;)
  {
    // While every animation plays, the board looks at its list again at each pass.
    const bool every_animation = applied.made && applied.play.playing < 0;
    if (every_animation)
      skipped.clear();
    if ((!newest.made || choose_again || every_animation) && !make_choice())
    {
      restart_schedule();
      wait(BUSY_RETRY_MS); // the next pass reads the files again
      return;
    }
    if (!applied.made || place.restart_list || !same_list(newest, applied))
      place.reset();
    applied = newest; // the same list keeps its position
    if (applied.play.playing < 0)
    {
      place.current = -1;
      play_every_animation();
      return;
    }

    for (; place.index < applied.play.playlists.size(); place.index++)
    {
      const std::string id = applied.play.playlists[place.index];
      switch (play_playlist(id))
      {
      case PlaylistOutcome::Played:
        place.pass_played = true;
        break;
      case PlaylistOutcome::Skipped:
        skip(id); // skipped until the next event
        break;
      case PlaylistOutcome::Busy:
        restart_schedule();
        wait(BUSY_RETRY_MS); // the next pass reads the playlist again
        return;
      case PlaylistOutcome::Left:
        return;
      }
    }
    place.index = 0;
    const bool any = place.pass_played;
    place.pass_played = false;
    if (any)
      return;
    choose_again = true; // nothing of the list played: the board falls back past it, in this pass
  }
}
