// SPDX-License-Identifier: GPL-3.0-or-later

#include "server_choice.h"

#include <algorithm>

namespace pixelart
{

namespace
{

bool read_id(JsonVariantConst value, std::string &id)
{
  if (!value.is<const char *>())
    return false;
  id = value.as<const char *>();
  return is_valid_id(id.c_str());
}

bool read_choice(JsonVariantConst value, ServerChoice &out)
{
  if (!value.is<JsonObjectConst>())
    return false;
  const JsonObjectConst object = value.as<JsonObjectConst>();
  if (object.size() != 1)
    return false;
  if (!object["schedule"].isNull())
    return read_id(object["schedule"], out.schedule);
  if (!object["playlists"].is<JsonArrayConst>())
    return false;
  const JsonArrayConst list = object["playlists"].as<JsonArrayConst>();
  if (list.size() == 0 || list.size() > MAX_SCHEDULE_PLAYLISTS)
    return false;
  for (JsonVariantConst item : list)
  {
    std::string id;
    if (!read_id(item, id) || std::find(out.playlists.begin(), out.playlists.end(), id) != out.playlists.end())
      return false;
    out.playlists.push_back(std::move(id));
  }
  return true;
}

} // namespace

bool read_server_choice(JsonVariantConst value, ServerChoice &out)
{
  out = ServerChoice();
  if (read_choice(value, out))
    return true;
  out = ServerChoice();
  return false;
}

} // namespace pixelart
