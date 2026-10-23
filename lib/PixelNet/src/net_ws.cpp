// SPDX-License-Identifier: GPL-3.0-or-later

#include "net_ws.h"

#include <pixel_codec.h>

#include <cstring>

namespace pixelart_net
{

MessageAssembler::Result MessageAssembler::close(uint16_t code)
{
  code_ = code;
  return Result::Close;
}

void MessageAssembler::reset()
{
  size_ = 0;
  in_message_ = false;
  binary_ = false;
  code_ = 0;
}

MessageAssembler::Result MessageAssembler::begin_frame(FrameKind kind, size_t payload_size)
{
  // A new message cannot start inside another, and a continuation needs a message to continue.
  if (kind == FrameKind::Continuation ? !in_message_ : in_message_)
    return close(CLOSE_PROTOCOL_ERROR);
  const size_t so_far = in_message_ ? size_ : 0;
  if (payload_size > MAX_MESSAGE || so_far + payload_size > MAX_MESSAGE)
    return close(CLOSE_TOO_BIG);
  current_ = kind;
  return Result::More;
}

MessageAssembler::Result MessageAssembler::end_frame(bool final, const uint8_t *payload, size_t payload_size)
{
  if (!in_message_)
  {
    binary_ = current_ == FrameKind::Binary;
    in_message_ = true;
    size_ = 0;
  }
  if (size_ + payload_size > MAX_MESSAGE)
    return close(CLOSE_TOO_BIG);
  if (!binary_ && payload_size > 0)
    memcpy(buffer_ + size_, payload, payload_size);
  size_ += payload_size; // a binary message is only counted: it is refused when complete
  if (!final)
    return Result::More;

  in_message_ = false;
  if (binary_)
    return close(CLOSE_UNSUPPORTED);
  buffer_[size_] = 0;
  for (size_t i = 0, length; i < size_; i += length)
  {
    length = pixelart::utf8_sequence_length(reinterpret_cast<const char *>(buffer_), size_, i);
    if (length == 0)
      return close(CLOSE_INVALID_PAYLOAD);
  }
  if (memchr(buffer_, '\n', size_))
    return close(CLOSE_POLICY);
  return Result::Line;
}

} // namespace pixelart_net
