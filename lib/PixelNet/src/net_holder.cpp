// SPDX-License-Identifier: GPL-3.0-or-later

#include "net_holder.h"

namespace pixelart_net
{

HolderCheck::Action HolderCheck::refused(uint32_t now_ms)
{
  if (!running_)
  {
    running_ = true;
    since_ = now_ms;
    return Action::Ping;
  }
  if (now_ms - since_ >= PONG_WAIT_MS)
  {
    running_ = false;
    return Action::Close;
  }
  return Action::Wait;
}

} // namespace pixelart_net
