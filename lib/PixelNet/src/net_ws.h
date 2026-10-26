// SPDX-License-Identifier: GPL-3.0-or-later

// The rules for the messages of the board's WebSocket, the same as the simulator's
// (docs/protocol/protocol-v1.md#websocket-simulator): one protocol line per text message,
// reassembled from fragments, at most MAX_LINE bytes. Plain C++ so the rules have native tests.

#pragma once

#include <cstddef>
#include <cstdint>

namespace pixelart_net
{

constexpr size_t MAX_MESSAGE = 1024;

// WebSocket close status codes (RFC 6455) the board uses.
constexpr uint16_t CLOSE_NORMAL = 1000;
constexpr uint16_t CLOSE_PROTOCOL_ERROR = 1002;
constexpr uint16_t CLOSE_UNSUPPORTED = 1003;
constexpr uint16_t CLOSE_INVALID_PAYLOAD = 1007;
constexpr uint16_t CLOSE_POLICY = 1008;
constexpr uint16_t CLOSE_TOO_BIG = 1009;
constexpr uint16_t CLOSE_INTERNAL_ERROR = 1011;
constexpr uint16_t CLOSE_TRY_LATER = 1013;

// A server ping frame (RFC 6455): FIN plus opcode 9, unmasked, empty payload.
constexpr uint8_t PING_FRAME[2] = {0x89, 0x00};

enum class FrameKind : uint8_t
{
  Continuation = 0,
  Text = 1,
  Binary = 2
};

// Collects the data frames of one message at a time. Control frames (ping, pong, close) are not
// its business.
class MessageAssembler
{
public:
  enum class Result : uint8_t
  {
    More, // the message goes on
    Line, // line() holds a complete text message
    Close // close the connection with code()
  };

  // Call when a frame header has been read and before its payload is read: refuses a frame that
  // breaks the sequence of a message (1002) or takes the message over the limit (1009), so a
  // payload that is too long is never read.
  Result begin_frame(FrameKind kind, size_t payload_size);

  // Adds the payload of the frame `begin_frame` accepted. `final` is the FIN bit. A complete text
  // message must be valid UTF-8 (1007) and hold no newline (1008); a complete binary message is
  // refused (1003).
  Result end_frame(bool final, const uint8_t *payload, size_t payload_size);

  const char *line() const { return reinterpret_cast<const char *>(buffer_); }
  size_t line_size() const { return size_; }
  uint16_t code() const { return code_; }

  // Forgets any message in progress.
  void reset();

private:
  Result close(uint16_t code);

  uint8_t buffer_[MAX_MESSAGE + 1] = {}; // the extra byte keeps line() a C string
  size_t size_ = 0;
  bool in_message_ = false;
  bool binary_ = false;
  FrameKind current_ = FrameKind::Text;
  uint16_t code_ = 0;
};

} // namespace pixelart_net
