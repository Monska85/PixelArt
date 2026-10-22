// SPDX-License-Identifier: GPL-3.0-or-later

#include "protocol.h"

#include <Arduino.h>
#include <ArduinoJson.h>
#include <pixel_codec.h>
#include <pixelart_engine.h>
#include <strict_json.h>

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <optional>

#include "app.h"
#include "platform.h"
#include "settings.h"
#include "storage.h"

namespace protocol
{

namespace
{

const char MARKER[] = "@PR ";
constexpr size_t MARKER_SIZE = 4;
constexpr size_t CRC_DIGITS = 8;
constexpr size_t MAX_NESTING = 4;
constexpr size_t MAX_SHA256_DIGITS = 64;
constexpr size_t MAX_LIST_NAME = 128;
constexpr size_t MAX_DIAGNOSTIC_TEXT = 160;
constexpr size_t MAX_DIAGNOSTIC_BYTES = 192;
constexpr size_t MAX_BYTES_PER_POLL = 512;
const char *TEMP_FILE = "/upload.tmp";
const char OUT_OF_MEMORY_MESSAGE[] = "not enough free memory to validate the file";

// Memory a file needs for validation: one block for the file, and the parsed
// document, which is a small multiple of the file. Rough values to tune with
// the memory measured on the board.
constexpr size_t BLOCK_MARGIN = 1024;
constexpr size_t PARSE_FACTOR = 4;
constexpr size_t PARSE_MARGIN = 8192;

enum class Kind
{
  Animation,
  Playlist
};

struct Upload
{
  bool active = false;
  Kind kind = Kind::Animation;
  std::string target;
  size_t size = 0;
  size_t received = 0;
  std::string sha256;
  pixelart::Sha256 hash;
  uint64_t last_progress_us = 0;
  storage::Writer writer; // the temporary file, open from put_begin until the upload ends
};

// The last reply, for requests that come again after their reply was lost.
struct Cache
{
  bool valid = false;
  uint32_t seq = 0;
  uint32_t crc = 0;
  std::string reply;
};

// Outcome of a command: no `code` means success.
struct Status
{
  const char *code = nullptr;
  std::string message;
};

Status fail(const char *code, std::string message) { return {code, std::move(message)}; }

Upload upload;
Cache cache;
LineReader reader;
uint32_t boot_id = 0;

Memory platform_memory() { return {platform::free_heap(), platform::max_alloc()}; }
MemoryProbe memory_probe = platform_memory;

size_t size_limit(Kind kind)
{
  return kind == Kind::Animation ? pixelart::MAX_FILE_SIZE : pixelart::MAX_PLAYLIST_FILE_SIZE;
}

std::string file_path(Kind kind, const std::string &id)
{
  return kind == Kind::Animation ? animation_file(id) : playlist_file(id);
}

// Every byte that is not part of a well-formed UTF-8 sequence becomes U+FFFD,
// so a reply is always valid UTF-8 whatever a file or a request contained.
std::string valid_utf8(const std::string &text)
{
  std::string out;
  out.reserve(text.size());
  for (size_t i = 0; i < text.size();)
  {
    if (size_t length = pixelart::utf8_sequence_length(text.data(), text.size(), i))
    {
      out.append(text, i, length);
      i += length;
    }
    else
    {
      out += "\xEF\xBF\xBD";
      i++;
    }
  }
  return out;
}

// ArduinoJson escapes only \b, \f, \n, \r and \t among the control characters
// and writes the others raw, which strict JSON forbids. Compact JSON syntax has
// no control character, so each one is inside a string and becomes a \u00XX
// escape: the text is kept and the reply stays strict JSON.
std::string escape_controls(const std::string &json)
{
  std::string out;
  out.reserve(json.size());
  for (char c : json)
  {
    if ((unsigned char)c < 0x20)
    {
      char escape[7];
      snprintf(escape, sizeof(escape), "\\u%04x", (unsigned)c);
      out += escape;
    }
    else
      out += c;
  }
  return out;
}

// Serializes a reply body and adds the frame: "@PR <crc> <json>". Anything
// quoted from a file or a request is made valid UTF-8 and strict JSON first:
// the JSON syntax is ASCII, so only string contents can change.
std::string frame(JsonDocument &body)
{
  std::string json;
  serializeJson(body, json);
  json = escape_controls(valid_utf8(json));
  char head[MARKER_SIZE + CRC_DIGITS + 2];
  snprintf(head, sizeof(head), "%s%08x ", MARKER, (unsigned)pixelart::crc32(json.data(), json.size()));
  return head + json;
}

void set_error(JsonDocument &body, const char *code, const std::string &message)
{
  body["ok"] = false;
  body["error"] = code;
  body["message"] = message;
}

// A reply that carries no `seq`: the request was not understood far enough to have one.
std::string error_frame(const char *code, const char *message)
{
  JsonDocument body;
  set_error(body, code, message);
  return frame(body);
}

std::string bad_frame(const char *message) { return error_frame("bad_frame", message); }

// Checks that `text` is one strict JSON object, with the same rules as a file
// (strict_json.h), nesting at most MAX_NESTING levels.
bool is_strict_object(const std::string &text)
{
  const char *reason;
  size_t offset;
  size_t first = text.find_first_not_of(" \t\n\r");
  return first != std::string::npos && text[first] == '{' &&
         pixelart::check_strict_json(text.data(), text.size(), MAX_NESTING, reason, offset);
}

// ---- Fields of a request ----

// Fails on a field the command does not define.
Status allow_only(JsonObjectConst request, std::initializer_list<const char *> names)
{
  for (JsonPairConst field : request)
  {
    bool known = field.key() == "seq" || field.key() == "cmd";
    for (const char *name : names)
      known = known || field.key() == name;
    if (!known)
      return fail("bad_request", std::string("unknown field \"") + field.key().c_str() + "\"");
  }
  return {};
}

// A required or optional text field. A missing optional field leaves `out` alone.
Status get_text(JsonObjectConst request, const char *key, bool required, std::string &out, bool &present)
{
  JsonVariantConst value = request[key];
  present = !value.isNull();
  if (!present)
    return required ? fail("bad_request", std::string("missing field \"") + key + "\"") : Status{};
  if (!value.is<const char *>())
    return fail("bad_request", std::string("\"") + key + "\" must be text");
  out = value.as<std::string>();
  return {};
}

Status get_text(JsonObjectConst request, const char *key, std::string &out)
{
  bool present;
  return get_text(request, key, true, out, present);
}

Status get_number(JsonObjectConst request, const char *key, uint32_t &out)
{
  JsonVariantConst value = request[key];
  if (value.isNull())
    return fail("bad_request", std::string("missing field \"") + key + "\"");
  if (!value.is<uint32_t>())
    return fail("bad_request", std::string("\"") + key + "\" must be a whole number");
  out = value.as<uint32_t>();
  return {};
}

Status get_kind(JsonObjectConst request, Kind &kind)
{
  std::string text;
  if (Status s = get_text(request, "kind", text); s.code)
    return s;
  if (text == "animation")
    kind = Kind::Animation;
  else if (text == "playlist")
    kind = Kind::Playlist;
  else
    return fail("invalid_kind", "kind must be \"animation\" or \"playlist\"");
  return {};
}

Status check_id(const std::string &id, const char *field)
{
  if (!pixelart::is_valid_id(id.c_str()))
    return fail("invalid_id", std::string("\"") + field + "\" is not a valid ID");
  return {};
}

// `kind` and `id` of a command that names a file.
Status get_file(JsonObjectConst request, Kind &kind, std::string &id)
{
  if (Status s = get_kind(request, kind); s.code)
    return s;
  if (Status s = get_text(request, "id", id); s.code)
    return s;
  return check_id(id, "id");
}

bool is_lower_hex(const std::string &text, size_t digits)
{
  if (text.size() != digits)
    return false;
  for (char c : text)
    if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')))
      return false;
  return true;
}

// A diagnostic text made valid UTF-8 and cut after MAX_DIAGNOSTIC_TEXT
// characters, or sooner when it would take more than MAX_DIAGNOSTIC_BYTES once
// written in JSON (as frame writes it), never inside a character: 32
// diagnostics then keep a reply under 16 KiB whatever the file holds.
std::string diagnostic_text(const std::string &raw)
{
  const std::string text = valid_utf8(raw);
  size_t characters = 0, written = 0, start = 0;
  for (size_t i = 0; i < text.size(); i++)
  {
    unsigned char c = text[i];
    if ((c & 0xC0) != 0x80)
    {
      start = i;
      if (++characters > MAX_DIAGNOSTIC_TEXT)
        return text.substr(0, i);
    }
    if (c == '"' || c == '\\' || c == '\b' || c == '\f' || c == '\n' || c == '\r' || c == '\t')
      written += 2;
    else
      written += c < 0x20 ? 6 : 1; // \u00XX
    if (written > MAX_DIAGNOSTIC_BYTES)
      return text.substr(0, start);
  }
  return text;
}

void add_diagnostics(JsonArray out, const std::vector<pixelart::Diagnostic> &diagnostics)
{
  for (const pixelart::Diagnostic &d : diagnostics)
  {
    if (out.size() >= pixelart::MAX_DIAGNOSTICS)
      break;
    JsonObject item = out.add<JsonObject>();
    item["severity"] = d.severity == pixelart::Severity::Error ? "error" : "warning";
    item["code"] = d.code;
    item["where"] = diagnostic_text(d.where);
    item["message"] = diagnostic_text(d.message);
  }
}

// ---- Uploads ----

void cancel_upload()
{
  upload.writer.close();
  if (upload.active)
    storage::remove(TEMP_FILE);
  upload.active = false;
}

// Ends an upload whose client went quiet.
void expire_upload()
{
  if (upload.active && platform::now_us() - upload.last_progress_us >= (uint64_t)UPLOAD_IDLE_MS * 1000)
    cancel_upload();
}

bool has_memory_for(size_t size)
{
  Memory memory = memory_probe();
  if (memory.free == 0 && memory.largest == 0)
    return true;
  return memory.largest >= size + BLOCK_MARGIN && memory.free >= size * PARSE_FACTOR + PARSE_MARGIN;
}

// Adds an `unknown_animation` warning for each animation a playlist names
// that is not stored.
void warn_unknown_animations(const pixelart::Playlist &playlist, std::vector<pixelart::Diagnostic> &diagnostics)
{
  std::vector<std::string> seen;
  for (const pixelart::PlaylistItem &item : playlist.items())
  {
    if (std::find(seen.begin(), seen.end(), item.animation) != seen.end())
      continue;
    seen.push_back(item.animation);
    if (!storage::exists(animation_file(item.animation)))
      diagnostics.push_back(
          {pixelart::Severity::Warning, "unknown_animation", "", "\"" + item.animation + "\" is not stored"});
  }
}

// ---- Commands ----

Status cmd_info(JsonObjectConst request, JsonDocument &reply)
{
  if (Status s = allow_only(request, {}); s.code)
    return s;
  Memory memory = memory_probe();
  reply["protocol"] = 1;
  reply["firmware"] = platform::firmware_version();
  reply["board"] = platform::board_name();
  reply["boot_id"] = boot_id;
  reply["formats"]["animation"].add("pixelart/1");
  reply["formats"]["playlist"].add("pixelart-playlist/1");
  reply["canvas"]["width"] = pixelart::CANVAS_WIDTH;
  reply["canvas"]["height"] = pixelart::CANVAS_HEIGHT;
  reply["storage"]["total"] = storage::total_bytes();
  reply["storage"]["used"] = storage::used_bytes();
  reply["memory"]["free"] = memory.free;
  reply["memory"]["largest"] = memory.largest;
  reply["limits"]["line"] = MAX_LINE;
  reply["limits"]["chunk"] = MAX_CHUNK;
  reply["limits"]["page"] = PAGE_SIZE;
  reply["limits"]["animation"] = pixelart::MAX_FILE_SIZE;
  reply["limits"]["playlist"] = pixelart::MAX_PLAYLIST_FILE_SIZE;
  return {};
}

// First `limit` characters of a valid UTF-8 text, never cutting a character in half.
std::string truncate_text(const std::string &text, size_t limit)
{
  size_t characters = 0, bytes = 0;
  for (; bytes < text.size(); bytes++)
    if (((unsigned char)text[bytes] & 0xC0) != 0x80 && ++characters > limit)
      break;
  return text.substr(0, bytes);
}

// SHA-256 of an open file, read piece by piece.
bool hash_file(storage::Reader &file, std::string &digest)
{
  pixelart::Sha256 hash;
  uint8_t block[MAX_CHUNK];
  for (size_t offset = 0; offset < file.size();)
  {
    size_t got = file.read_at(offset, block, std::min(sizeof(block), file.size() - offset));
    if (got == 0)
      return false;
    hash.update(block, got);
    offset += got;
  }
  digest = hash.hex_digest();
  return true;
}

// SHA-256 of an open file, or "" if it cannot be read. A file within its size
// limit is read once into `buffer`, which describe_file then parses; a larger
// one is hashed piece by piece and `buffer` stays empty.
std::string file_digest(Kind kind, storage::Reader &file, storage::Buffer &buffer)
{
  if (file.size() <= size_limit(kind) && file.read_all(buffer, size_limit(kind)) == storage::ReadResult::Ok)
  {
    pixelart::Sha256 hash;
    hash.update(buffer.data.get(), buffer.size);
    return hash.hex_digest();
  }
  buffer = storage::Buffer();
  std::string digest;
  hash_file(file, digest);
  return digest;
}

// Adds `name` and `version` from the content of a file. A file that does not
// parse adds nothing.
void add_metadata(Kind kind, const storage::Buffer &buffer, JsonObject entry)
{
  JsonDocument filter;
  filter["name"] = true;
  filter["version"] = true;
  JsonDocument doc;
  if (deserializeJson(doc, buffer.data.get(), buffer.size, DeserializationOption::Filter(filter),
                      DeserializationOption::NestingLimit(32)) ||
      !doc.is<JsonObject>())
    return;
  if (doc["name"].is<const char *>())
    entry["name"] = truncate_text(valid_utf8(doc["name"].as<const char *>()), MAX_LIST_NAME);
  if (kind == Kind::Animation)
  {
    if (doc["version"].isNull())
      entry["version"] = 1;
    else if (doc["version"].is<uint32_t>())
      entry["version"] = doc["version"].as<uint32_t>();
  }
}

// One entry of a `list` reply. What cannot be read from the file is left out,
// so a damaged file is still listed.
void describe_file(Kind kind, const std::string &id, JsonObject entry)
{
  const std::string path = file_path(kind, id);
  entry["id"] = id;
  // One open gives the size, the digest and the metadata.
  storage::Reader file;
  if (file.open(path) != storage::ReadResult::Ok)
  {
    size_t size;
    if (storage::file_size(path, size))
      entry["size"] = size;
    return;
  }
  entry["size"] = file.size();

  storage::Buffer buffer;
  std::string digest = file_digest(kind, file, buffer);
  if (!digest.empty())
    entry["sha256"] = digest;
  if (buffer.data)
    add_metadata(kind, buffer, entry);
}

Status cmd_list(JsonObjectConst request, JsonDocument &reply)
{
  if (Status s = allow_only(request, {"kind", "after"}); s.code)
    return s;
  Kind kind;
  if (Status s = get_kind(request, kind); s.code)
    return s;
  std::string after;
  bool has_after;
  if (Status s = get_text(request, "after", false, after, has_after); s.code)
    return s;
  if (has_after)
    if (Status s = check_id(after, "after"); s.code)
      return s;

  std::vector<std::string> ids = kind == Kind::Animation ? stored_animations() : stored_playlists();
  // Ids sort differently from file names (`a-b.json` before `a.json`), and paging goes by id.
  std::sort(ids.begin(), ids.end());
  reply["kind"] = kind == Kind::Animation ? "animation" : "playlist";
  JsonArray entries = reply["entries"].to<JsonArray>();
  bool more = false;
  for (const std::string &id : ids)
  {
    if (has_after && id <= after)
      continue;
    if (entries.size() == PAGE_SIZE)
    {
      more = true;
      break;
    }
    describe_file(kind, id, entries.add<JsonObject>());
  }
  reply["more"] = more;
  return {};
}

Status cmd_get(JsonObjectConst request, JsonDocument &reply)
{
  if (Status s = allow_only(request, {"kind", "id", "offset", "length"}); s.code)
    return s;
  Kind kind;
  std::string id;
  uint32_t offset, length;
  if (Status s = get_file(request, kind, id); s.code)
    return s;
  if (Status s = get_number(request, "offset", offset); s.code)
    return s;
  if (Status s = get_number(request, "length", length); s.code)
    return s;
  if (length < 1 || length > MAX_CHUNK)
    return fail("bad_request", "length must be from 1 to " + std::to_string(MAX_CHUNK));

  const std::string path = file_path(kind, id);
  storage::Reader file;
  switch (file.open(path))
  {
  case storage::ReadResult::Ok:
    break;
  case storage::ReadResult::Missing:
    return fail("not_found", "no such file");
  default:
    return fail("storage_error", "the file cannot be opened");
  }
  if (offset > file.size())
    return fail("bad_request", "offset is past the end of the file");

  uint8_t block[MAX_CHUNK];
  size_t wanted = std::min<size_t>(length, file.size() - offset);
  if (file.read_at(offset, block, wanted) != wanted)
    return fail("storage_error", "the file cannot be read");
  reply["size"] = file.size();
  reply["offset"] = offset;
  reply["data"] = pixelart::base64_encode(block, wanted);
  return {};
}

Status cmd_put_begin(JsonObjectConst request, JsonDocument &)
{
  // A new upload replaces the old one even when the request is refused.
  cancel_upload();
  if (Status s = allow_only(request, {"kind", "id", "size", "sha256"}); s.code)
    return s;
  Kind kind;
  std::string id, sha256;
  uint32_t size;
  if (Status s = get_file(request, kind, id); s.code)
    return s;
  if (Status s = get_number(request, "size", size); s.code)
    return s;
  if (Status s = get_text(request, "sha256", sha256); s.code)
    return s;
  if (size < 1)
    return fail("bad_request", "size must be at least 1");
  if (!is_lower_hex(sha256, MAX_SHA256_DIGITS))
    return fail("bad_request", "sha256 must be 64 lowercase hexadecimal digits");
  if (size > size_limit(kind))
    return fail("too_large", "size is over " + std::to_string(size_limit(kind)) + " bytes");

  size_t needed = (size + storage::BLOCK_SIZE - 1) / storage::BLOCK_SIZE * storage::BLOCK_SIZE;
  size_t total = storage::total_bytes(), used = storage::used_bytes();
  if (total < used || total - used < needed)
    return fail("no_space", "not enough free space");
  if (!has_memory_for(size))
    return fail("out_of_memory", OUT_OF_MEMORY_MESSAGE);

  Upload fresh;
  if (!fresh.writer.open(TEMP_FILE))
  {
    storage::remove(TEMP_FILE);
    return fail("storage_error", "the temporary file cannot be created");
  }
  fresh.active = true;
  fresh.kind = kind;
  fresh.target = file_path(kind, id);
  fresh.size = size;
  fresh.sha256 = sha256;
  fresh.last_progress_us = platform::now_us();
  upload = std::move(fresh);
  return {};
}

Status cmd_put_chunk(JsonObjectConst request, JsonDocument &reply)
{
  if (Status s = allow_only(request, {"offset", "data"}); s.code)
    return s;
  uint32_t offset;
  std::string text, data;
  if (Status s = get_number(request, "offset", offset); s.code)
    return s;
  if (Status s = get_text(request, "data", text); s.code)
    return s;
  if (!pixelart::base64_decode(text.data(), text.size(), MAX_CHUNK, data) || data.empty())
    return fail("bad_request", "data must be base64 of 1 to " + std::to_string(MAX_CHUNK) + " bytes");
  if (!upload.active)
    return fail("no_upload", "no upload in progress");

  if (offset > upload.received)
  {
    reply["expected"] = upload.received;
    return fail("bad_offset", "the upload stands at " + std::to_string(upload.received));
  }
  if (offset < upload.received)
  {
    reply["received"] = upload.received; // already written: acknowledge again
    return {};
  }
  if (data.size() > upload.size - upload.received)
    return fail("too_large", "the chunk goes past the declared size");
  if (!upload.writer.write(data.data(), data.size()))
  {
    cancel_upload();
    return fail("storage_error", "the temporary file cannot be written");
  }
  upload.hash.update(data.data(), data.size());
  upload.received += data.size();
  upload.last_progress_us = platform::now_us();
  reply["received"] = upload.received;
  return {};
}

// Removes the temporary file when an upload ends, whatever the result.
struct TempFileGuard
{
  ~TempFileGuard() { storage::remove(TEMP_FILE); }
};

// Loads the temporary file with the engine, so the file in memory is gone
// before the rename. Fills `diagnostics`; a rejected file also gets them in
// the reply.
Status validate_temp_file(Kind kind, JsonDocument &reply, std::vector<pixelart::Diagnostic> &diagnostics)
{
  storage::Buffer buffer;
  switch (storage::read(TEMP_FILE, buffer, size_limit(kind)))
  {
  case storage::ReadResult::Ok:
    break;
  case storage::ReadResult::OutOfMemory:
    return fail("out_of_memory", OUT_OF_MEMORY_MESSAGE);
  default:
    return fail("storage_error", "the temporary file cannot be read");
  }

  bool valid;
  if (kind == Kind::Animation)
  {
    pixelart::Animation animation;
    valid = animation.load(buffer.data.get(), buffer.size, diagnostics);
  }
  else
  {
    pixelart::Playlist playlist;
    valid = playlist.load(buffer.data.get(), buffer.size, diagnostics);
    if (valid)
      warn_unknown_animations(playlist, diagnostics);
  }
  if (valid)
    return {};
  add_diagnostics(reply["diagnostics"].to<JsonArray>(), diagnostics);
  return fail("invalid_file",
              kind == Kind::Animation ? "the file is not a valid animation" : "the file is not a valid playlist");
}

Status cmd_put_end(JsonObjectConst request, JsonDocument &reply)
{
  if (Status s = allow_only(request, {}); s.code)
    return s;
  if (!upload.active)
    return fail("no_upload", "no upload in progress");

  Upload done = std::move(upload);
  upload.active = false;
  TempFileGuard guard;
  done.writer.close();

  if (done.received != done.size)
    return fail("size_mismatch",
                "received " + std::to_string(done.received) + " bytes of " + std::to_string(done.size));
  if (done.hash.hex_digest() != done.sha256)
    return fail("checksum_mismatch", "the SHA-256 of the data differs from the declared one");
  size_t stored = 0;
  if (!storage::file_size(TEMP_FILE, stored) || stored != done.size)
    return fail("storage_error", "the temporary file cannot be read");
  if (!has_memory_for(done.size))
    return fail("out_of_memory", OUT_OF_MEMORY_MESSAGE);

  std::vector<pixelart::Diagnostic> diagnostics;
  if (Status s = validate_temp_file(done.kind, reply, diagnostics); s.code)
    return s;

  if (!storage::rename(TEMP_FILE, done.target))
    return fail("storage_error", "the file cannot be stored");
  if (done.kind == Kind::Playlist)
    request_playlist_reload();
  add_diagnostics(reply["warnings"].to<JsonArray>(), diagnostics);
  return {};
}

Status cmd_put_abort(JsonObjectConst request, JsonDocument &)
{
  if (Status s = allow_only(request, {}); s.code)
    return s;
  cancel_upload();
  return {};
}

Status cmd_delete(JsonObjectConst request, JsonDocument &)
{
  if (Status s = allow_only(request, {"kind", "id"}); s.code)
    return s;
  Kind kind;
  std::string id;
  if (Status s = get_file(request, kind, id); s.code)
    return s;
  const std::string path = file_path(kind, id);
  if (!storage::exists(path))
    return fail("not_found", "no such file");
  if (!storage::remove(path))
    return fail("storage_error", "the file cannot be removed");
  if (kind == Kind::Playlist)
    request_playlist_reload();
  return {};
}

// Removes every file in `folder`, whatever its name, and counts them. Stops at
// the first file that cannot be removed.
bool remove_all_files(const char *folder, size_t &count)
{
  count = 0;
  for (const std::string &name : storage::list(folder))
  {
    if (!storage::remove(std::string(folder) + "/" + name))
      return false;
    count++;
  }
  return true;
}

// Saves the given settings, all or nothing: the playlist is saved first, and
// put back if the brightness cannot be saved. When the settings memory also
// refuses the playlist back, the new playlist stays and the message says so.
// Returns the storage_error message, or nullptr when every setting is saved.
const char *save_settings(const std::optional<std::string> &playlist, std::optional<uint8_t> brightness)
{
  const std::string previous = settings::playlist();
  bool restart = playlist && *playlist != previous;
  if (playlist && !settings::set_playlist(*playlist))
    return "the settings cannot be saved";
  const char *failure = nullptr;
  if (brightness && !settings::set_brightness(*brightness))
  {
    failure = "the settings cannot be saved";
    if (playlist && !settings::set_playlist(previous))
      failure = "the settings cannot be saved and may be partly changed";
    else
      restart = false; // the previous playlist is back: playback keeps it
  }
  if (restart)
    request_playlist_reload(); // playback follows the playlist that is now set
  return failure;
}

void add_settings(JsonDocument &reply)
{
  reply["settings"]["brightness"] = settings::brightness();
  reply["settings"]["playlist"] = settings::playlist();
}

Status cmd_delete_all(JsonObjectConst request, JsonDocument &reply)
{
  if (Status s = allow_only(request, {"settings"}); s.code)
    return s;
  // A missing field means false; any value but true or false, null included, is refused.
  JsonVariantConst settings_field = request["settings"];
  if (!settings_field.isUnbound() && !settings_field.is<bool>())
    return fail("bad_request", "settings must be true or false");
  bool reset = settings_field.as<bool>();
  cancel_upload();
  size_t playlists = 0, animations = 0;
  bool done = remove_all_files(PLAYLISTS_FOLDER, playlists) && remove_all_files(ANIMATIONS_FOLDER, animations);
  if (playlists > 0)
    request_playlist_reload();
  if (!done)
    return fail("storage_error", "a file cannot be removed");
  // The settings go back to their defaults only once every file is gone.
  if (reset)
  {
    if (const char *failure = save_settings(std::string(settings::DEFAULT_PLAYLIST), settings::DEFAULT_BRIGHTNESS))
      return fail("storage_error", std::string("the files are removed but ") + failure);
    add_settings(reply);
  }
  reply["playlists"] = playlists;
  reply["animations"] = animations;
  return {};
}

Status cmd_settings_get(JsonObjectConst request, JsonDocument &reply)
{
  if (Status s = allow_only(request, {}); s.code)
    return s;
  add_settings(reply);
  return {};
}

Status cmd_settings_set(JsonObjectConst request, JsonDocument &reply)
{
  if (Status s = allow_only(request, {"brightness", "playlist"}); s.code)
    return s;
  JsonVariantConst brightness = request["brightness"];
  JsonVariantConst playlist = request["playlist"];
  if (brightness.isUnbound() && playlist.isUnbound())
    return fail("bad_request", "give at least one setting");

  // Check everything before changing anything. A field given as null is of the wrong type.
  if (!brightness.isUnbound() && !brightness.is<uint8_t>())
    return fail("bad_request", "brightness must be a whole number from 0 to 255");
  std::string id;
  if (!playlist.isUnbound())
  {
    if (!playlist.is<const char *>())
      return fail("bad_request", "playlist must be text");
    id = playlist.as<std::string>();
    if (Status s = check_id(id, "playlist"); s.code)
      return s;
    if (!storage::exists(playlist_file(id)))
      return fail("not_found", "no such playlist");
  }

  std::optional<std::string> new_playlist;
  if (!playlist.isUnbound())
    new_playlist = id;
  std::optional<uint8_t> new_brightness;
  if (!brightness.isUnbound())
    new_brightness = brightness.as<uint8_t>();
  if (const char *failure = save_settings(new_playlist, new_brightness))
    return fail("storage_error", failure);
  add_settings(reply);
  return {};
}

struct Command
{
  const char *name;
  Status (*run)(JsonObjectConst, JsonDocument &);
};

const Command COMMANDS[] = {
    {"info", cmd_info},
    {"list", cmd_list},
    {"get", cmd_get},
    {"put_begin", cmd_put_begin},
    {"put_chunk", cmd_put_chunk},
    {"put_end", cmd_put_end},
    {"put_abort", cmd_put_abort},
    {"delete", cmd_delete},
    {"delete_all", cmd_delete_all},
    {"settings_get", cmd_settings_get},
    {"settings_set", cmd_settings_set},
};

// Runs a request that arrived intact and builds its reply.
std::string run_request(const std::string &json, uint32_t crc)
{
  JsonDocument request;
  if (!is_strict_object(json) ||
      deserializeJson(request, json.data(), json.size(), DeserializationOption::NestingLimit(MAX_NESTING)))
    return bad_frame("the JSON is broken, is not an object or nests too deeply");
  JsonObjectConst object = request.as<JsonObjectConst>();

  JsonVariantConst seq = object["seq"];
  JsonVariantConst cmd = object["cmd"];
  if (!seq.is<uint32_t>() || !cmd.is<const char *>())
    return error_frame("bad_request", "seq must be a whole number and cmd must be text");

  if (cache.valid && cache.seq == seq.as<uint32_t>() && cache.crc == crc)
    return cache.reply;

  JsonDocument reply;
  reply["seq"] = seq.as<uint32_t>();
  reply["ok"] = true;
  Status status = fail("unknown_command", "this firmware does not know the command");
  const std::string name = cmd.as<std::string>();
  for (const Command &command : COMMANDS)
    if (name == command.name)
      status = command.run(object, reply);
  if (status.code)
    set_error(reply, status.code, status.message);

  cache.valid = true;
  cache.seq = seq.as<uint32_t>();
  cache.crc = crc;
  cache.reply = frame(reply);
  return cache.reply;
}

void write_line(const std::string &reply)
{
  if (reply.empty())
    return;
  std::string line = reply + "\n";
  // One write, so the line never mixes with a log or mirror line. A line the
  // port cannot take is dropped; the client asks again. The flush sends the
  // whole line at once: without it, the ESP32-C3 USB serial port can hold the
  // end of a long line for seconds, until more output follows. Only that port
  // is flushed: on a UART, flush() waits for every byte at the baud rate.
  Serial.write(reinterpret_cast<const uint8_t *>(line.data()), line.size());
#if ARDUINO_USB_MODE && ARDUINO_USB_CDC_ON_BOOT
  Serial.flush();
#endif
}

} // namespace

#ifdef PIXELART_SIM
void set_memory_probe(MemoryProbe probe) { memory_probe = probe ? probe : platform_memory; }
#endif

LineReader::Event LineReader::feed(uint8_t byte)
{
  if (complete_)
    clear();
  if (byte != '\n')
  {
    // Room for a `\r` after the longest line.
    if (line_.size() <= MAX_LINE)
      line_ += (char)byte;
    else
      overflowed_ = true;
    return Event::None;
  }

  if (!line_.empty() && line_.back() == '\r')
    line_.pop_back();
  bool too_long = overflowed_ || line_.size() > MAX_LINE;
  bool is_protocol = line_.compare(0, MARKER_SIZE, MARKER) == 0;
  if (too_long)
    line_.clear();
  overflowed_ = false;
  if (too_long)
    return is_protocol ? Event::Overflow : Event::None;
  complete_ = true;
  return Event::Line;
}

void LineReader::clear()
{
  line_.clear();
  overflowed_ = false;
  complete_ = false;
}

void begin()
{
  reader.clear();
  upload = Upload();
  cache = Cache();
  storage::remove(TEMP_FILE);
  boot_id = platform::random32();
}

std::string handle_line(const std::string &line)
{
  expire_upload();
  if (line.compare(0, MARKER_SIZE, MARKER) != 0)
    return "";

  // "@PR ", 8 hex digits, a space, then the JSON.
  const size_t json_at = MARKER_SIZE + CRC_DIGITS + 1;
  if (line.size() <= json_at || line[json_at - 1] != ' ' ||
      !is_lower_hex(line.substr(MARKER_SIZE, CRC_DIGITS), CRC_DIGITS))
    return bad_frame("the checksum is malformed");
  uint32_t crc = (uint32_t)strtoul(line.substr(MARKER_SIZE, CRC_DIGITS).c_str(), nullptr, 16);
  std::string json = line.substr(json_at);
  if (pixelart::crc32(json.data(), json.size()) != crc)
    return bad_frame("checksum does not match");
  return run_request(json, crc);
}

std::string line_too_long() { return bad_frame("the line is too long"); }

void poll()
{
  expire_upload();
  for (size_t n = 0; n < MAX_BYTES_PER_POLL && Serial.available() > 0; n++)
  {
    int byte = Serial.read();
    if (byte < 0)
      return;
    LineReader::Event event = reader.feed((uint8_t)byte);
    if (event == LineReader::Event::None)
      continue;
    write_line(event == LineReader::Event::Line ? handle_line(reader.line()) : line_too_long());
    return;
  }
}

bool upload_active() { return upload.active; }

} // namespace protocol
