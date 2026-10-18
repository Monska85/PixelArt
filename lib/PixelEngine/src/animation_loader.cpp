// Parsing and validation of pixelart/1 documents.
// Structural rules mirror schema/pixelart-1.schema.json; the other rules are
// the ones listed in docs/format/pixelart-v1.md#validation.

#include <ArduinoJson.h>

#include <algorithm>
#include <cstring>
#include <initializer_list>
#include <map>
#include <set>

#include "pixelart_engine.h"

namespace pixelart
{
namespace
{

bool is_name(const char *s)
{
  if (!s || !(*s >= 'a' && *s <= 'z'))
    return false;
  size_t n = 0;
  for (const char *p = s; *p; p++, n++)
  {
    bool ok = (*p >= 'a' && *p <= 'z') || (*p >= '0' && *p <= '9') || *p == '_';
    if (!ok || n >= 32)
      return false;
  }
  return true;
}

bool parse_hex(const char *s, Rgb &out)
{
  if (!s || s[0] != '#')
    return false;
  Rgb value = 0;
  for (int i = 1; i <= 6; i++)
  {
    char c = s[i];
    int digit;
    if (c >= '0' && c <= '9')
      digit = c - '0';
    else if (c >= 'a' && c <= 'f')
      digit = c - 'a' + 10;
    else if (c >= 'A' && c <= 'F')
      digit = c - 'A' + 10;
    else
      return false;
    value = (value << 4) | (Rgb)digit;
  }
  if (s[7] != '\0')
    return false;
  out = value;
  return true;
}

std::string index_path(const std::string &base, size_t i) { return base + "[" + std::to_string(i) + "]"; }

std::string key_path(const std::string &base, const char *key) { return base.empty() ? key : base + "." + key; }

} // namespace

// Fills an Animation from a JSON document, collecting every error and warning.
class Loader
{
public:
  Loader(Animation &animation, std::vector<Diagnostic> &diagnostics)
      : a_(animation), diagnostics_(diagnostics), first_diagnostic_(diagnostics.size())
  {
  }

  bool run(const char *json, size_t length);

private:
  using Item = Animation::Item;
  using Ref = Animation::Ref;
  using Sprite = Animation::Sprite;

  void error(const char *code, const std::string &where, const std::string &message)
  {
    failed_ = true;
    error_count_++;
    report(Severity::Error, code, where, message);
  }

  void warning(const char *code, const std::string &where, const std::string &message)
  {
    report(Severity::Warning, code, where, message);
  }

  // Keeps at most MAX_DIAGNOSTICS entries, so a file full of mistakes cannot
  // exhaust memory. When the list is full, an error replaces the latest
  // warning, so a rejected file always reports at least one reason.
  void report(Severity severity, const char *code, const std::string &where, const std::string &message)
  {
    if (diagnostics_.size() - first_diagnostic_ < MAX_DIAGNOSTICS)
    {
      diagnostics_.push_back({severity, code, where, message});
      return;
    }
    if (severity != Severity::Error)
      return;
    for (size_t i = diagnostics_.size(); i > first_diagnostic_; i--)
      if (diagnostics_[i - 1].severity == Severity::Warning)
      {
        diagnostics_.erase(diagnostics_.begin() + (long)(i - 1));
        diagnostics_.push_back({severity, code, where, message});
        return;
      }
  }

  bool check_keys(JsonObjectConst object, std::initializer_list<const char *> allowed, const std::string &where);
  bool get_int(JsonVariantConst value, long min, long max, const std::string &where, long &out);
  bool get_position(JsonVariantConst value, const std::string &where, Animation::Pos &out);
  bool optional_position(JsonObjectConst object, const char *key, const std::string &where, bool &present,
                         Animation::Pos &out);
  bool parse_angle(JsonVariantConst value, const std::string &where, int16_t &out);
  bool add_points_budget(size_t count, const std::string &where);
  void warn_duplicate_points(const Sprite &sprite, const std::string &where);
  bool get_string(JsonVariantConst value, size_t max_length, bool allow_empty, const std::string &where);
  bool get_color(JsonVariantConst value, const std::string &where, uint8_t &out);
  bool color_from_string(const char *text, const std::string &where, uint8_t &out);
  bool add_color(Rgb rgb, const std::string &where, uint8_t &out);

