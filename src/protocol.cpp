// SPDX-License-Identifier: GPL-3.0-or-later

#include "protocol.h"

#include <Arduino.h>
#include <ArduinoJson.h>
#include <net_auth.h>
#include <pixel_codec.h>
#include <pixelart_engine.h>
#include <strict_json.h>

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <cstring>

#include "app.h"
#include "firmware.h"
#include "improv.h"
#include "install.h"
#include "network.h"
#include "platform.h"
#include "settings.h"
#include "storage.h"
#include "task_sync.h"
#include "updates.h"
#include "wifi_logic.h"
#include "ws_server.h"

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

using install::Kind;

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
  Transport owner = Transport::Usb; // the transport that began it: only that one continues or ends it
  storage::Writer writer;           // the temporary file, open from put_begin until the upload ends
};

// The last reply of one transport, for requests that come again after their reply was lost.
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
// One per transport: a request over one never replaces the reply remembered for the other,
// and a reply that holds the token is sent again only over USB.
Cache usb_cache, wifi_cache;
LineReader reader;
uint32_t boot_id = 0;
uint64_t last_byte_us = 0;
// The transport of the request being run, for the commands that differ by it.
Transport current_transport = Transport::Usb;

// The login of each transport. The WiFi one belongs to the connection that is open, if any. The USB one
// only answers `auth` as the WiFi one does: nothing over USB needs a login.
pixelart_net::AuthSession wifi_session;
pixelart_net::AuthSession usb_session;
// The WiFi connection was told to close and its close has not been reported yet: its lines are dropped.
bool wifi_closing = false;

pixelart_net::AuthSession &session_of(Transport transport)
{
  return transport == Transport::Wifi ? wifi_session : usb_session;
}

// Whether a request is one a WiFi client may send before it logs in.
bool allowed_before_login(const std::string &command)
{
  return command == "info" || command == "auth_challenge" || command == "auth";
}

// The WiFi client is closed after a new token: its login was made with the old one.
void close_wifi_client()
{
  wifi_session.reset();
  wifi_closing = true;
  network::close_client();
}

std::string file_path(Kind kind, const std::string &id)
{
  switch (kind)
  {
  case Kind::Animation:
    return animation_file(id);
  case Kind::Playlist:
    return playlist_file(id);
  case Kind::Schedule:
    break;
  }
  return schedule_file(id);
}

