// Parsing and validation of pixelart-playlist/1 documents.
// Structural rules mirror schema/playlist-1.schema.json.

#include <ArduinoJson.h>

#include <cstring>

#include "pixelart_engine.h"
#include "strict_json.h"

namespace pixelart
{

bool is_valid_id(const char *id)
{
  if (!id || !*id)
    return false;
  size_t n = 0;
  for (const char *p = id; *p; p++, n++)
  {
    bool alnum = (*p >= 'a' && *p <= 'z') || (*p >= '0' && *p <= '9');
    if (n >= 32 || !(alnum || (n > 0 && (*p == '_' || *p == '-'))))
      return false;
  }
  return true;
}

bool Playlist::load(const char *json, size_t length, std::vector<Diagnostic> &diagnostics)
{
  items_.clear();
  bool ok = true;
  const size_t first_diagnostic = diagnostics.size();
  // Keeps at most MAX_DIAGNOSTICS entries, like the animation loader.
  auto error = [&](const char *code, const std::string &where, const std::string &message)
  {
    if (diagnostics.size() - first_diagnostic < MAX_DIAGNOSTICS)
      diagnostics.push_back({Severity::Error, code, where, message});
    ok = false;
  };

  if (length > MAX_PLAYLIST_FILE_SIZE)
  {
    error("limit_exceeded", "", "file larger than " + std::to_string(MAX_PLAYLIST_FILE_SIZE / 1024) + " KiB");
    return false;
  }
  // ArduinoJson's default nesting limit.
  constexpr int MAX_JSON_DEPTH = 10;
  const std::string strict_error = strict_json_error(json, length, MAX_JSON_DEPTH);
  if (!strict_error.empty())
  {
    error("structure", "", strict_error);
    return false;
  }
  JsonDocument doc;
  DeserializationError parse_error =
      deserializeJson(doc, json, length, DeserializationOption::NestingLimit(MAX_JSON_DEPTH));
  if (parse_error)
  {
    error("structure", "", std::string("not valid JSON: ") + parse_error.c_str());
    return false;
  }
  JsonObjectConst root = doc.as<JsonObjectConst>();
  const char *format = root["format"].as<const char *>();
  if (!doc.is<JsonObjectConst>() || !format || std::string(format) != "pixelart-playlist/1")
  {
    error("format_unsupported", "format", std::string("unsupported format \"") + (format ? format : "") + "\"");
    return false;
  }

  for (JsonPairConst kv : root)
    if (!(kv.key() == "format" || kv.key() == "name" || kv.key() == "canvas" || kv.key() == "items"))
      error("structure", kv.key().c_str(), std::string("unknown field \"") + kv.key().c_str() + "\"");

  if (!root["name"].isNull())
  {
    const char *name = root["name"].as<const char *>();
    if (!name || !*name || utf8_code_points(name) > 128)
      error("structure", "name", "must be a text of 1 to 128 characters");
  }

  JsonObjectConst canvas = root["canvas"].as<JsonObjectConst>();
  if (!root["canvas"].is<JsonObjectConst>() || canvas.size() != 2 || !canvas["width"].is<long>() ||
      !canvas["height"].is<long>())
    error("structure", "canvas", "must be { width, height }");
  else if (canvas["width"].as<long>() != CANVAS_WIDTH || canvas["height"].as<long>() != CANVAS_HEIGHT)
    error("canvas_mismatch", "canvas", "the playlist is made for a different matrix than 16x16");

  JsonArrayConst items = root["items"].as<JsonArrayConst>();
  if (!root["items"].is<JsonArrayConst>() || items.size() == 0)
  {
    error("structure", "items", "must be a non-empty list");
    return false;
  }
  if (items.size() > MAX_PLAYLIST_ITEMS)
  {
    error("limit_exceeded", "items", "more than " + std::to_string(MAX_PLAYLIST_ITEMS) + " items");
    return false;
  }

  size_t i = 0;
  for (JsonVariantConst entry : items)
  {
    std::string where = "items[" + std::to_string(i++) + "]";
    JsonObjectConst item = entry.as<JsonObjectConst>();
    if (!entry.is<JsonObjectConst>())
    {
      error("structure", where, "must be an object with \"animation\"");
      continue;
    }
    for (JsonPairConst kv : item)
      if (!(kv.key() == "animation" || kv.key() == "repeat" || kv.key() == "enabled"))
        error("structure", where + "." + kv.key().c_str(), std::string("unknown field \"") + kv.key().c_str() + "\"");
    const char *id = item["animation"].as<const char *>();
    if (!is_valid_id(id))
    {
      error("structure", where + ".animation", "must be an animation ID: lowercase letters, digits, _ and -");
      continue;
    }
    long repeat = 1;
    if (!item["repeat"].isNull())
    {
      if (!item["repeat"].is<long>() || item["repeat"].as<long>() < 1 ||
          item["repeat"].as<long>() > MAX_PLAYLIST_REPEAT)
      {
        error("structure", where + ".repeat", "must be an integer from 1 to " + std::to_string(MAX_PLAYLIST_REPEAT));
        continue;
      }
      repeat = item["repeat"].as<long>();
    }
    bool enabled = true;
    if (!item["enabled"].isNull())
    {
      if (!item["enabled"].is<bool>())
      {
        error("structure", where + ".enabled", "must be true or false");
        continue;
      }
      enabled = item["enabled"].as<bool>();
    }
    if (enabled)
      items_.push_back({id, (uint16_t)repeat});
  }
  if (!ok)
    items_.clear();
  return ok;
}

} // namespace pixelart