  void parse_palette(JsonVariantConst value);
  void parse_sprites(JsonVariantConst value);
  void parse_sprite(Sprite &sprite, JsonVariantConst value, const std::string &where);
  void parse_points(Sprite &sprite, JsonVariantConst value, const std::string &where);
  void parse_parts(Sprite &sprite, JsonVariantConst value, const std::string &where);
  bool check_sprite_graph();
  bool visit_for_cycles(size_t index, std::vector<uint8_t> &state);
  int compute_bounds(size_t index);
  void parse_items(JsonVariantConst value, const std::string &where, int depth, std::vector<uint32_t> &out);
  void parse_frame(JsonObjectConst object, const std::string &where, Item &item);
  void parse_loop(JsonObjectConst object, const std::string &where, int depth, Item &item);
  bool parse_ref(JsonVariantConst value, const std::string &where, Ref &ref);
  bool find_sprite(const char *name, const std::string &where, uint8_t &out);
  void check_drawn_points(const Item &item, const std::string &where);
  void final_warnings();

  Animation &a_;
  std::vector<Diagnostic> &diagnostics_;
  const size_t first_diagnostic_;
  size_t error_count_ = 0; // every error, including the ones not stored
  bool failed_ = false;
  bool points_full_reported_ = false;
  bool colors_full_reported_ = false;
  bool items_full_reported_ = false;
  bool sprites_ok_ = false;
  uint16_t frame_ms_ = DEFAULT_FRAME_MS;
  size_t total_points_ = 0;
  size_t total_items_ = 0;
  std::map<std::string, Rgb> palette_;
  std::set<std::string> palette_used_;
  std::map<std::string, uint8_t> sprite_index_;
  std::vector<bool> sprite_used_;
  std::set<uint8_t> rotated_default_pivot_;
  std::vector<int> composite_depth_;
};

bool Loader::check_keys(JsonObjectConst object, std::initializer_list<const char *> allowed, const std::string &where)
{
  bool ok = true;
  for (JsonPairConst kv : object)
  {
    bool known = false;
    for (const char *key : allowed)
      known = known || kv.key() == key;
    if (!known)
    {
      error("structure", key_path(where, kv.key().c_str()), std::string("unknown field \"") + kv.key().c_str() + "\"");
      ok = false;
    }
  }
  return ok;
}

bool Loader::get_int(JsonVariantConst value, long min, long max, const std::string &where, long &out)
{
  if (!value.is<long>() || value.as<long>() < min || value.as<long>() > max)
  {
    error("structure", where, "must be an integer from " + std::to_string(min) + " to " + std::to_string(max));
    return false;
  }
  out = value.as<long>();
  return true;
}

bool Loader::get_position(JsonVariantConst value, const std::string &where, Animation::Pos &out)
{
  JsonArrayConst array = value.as<JsonArrayConst>();
  if (!value.is<JsonArrayConst>() || array.size() != 2)
  {
    error("structure", where, "must be [x, y]");
    return false;
  }
  long x, y;
  bool ok = get_int(array[0], MIN_COORD, MAX_COORD, index_path(where, 0), x);
  ok = get_int(array[1], MIN_COORD, MAX_COORD, index_path(where, 1), y) && ok;
  if (ok)
    out = {(int8_t)x, (int8_t)y};
  return ok;
}

bool Loader::get_string(JsonVariantConst value, size_t max_length, bool allow_empty, const std::string &where)
{
  const char *s = value.as<const char *>();
  if (!value.is<const char *>() || (!allow_empty && !*s) || strlen(s) > max_length)
  {
    error("structure", where,
          "must be a text of " + std::string(allow_empty ? "0" : "1") + " to " + std::to_string(max_length) +
              " characters");
    return false;
  }
  return true;
}

bool Loader::add_color(Rgb rgb, const std::string &where, uint8_t &out)
{
  for (size_t i = 0; i < a_.colors_.size(); i++)
    if (a_.colors_[i] == rgb)
    {
      out = (uint8_t)i;
      return true;
    }
  if (a_.colors_.size() >= MAX_COLORS)
  {
    if (!colors_full_reported_)
      error("limit_exceeded", where, "more than " + std::to_string(MAX_COLORS) + " different colors");
    colors_full_reported_ = true;
    return false;
  }
  a_.colors_.push_back(rgb);
  out = (uint8_t)(a_.colors_.size() - 1);
  return true;
}

bool Loader::color_from_string(const char *text, const std::string &where, uint8_t &out)
{
  Rgb rgb;
  if (parse_hex(text, rgb))
    return add_color(rgb, where, out);
  auto found = palette_.find(text);
  if (found == palette_.end())
  {
    error("unknown_color", where,
          std::string("unknown color \"") + text + "\": not a palette name or a \"#rrggbb\" value");
    return false;
  }
  palette_used_.insert(found->first);
  return add_color(found->second, where, out);
}

bool Loader::get_color(JsonVariantConst value, const std::string &where, uint8_t &out)
{
  if (!value.is<const char *>())
  {
    error("unknown_color", where, "a color must be a palette name or a \"#rrggbb\" text");
    return false;
  }
  return color_from_string(value.as<const char *>(), where, out);
}

void Loader::parse_palette(JsonVariantConst value)
{
  if (value.isNull())
    return;
  JsonObjectConst object = value.as<JsonObjectConst>();
  if (!value.is<JsonObjectConst>())
  {
    error("structure", "palette", "must be an object of name: \"#rrggbb\"");
    return;
  }
  if (object.size() > MAX_PALETTE)
    error("limit_exceeded", "palette", "more than " + std::to_string(MAX_PALETTE) + " entries");
  for (JsonPairConst kv : object)
  {
    std::string where = key_path("palette", kv.key().c_str());
    Rgb rgb;
    if (!is_name(kv.key().c_str()))
      error("structure", where, "invalid name: use lowercase letters, digits and _, starting with a letter");
    else if (!kv.value().is<const char *>() || !parse_hex(kv.value().as<const char *>(), rgb))
      error("structure", where, "must be a \"#rrggbb\" value");
    else
      palette_[kv.key().c_str()] = rgb;
  }
}

void Loader::parse_sprites(JsonVariantConst value)
{
  JsonObjectConst object = value.as<JsonObjectConst>();
  if (!value.is<JsonObjectConst>() || object.size() == 0)
  {
    error("structure", "sprites", "must be an object with at least one sprite");
    return;
  }
  if (object.size() > MAX_SPRITES)
  {
    error("limit_exceeded", "sprites", "more than " + std::to_string(MAX_SPRITES) + " sprites");
    return;
  }

  // Names first, so parts can refer to sprites defined later in the file.
  for (JsonPairConst kv : object)
  {
    if (!is_name(kv.key().c_str()))
    {
      error("structure", key_path("sprites", kv.key().c_str()),
            "invalid name: use lowercase letters, digits and _, starting with a letter");
      continue;
    }
    sprite_index_[kv.key().c_str()] = (uint8_t)a_.sprites_.size();
    a_.sprites_.emplace_back();
    a_.sprites_.back().name = kv.key().c_str();
  }
  sprite_used_.assign(a_.sprites_.size(), false);

  const size_t errors_before = error_count_;
  for (JsonPairConst kv : object)
  {
    auto found = sprite_index_.find(kv.key().c_str());
    if (found != sprite_index_.end())
      parse_sprite(a_.sprites_[found->second], kv.value(), key_path("sprites", kv.key().c_str()));
  }

  sprites_ok_ = error_count_ == errors_before && check_sprite_graph();
}

void Loader::parse_sprite(Sprite &sprite, JsonVariantConst value, const std::string &where)
{
  JsonObjectConst object = value.as<JsonObjectConst>();
  if (!value.is<JsonObjectConst>())
  {
    error("structure", where, "a sprite must be an object");
    return;
  }
  check_keys(object, {"at", "pivot", "points", "parts"}, where);
  if (!object["at"].isNull())
    get_position(object["at"], key_path(where, "at"), sprite.at);
  if (!object["pivot"].isNull() && get_position(object["pivot"], key_path(where, "pivot"), sprite.pivot))
    sprite.has_pivot = true;

  bool has_points = !object["points"].isNull(), has_parts = !object["parts"].isNull();
  if (has_points == has_parts)
    error("structure", where, "a sprite needs either \"points\" or \"parts\", not both");
  else if (has_points)
    parse_points(sprite, object["points"], key_path(where, "points"));
  else
    parse_parts(sprite, object["parts"], key_path(where, "parts"));
}

// Reserves room for `count` more points, or reports the limit and returns
// false before anything is stored.
bool Loader::add_points_budget(size_t count, const std::string &where)
{
  if (total_points_ + count > MAX_POINTS)
  {
    if (!points_full_reported_)
      error("limit_exceeded", where, "more than " + std::to_string(MAX_POINTS) + " points in the animation");
    points_full_reported_ = true;
    return false;
  }
  total_points_ += count;
  return true;
}

// Sorts the positions instead of keeping a set, so the check needs 2 bytes
// per point.
void Loader::warn_duplicate_points(const Sprite &sprite, const std::string &where)
{
  std::vector<uint16_t> keys;
  keys.reserve(sprite.points.size());
  for (const Animation::Point &p : sprite.points)
    keys.push_back((uint16_t)((uint8_t)(p.x + 128) << 8 | (uint8_t)(p.y + 128)));
  std::sort(keys.begin(), keys.end());
  auto duplicate = std::adjacent_find(keys.begin(), keys.end());
  if (duplicate != keys.end())
  {
    int x = (*duplicate >> 8) - 128, y = (*duplicate & 0xff) - 128;
    warning("duplicate_point", where,
            "two points share position [" + std::to_string(x) + ", " + std::to_string(y) + "]; the later one wins");
  }
}

void Loader::parse_points(Sprite &sprite, JsonVariantConst value, const std::string &where)
{
  if (value.is<JsonArrayConst>())
  {
    JsonArrayConst points = value.as<JsonArrayConst>();
    if (points.size() == 0)
      error("empty_sprite", where, "a sprite needs at least one point");
    if (!add_points_budget(points.size(), where))
      return;
    sprite.points.reserve(points.size());
    size_t i = 0;
    for (JsonVariantConst p : points)
    {
      std::string at = index_path(where, i++);
      JsonArrayConst triple = p.as<JsonArrayConst>();
      if (!p.is<JsonArrayConst>() || triple.size() != 3)
      {
        error("structure", at, "a point must be [x, y, color]");
        continue;
      }
      long x, y;
      uint8_t color;
      bool ok = get_int(triple[0], MIN_COORD, MAX_COORD, index_path(at, 0), x);
      ok = get_int(triple[1], MIN_COORD, MAX_COORD, index_path(at, 1), y) && ok;
      ok = get_color(triple[2], index_path(at, 2), color) && ok;
      if (ok)
        sprite.points.push_back({(int8_t)x, (int8_t)y, color});
    }
  }
  else if (value.is<JsonObjectConst>())
  {
    JsonObjectConst groups = value.as<JsonObjectConst>();
    if (groups.size() == 0)
      error("empty_sprite", where, "a sprite needs at least one point");
    for (JsonPairConst kv : groups)
    {
      std::string at = key_path(where, kv.key().c_str());
      JsonArrayConst positions = kv.value().as<JsonArrayConst>();
      if (!kv.value().is<JsonArrayConst>() || positions.size() == 0)
      {
        error("structure", at, "must be a non-empty list of [x, y]");
        continue;
      }
      if (!add_points_budget(positions.size(), where))
        return;
      uint8_t color;
      bool color_ok = color_from_string(kv.key().c_str(), at, color);
      size_t i = 0;
      for (JsonVariantConst p : positions)
      {
        Animation::Pos pos;
        if (get_position(p, index_path(at, i++), pos) && color_ok)
          sprite.points.push_back({pos.x, pos.y, color});
      }
    }
  }
  else
  {
    error("structure", where, "must be a list of [x, y, color] or an object of color: [[x, y], ...]");
    return;
  }
  warn_duplicate_points(sprite, where);
}

void Loader::parse_parts(Sprite &sprite, JsonVariantConst value, const std::string &where)
{
  JsonArrayConst parts = value.as<JsonArrayConst>();
  if (!value.is<JsonArrayConst>())
  {
    error("structure", where, "must be a list of sprite names");
    return;
  }
  if (parts.size() == 0)
  {
    error("empty_sprite", where, "a composite sprite needs at least one part");
    return;
  }
  if (parts.size() > MAX_PARTS)
  {
    error("limit_exceeded", where, "more than " + std::to_string(MAX_PARTS) + " parts");
    return;
  }
  size_t i = 0;
  for (JsonVariantConst p : parts)
  {
    std::string at = index_path(where, i++);
    Animation::Part part{0, false, {}};
    const char *name = nullptr;
    if (p.is<const char *>())
    {
      name = p.as<const char *>();
    }
    else if (p.is<JsonObjectConst>())
    {
      JsonObjectConst object = p.as<JsonObjectConst>();
      check_keys(object, {"sprite", "at"}, at);
      if (!object["sprite"].is<const char *>())
      {
        error("structure", key_path(at, "sprite"), "must be a sprite name");
        continue;
      }
      name = object["sprite"].as<const char *>();
      if (!object["at"].isNull() && get_position(object["at"], key_path(at, "at"), part.at))
        part.has_at = true;
    }
    else
    {
      error("structure", at, "must be a sprite name or { sprite, at }");
      continue;
    }
    if (find_sprite(name, at, part.sprite))
    {
      sprite.parts.push_back(part);
      sprite_used_[part.sprite] = true;
    }
  }
}

bool Loader::find_sprite(const char *name, const std::string &where, uint8_t &out)
{
  auto found = sprite_index_.find(name);
  if (found == sprite_index_.end())
  {
    error("unknown_sprite", where, std::string("unknown sprite \"") + name + "\"");
    return false;
  }
  out = found->second;
  return true;
}

bool Loader::visit_for_cycles(size_t index, std::vector<uint8_t> &state)
{
  if (state[index] == 2)
    return true;
  if (state[index] == 1)
  {
    error("sprite_cycle", key_path("sprites", a_.sprites_[index].name.c_str()),
          "sprite \"" + a_.sprites_[index].name + "\" contains itself through its parts");
    return false;
  }
  state[index] = 1;
  for (const Animation::Part &part : a_.sprites_[index].parts)
    if (!visit_for_cycles(part.sprite, state))
      return false;
  state[index] = 2;
  return true;
}

// Computes the bounding box and the number of drawn points, and returns the
// composite depth of a sprite. Runs after the cycle check, so it terminates.
int Loader::compute_bounds(size_t index)
{
  if (composite_depth_[index] >= 0)
    return composite_depth_[index];
  Sprite &s = a_.sprites_[index];
  int depth = 0;
  bool first = true;
  auto extend = [&](int min_x, int min_y, int max_x, int max_y)
  {
    if (first || min_x < s.min_x)
      s.min_x = (int16_t)min_x;
    if (first || min_y < s.min_y)
      s.min_y = (int16_t)min_y;
    if (first || max_x > s.max_x)
      s.max_x = (int16_t)max_x;
    if (first || max_y > s.max_y)
      s.max_y = (int16_t)max_y;
    first = false;
  };
  for (const Animation::Point &p : s.points)
    extend(p.x, p.y, p.x, p.y);
  // Saturates just above the limit: 64 parts nested 4 deep would overflow.
  uint64_t drawn = s.points.size();
  for (const Animation::Part &part : s.parts)
  {
    depth = std::max(depth, compute_bounds(part.sprite) + 1);
    const Sprite &child = a_.sprites_[part.sprite];
    Animation::Pos offset = a_.part_position(part);
    extend(child.min_x + offset.x, child.min_y + offset.y, child.max_x + offset.x, child.max_y + offset.y);
    drawn = std::min<uint64_t>(drawn + child.drawn_points, MAX_DRAWN_POINTS + 1);
  }
  s.drawn_points = (uint32_t)std::min<uint64_t>(drawn, MAX_DRAWN_POINTS + 1);
  composite_depth_[index] = depth;
  return depth;
}

bool Loader::check_sprite_graph()
{
  std::vector<uint8_t> state(a_.sprites_.size(), 0);
  for (size_t i = 0; i < a_.sprites_.size(); i++)
    if (!visit_for_cycles(i, state))
      return false;
  composite_depth_.assign(a_.sprites_.size(), -1);
  bool ok = true;
  for (size_t i = 0; i < a_.sprites_.size(); i++)
    if (compute_bounds(i) > MAX_COMPOSITE_DEPTH)
    {
      error("limit_exceeded", key_path("sprites", a_.sprites_[i].name.c_str()),
            "composite sprites nested more than " + std::to_string(MAX_COMPOSITE_DEPTH) + " levels deep");
      ok = false;
    }
  return ok;
}

bool Loader::optional_position(JsonObjectConst object, const char *key, const std::string &where, bool &present,
                               Animation::Pos &out)
{
  if (object[key].isNull())
    return true;
  present = get_position(object[key], key_path(where, key), out);
  return present;
}

// A non-integer angle is a type error (`structure`); an integer that is not a
// quarter turn is `invalid_angle`.
bool Loader::parse_angle(JsonVariantConst value, const std::string &where, int16_t &out)
{
  if (!value.is<long>())
  {
    error("structure", where, "must be an integer number of degrees");
    return false;
  }
  long degrees = value.as<long>();
  if (degrees % 90 != 0 || degrees < -270 || degrees > 270)
  {
    error("invalid_angle", where, "must be one of -270, -180, -90, 0, 90, 180, 270");
    return false;
  }
  out = (int16_t)degrees;
  return true;
}

bool Loader::parse_ref(JsonVariantConst value, const std::string &where, Ref &ref)
{
  if (value.is<const char *>())
    return find_sprite(value.as<const char *>(), where, ref.sprite);
  JsonObjectConst object = value.as<JsonObjectConst>();
  if (!value.is<JsonObjectConst>())
  {
    error("structure", where, "must be a sprite name or { sprite, ... }");
    return false;
  }
  if (!object["sprite"].is<const char *>())
  {
    error("structure", key_path(where, "sprite"), "must be a sprite name");
    return false;
  }

  bool ok = check_keys(object, {"sprite", "at", "move", "wrap", "rotate", "spin", "flip", "pivot"}, where);
  if (!find_sprite(object["sprite"].as<const char *>(), key_path(where, "sprite"), ref.sprite))
    ok = false;
  bool has_move = false;
  if (!optional_position(object, "at", where, ref.has_at, ref.at))
    ok = false;
  if (!optional_position(object, "move", where, has_move, ref.move))
    ok = false;
  if (!optional_position(object, "pivot", where, ref.has_pivot, ref.pivot))
    ok = false;

  if (!object["wrap"].isNull())
  {
    if (object["wrap"].is<bool>())
      ref.wrap = object["wrap"].as<bool>();
    else
    {
      error("structure", key_path(where, "wrap"), "must be true or false");
      ok = false;
    }
  }
  if (!object["rotate"].isNull() && !parse_angle(object["rotate"], key_path(where, "rotate"), ref.rotate))
    ok = false;
  if (!object["spin"].isNull() && !parse_angle(object["spin"], key_path(where, "spin"), ref.spin))
    ok = false;

  if (!object["flip"].isNull())
  {
    const char *flip = object["flip"].as<const char *>();
    std::string f = flip ? flip : "";
    if (f == "x")
      ref.flip = Animation::FLIP_X;
    else if (f == "y")
      ref.flip = Animation::FLIP_Y;
    else if (f == "xy")
      ref.flip = Animation::FLIP_X | Animation::FLIP_Y;
    else
    {
      error("structure", key_path(where, "flip"), "must be \"x\", \"y\" or \"xy\"");
      ok = false;
    }
  }
  return ok;
}

void Loader::parse_frame(JsonObjectConst object, const std::string &where, Item &item)
{
  check_keys(object, {"show", "ms", "repeat", "recolor"}, where);
  long value;
  item.ms = frame_ms_;
  if (!object["ms"].isNull() && get_int(object["ms"], MIN_MS, MAX_MS, key_path(where, "ms"), value))
    item.ms = (uint16_t)value;
  if (!object["repeat"].isNull() && get_int(object["repeat"], 1, MAX_COUNT, key_path(where, "repeat"), value))
    item.count = (uint16_t)value;

  JsonArrayConst show = object["show"].as<JsonArrayConst>();
  std::string show_where = key_path(where, "show");
  if (!object["show"].is<JsonArrayConst>())
    error("structure", show_where, "must be a list of sprites");
  else if (show.size() > MAX_SHOW)
    error("limit_exceeded", show_where, "more than " + std::to_string(MAX_SHOW) + " sprites");
  else
  {
    item.first = (uint32_t)a_.refs_.size();
    size_t i = 0;
    for (JsonVariantConst entry : show)
    {
      Ref ref;
      std::string at = index_path(show_where, i++);
      if (!parse_ref(entry, at, ref))
        continue;
      if (item.count == 1 && (ref.move.x || ref.move.y || ref.spin))
        warning("no_effect", at, "\"move\" and \"spin\" only change the sprite when the frame has \"repeat\"");
      if ((ref.rotate || ref.spin) && !ref.has_pivot && !a_.sprites_[ref.sprite].has_pivot)
        rotated_default_pivot_.insert(ref.sprite);
      sprite_used_[ref.sprite] = true;
      a_.refs_.push_back(ref);
    }
    item.size = (uint32_t)a_.refs_.size() - item.first;
    check_drawn_points(item, show_where);
  }

  JsonVariantConst recolor = object["recolor"];
  if (recolor.isNull())
    return;
  std::string recolor_where = key_path(where, "recolor");
  JsonObjectConst map = recolor.as<JsonObjectConst>();
  if (!recolor.is<JsonObjectConst>() || map.size() == 0)
  {
    error("structure", recolor_where, "must be an object of color: color");
    return;
  }
  if (map.size() > MAX_COLORS)
  {
    error("limit_exceeded", recolor_where, "more than " + std::to_string(MAX_COLORS) + " substitutions");
    return;
  }
  item.recolor_first = (uint32_t)a_.recolors_.size();
  for (JsonPairConst kv : map)
  {
    std::string at = key_path(recolor_where, kv.key().c_str());
    uint8_t from, to;
    bool ok = color_from_string(kv.key().c_str(), at, from);
    ok = get_color(kv.value(), at, to) && ok;
    if (ok)
      a_.recolors_.push_back({from, to});
  }
  item.recolor_size = (uint32_t)a_.recolors_.size() - item.recolor_first;
}

// Bounds the work of one frame: composites can repeat a part up to 64 times
// at every nesting level, so a small file could otherwise draw millions of
// pixels per frame.
void Loader::check_drawn_points(const Item &item, const std::string &where)
{
  if (!sprites_ok_)
    return; // drawn_points is only computed for a valid sprite graph
  uint64_t drawn = 0;
  for (uint32_t i = 0; i < item.size; i++)
    drawn += a_.sprites_[a_.refs_[item.first + i].sprite].drawn_points;
  if (drawn > MAX_DRAWN_POINTS)
    error("limit_exceeded", where,
          "draws more than " + std::to_string(MAX_DRAWN_POINTS) +
              " pixels in one frame (composite sprites count every part)");
}

void Loader::parse_loop(JsonObjectConst object, const std::string &where, int depth, Item &item)
{
  check_keys(object, {"loop", "steps"}, where);
  long count;
  if (get_int(object["loop"], 1, MAX_COUNT, key_path(where, "loop"), count))
    item.count = (uint16_t)count;
  if (depth > MAX_LOOP_DEPTH)
  {
    error("limit_exceeded", where, "loops nested more than " + std::to_string(MAX_LOOP_DEPTH) + " levels deep");
    return;
  }
  JsonArrayConst steps = object["steps"].as<JsonArrayConst>();
  if (!object["steps"].is<JsonArrayConst>() || steps.size() == 0)
  {
    error("structure", key_path(where, "steps"), "must be a non-empty list of frames and loops");
    return;
  }
  std::vector<uint32_t> children;
  parse_items(object["steps"], key_path(where, "steps"), depth, children);
  item.first = (uint32_t)a_.children_.size();
  item.size = (uint32_t)children.size();
  a_.children_.insert(a_.children_.end(), children.begin(), children.end());
}

void Loader::parse_items(JsonVariantConst value, const std::string &where, int depth, std::vector<uint32_t> &out)
{
  size_t i = 0;
  for (JsonVariantConst entry : value.as<JsonArrayConst>())
  {
    std::string at = index_path(where, i++);
    if (++total_items_ > MAX_TIMELINE_ITEMS)
    {
      if (!items_full_reported_)
        error("limit_exceeded", at, "more than " + std::to_string(MAX_TIMELINE_ITEMS) + " timeline items");
      items_full_reported_ = true;
      return;
    }
    JsonObjectConst object = entry.as<JsonObjectConst>();
    bool is_loop = entry.is<JsonObjectConst>() && !object["loop"].isNull();
    bool is_frame = entry.is<JsonObjectConst>() && !object["show"].isNull();
    if (is_loop == is_frame)
    {
      error("structure", at, "an item is either a frame (\"show\") or a loop (\"loop\" and \"steps\")");
      continue;
    }
    Item item;
    item.is_loop = is_loop;
    if (is_loop)
      parse_loop(object, at, depth + 1, item);
    else
      parse_frame(object, at, item);
    out.push_back((uint32_t)a_.items_.size());
    a_.items_.push_back(item);
  }
}

void Loader::final_warnings()
{
  for (uint8_t index : rotated_default_pivot_)
  {
    const Sprite &s = a_.sprites_[index];
    if ((s.min_x + s.max_x) % 2 != 0 || (s.min_y + s.max_y) % 2 != 0)
      warning("pivot_rounded", key_path("sprites", s.name.c_str()),
              "the center falls between two pixels, so the sprite shifts by one pixel when it turns; set \"pivot\"");
  }
  for (size_t i = 0; i < a_.sprites_.size(); i++)
    if (!sprite_used_[i])
      warning("unused_sprite", key_path("sprites", a_.sprites_[i].name.c_str()),
              "sprite \"" + a_.sprites_[i].name + "\" is never shown");
  for (const auto &entry : palette_)
    if (!palette_used_.count(entry.first))
      warning("unused_color", key_path("palette", entry.first.c_str()), "color \"" + entry.first + "\" is never used");
}

bool Loader::run(const char *json, size_t length)
{
  a_.clear();
  if (length > MAX_FILE_SIZE)
  {
    error("limit_exceeded", "", "file larger than " + std::to_string(MAX_FILE_SIZE / 1024) + " KiB");
    return false;
  }

  JsonDocument doc;
  DeserializationError parse_error = deserializeJson(doc, json, length, DeserializationOption::NestingLimit(32));
  if (parse_error)
  {
    error("structure", "", std::string("not valid JSON: ") + parse_error.c_str());
    return false;
  }
  JsonObjectConst root = doc.as<JsonObjectConst>();
  if (!doc.is<JsonObjectConst>())
  {
    error("structure", "", "the document must be an object");
    return false;
  }
  const char *format = root["format"].as<const char *>();
  if (!format || std::string(format) != "pixelart/1")
  {
    error("format_unsupported", "format", std::string("unsupported format \"") + (format ? format : "") + "\"");
    return false;
  }

  check_keys(root,
             {"format", "name", "version", "author", "description", "canvas", "frame_ms", "background", "palette",
              "sprites", "timeline"},
             "");
  for (const char *key : {"name", "canvas", "sprites", "timeline"})
    if (root[key].isNull())
      error("structure", key, std::string("missing required field \"") + key + "\"");

  if (!root["name"].isNull() && get_string(root["name"], 128, false, "name"))
    a_.name_ = root["name"].as<const char *>();
  long value;
  if (!root["version"].isNull() && get_int(root["version"], 1, 0x7fffffff, "version", value))
    a_.version_ = (uint32_t)value;
  if (!root["author"].isNull())
    get_string(root["author"], 128, true, "author");
  if (!root["description"].isNull())
    get_string(root["description"], 512, true, "description");
  if (!root["canvas"].isNull())
  {
    JsonObjectConst canvas = root["canvas"].as<JsonObjectConst>();
    if (!root["canvas"].is<JsonObjectConst>() || canvas.size() != 2 || canvas["width"].as<long>() != CANVAS_WIDTH ||
        canvas["height"].as<long>() != CANVAS_HEIGHT || !canvas["width"].is<long>() || !canvas["height"].is<long>())
      error("structure", "canvas", "must be { width: 16, height: 16 }");
  }
  if (!root["frame_ms"].isNull() && get_int(root["frame_ms"], MIN_MS, MAX_MS, "frame_ms", value))
    frame_ms_ = (uint16_t)value;

  parse_palette(root["palette"]);
  if (!root["background"].isNull() && get_color(root["background"], "background", a_.background_))
    a_.has_background_ = true;
  if (!root["sprites"].isNull())
    parse_sprites(root["sprites"]);

  JsonVariantConst timeline = root["timeline"];
  if (!timeline.isNull())
  {
    if (!timeline.is<JsonArrayConst>() || timeline.as<JsonArrayConst>().size() == 0)
      error("structure", "timeline", "must be a non-empty list of frames and loops");
    else if (sprite_index_.empty() && !failed_)
      error("structure", "sprites", "must define at least one sprite");
    else
    {
      std::vector<uint32_t> root_items;
      parse_items(timeline, "timeline", 0, root_items);
      a_.root_first_ = (uint32_t)a_.children_.size();
      a_.root_size_ = (uint32_t)root_items.size();
      a_.children_.insert(a_.children_.end(), root_items.begin(), root_items.end());
    }
  }

  if (failed_ || !sprites_ok_)
  {
    a_.clear();
    return false;
  }
  final_warnings();
  a_.loaded_ = true;
  return true;
}

void Animation::clear()
{
  loaded_ = false;
  name_.clear();
  version_ = 1;
  has_background_ = false;
  background_ = 0;
  colors_.clear();
  sprites_.clear();
  refs_.clear();
  recolors_.clear();
  items_.clear();
  children_.clear();
  root_first_ = root_size_ = 0;
}

bool Animation::load(const char *json, size_t length, std::vector<Diagnostic> &diagnostics)
{
  Loader loader(*this, diagnostics);
  return loader.run(json, length);
}

} // namespace pixelart