const char *kind_name(Kind kind)
{
  switch (kind)
  {
  case Kind::Animation:
    return "animation";
  case Kind::Playlist:
    return "playlist";
  case Kind::Schedule:
    break;
  }
  return "schedule";
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

// A required or optional text field. A missing optional field leaves `out` alone; a field that is present as
// `null` is not missing and fails as text of the wrong type.
Status get_text(JsonObjectConst request, const char *key, bool required, std::string &out, bool &present)
{
  JsonVariantConst value = request[key];
  present = !value.isUnbound();
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
  else if (text == "schedule")
    kind = Kind::Schedule;
  else
    return fail("invalid_kind", "kind must be \"animation\", \"playlist\" or \"schedule\"");
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

// An upload belongs to the transport that began it: the other one gets busy until the upload ends.
Status check_upload_owner()
{
  if (upload.active && upload.owner != current_transport)
    return fail("busy", "a file is being uploaded over the other connection");
  return {};
}

// Ends an upload whose client went quiet.
void expire_upload()
{
  if (upload.active && platform::now_us() - upload.last_progress_us >= (uint64_t)UPLOAD_IDLE_MS * 1000)
    cancel_upload();
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

// Adds an `unknown_playlist` warning for each place of a schedule that names a playlist that is not stored.
void warn_unknown_playlists(const pixelart::Schedule &schedule, std::vector<pixelart::Diagnostic> &diagnostics)
{
  auto check = [&](const std::vector<std::string> &ids, const std::string &where)
  {
    for (size_t i = 0; i < ids.size(); i++)
      if (!storage::exists(playlist_file(ids[i])))
        diagnostics.push_back({pixelart::Severity::Warning, "unknown_playlist", where + "[" + std::to_string(i) + "]",
                               "\"" + ids[i] + "\" is not stored"});
  };
  check(schedule.fallback(), "fallback");
  for (size_t e = 0; e < schedule.entry_count(); e++)
    check(schedule.playlists(e), "entries[" + std::to_string(e) + "].playlists");
}

// ---- Commands ----

Status cmd_info(JsonObjectConst request, JsonDocument &reply)
{
  if (Status s = allow_only(request, {}); s.code)
    return s;
  install::Memory memory = install::memory();
  reply["protocol"] = 1;
  reply["firmware"] = platform::firmware_version();
  reply["board"] = platform::board_name();
  reply["boot_id"] = boot_id;
  reply["formats"]["animation"].add("pixelart/1");
  reply["formats"]["playlist"].add("pixelart-playlist/1");
  reply["formats"]["schedule"].add("pixelart-schedule/1");
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
  reply["limits"]["schedule"] = pixelart::MAX_SCHEDULE_FILE_SIZE;
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
  storage::sha256_hex(file, digest);
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
// so a damaged file is still listed. The caller holds the heap lock: the files and their parses are in memory.
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

  std::vector<std::string> ids = kind == Kind::Animation  ? stored_animations()
                                 : kind == Kind::Playlist ? stored_playlists()
                                                          : stored_schedules();
  // Ids sort differently from file names (`a-b.json` before `a.json`), and paging goes by id.
  std::sort(ids.begin(), ids.end());
  // One lock for the page. An update holding the memory for longer than the wait is `out_of_memory`.
  task_sync::HeapLock lock(task_sync::Owner::Loop);
  if (!lock.held())
    return fail("out_of_memory", "an update holds the memory, try again in a moment");
  reply["kind"] = kind_name(kind);
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
  if (Status s = check_upload_owner(); s.code)
    return s;
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
  if (!install::memory_fits(size))
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
  fresh.owner = current_transport;
  upload = std::move(fresh);
  return {};
}

Status cmd_put_chunk(JsonObjectConst request, JsonDocument &reply)
{
  if (Status s = check_upload_owner(); s.code)
    return s;
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
Status validate_temp_file(Kind kind, size_t size, JsonDocument &reply, std::vector<pixelart::Diagnostic> &diagnostics)
{
  pixelart::Playlist playlist;
  pixelart::Schedule schedule;
  switch (install::check(kind, TEMP_FILE, size, diagnostics, &playlist, &schedule))
  {
  case install::Result::Ok:
    if (kind == Kind::Playlist)
      warn_unknown_animations(playlist, diagnostics);
    else if (kind == Kind::Schedule)
      warn_unknown_playlists(schedule, diagnostics);
    return {};
  case install::Result::OutOfMemory:
    return fail("out_of_memory", OUT_OF_MEMORY_MESSAGE);
  case install::Result::StorageError:
    return fail("storage_error", "the temporary file cannot be read");
  case install::Result::Invalid:
    break;
  }
  add_diagnostics(reply["diagnostics"].to<JsonArray>(), diagnostics);
  return fail("invalid_file", std::string("the file is not a valid ") + kind_name(kind));
}

Status cmd_put_end(JsonObjectConst request, JsonDocument &reply)
{
  if (Status s = check_upload_owner(); s.code)
    return s;
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

  std::vector<pixelart::Diagnostic> diagnostics;
  if (Status s = validate_temp_file(done.kind, done.size, reply, diagnostics); s.code)
    return s;

  if (!install::commit(done.kind, TEMP_FILE, done.target))
    return fail("storage_error", "the file cannot be stored");
  add_diagnostics(reply["warnings"].to<JsonArray>(), diagnostics);
  return {};
}

Status cmd_put_abort(JsonObjectConst request, JsonDocument &)
{
  if (Status s = check_upload_owner(); s.code)
    return s;
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
  if (kind != Kind::Animation)
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

// Applies what a changed setting does outside the settings memory.
void apply_changes(const settings::Values &before)
{
  const settings::Values &now = settings::current();
  if (now.playlist != before.playlist || now.play != before.play || now.playlists != before.playlists ||
      now.timezone != before.timezone)
    request_play_update(); // playback follows the play settings, and the schedule the local date
  if (now.wifi_power != before.wifi_power)
    network::set_power(now.wifi_power);
  if (now.update_config_differs(before))
    updates::apply(now);
  // A login made while the setting was off does not carry over: the client logs in again.
  if (now.network_login && !before.network_login)
    wifi_session.reset();
}

// Saves `next`, all or nothing, and applies what changed. Returns the
// storage_error message, or nullptr when every setting is saved. When the
// settings memory also refuses to put a value back, the message says so.
const char *save_settings(const settings::Values &next)
{
  const settings::Values before = settings::current();
  const settings::Commit result = settings::commit(next);
  apply_changes(before);
  switch (result)
  {
  case settings::Commit::Ok:
    return nullptr;
  case settings::Commit::Failed:
    return "the settings cannot be saved";
  case settings::Commit::PartlyChanged:
    break;
  }
  return "the settings cannot be saved and may be partly changed";
}

// Every setting. The token is for USB only.
void add_settings(JsonDocument &reply)
{
  const settings::Values &v = settings::current();
  JsonObject out = reply["settings"].to<JsonObject>();
  out["brightness"] = v.brightness;
  out["playlist"] = v.playlist;
  out["play"] = v.play;
  JsonArray playlists = out["playlists"].to<JsonArray>();
  for (const std::string &id : v.playlists)
    playlists.add(id);
  out["wifi_power"] = v.wifi_power;
  out["update_mode"] = v.update_mode;
  out["update_firmware"] = v.update_firmware;
  out["update_animations"] = v.update_animations;
  out["check_hours"] = v.check_hours;
  out["install_start"] = v.install_start;
  out["install_end"] = v.install_end;
  out["timezone"] = v.timezone;
  out["time_sync_hours"] = v.time_sync_hours;
  out["ntp_server"] = v.ntp_server;
  out["animation_source"] = v.animation_source;
  out["network_login"] = v.network_login;
  if (current_transport == Transport::Usb)
    out["token"] = v.token;
}

Status usb_only(const char *what)
{
  if (current_transport == Transport::Usb)
    return {};
  return fail("usb_only", std::string(what) + " works over USB only");
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
  if (reset)
    if (Status s = usb_only("delete_all with settings"); s.code)
      return s;
  // The network is asked first: when the request cannot be queued nothing has changed yet, so the client repeats it.
  if (reset && !network::forget())
    return fail("busy", "the board could not take the request now; nothing was changed, repeat the command");
  cancel_upload();
  updates::cancel_install(); // before the files go, so an installation does not store them again
  size_t schedules = 0, playlists = 0, animations = 0;
  bool done = remove_all_files(SCHEDULES_FOLDER, schedules) && remove_all_files(PLAYLISTS_FOLDER, playlists) &&
              remove_all_files(ANIMATIONS_FOLDER, animations);
  if (schedules > 0 || playlists > 0)
    request_playlist_reload();
  if (!done)
    return fail("storage_error", "a file cannot be removed");
  // The settings go back to their defaults only once every file is gone, with a new token.
  if (reset)
  {
    if (const char *failure = save_settings(settings::defaults_with_new_token()))
      return fail("storage_error", std::string("the files are removed but ") + failure);
    close_wifi_client(); // the old token is gone
    add_settings(reply);
  }
  reply["schedules"] = schedules;
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

// The optional fields below are read into `out` only when present and valid,
// and `out` keeps its value when the field is absent. A field that is present
// and breaks its rule is a bad_request, `null` included.

// Text checked with `valid`, which `rule` describes.
// The rule of animation_source as the message of a refusal says it, with the limit of settings.h.
const std::string &animation_source_rule()
{
  static const std::string rule = "an http:// or https:// URL with a host and no user information, at most " +
                                  std::to_string(settings::MAX_ANIMATION_SOURCE) + " characters";
  return rule;
}

Status optional_text(JsonObjectConst request, const char *key, bool (*valid)(const std::string &), const char *rule,
                     std::string &out)
{
  JsonVariantConst value = request[key];
  if (value.isUnbound())
    return {};
  if (!value.is<const char *>() || !valid(value.as<std::string>()))
    return fail("bad_request", std::string(key) + " must be " + rule);
  out = value.as<std::string>();
  return {};
}

Status optional_flag(JsonObjectConst request, const char *key, bool &out)
{
  JsonVariantConst value = request[key];
  if (value.isUnbound())
    return {};
  if (!value.is<bool>())
    return fail("bad_request", std::string(key) + " must be true or false");
  out = value.as<bool>();
  return {};
}

// A whole number, from `min` to `max`, checked with `valid`.
Status optional_number(JsonObjectConst request, const char *key, bool (*valid)(uint32_t), const char *rule,
                       uint16_t &out)
{
  JsonVariantConst value = request[key];
  if (value.isUnbound())
    return {};
  if (!value.is<uint32_t>() || !valid(value.as<uint32_t>()))
    return fail("bad_request", std::string(key) + " must be a whole number " + rule);
  out = (uint16_t)value.as<uint32_t>();
  return {};
}

// Whether the request has a field besides `seq` and `cmd`.
bool has_fields(JsonObjectConst request)
{
  for (JsonPairConst pair : request)
    if (pair.key() != "seq" && pair.key() != "cmd")
      return true;
  return false;
}

// The `playlists` setting of a request: 1 to MAX_PLAYLISTS texts, no ID twice. The IDs are checked afterwards.
Status optional_playlists(JsonObjectConst request, bool &present, std::vector<std::string> &out)
{
  JsonVariantConst value = request["playlists"];
  present = !value.isUnbound();
  if (!present)
    return {};
  const std::string rule =
      "playlists must be a list of 1 to " + std::to_string(settings::MAX_PLAYLISTS) + " playlist IDs, no ID twice";
  if (!value.is<JsonArrayConst>() || value.size() < 1 || value.size() > settings::MAX_PLAYLISTS)
    return fail("bad_request", rule);
  out.clear();
  for (JsonVariantConst item : value.as<JsonArrayConst>())
  {
    if (!item.is<const char *>())
      return fail("bad_request", rule);
    std::string id = item.as<std::string>();
    if (std::find(out.begin(), out.end(), id) != out.end())
      return fail("bad_request", rule);
    out.push_back(std::move(id));
  }
  return {};
}

Status cmd_settings_set(JsonObjectConst request, JsonDocument &reply)
{
  if (!request["token"].isUnbound())
    return fail("bad_request", "token is read only");
  if (Status s =
          allow_only(request, {"brightness", "playlist", "play", "playlists", "wifi_power", "update_mode",
                               "update_firmware", "update_animations", "check_hours", "install_start", "install_end",
                               "timezone", "time_sync_hours", "ntp_server", "animation_source", "network_login"});
      s.code)
    return s;

  // Check everything before changing anything: the fields go into a copy of the settings. The errors come in
  // this order: bad_request for any field, then invalid_id, then not_found, then a playlist that disagrees.
  settings::Values next = settings::current();
  JsonVariantConst brightness = request["brightness"];
  if (!brightness.isUnbound())
  {
    if (!brightness.is<uint8_t>())
      return fail("bad_request", "brightness must be a whole number from 0 to 255");
    next.brightness = brightness.as<uint8_t>();
  }
  JsonVariantConst playlist_field = request["playlist"];
  const bool has_playlist = !playlist_field.isUnbound();
  if (has_playlist && !playlist_field.is<const char *>())
    return fail("bad_request", "playlist must be text");
  const std::string playlist = has_playlist ? playlist_field.as<std::string>() : std::string();
  const bool has_play = !request["play"].isUnbound();
  std::vector<std::string> playlists;
  bool has_playlists;
  for (Status s :
       {optional_text(request, "play", settings::valid_play, "auto or playlists", next.play),
        optional_playlists(request, has_playlists, playlists),
        optional_text(request, "wifi_power", settings::valid_wifi_power, "auto, 8.5, 11, 13, 15, 17, 18.5 or 19.5",
                      next.wifi_power),
        optional_text(request, "update_mode", settings::valid_update_mode, "off, notify or automatic",
                      next.update_mode),
        optional_text(request, "timezone", settings::valid_timezone, "1 to 64 printable ASCII characters",
                      next.timezone),
        optional_text(request, "ntp_server", settings::valid_ntp_server,
                      "a host name or IPv4 address of 1 to 64 letters, digits, dots and dashes", next.ntp_server),
        optional_text(request, "animation_source", settings::valid_animation_source, animation_source_rule().c_str(),
                      next.animation_source),
        optional_flag(request, "update_firmware", next.update_firmware),
        optional_flag(request, "update_animations", next.update_animations),
        optional_flag(request, "network_login", next.network_login),
        optional_number(request, "check_hours", settings::valid_check_hours, "from 1 to 168", next.check_hours),
        optional_number(request, "install_start", settings::valid_minutes, "from 0 to 1439", next.install_start),
        optional_number(request, "install_end", settings::valid_minutes, "from 0 to 1439", next.install_end),
        optional_number(request, "time_sync_hours", settings::valid_time_sync_hours, "from 1 to 168",
                        next.time_sync_hours)})
    if (s.code)
      return s;
  if (!has_fields(request)) // every field is a setting: allow_only refused the others
    return fail("bad_request", "give at least one setting");

  if (has_playlist)
    if (Status s = check_id(playlist, "playlist"); s.code)
      return s;
  for (const std::string &id : playlists)
    if (Status s = check_id(id, "playlists"); s.code)
      return s;
  if (has_playlist && !storage::exists(playlist_file(playlist)))
    return fail("not_found", "no such playlist");
  for (const std::string &id : playlists)
    if (!storage::exists(playlist_file(id)))
      return fail("not_found", "no such playlist: " + id);

  if (has_play || has_playlists)
  {
    if (has_playlists)
      next.playlists = playlists;
    next.play_stored = true;
    next.playlist = settings::reported_playlist(next.play, next.playlists);
    if (has_playlist && playlist != next.playlist)
      return fail("bad_request", "playlist must be " + next.playlist + " with these play and playlists");
  }
  else if (has_playlist)
  {
    // An older client: its `default` means Automatic, another playlist My playlists with that one.
    next.playlist = playlist;
    settings::derive_play(next);
  }

  if (const char *failure = save_settings(next))
    return fail("storage_error", failure);
  add_settings(reply);
  return {};
}

Status cmd_status(JsonObjectConst request, JsonDocument &reply)
{
  if (Status s = allow_only(request, {}); s.code)
    return s;
  const network::Snapshot n = network::snapshot();
  JsonObject wifi = reply["wifi"].to<JsonObject>();
  wifi["state"] = wifi_logic::state_name(n.state);
  if (n.has_ip)
    wifi["ip"] = std::string(n.ip); // copied: `n` is gone when the reply is written
  else
    wifi["ip"] = nullptr;
  if (n.has_rssi)
    wifi["rssi"] = n.rssi;
  else
    wifi["rssi"] = nullptr;
  wifi["power"] = std::string(n.power);
  wifi["power_reduced"] = n.power_reduced;
  wifi["hostname"] = std::string(n.hostname);
  if (n.has_ssid)
    wifi["ssid"] = pixelart::utf8_lossy(n.ssid, strnlen(n.ssid, sizeof(n.ssid)));
  else
    wifi["ssid"] = nullptr;
  const updates::Snapshot u = updates::snapshot();
  reply["time"]["known"] = u.time_known;
  const PlayStatus p = play_status();
  JsonObject play = reply["play"].to<JsonObject>();
  play["mode"] = p.automatic ? settings::PLAY_AUTO : settings::PLAY_PLAYLISTS;
  play["reason"] = pixelart::play_reason_name(p.reason);
  if (p.entry >= 0)
    play["entry"] = p.entry;
  else
    play["entry"] = nullptr;
  JsonArray list = play["playlists"].to<JsonArray>();
  for (const std::string &id : p.playlists)
    list.add(id);
  if (p.playing.empty())
    play["playing"] = nullptr;
  else
    play["playing"] = p.playing;
  JsonObject update = reply["update"].to<JsonObject>();
  update["state"] = u.state;
  update["progress"] = u.progress;
  if (u.has_last_check)
    update["last_check"] = u.last_check_seconds;
  else
    update["last_check"] = nullptr;
  if (u.last_result)
    update["last_result"] = u.last_result;
  else
    update["last_result"] = nullptr;
  if (u.last_detail)
    update["last_detail"] = u.last_detail;
  else
    update["last_detail"] = nullptr;
  update["failed_files"] = u.failed_files;
  if (u.firmware.empty())
    update["firmware"] = nullptr;
  else
    update["firmware"] = u.firmware;
  update["files"] = u.files;
  const firmware::LastInstall last = firmware::last_install();
  if (last.present)
  {
    JsonObject install = update["last_install"].to<JsonObject>();
    install["result"] = last.rolled_back ? "rolled_back" : "updated";
    install["from"] = last.from;
    install["to"] = last.to;
  }
  else
    update["last_install"] = nullptr;
  return {};
}

// The error of a request for a check or an installation, or success.
Status update_status(updates::Request request)
{
  switch (request)
  {
  case updates::Request::Started:
    return {};
  case updates::Request::UpdatesOff:
    return fail("updates_off", "updates are off for this request");
  case updates::Request::NothingToInstall:
    return fail("nothing_to_install", "the last check found nothing to install");
  case updates::Request::NoNetwork:
    return fail("no_network", "the board is not connected to WiFi");
  case updates::Request::Busy:
    return fail("busy", "a check or an installation is already running");
  case updates::Request::FirmwareConfirming:
    return fail("busy", "the running firmware is still confirming itself, try again after it has");
  }
  return fail("busy", "a check or an installation is already running");
}

Status cmd_update_check(JsonObjectConst request, JsonDocument &)
{
  if (Status s = allow_only(request, {}); s.code)
    return s;
  return update_status(updates::check());
}

Status cmd_update_install(JsonObjectConst request, JsonDocument &)
{
  if (Status s = allow_only(request, {"target", "force"}); s.code)
    return s;
  std::string target;
  if (Status s = get_text(request, "target", target); s.code)
    return s;
  bool force = false;
  if (Status s = optional_flag(request, "force", force); s.code)
    return s;
  if (target == "animations")
    return update_status(updates::install_animations());
  if (target == "firmware")
    return update_status(updates::install_firmware(force));
  return fail("bad_request", "target must be \"firmware\" or \"animations\"");
}

Status cmd_wifi_forget(JsonObjectConst request, JsonDocument &)
{
  if (Status s = allow_only(request, {}); s.code)
    return s;
  if (Status s = usb_only("wifi_forget"); s.code)
    return s;
  if (!network::forget())
    return fail("busy", "the board could not take the request now; repeat it");
  return {};
}

Status cmd_token_regenerate(JsonObjectConst request, JsonDocument &reply)
{
  if (Status s = allow_only(request, {}); s.code)
    return s;
  if (Status s = usb_only("token_regenerate"); s.code)
    return s;
  settings::Values next = settings::current();
  next.token = settings::make_token();
  if (const char *failure = save_settings(next))
    return fail("storage_error", failure);
  reply["token"] = settings::current().token;
  close_wifi_client();
  return {};
}

Status cmd_auth_challenge(JsonObjectConst request, JsonDocument &reply)
{
  if (Status s = allow_only(request, {}); s.code)
    return s;
  uint8_t random[pixelart_net::NONCE_BYTES];
  platform::nonce_bytes(random, sizeof(random));
  reply["nonce"] = session_of(current_transport).challenge(random);
  return {};
}

Status cmd_auth(JsonObjectConst request, JsonDocument &)
{
  if (Status s = allow_only(request, {"hmac"}); s.code)
    return s;
  std::string hmac;
  if (Status s = get_text(request, "hmac", hmac); s.code)
    return s;
  if (!pixelart_net::is_hmac_text(hmac))
    return fail("bad_request", "hmac must be 64 lowercase hexadecimal digits");
  switch (session_of(current_transport).attempt(settings::current().token, hmac))
  {
  case pixelart_net::AuthSession::Verdict::Accepted:
    return {};
  case pixelart_net::AuthSession::Verdict::Refused:
    break;
  case pixelart_net::AuthSession::Verdict::RefusedAndClose:
    if (current_transport == Transport::Wifi)
      close_wifi_client();
    break;
  }
  return fail("unauthorized", "the login failed");
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
    {"status", cmd_status},
    {"update_check", cmd_update_check},
    {"update_install", cmd_update_install},
    {"wifi_forget", cmd_wifi_forget},
    {"token_regenerate", cmd_token_regenerate},
    {"auth_challenge", cmd_auth_challenge},
    {"auth", cmd_auth},
};

// Runs a request that arrived intact and builds its reply.
std::string run_request(const std::string &json, uint32_t crc, Transport transport)
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

  const std::string name = cmd.as<std::string>();
  if (transport == Transport::Wifi)
  {
    if (wifi_closing)
      return "";
    // Before the cache, so a reply made for a logged in client is never sent to another one.
    if (wifi_login_pending() && !allowed_before_login(name))
    {
      JsonDocument refusal;
      refusal["seq"] = seq.as<uint32_t>();
      set_error(refusal, "unauthorized", "log in first with auth_challenge and auth");
      return frame(refusal);
    }
  }

  Cache &cache = transport == Transport::Wifi ? wifi_cache : usb_cache;
  if (cache.valid && cache.seq == seq.as<uint32_t>() && cache.crc == crc)
    return cache.reply;

  current_transport = transport;
  JsonDocument reply;
  reply["seq"] = seq.as<uint32_t>();
  reply["ok"] = true;
  Status status = fail("unknown_command", "this firmware does not know the command");
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

LineReader::Event LineReader::feed(uint8_t byte)
{
  if (complete_)
    clear();
  if (frame_.active())
  {
    switch (frame_.feed(byte))
    {
    case improv::FrameParser::Result::More:
      return Event::None;
    case improv::FrameParser::Result::Frame:
      complete_ = true;
      return Event::Improv;
    case improv::FrameParser::Result::BadChecksum:
      complete_ = true;
      return Event::ImprovInvalid;
    }
  }
  if (byte != '\n')
  {
    // Room for a `\r` after the longest line.
    if (line_.size() <= MAX_LINE)
      line_ += (char)byte;
    else
      overflowed_ = true;
    if (line_.size() == MARKER_SIZE && !overflowed_)
      protocol_line_ = line_ == MARKER;
    if (protocol_line_)
      return Event::None;
    if (recent_size_ == improv::HEADER_SIZE)
      memmove(recent_, recent_ + 1, improv::HEADER_SIZE - 1);
    else
      recent_size_++;
    recent_[recent_size_ - 1] = byte;
    if (recent_size_ == improv::HEADER_SIZE && memcmp(recent_, improv::MAGIC, improv::MAGIC_SIZE) == 0 &&
        recent_[improv::MAGIC_SIZE] == improv::VERSION)
    {
      // What came before the header on this line was not a protocol line.
      line_.clear();
      reset_scan();
      frame_.start();
    }
    return Event::None;
  }

  if (!line_.empty() && line_.back() == '\r')
    line_.pop_back();
  bool too_long = overflowed_ || line_.size() > MAX_LINE;
  bool is_protocol = line_.compare(0, MARKER_SIZE, MARKER) == 0;
  if (too_long)
    line_.clear();
  reset_scan();
  if (too_long)
    return is_protocol ? Event::Overflow : Event::None;
  complete_ = true;
  return Event::Line;
}

void LineReader::reset_scan()
{
  overflowed_ = false;
  recent_size_ = 0;
  protocol_line_ = false;
}

void LineReader::abort_frame()
{
  frame_.reset();
  line_.clear();
  reset_scan();
}

void LineReader::clear()
{
  abort_frame();
  complete_ = false;
}

void begin()
{
  reader.clear();
  improv::begin();
  upload = Upload();
  usb_cache = Cache();
  wifi_cache = Cache();
  wifi_session.reset();
  usb_session.reset();
  wifi_closing = false;
  storage::remove(TEMP_FILE);
  boot_id = platform::random32();
}

std::string handle_line(const std::string &line, Transport transport)
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
  return run_request(json, crc, transport);
}

namespace
{
// A WiFi connection that opens or closes ends the WiFi session: its login, its
// closing flag and its remembered reply, so nothing of it reaches the next client.
void reset_wifi_session()
{
  wifi_session.reset();
  wifi_closing = false;
  wifi_cache = Cache();
}
} // namespace

void wifi_opened() { reset_wifi_session(); }

void wifi_closed() { reset_wifi_session(); }

bool wifi_login_pending() { return settings::current().network_login && !wifi_session.authenticated(); }

std::string line_too_long() { return bad_frame("the line is too long"); }

void poll()
{
  expire_upload();
  ws_server::poll();
  improv::poll();
  if (reader.in_frame() && platform::now_us() - last_byte_us >= (uint64_t)improv::FRAME_IDLE_MS * 1000)
    reader.abort_frame();
  for (size_t n = 0; n < MAX_BYTES_PER_POLL && Serial.available() > 0; n++)
  {
    int byte = Serial.read();
    if (byte < 0)
      return;
    last_byte_us = platform::now_us();
    switch (reader.feed((uint8_t)byte))
    {
    case LineReader::Event::None:
      continue;
    case LineReader::Event::Line:
      write_line(handle_line(reader.line(), Transport::Usb));
      return;
    case LineReader::Event::Overflow:
      write_line(line_too_long());
      return;
    case LineReader::Event::Improv:
      improv::handle_frame(reader.improv_frame().type(), reader.improv_frame().data());
      reader.clear(); // wipes the frame, which may hold a password
      return;
    case LineReader::Event::ImprovInvalid:
      improv::handle_bad_checksum();
      return;
    }
  }
}

bool upload_active() { return upload.active; }

} // namespace protocol
