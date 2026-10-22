// SPDX-License-Identifier: GPL-3.0-or-later

// The command protocol of docs/protocol/protocol-v1.md: framing, commands and
// uploads. The core takes one line and returns one reply line, so any
// transport can drive it. The serial transport reads the board's USB serial
// port from poll().

#pragma once

#include <cstddef>
#include <cstdint>
#include <string>

namespace protocol
{

// Limits of the protocol, reported by `info`.
constexpr size_t MAX_LINE = 1024;
constexpr size_t MAX_CHUNK = 512;
constexpr size_t PAGE_SIZE = 8;
constexpr uint32_t UPLOAD_IDLE_MS = 10000;

// Free and largest-block memory in bytes. Both 0 means the platform does not
// measure memory (the simulator), and nothing is refused for lack of it.
struct Memory
{
  size_t free;
  size_t largest;
};
using MemoryProbe = Memory (*)();
#ifdef PIXELART_SIM
// Replaces the platform's memory measure; nullptr restores it. For tests.
void set_memory_probe(MemoryProbe probe);
#endif

// Collects bytes into lines. A line is at most MAX_LINE bytes, not counting
// the newline and a `\r` before it.
class LineReader
{
public:
  enum class Event
  {
    None,
    Line,    // line() holds a complete line
    Overflow // a line that starts with the protocol marker was too long and has been dropped
  };

  Event feed(uint8_t byte);
  // The line of the last Event::Line, valid until the next feed().
  const std::string &line() const { return line_; }
  void clear();

private:
  std::string line_;
  bool overflowed_ = false;
  bool complete_ = false; // the last feed() ended a line: the next one starts a new line
};

// Starts the protocol after a boot: forgets any upload and reply, removes a
// temporary file left by an interrupted upload, picks a new boot_id.
void begin();

// Handles one line (no newline). Returns the reply line without its newline,
// or an empty string when the line is not a protocol line.
std::string handle_line(const std::string &line);

// The reply to a protocol line that was too long.
std::string line_too_long();

// Serial transport: reads at most a bounded number of bytes from Serial,
// handles one complete line and writes its reply. Also ends an upload that
// has been idle for too long. Call it often.
void poll();

// True while an upload is open; the live mirror is paused meanwhile.
bool upload_active();

} // namespace protocol
