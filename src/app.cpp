// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

#include "app.h"

#include <cstring>
#include <set>

#include "pixel_art.h"
#include "platform.h"
#include "protocol.h"
#include "settings.h"
#include "storage.h"

namespace
{

const char *JSON_SUFFIX = ".json";
constexpr uint32_t NO_ANIMATIONS_MS = 2000;
// Distinct problems remembered by report_once; beyond this they are not
// printed again, so the memory used stays bounded.
constexpr size_t MAX_REPORTED = 64;
// A frame this far behind its schedule starts a new schedule instead of
// catching up with a burst of frames.
constexpr uint64_t MAX_LAG_US = 1000000;

bool reload_requested = false;

// Deadline of the frame being waited for. Each frame's deadline follows the
// previous one, so a command that delays one frame does not shift the frames
// after it, and the schedule does not drift.
uint64_t deadline_us = 0;
bool has_deadline = false;

// Starts a new schedule at the next wait: the first frame of an animation.
void restart_schedule() { has_deadline = false; }

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
    now = platform::now_us();
    if (now >= deadline_us)
      return;
    platform::wait_us(deadline_us - now);
  }
}

// Applies the board setting limited by the percentage of the playing animation,
// so a change made through the protocol reaches the next frame. Only a change
// is applied, because setBrightness() rescales what the matrix holds.
void apply_brightness(uint8_t percent)
{
  const uint8_t target = pixelart::effective_brightness(settings::brightness(), percent);
  if (matrix.getBrightness() != target)
    matrix.setBrightness(target);
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
  wait(NO_ANIMATIONS_MS);
}

} // namespace

std::string animation_file(const std::string &id) { return std::string(ANIMATIONS_FOLDER) + "/" + id + JSON_SUFFIX; }

std::string playlist_file(const std::string &name) { return std::string(PLAYLISTS_FOLDER) + "/" + name + JSON_SUFFIX; }

std::vector<std::string> stored_animations() { return json_names(ANIMATIONS_FOLDER); }

std::vector<std::string> stored_playlists() { return json_names(PLAYLISTS_FOLDER); }

bool load_stored_animation(const std::string &id, pixelart::Animation &animation,
                           std::vector<pixelart::Diagnostic> &diagnostics)
{
  storage::Buffer buffer;
  if (!read_for_engine(animation_file(id), pixelart::MAX_FILE_SIZE, buffer, diagnostics))
    return false;
  return animation.load(buffer.data.get(), buffer.size, diagnostics);
}

bool load_stored_playlist(const std::string &name, pixelart::Playlist &playlist,
                          std::vector<pixelart::Diagnostic> &diagnostics)
{
  storage::Buffer buffer;
  if (!read_for_engine(playlist_file(name), pixelart::MAX_PLAYLIST_FILE_SIZE, buffer, diagnostics))
    return false;
  return playlist.load(buffer.data.get(), buffer.size, diagnostics);
}

bool play_stored_animation(const std::string &id, uint16_t times)
{
  pixelart::Animation animation;
  std::vector<pixelart::Diagnostic> diagnostics;
  if (!load_stored_animation(id, animation, diagnostics))
  {
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
    if (reload_requested)
      break; // the playlist changed: leave the repeats
  }
  return true;
}

void request_playlist_reload() { reload_requested = true; }

bool playlist_reload_pending() { return reload_requested; }

void play_from_storage()
{
  reload_requested = false;
  const std::string active = settings::playlist();
  std::vector<pixelart::PlaylistItem> items;
  pixelart::Playlist playlist;
  std::vector<pixelart::Diagnostic> diagnostics;
  if (load_stored_playlist(active, playlist, diagnostics))
    items = playlist.items();
  else if (diagnostics.empty() || diagnostics.front().code != "missing_file")
    report_once(playlist_file(active), diagnostics); // no playlist at all is normal

  bool played = false;
  for (const pixelart::PlaylistItem &item : items)
  {
    played = play_stored_animation(item.animation, item.repeat) || played;
    if (reload_requested)
      return;
  }
  if (!played)
    for (const std::string &id : stored_animations())
    {
      played = play_stored_animation(id) || played;
      if (reload_requested)
        return;
    }
  if (!played)
    show_no_animations();
}
