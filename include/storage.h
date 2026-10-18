// Access to the board's file system: LittleFS on the board, a folder on the
// computer in the simulator (--data). Paths start from the root, for example
// "/animations/santa.json".

#pragma once

#include <cstddef>
#include <memory>
#include <string>
#include <vector>

namespace storage
{

enum class ReadResult
{
  Ok,
  Missing,     // no such file
  TooLarge,    // larger than the size the caller accepts
  OutOfMemory, // not enough free memory to hold the file
  Unreadable,  // exists, but could not be read completely
};

// A whole file in memory.
struct Buffer
{
  std::unique_ptr<char[]> data;
  size_t size = 0;
};

// Mounts the file system. On the board, an unformatted file system is
// formatted, so a new board starts empty instead of failing.
bool begin();

// Reads a whole file. Allocation failures are reported, never fatal.
ReadResult read(const std::string &path, Buffer &out, size_t max_size);

// Names of the files in a folder, sorted. Empty if the folder is missing.
std::vector<std::string> list(const std::string &folder);

} // namespace storage
