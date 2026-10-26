// SPDX-License-Identifier: GPL-3.0-or-later

// The command protocol of docs/protocol/protocol-v1.md: framing, commands and
// uploads. The core takes one line and returns one reply line, so any
// transport can drive it. The serial transport reads the board's USB serial
// port from poll().

#pragma once

#include <cstddef>
#include <cstdint>
#include <string>

#include "improv.h"
#include "install.h"

namespace protocol
{

// Where a request came from. Some commands, and the token, are for USB only.
enum class Transport
{
  Usb, // the serial port, and the simulator's WebSocket
  Wifi
};

// Limits of the protocol, reported by `info`.
constexpr size_t MAX_LINE = 1024;
constexpr size_t MAX_CHUNK = 512;
constexpr size_t PAGE_SIZE = 8;
constexpr uint32_t UPLOAD_IDLE_MS = 10000;

// Collects bytes into lines. A line is at most MAX_LINE bytes, not counting
// the newline and a `\r` before it. It also finds Improv Wi-Fi frames
// (docs/board/wifi-and-updates-v1.md#setup-with-improv) between the lines: the
// header `IMPROV` and the version byte, anywhere outside a protocol line, and
// then the whole frame by its length, so a newline inside it ends nothing.
class LineReader
{
public:
  enum class Event
  {
    None,
    Line,         // line() holds a complete line
    Overflow,     // a line that starts with the protocol marker was too long and has been dropped
    Improv,       // improv_frame() holds a complete Improv frame
    ImprovInvalid // an Improv frame whose checksum is wrong
  };

  Event feed(uint8_t byte);
  // The line of the last Event::Line, valid until the next feed().
  const std::string &line() const { return line_; }
  // The frame of the last Event::Improv, valid until the next feed().
  const improv::FrameParser &improv_frame() const { return frame_; }
  // Whether an Improv frame is partly read.
  bool in_frame() const { return frame_.active(); }
  // Drops the Improv frame in progress, for a frame that stopped.
  void abort_frame();
  void clear();

private:
  // Forgets what the scan knows of the line in progress, but not the line itself.
  void reset_scan();

  std::string line_;
  improv::FrameParser frame_;
  // The last bytes outside a protocol line, to find the Improv header. A
  // protocol line never feeds it: a raw 0x01 is not valid JSON.
  uint8_t recent_[improv::HEADER_SIZE] = {};
  size_t recent_size_ = 0;     // bytes of recent_ in use, up to HEADER_SIZE
  bool protocol_line_ = false; // the line in progress starts with the marker
  bool overflowed_ = false;
  bool complete_ = false; // the last feed() ended a line or a frame: the next one starts afresh
};

// Starts the protocol after a boot: forgets any upload and reply, removes a
// temporary file left by an interrupted upload, picks a new boot_id.
void begin();

// Handles one line (no newline). Returns the reply line without its newline,
// or an empty string when the line is not a protocol line.
std::string handle_line(const std::string &line, Transport transport = Transport::Usb);

// A WiFi client connected, or its connection closed: its login and the reply remembered for it are
// forgotten. A request that arrives over WiFi belongs to the connection opened last.
void wifi_opened();
void wifi_closed();

// Whether the network login is on and the WiFi client has not logged in. The loop task only.
bool wifi_login_pending();

// The reply to a protocol line that was too long.
std::string line_too_long();

// Serial transport: reads at most a bounded number of bytes from Serial,
// handles one complete line and writes its reply. Also ends an upload that
// has been idle for too long. Call it often.
void poll();

// True while an upload is open; the live mirror is paused meanwhile.
bool upload_active();

} // namespace protocol
