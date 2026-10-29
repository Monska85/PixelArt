// SPDX-License-Identifier: GPL-3.0-or-later

#include "update_manifest.h"

#include <ArduinoJson.h>
#include <pixelart_engine.h>
#include <strict_json.h>

#include <algorithm>
#include <cstdlib>
#include <cstring>
#include <type_traits>

#include "update_semver.h"

namespace pixelart_update
{

namespace
{

// The manifest nests object in array in object: three levels. A little room for fields added later.
constexpr int MAX_DEPTH = 6;
constexpr size_t SHA256_DIGITS = 64;

bool is_lower_hex(const std::string &text, size_t digits)
{
  if (text.size() != digits)
    return false;
  for (char c : text)
    if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')))
      return false;
  return true;
}

bool is_path_char(char c)
{
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '.' || c == '_' ||
         c == '-' || c == '+';
}

// Keeps in memory only the fields the board reads, so a large manifest stays small.
void make_filter(JsonDocument &filter)
{
  filter["format"] = true;
  filter["version"] = true;
  // Keep this subtree whole so a present but mistyped declaration cannot disappear in the filter.
  filter["content_pages"] = true;
  for (const char *list : {"animations", "playlists", "schedules", "play"})
  {
    filter[list][0]["id"] = true;
    filter[list][0]["file"] = true;
    filter[list][0]["size"] = true;
    filter[list][0]["sha256"] = true;
  }
  filter["firmware"][0]["board"] = true;
  filter["firmware"][0]["part"] = true;
  filter["firmware"][0]["file"] = true;
  filter["firmware"][0]["size"] = true;
  filter["firmware"][0]["sha256"] = true;
}

bool fail(std::string &reason, const std::string &text)
{
  reason = text;
  return false;
}

// The fields every file entry needs: `file`, `size` and `sha256`.
bool read_file_fields(JsonObjectConst item, const std::string &where, std::string &file, size_t &size,
                      std::string &sha256, std::string &reason)
{
  if (!item["file"].is<const char *>() || !item["sha256"].is<const char *>() || !item["size"].is<uint32_t>())
    return fail(reason, where + " lacks file, size or sha256");
  file = item["file"].as<std::string>();
  sha256 = item["sha256"].as<std::string>();
  size = item["size"].as<uint32_t>();
  if (!is_safe_relative_path(file))
    return fail(reason, where + " has a path that is not relative to the manifest");
  if (size < 1)
    return fail(reason, where + " has a size below 1");
  if (!is_lower_hex(sha256, SHA256_DIGITS))
    return fail(reason, where + " has a sha256 that is not 64 lowercase hexadecimal digits");
  return true;
}

// The allocator of the parsed document: it refuses what `memory` cannot afford, so the document
// stops growing (ArduinoJson reports NoMemory) instead of taking the last of the heap.
class LimitedAllocator : public ArduinoJson::Allocator
{
public:
  explicit LimitedAllocator(ManifestMemory &memory) : memory_(memory) {}

  void *allocate(size_t size) override { return affordable(size) ? malloc(size) : nullptr; }
  void deallocate(void *pointer) override { free(pointer); }
  void *reallocate(void *pointer, size_t size) override { return affordable(size) ? realloc(pointer, size) : nullptr; }

private:
  bool affordable(size_t size)
  {
    if (!memory_.affordable || memory_.affordable(size, size))
      return true;
    memory_.out_of_memory = true;
    return false;
  }

