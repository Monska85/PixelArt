// SPDX-License-Identifier: GPL-3.0-or-later

#include "net_watch.h"

namespace pixelart_net
{

size_t ConnectionWatch::check(const int *open, size_t count, int slot, uint32_t generation, bool login_pending,
                              uint32_t now_ms, int *expired, size_t capacity)
{
  size_t found = 0;

  // Keep the sockets still open that are not the slot, in the order they were first seen.
  int kept_fd[MAX_SOCKETS];
  uint32_t kept_since[MAX_SOCKETS];
  size_t kept = 0;
  for (size_t i = 0; i < count && kept < MAX_SOCKETS; i++)
  {
    if (open[i] == slot)
      continue;
    uint32_t since = now_ms;
    for (size_t j = 0; j < used_; j++)
      if (fd_[j] == open[i])
        since = since_[j];
    if (now_ms - since >= HANDSHAKE_TIMEOUT_MS)
    {
      if (found < capacity)
        expired[found++] = open[i];
      continue; // forgotten: a socket that stays open starts a new wait
    }
    kept_fd[kept] = open[i];
    kept_since[kept] = since;
    kept++;
  }
  for (size_t i = 0; i < kept; i++)
  {
    fd_[i] = kept_fd[i];
    since_[i] = kept_since[i];
  }
  used_ = kept;

  // A slot that is not in the list any more was closed: its number may come back as another client.
  bool slot_open = false;
  for (size_t i = 0; i < count; i++)
    if (open[i] == slot)
      slot_open = true;
  if (!slot_open)
    slot = -1;

  if (slot < 0 || !login_pending)
    pending_ = false;
  else if (!pending_ || slot != pending_slot_ || generation != pending_generation_)
  {
    pending_ = true; // a new wait for a client that took the slot since
    pending_slot_ = slot;
    pending_generation_ = generation;
    pending_since_ = now_ms;
  }
  else if (now_ms - pending_since_ >= LOGIN_TIMEOUT_MS)
  {
    if (found < capacity)
      expired[found++] = slot;
    pending_ = false;
  }
  return found;
}

} // namespace pixelart_net
