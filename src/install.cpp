// SPDX-License-Identifier: GPL-3.0-or-later

#include "install.h"

#include <server_choice.h>

#include "app.h"
#include "platform.h"
#include "storage.h"
#include "task_sync.h"

namespace install
{

namespace
{

// Memory a file needs for validation: one block for the file, and the parsed
// document, which is a small multiple of the file. Rough values to tune with
// the memory measured on the board.
constexpr size_t BLOCK_MARGIN = 1024;
constexpr size_t PARSE_FACTOR = 4;
constexpr size_t PARSE_MARGIN = 8192;

Memory platform_memory() { return {platform::free_heap(), platform::max_alloc()}; }
MemoryProbe memory_probe = platform_memory;

} // namespace

Memory memory() { return memory_probe(); }

size_t size_limit(Kind kind)
{
  switch (kind)
  {
  case Kind::Animation:
    return pixelart::MAX_FILE_SIZE;
  case Kind::Playlist:
    return pixelart::MAX_PLAYLIST_FILE_SIZE;
  case Kind::Schedule:
    return pixelart::MAX_SCHEDULE_FILE_SIZE;
  case Kind::Play:
    break;
  }
  return pixelart::MAX_PLAY_FILE_SIZE;
}

std::string file_path(Kind kind, const std::string &id)
{
  switch (kind)
  {
  case Kind::Animation:
    return animation_file(id);
  case Kind::Playlist:
    return playlist_file(id);
  case Kind::Schedule:
    return schedule_file(id);
  case Kind::Play:
    break;
  }
  return play_file(id);
}

std::vector<std::string> stored_ids(Kind kind)
{
  switch (kind)
  {
  case Kind::Animation:
    return stored_animations();
  case Kind::Playlist:
    return stored_playlists();
  case Kind::Schedule:
    return stored_schedules();
  case Kind::Play:
    break;
  }
  return stored_play_files();
}

bool memory_fits(size_t size)
{
  const Memory now = memory_probe();
  if (now.free == 0 && now.largest == 0)
    return true;
  return now.largest >= size + BLOCK_MARGIN && now.free >= size * PARSE_FACTOR + PARSE_MARGIN;
}

#ifdef PIXELART_SIM
void set_memory_probe(MemoryProbe probe) { memory_probe = probe ? probe : platform_memory; }
#endif

Result validate(Kind kind, const std::string &path, std::vector<pixelart::Diagnostic> &diagnostics, Parsed *parsed)
{
  const size_t limit = size_limit(kind);
  task_sync::HeapLock lock(task_sync::Owner::Loop);
  if (!lock.held())
    return Result::OutOfMemory; // an update connection holds the memory
  storage::Buffer buffer;
  switch (storage::read(path, buffer, limit))
  {
  case storage::ReadResult::Ok:
    break;
  case storage::ReadResult::OutOfMemory:
    return Result::OutOfMemory;
  default:
    return Result::StorageError;
  }

  bool valid;
  if (kind == Kind::Animation)
  {
    pixelart::Animation animation;
    valid = animation.load(buffer.data.get(), buffer.size, diagnostics);
  }
  else if (kind == Kind::Playlist)
  {
    pixelart::Playlist local;
    pixelart::Playlist &target = parsed ? parsed->playlist : local;
    valid = target.load(buffer.data.get(), buffer.size, diagnostics);
  }
  else if (kind == Kind::Schedule)
  {
    pixelart::Schedule local;
    pixelart::Schedule &target = parsed ? parsed->schedule : local;
    valid = target.load(buffer.data.get(), buffer.size, diagnostics);
  }
  else
  {
    pixelart::ServerChoice local;
    pixelart::ServerChoice &target = parsed ? parsed->play : local;
    valid = pixelart::load_play_file(buffer.data.get(), buffer.size, target, diagnostics);
  }
  return valid ? Result::Ok : Result::Invalid;
}

Result check(Kind kind, const std::string &path, size_t expected_size, std::vector<pixelart::Diagnostic> &diagnostics,
             Parsed *parsed)
{
  size_t stored = 0;
  if (!storage::file_size(path, stored) || (expected_size != SIZE_ANY && stored != expected_size))
    return Result::StorageError;
  if (!memory_fits(stored))
    return Result::OutOfMemory;
  return validate(kind, path, diagnostics, parsed);
}

bool commit(Kind kind, const std::string &path, const std::string &target)
{
  if (!storage::rename(path, target))
    return false;
  file_changed(kind);
  return true;
}

void file_changed(Kind kind)
{
  if (kind == Kind::Playlist)
    request_choice_and_restart();
  else if (kind == Kind::Schedule || kind == Kind::Play)
    request_choice();
}

} // namespace install
