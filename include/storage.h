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

// Names of the files in a folder, sorted. Empty if the folder is missing. On the
// board the files themselves are not opened.
std::vector<std::string> list(const std::string &folder);

// Whether a regular file exists, and its size.
bool exists(const std::string &path);
bool file_size(const std::string &path, size_t &size);

// Removes a file. A file that does not exist counts as removed; a folder is
// refused.
bool remove(const std::string &path);

// Moves a file over `to`, replacing it, in one step: after a power cut `to`
// holds either the old or the new content. The file `to` must not be open.
bool rename(const std::string &from, const std::string &to);

// Capacity and use of the file system, in bytes. Space is used in blocks of
// BLOCK_SIZE.
constexpr size_t BLOCK_SIZE = 4096;
size_t total_bytes();
size_t used_bytes();

#ifdef PIXELART_SIM
// Capacity of the simulated file system, by default the size of the board's
// data partition.
constexpr size_t DEFAULT_CAPACITY = 1441792;
void set_capacity(size_t bytes);
#endif

// Writes a new file piece by piece through one open handle, so each write is
// not a reopen (on LittleFS, a reopen copies the last block and commits the
// metadata). The file is closed by close() or the destructor, and must be
// closed before it is read or renamed.
class Writer
{
public:
  Writer();
  ~Writer();
  Writer(Writer &&) noexcept;
  Writer &operator=(Writer &&) noexcept;
  Writer(const Writer &) = delete;
  Writer &operator=(const Writer &) = delete;

  // Creates an empty file, replacing any existing one, and keeps it open.
  // Parent folders are created when missing.
  bool open(const std::string &path);
  bool is_open() const { return (bool)impl_; }
  // Appends `size` bytes; false if they could not all be written.
  bool write(const void *data, size_t size);
  void close();

private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

#ifdef PIXELART_SIM
// Makes every Writer::write fail, to test the error paths.
void set_fail_writes(bool fail);
// How many Writers hold a file open. The simulator also refuses to read or
// rename a file a Writer holds open, as the board's file system requires.
size_t open_writers();
// Makes Reader::read_all fail with `result` (OutOfMemory before it allocates,
// Unreadable after it has filled the buffer), to test the callers' fallbacks.
// ReadResult::Ok turns the failure off.
void set_read_all_failure(ReadResult result);
#endif

// Reads a file piece by piece, without holding it in memory.
class Reader
{
public:
  Reader();
  ~Reader();
  Reader(const Reader &) = delete;
  Reader &operator=(const Reader &) = delete;

  // Missing if there is no regular file at `path` (a folder counts as missing),
  // Unreadable if it exists but cannot be opened. The simulator also reports
  // Unreadable for a file a Writer holds open, as the board's file system would.
  ReadResult open(const std::string &path);
  size_t size() const { return size_; }
  // Reads the whole file into memory with the failure reports of storage::read,
  // so a caller that already holds the file open does not open it again.
  ReadResult read_all(Buffer &out, size_t max_size);
  // Reads up to `length` bytes from `offset`. Returns the number read, which is
  // less than `length` only at the end of the file or on a read error.
  size_t read_at(size_t offset, void *out, size_t length);

private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
  size_t size_ = 0;
};

} // namespace storage
