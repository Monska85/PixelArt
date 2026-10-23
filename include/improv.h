// SPDX-License-Identifier: GPL-3.0-or-later

// Improv Wi-Fi Serial, version 1 (https://www.improv-wifi.com/serial/): the
// binary frames that set up WiFi over the USB serial port, next to the command
// protocol. See docs/board/wifi-and-updates-v1.md#setup-with-improv.
//
// A frame is `IMPROV`, the version, a type, the length of the data, the data,
// and a checksum: the sum of every earlier byte of the frame, modulo 256.

#pragma once

#include <cstddef>
#include <cstdint>
#include <functional>
#include <string>
#include <vector>

namespace improv
{

constexpr uint8_t VERSION = 1;
constexpr size_t MAGIC_SIZE = 6;
// `IMPROV` and the version byte.
constexpr size_t HEADER_SIZE = MAGIC_SIZE + 1;
constexpr size_t MAX_DATA = 255;
// How long a connection started by "send WiFi settings" may take before the
// board answers "unable to connect".
constexpr uint32_t CONNECT_TIMEOUT_MS = 30000;
// How long a scan may take before the board answers with what it has.
constexpr uint32_t SCAN_TIMEOUT_MS = 15000;
// A frame that stops for this long is dropped, so a lost byte never swallows the protocol lines after it.
constexpr uint32_t FRAME_IDLE_MS = 1000;

extern const char MAGIC[MAGIC_SIZE]; // "IMPROV"

enum class Type : uint8_t
{
  CurrentState = 0x01,
  ErrorState = 0x02,
  RpcCommand = 0x03,
  RpcResult = 0x04
};

enum class State : uint8_t
{
  Ready = 0x02,
  Provisioning = 0x03,
  Provisioned = 0x04
};

enum class Error : uint8_t
{
  None = 0x00,
  InvalidRpc = 0x01,
  UnknownRpc = 0x02,
  UnableToConnect = 0x03
};

enum class Command : uint8_t
{
  WifiSettings = 0x01,
  CurrentState = 0x02,
  DeviceInfo = 0x03,
  ScanNetworks = 0x04
};

// Reads the bytes of one frame after its header and version byte: the type, the length, the data and the checksum.
class FrameParser
{
public:
  enum class Result
  {
    More,
    Frame,       // a complete frame with a good checksum: type() and data()
    BadChecksum, // a complete frame with a wrong checksum
  };

  void start();
  Result feed(uint8_t byte);
  bool active() const { return active_; }
  // Drops the frame in progress and wipes it.
  void reset();

  uint8_t type() const { return type_; }
  const std::string &data() const { return data_; }

private:
  bool active_ = false;
  size_t seen_ = 0; // bytes after the version
  uint8_t type_ = 0;
  uint8_t length_ = 0;
  uint8_t sum_ = 0;
  std::string data_;
};

// A whole packet for the client: header, type, length, data and checksum.
std::string packet(Type type, const std::string &data);
std::string state_packet(State state);
std::string error_packet(Error error);
// An RPC result for `command` with the given strings, each at most 255 bytes.
std::string result_packet(Command command, const std::vector<std::string> &strings);

// What the handler needs from the board. The board's own functions in the
// firmware and the simulator, replaced in tests.
using Sink = std::function<void(const std::string &packet)>;

// Where the handler writes its packets. By default the serial port.
void set_sink(Sink sink);

// Handles an RPC frame the line reader found, and the frame that failed its checksum.
void handle_frame(uint8_t type, const std::string &data);
void handle_bad_checksum();

// Moves the work that waits for the network along: a connection that was
// started, a scan. Call it often.
void poll();

// Forgets any work in progress. For a restart of the protocol and for tests.
void begin();

} // namespace improv
