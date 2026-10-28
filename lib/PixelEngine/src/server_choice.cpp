// SPDX-License-Identifier: GPL-3.0-or-later

#include "server_choice.h"

#include <algorithm>

#include "strict_json.h"

namespace pixelart
{

namespace
{

// ArduinoJson's default nesting limit, as for the other formats.
constexpr int MAX_JSON_DEPTH = 10;

enum class Fault
{
  None,
  Structure,
  Limit
};

bool read_id(JsonVariantConst value, std::string &id)
{
  if (!value.is<const char *>())
    return false;
  id = value.as<const char *>();
  return is_valid_id(id.c_str());
}

Fault read_choice(JsonVariantConst value, ServerChoice &out, std::string &message)
{
  message = "must be an object with one of schedule or playlists";
  if (!value.is<JsonObjectConst>())
    return Fault::Structure;
  const JsonObjectConst object = value.as<JsonObjectConst>();
  if (object.size() != 1)
    return Fault::Structure;
  if (!object["schedule"].isNull())
  {
    message = "schedule must be a schedule ID: lowercase letters, digits, _ and -";
    return read_id(object["schedule"], out.schedule) ? Fault::None : Fault::Structure;
  }
  if (!object["playlists"].is<JsonArrayConst>())
    return Fault::Structure;
  const JsonArrayConst list = object["playlists"].as<JsonArrayConst>();
  if (list.size() > MAX_SCHEDULE_PLAYLISTS)
  {
    message = "more than " + std::to_string(MAX_SCHEDULE_PLAYLISTS) + " playlists";
    return Fault::Limit;
  }
  message = "playlists must be 1 to " + std::to_string(MAX_SCHEDULE_PLAYLISTS) +
            " playlist IDs, none twice: lowercase letters, digits, _ and -";
  if (list.size() == 0)
    return Fault::Structure;
  for (JsonVariantConst item : list)
  {
    std::string id;
    if (!read_id(item, id) || std::find(out.playlists.begin(), out.playlists.end(), id) != out.playlists.end())
      return Fault::Structure;
    out.playlists.push_back(std::move(id));
  }
  return Fault::None;
}

} // namespace

bool read_server_choice(JsonVariantConst value, ServerChoice &out)
{
  out = ServerChoice();
  std::string message;
  if (read_choice(value, out, message) == Fault::None)
    return true;
  out = ServerChoice();
  return false;
}

bool load_play_file(const char *json, size_t length, ServerChoice &out, std::vector<Diagnostic> &diagnostics)
{
  out = ServerChoice();
  const size_t first_diagnostic = diagnostics.size();
  // Keeps at most MAX_DIAGNOSTICS entries, like the other loaders.
  auto error = [&](const char *code, const std::string &where, const std::string &message)
  {
    if (diagnostics.size() - first_diagnostic < MAX_DIAGNOSTICS)
      diagnostics.push_back({Severity::Error, code, where, message});
    return false;
  };

  JsonDocument doc;
  const char *code = nullptr;
  std::string message;
  if (!parse_document(json, length, MAX_PLAY_FILE_SIZE, MAX_JSON_DEPTH, doc, code, message))
    return error(code, "", message);
  JsonObjectConst root = doc.as<JsonObjectConst>();
  const char *format = root["format"].as<const char *>();
  if (!doc.is<JsonObjectConst>() || !format || std::string(format) != "pixelart-play/1")
    return error("format_unsupported", "format", std::string("unsupported format \"") + (format ? format : "") + "\"");

  bool ok = true;
  for (JsonPairConst kv : root)
    if (!is_allowed_key(kv.key(), {"format", "default"}))
      ok = error("structure", kv.key().c_str(), std::string("unknown field \"") + kv.key().c_str() + "\"");
  if (!root["default"].is<JsonVariantConst>())
    return error("structure", "default", "is required");

  const JsonVariantConst choice = root["default"];
  bool unknown_key = false;
  if (choice.is<JsonObjectConst>())
    for (JsonPairConst kv : choice.as<JsonObjectConst>())
      if (!is_allowed_key(kv.key(), {"schedule", "playlists"}))
      {
        ok = error("structure", std::string("default.") + kv.key().c_str(),
                   std::string("unknown field \"") + kv.key().c_str() + "\"");
        unknown_key = true;
      }
  if (!unknown_key)
    if (const Fault fault = read_choice(choice, out, message); fault != Fault::None)
      ok = error(fault == Fault::Limit ? "limit_exceeded" : "structure", "default", message);
  if (!ok)
    out = ServerChoice();
  return ok;
}

} // namespace pixelart
