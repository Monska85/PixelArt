// SPDX-License-Identifier: GPL-3.0-or-later

#include "net_handshake.h"

#include <cstring>

#include "net_origin.h"

namespace pixelart_net
{

namespace
{

const char ORIGIN_NAME[] = "origin:";
constexpr size_t ORIGIN_NAME_SIZE = sizeof(ORIGIN_NAME) - 1;
const char HANDSHAKE_ANSWER[] = "HTTP/1.1 101 ";

bool is_space(char c) { return c == ' ' || c == '\t'; }

char lower(char c) { return c >= 'A' && c <= 'Z' ? (char)(c - 'A' + 'a') : c; }

} // namespace

void HeadScanner::feed(const char *data, size_t size)
{
  for (size_t i = 0; i < size; i++)
  {
    const char c = data[i];
    if (complete_)
      reset(); // the next request on the same connection: its head is the one that counts
    if (c == '\r')
      continue;
    if (c == '\n')
    {
      end_line();
      continue;
    }
    if (in_value_)
    {
      if (value_size_ == 0 && is_space(c))
        continue;
      if (value_size_ < MAX_ORIGIN && c != '\0')
        value_[value_size_++] = c;
      else
        unreadable_ = true;
    }
    else if (line_ > 0 && name_matches_)
    {
      if (column_ < ORIGIN_NAME_SIZE && lower(c) == ORIGIN_NAME[column_])
      {
        if (column_ == ORIGIN_NAME_SIZE - 1 && !found_)
        {
          found_ = true;
          in_value_ = true;
        }
      }
      else
        name_matches_ = false;
    }
    column_++;
  }
}

void HeadScanner::end_line()
{
  if (column_ == 0 && line_ > 0)
  {
    complete_ = true;
    return;
  }
  if (in_value_)
  {
    while (value_size_ > 0 && is_space(value_[value_size_ - 1]))
      value_size_--;
    in_value_ = false;
  }
  line_++;
  column_ = 0;
  name_matches_ = true;
}

bool HeadScanner::origin_allowed(const char *site_origin) const
{
  if (!complete_ || unreadable_)
    return false;
  if (!found_)
    return pixelart_net::origin_allowed(nullptr, site_origin);
  char origin[MAX_ORIGIN + 1];
  memcpy(origin, value_, value_size_);
  origin[value_size_] = '\0';
  return pixelart_net::origin_allowed(origin, site_origin);
}

void HeadScanner::reset() { *this = HeadScanner(); }

bool is_handshake_answer(const char *data, size_t size)
{
  const size_t prefix = sizeof(HANDSHAKE_ANSWER) - 1;
  return data && size >= prefix && memcmp(data, HANDSHAKE_ANSWER, prefix) == 0;
}

} // namespace pixelart_net
