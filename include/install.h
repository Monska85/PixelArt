// SPDX-License-Identifier: GPL-3.0-or-later

// Checks a received animation, playlist, schedule or play file with the engine, for everything that stores a file
// from outside: an upload (`put_end`) and a download of the update task. Runs on the loop task.

#pragma once

#include <pixelart_engine.h>

#include <cstddef>
#include <string>
#include <vector>

namespace install
{

enum class Kind
{
  Animation,
  Playlist,
  Schedule,
  Play
};

// The largest file of a kind.
size_t size_limit(Kind kind);

// Path of a stored file of a kind on the board, from its ID.
std::string file_path(Kind kind, const std::string &id);

// IDs of the stored files of a kind, sorted.
std::vector<std::string> stored_ids(Kind kind);

enum class Result
{
  Ok,
  OutOfMemory,  // the file or its parse does not fit in memory
  StorageError, // the file cannot be read
  Invalid       // the engine rejects it: `diagnostics` says why
};

// Free and largest-block memory in bytes. Both 0 means the platform does not measure memory (the
// simulator), and nothing is refused for lack of it.
struct Memory
{
  size_t free;
  size_t largest;
};
using MemoryProbe = Memory (*)();

// The memory now, from the probe.
Memory memory();

// Whether a file of `size` bytes fits in memory for its validation: one block for the file and
// room for the parsed document. Always true when memory is not measured.
bool memory_fits(size_t size);

#ifdef PIXELART_SIM
// Replaces the platform's memory measure; nullptr restores it. For tests.
void set_memory_probe(MemoryProbe probe);
#endif

// A valid file a caller keeps after its validation, in the member of its kind.
struct Parsed
{
  pixelart::Playlist playlist;
  pixelart::Schedule schedule;
  pixelart::ServerChoice play; // the `default` of a play file
};

// Reads `path` (at most the limit of `kind`) and loads it with the engine, which also fills
// `diagnostics` with warnings. A valid playlist, schedule or play file is left in `parsed` when it is given. Takes
// the lock for large allocations while the file is in memory.
Result validate(Kind kind, const std::string &path, std::vector<pixelart::Diagnostic> &diagnostics,
                Parsed *parsed = nullptr);

// Checks a received file in `path` before it is stored: its size (`expected_size`, unless that is
// SIZE_ANY), the memory it needs, and then validate(). StorageError also covers a size that differs.
constexpr size_t SIZE_ANY = (size_t)-1;
Result check(Kind kind, const std::string &path, size_t expected_size, std::vector<pixelart::Diagnostic> &diagnostics,
             Parsed *parsed = nullptr);

// Moves the checked file `path` to `target`, then calls file_changed(). False when the file cannot be moved.
bool commit(Kind kind, const std::string &path, const std::string &target);

// A file of `kind` was stored or deleted: a playlist makes the player choose what to play again and start
// its list from the first playlist, a schedule or a play file only choose again.
void file_changed(Kind kind);

} // namespace install