  ManifestMemory &memory_;
};

// What a string of `length` characters takes on the heap: nothing while it fits in the string itself
// (15 characters in libstdc++), else its characters, the terminator and the allocator's own overhead.
size_t string_cost(size_t length) { return length <= 15 ? 0 : length + 1 + 16; }

size_t text_length(JsonVariantConst value) { return value.is<const char *>() ? strlen(value.as<const char *>()) : 0; }

size_t array_size(JsonVariantConst list) { return list.is<JsonArrayConst>() ? list.as<JsonArrayConst>().size() : 0; }

// The memory the entries of a list will take once read, and the size of the vector's one block.
void list_cost(JsonVariantConst list, size_t &total, size_t &block)
{
  block = array_size(list) * sizeof(FileEntry);
  total = block;
  if (!list.is<JsonArrayConst>())
    return;
  for (JsonVariantConst item : list.as<JsonArrayConst>())
    total += string_cost(text_length(item["id"])) + string_cost(text_length(item["file"])) +
             string_cost(text_length(item["sha256"]));
}

bool is_app(JsonVariantConst item)
{
  return item["part"].is<const char *>() && strcmp(item["part"].as<const char *>(), "app") == 0;
}

size_t app_entries(JsonVariantConst list)
{
  size_t count = 0;
  if (list.is<JsonArrayConst>())
    for (JsonVariantConst item : list.as<JsonArrayConst>())
      count += is_app(item) ? 1 : 0;
  return count;
}

// The same for the `app` entries of the firmware list, the only ones kept.
void firmware_cost(JsonVariantConst list, size_t &total, size_t &block)
{
  block = app_entries(list) * sizeof(FirmwareEntry);
  total = block;
  if (!list.is<JsonArrayConst>())
    return;
  for (JsonVariantConst item : list.as<JsonArrayConst>())
    if (is_app(item))
      total += string_cost(text_length(item["board"])) + string_cost(text_length(item["file"])) +
               string_cost(text_length(item["sha256"]));
}

bool read_list(JsonVariantConst list, const char *name, std::vector<FileEntry> &out, std::string &reason,
               size_t maximum = MAX_MANIFEST_FILES)
{
  if (!list.is<JsonArrayConst>())
    return fail(reason, std::string(name) + " is missing or not a list");
  size_t index = 0;
  for (JsonVariantConst item : list.as<JsonArrayConst>())
  {
    const std::string where = std::string(name) + "[" + std::to_string(index++) + "]";
    if (out.size() >= maximum)
      return fail(reason, std::string(name) + " lists too many files");
    if (!item.is<JsonObjectConst>() || !item["id"].is<const char *>())
      return fail(reason, where + " has no id");
    if (out.empty())
      out.reserve(std::min(list.as<JsonArrayConst>().size(), maximum)); // one block, never regrown
    FileEntry entry;
    entry.id = item["id"].as<std::string>();
    if (!pixelart::is_valid_id(entry.id.c_str()))
      return fail(reason, where + " has an id that is not valid");
    if (!read_file_fields(item.as<JsonObjectConst>(), where, entry.file, entry.size, entry.sha256, reason))
      return false;
    for (const FileEntry &seen : out)
      if (seen.id == entry.id)
        return fail(reason, where + " repeats an id");
    out.push_back(std::move(entry));
  }
  return true;
}

} // namespace

size_t size_limit(Kind kind)
{
  switch (kind)
  {
  case Kind::Animation:
    return pixelart::MAX_FILE_SIZE;
  case Kind::Playlist:
    return pixelart::MAX_PLAYLIST_FILE_SIZE;
  case Kind::Schedule:
    return pixelart::MAX_SCHEDULE_FILE_SIZE;
  case Kind::Play:
    break;
  }
  return pixelart::MAX_PLAY_FILE_SIZE;
}

bool is_safe_relative_path(const std::string &path)
{
  if (path.empty() || path.size() > MAX_FILE_PATH)
    return false;
  size_t start = 0;
  for (;;)
  {
    const size_t slash = path.find('/', start);
    const std::string part = path.substr(start, slash == std::string::npos ? std::string::npos : slash - start);
    if (part.empty() || part == "." || part == "..")
      return false;
    for (char c : part)
      if (!is_path_char(c))
        return false;
    if (slash == std::string::npos)
      return true;
    start = slash + 1;
  }
}

bool parse_manifest(const char *json, size_t length, Manifest &out, std::string &reason)
{
  ManifestMemory unlimited;
  return parse_manifest(json, length, out, reason, unlimited);
}

bool parse_manifest(const char *json, size_t length, Manifest &out, std::string &reason, ManifestMemory &memory)
{
  if (length > MAX_MANIFEST_SIZE)
    return fail(reason, "the manifest is larger than 64 KiB");
  const char *strict_reason;
  size_t offset;
  if (!pixelart::check_strict_json(json, length, MAX_DEPTH, strict_reason, offset))
    return fail(reason, std::string("the manifest is not strict JSON: ") + strict_reason);

  memory.out_of_memory = false;
  LimitedAllocator allocator(memory);
  JsonDocument filter(&allocator), doc(&allocator);
  make_filter(filter);
  const DeserializationError error = deserializeJson(doc, json, length, DeserializationOption::Filter(filter),
                                                     DeserializationOption::NestingLimit(MAX_DEPTH));
  if (memory.out_of_memory || filter.overflowed())
  {
    memory.out_of_memory = true;
    return fail(reason, "the manifest does not fit in memory");
  }
  if (error)
    return fail(reason, std::string("the manifest cannot be read: ") + error.c_str());
  if (memory.release_input)
    memory.release_input(); // the document copied what it keeps
  if (!doc.is<JsonObject>())
    return fail(reason, "the manifest is not an object");
  if (!doc["format"].is<const char *>() || strcmp(doc["format"].as<const char *>(), MANIFEST_FORMAT) != 0)
    return fail(reason, std::string("the format is not ") + MANIFEST_FORMAT);
  const size_t files = array_size(doc["animations"]) + array_size(doc["playlists"]) + array_size(doc["schedules"]) +
                       array_size(doc["play"]);
  if (files > MAX_MANIFEST_FILES)
    return fail(reason, "the manifest lists too many files");
  const char *names[] = {"animations", "playlists", "schedules", "play"};
  size_t page_count = 0, page_cost = 0, page_block = 0;
  if (doc.containsKey("content_pages"))
  {
    if (!doc["content_pages"].is<JsonObjectConst>())
      return fail(reason, "content_pages is not an object");
    JsonObjectConst pages = doc["content_pages"];
    for (JsonPairConst pair : pages)
    {
      size_t kind = 0;
      while (kind < 4 && strcmp(pair.key().c_str(), names[kind]) != 0)
        kind++;
      if (kind == 4 || !pair.value().is<JsonArrayConst>())
        return fail(reason, "content_pages has an unknown kind or a kind that is not a list");
      page_count += pair.value().as<JsonArrayConst>().size();
      if (page_count > MAX_CONTENT_PAGES)
        return fail(reason, "content_pages lists too many pages");
      size_t cost, block_size;
      // The page references have the same three strings as file entries but a smaller vector element.
      list_cost(pair.value(), cost, block_size);
      page_cost += cost;
      page_block = std::max(page_block, pair.value().as<JsonArrayConst>().size() * sizeof(PageEntry));
    }
  }

  // Everything the manifest is copied into, asked for at once: the version (and the copies its check
  // makes), the lists of files and the `app` entries of the firmware.
  size_t total = 4 * string_cost(text_length(doc["version"])), block = 0;
  for (const char *name : {"animations", "playlists", "schedules", "play"})
  {
    size_t list_total, list_block;
    list_cost(doc[name], list_total, list_block);
    total += list_total;
    block = std::max(block, list_block);
  }
  size_t firmware_total, firmware_block;
  firmware_cost(doc["firmware"], firmware_total, firmware_block);
  total += firmware_total;
  block = std::max(block, firmware_block);
  total += page_cost;
  block = std::max(block, page_block);
  if (memory.affordable && !memory.affordable(total, block))
  {
    memory.out_of_memory = true;
    return fail(reason, "the manifest does not fit in memory");
  }

  Manifest manifest;
  Version parsed;
  if (!doc["version"].is<const char *>() || !parse_version(doc["version"].as<std::string>(), parsed))
    return fail(reason, "the version is missing or not a Semantic Version");
  manifest.version = doc["version"].as<std::string>();
  if (!read_list(doc["animations"], "animations", manifest.animations, reason) ||
      !read_list(doc["playlists"], "playlists", manifest.playlists, reason))
    return false;
  if (doc["schedules"].is<JsonArrayConst>() && !read_list(doc["schedules"], "schedules", manifest.schedules, reason))
    return false;
  if (doc["play"].is<JsonArrayConst>() && !read_list(doc["play"], "play", manifest.play, reason))
    return false;
  if (doc.containsKey("content_pages"))
  {
    JsonObjectConst pages = doc["content_pages"];
    for (size_t kind = 0; kind < 4; kind++)
    {
      if (!pages.containsKey(names[kind]))
        continue;
      manifest.paged[kind] = true;
      JsonArrayConst list = pages[names[kind]].as<JsonArrayConst>();
      manifest.pages[kind].reserve(list.size());
      size_t index = 0;
      for (JsonVariantConst item : list)
      {
        const std::string where = std::string("content_pages.") + names[kind] + "[" + std::to_string(index++) + "]";
        if (!item.is<JsonObjectConst>())
          return fail(reason, where + " is not an object");
        PageEntry page;
        if (!read_file_fields(item.as<JsonObjectConst>(), where, page.file, page.size, page.sha256, reason))
          return false;
        if (page.size > MAX_CONTENT_PAGE_SIZE)
          return fail(reason, where + " is too large");
        for (size_t previous = 0; previous <= kind; previous++)
          for (const PageEntry &seen : manifest.pages[previous])
            if (seen.file == page.file)
              return fail(reason, where + " repeats a page path");
        manifest.pages[kind].push_back(std::move(page));
      }
    }
  }

  if (doc["firmware"].is<JsonArrayConst>()) // the filter drops a firmware that is not a list
  {
    manifest.firmware.reserve(app_entries(doc["firmware"]));
    size_t index = 0;
    for (JsonVariantConst item : doc["firmware"].as<JsonArrayConst>())
    {
      const std::string where = "firmware[" + std::to_string(index++) + "]";
      if (!item.is<JsonObjectConst>() || !item["board"].is<const char *>() || !item["part"].is<const char *>())
        return fail(reason, where + " lacks board or part");
      if (!is_app(item))
        continue;
      FirmwareEntry entry;
      entry.board = item["board"].as<std::string>();
      if (!read_file_fields(item.as<JsonObjectConst>(), where, entry.file, entry.size, entry.sha256, reason))
        return false;
      manifest.firmware.push_back(std::move(entry));
    }
  }
  out = std::move(manifest);
  return true;
}

bool parse_content_page(const char *json, size_t length, Kind kind, std::vector<FileEntry> &out, std::string &reason,
                        ManifestMemory &memory)
{
  if (length > MAX_CONTENT_PAGE_SIZE)
    return fail(reason, "the content page is larger than 8 KiB");
  const char *strict_reason;
  size_t offset;
  if (!pixelart::check_strict_json(json, length, MAX_DEPTH, strict_reason, offset))
    return fail(reason, std::string("the content page is not strict JSON: ") + strict_reason);
  memory.out_of_memory = false;
  LimitedAllocator allocator(memory);
  JsonDocument doc(&allocator);
  const DeserializationError error = deserializeJson(doc, json, length, DeserializationOption::NestingLimit(MAX_DEPTH));
  if (memory.out_of_memory)
  {
    memory.out_of_memory = true;
    return fail(reason, "the content page does not fit in memory");
  }
  if (error)
    return fail(reason, std::string("the content page cannot be read: ") + error.c_str());
  if (memory.release_input)
    memory.release_input();
  const char *names[] = {"animations", "playlists", "schedules", "play"};
  const size_t index = static_cast<size_t>(kind);
  if (!doc.is<JsonObject>() || !doc["format"].is<const char *>() ||
      strcmp(doc["format"].as<const char *>(), CONTENT_PAGE_FORMAT) != 0 || !doc["kind"].is<const char *>() ||
      strcmp(doc["kind"].as<const char *>(), names[index]) != 0 || !doc["entries"].is<JsonArrayConst>())
    return fail(reason, "the content page has a wrong format, kind or entries");
  const size_t count = doc["entries"].as<JsonArrayConst>().size();
  if (count == 0 || count > MAX_CONTENT_PAGE_ENTRIES)
    return fail(reason, "the content page lists too many files");
  for (JsonPairConst pair : doc.as<JsonObjectConst>())
    if (strcmp(pair.key().c_str(), "format") != 0 && strcmp(pair.key().c_str(), "kind") != 0 &&
        strcmp(pair.key().c_str(), "entries") != 0)
      return fail(reason, "the content page has an unknown field");
  for (JsonVariantConst item : doc["entries"].as<JsonArrayConst>())
  {
    if (!item.is<JsonObjectConst>())
      return fail(reason, "the content page has an entry that is not an object");
    JsonObjectConst object = item.as<JsonObjectConst>();
    for (JsonPairConst pair : object)
    {
      const char *key = pair.key().c_str();
      if (strcmp(key, "id") != 0 && strcmp(key, "file") != 0 && strcmp(key, "size") != 0 &&
          strcmp(key, "sha256") != 0 && !(kind != Kind::Play && strcmp(key, "name") == 0) &&
          !(kind == Kind::Animation && strcmp(key, "version") == 0))
        return fail(reason, "the content page has an unknown entry field");
    }
    if (kind == Kind::Animation &&
        (!object["version"].is<uint32_t>() || object["version"].as<uint32_t>() < 1 ||
         object["version"].as<uint32_t>() > INT32_MAX || !object["name"].is<const char *>() ||
         !*object["name"].as<const char *>() || pixelart::utf8_code_points(object["name"].as<const char *>()) > 128))
      return fail(reason, "the content page has an invalid animation name or version");
    if (kind != Kind::Animation && kind != Kind::Play && object.containsKey("name") &&
        (!object["name"].is<const char *>() || !*object["name"].as<const char *>() ||
         pixelart::utf8_code_points(object["name"].as<const char *>()) > 128))
      return fail(reason, "the content page has an invalid name");
  }
  size_t total, block;
  list_cost(doc["entries"], total, block);
  if (memory.affordable && !memory.affordable(total, block))
  {
    memory.out_of_memory = true;
    return fail(reason, "the content page does not fit in memory");
  }
  std::vector<FileEntry> entries;
  if (!read_list(doc["entries"], "entries", entries, reason, MAX_CONTENT_PAGE_ENTRIES))
    return false;
  for (const FileEntry &entry : entries)
    if (entry.file != std::string(names[index]) + "/" + entry.id + ".json" || entry.size > size_limit(kind))
      return fail(reason, "the content page has a file path or size that does not match its kind and id");
  out = std::move(entries);
  return true;
}

bool parse_url(const std::string &text, Url &out)
{
  Url url;
  size_t at;
  if (text.compare(0, 8, "https://") == 0)
  {
    url.secure = true;
    at = 8;
  }
  else if (text.compare(0, 7, "http://") == 0)
    at = 7;
  else
    return false;
  for (char c : text)
    if ((unsigned char)c <= 0x20 || (unsigned char)c >= 0x7F)
      return false;
  const size_t end = text.find_first_of("/?#", at);
  url.authority = text.substr(at, end == std::string::npos ? std::string::npos : end - at);
  if (url.authority.empty() || url.authority.find('@') != std::string::npos)
    return false;
  if (end != std::string::npos && text[end] == '/')
  {
    const size_t cut = text.find_first_of("?#", end);
    url.path = text.substr(end, cut == std::string::npos ? std::string::npos : cut - end);
  }
  else
    url.path = "/";
  out = url;
  return true;
}

bool resolve_file_url(const std::string &manifest_url, const std::string &relative, std::string &out)
{
  Url base;
  if (!parse_url(manifest_url, base) || !is_safe_relative_path(relative))
    return false;
  const std::string folder = base.path.substr(0, base.path.rfind('/') + 1);
  out = std::string(base.secure ? "https://" : "http://") + base.authority + folder + relative;
  return true;
}

bool resolve_redirect(const std::string &current_url, const std::string &location, bool allow_http, std::string &next)
{
  Url current;
  if (!parse_url(current_url, current) || location.empty())
    return false;
  const std::string scheme = current.secure ? "https:" : "http:";
  std::string target;
  if (location.compare(0, 2, "//") == 0)
    target = scheme + location;
  else if (location[0] == '/')
    target = scheme + "//" + current.authority + location;
  else if (location.find("://") != std::string::npos)
    target = location;
  else
    target = scheme + "//" + current.authority + current.path.substr(0, current.path.rfind('/') + 1) + location;
  Url resolved;
  if (!parse_url(target, resolved) || (!resolved.secure && (!allow_http || current.secure)))
    return false;
  next = target;
  return true;
}

namespace
{

// Copies the entries of `manifest` into the plan, or moves them out of it when `Entries` is not const.
template <typename ManifestType> std::vector<PlanItem> plan_entries(ManifestType &manifest, const StoredDigest &stored)
{
  std::vector<PlanItem> plan;
  plan.reserve(manifest.animations.size() + manifest.playlists.size() + manifest.schedules.size() +
               manifest.play.size()); // one block, never regrown
  // A playlist finds its animations, a schedule its playlists, and a play file its schedule or playlists.
  for (Kind kind : {Kind::Animation, Kind::Playlist, Kind::Schedule, Kind::Play})
    for (auto &entry : kind == Kind::Animation  ? manifest.animations
                       : kind == Kind::Playlist ? manifest.playlists
                       : kind == Kind::Schedule ? manifest.schedules
                                                : manifest.play)
    {
      std::string have;
      const bool is_stored = stored(kind, entry.id, have);
      if (is_stored && have == entry.sha256)
        continue;
      PlanItem item;
      item.kind = kind;
      item.size = entry.size;
      item.replace = is_stored;
      if constexpr (std::is_const_v<ManifestType>)
      {
        item.id = entry.id;
        item.file = entry.file;
        item.sha256 = entry.sha256;
      }
      else
      {
        item.id = std::move(entry.id);
        item.file = std::move(entry.file);
        item.sha256 = std::move(entry.sha256);
      }
      plan.push_back(std::move(item));
    }
  return plan;
}

} // namespace

std::vector<PlanItem> plan_sync(const Manifest &manifest, const StoredDigest &stored)
{
  return plan_entries(manifest, stored);
}

std::vector<PlanItem> plan_sync(Manifest &manifest, const StoredDigest &stored)
{
  return plan_entries(manifest, stored);
}

size_t plan_block(const Manifest &manifest)
{
  return (manifest.animations.size() + manifest.playlists.size() + manifest.schedules.size() + manifest.play.size()) *
         sizeof(PlanItem);
}

const FirmwareEntry *find_firmware(const Manifest &manifest, const std::string &board)
{
  for (const FirmwareEntry &entry : manifest.firmware)
    if (entry.board == board)
      return &entry;
  return nullptr;
}

bool firmware_available(const Manifest &manifest, const std::string &board, const std::string &running,
                        const std::string &skipped, bool force)
{
  if (!find_firmware(manifest, board) || !is_newer_version(manifest.version, running))
    return false;
  return force || skipped.empty() || manifest.version != skipped;
}

} // namespace pixelart_update
