// SPDX-License-Identifier: GPL-3.0-or-later

// Runs the protocol conformance cases in conformance/protocol/ through the
// real line reader on the simulated serial port, and tests what the cases
// cannot express. Run with: pio test -e native_test (or make test)

#include <ArduinoJson.h>
#include <pixel_codec.h>
#include <sim.h>
#include <strict_json.h>
#include <unity.h>

#include <algorithm>
#include <cstdio>
#include <deque>
#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

#include "app.h"
#include "protocol.h"
#include "settings.h"
#include "storage.h"
#include "pixelart_test.h"

namespace fs = std::filesystem;
using pixelart_test::DOT;
using pixelart_test::protocol_frame;
using pixelart_test::put_begin;
using pixelart_test::put_chunk;
using pixelart_test::read_file;
using pixelart_test::request;
using pixelart_test::sha256_hex;
using pixelart_test::TempData;

static const fs::path SUITE = fs::path(PIXELART_PROJECT_DIR) / "conformance" / "protocol";
static const char *ANY = "<any>";

// The replies the board has written to the serial port.
class Replies
{
public:
  // Feeds `bytes` to the serial input and lets the protocol read all of it.
  void send(const std::string &bytes)
  {
    sim::serial_input(bytes);
    while (sim::serial_input_size() > 0)
      protocol::poll();
    collect();
  }

  void collect()
  {
    for (; seen_ < sim::serial().size(); seen_++)
    {
      const std::string &text = sim::serial()[seen_].text;
      if (text.rfind("@PR ", 0) == 0)
        pending_.push_back(text);
    }
  }

  bool empty() const { return pending_.empty(); }
  size_t size() const { return pending_.size(); }
  std::string pop()
  {
    std::string line = pending_.front();
    pending_.pop_front();
    return line;
  }

private:
  size_t seen_ = 0;
  std::deque<std::string> pending_;
};

// Strict check of RFC 3629: no overlong forms, surrogates or values over U+10FFFF.
static bool is_utf8(const std::string &text)
{
  for (size_t i = 0, n; i < text.size(); i += n)
    if ((n = pixelart::utf8_sequence_length(text.data(), text.size(), i)) == 0)
      return false;
  return true;
}

// Splits a reply line and checks its framing: marker, 8 lowercase hex digits,
// a CRC that matches the JSON, and JSON that follows the strict rules.
static std::string reply_json(const std::string &line, const std::string &where)
{
  TEST_ASSERT_TRUE_MESSAGE(line.size() > 13 && line.compare(0, 4, "@PR ") == 0 && line[12] == ' ',
                           (where + ": not a protocol line: " + line).c_str());
  std::string json = line.substr(13);
  TEST_ASSERT_TRUE_MESSAGE(is_utf8(json), (where + ": the reply is not valid UTF-8: " + line).c_str());
  const char *reason;
  size_t offset;
  TEST_ASSERT_TRUE_MESSAGE(pixelart::check_strict_json(json.data(), json.size(), 32, reason, offset),
                           (where + ": the reply is not strict JSON: " + line).c_str());
  char want[16];
  snprintf(want, sizeof(want), "%08x", (unsigned)pixelart::crc32(json.data(), json.size()));
  TEST_ASSERT_EQUAL_STRING_MESSAGE(want, line.substr(4, 8).c_str(), (where + ": wrong CRC in " + line).c_str());
  return json;
}

static std::string text_of(JsonVariantConst value)
{
  std::string out;
  serializeJson(value, out);
  return out;
}

// Compares a reply with the expected body. "<any>" matches any value, and
// "<at most N characters>" any text of at most N code points.
static bool matches(JsonVariantConst want, JsonVariantConst got)
{
  if (want.is<const char *>() && std::string(want.as<const char *>()) == ANY)
    return true;
  size_t limit;
  int end = 0;
  if (want.is<const char *>() && sscanf(want.as<const char *>(), "<at most %zu characters>%n", &limit, &end) == 1 &&
      end > 0 && want.as<const char *>()[end] == '\0')
    return got.is<const char *>() && pixelart::utf8_code_points(got.as<const char *>()) <= limit;
  if (want.is<JsonObjectConst>())
  {
    if (!got.is<JsonObjectConst>() || want.as<JsonObjectConst>().size() != got.as<JsonObjectConst>().size())
      return false;
    // Equal sizes and every expected key present: the same set of keys.
    JsonObjectConst object = got.as<JsonObjectConst>();
    for (JsonPairConst pair : want.as<JsonObjectConst>())
      if (object[pair.key()].isNull() || !matches(pair.value(), object[pair.key()]))
        return false;
    return true;
  }
  if (want.is<JsonArrayConst>())
  {
    if (!got.is<JsonArrayConst>() || want.as<JsonArrayConst>().size() != got.as<JsonArrayConst>().size())
      return false;
    for (size_t i = 0; i < want.as<JsonArrayConst>().size(); i++)
      if (!matches(want[i], got[i]))
        return false;
    return true;
  }
  return text_of(want) == text_of(got);
}

static std::string file_bytes(const JsonVariantConst &spec)
{
  if (spec.is<const char *>())
    return spec.as<const char *>();
  std::string decoded;
  std::string coded = spec["base64"].as<const char *>();
  TEST_ASSERT_TRUE(pixelart::base64_decode(coded.data(), coded.size(), 1 << 20, decoded));
  return decoded;
}

static void run_case(const fs::path &file)
{
  const std::string name = file.stem().string();
  JsonDocument doc;
  std::string text = read_file(file);
  TEST_ASSERT_FALSE_MESSAGE(deserializeJson(doc, text), (name + ": the case is not valid JSON").c_str());

  sim::reset();
  TempData data("protocol");
  if (!doc["capacity"].isNull())
    storage::set_capacity(doc["capacity"].as<size_t>());
  for (JsonPairConst f : doc["files"].as<JsonObjectConst>())
    data.write(f.key().c_str(), file_bytes(f.value()));
  setup();
  if (!doc["settings"]["brightness"].isNull())
    settings::set_brightness(doc["settings"]["brightness"].as<uint8_t>());
  if (!doc["settings"]["playlist"].isNull())
    settings::set_playlist(doc["settings"]["playlist"].as<const char *>());

  Replies replies;
  size_t index = 0;
  for (JsonVariantConst step : doc["steps"].as<JsonArrayConst>())
  {
    const std::string where = name + ", step " + std::to_string(index++);
    if (!step["send"].isNull())
    {
      std::string eol = step["eol"].isNull() ? "\n" : step["eol"].as<const char *>();
      replies.send(std::string(step["send"].as<const char *>()) + eol);
    }
    else if (!step["expect"].isNull())
    {
      TEST_ASSERT_FALSE_MESSAGE(replies.empty(), (where + ": the board sent no reply").c_str());
      std::string json = reply_json(replies.pop(), where);
      JsonDocument got;
      TEST_ASSERT_FALSE_MESSAGE(deserializeJson(got, json), (where + ": reply is not JSON: " + json).c_str());
      TEST_ASSERT_TRUE_MESSAGE(matches(step["expect"], got),
                               (where + ": expected " + text_of(step["expect"]) + " got " + json).c_str());
    }
    else if (!step["expect_nothing"].isNull())
    {
      std::string extra = replies.empty() ? "" : replies.pop();
      TEST_ASSERT_TRUE_MESSAGE(extra.empty(), (where + ": unexpected reply " + extra).c_str());
    }
    else if (!step["advance_ms"].isNull())
    {
      sim::advance_us((uint64_t)step["advance_ms"].as<uint32_t>() * 1000);
      protocol::poll();
      replies.collect();
    }
    else if (!step["reboot"].isNull())
    {
      setup();
    }
    else if (!step["expect_files"].isNull())
    {
      for (JsonPairConst f : step["expect_files"].as<JsonObjectConst>())
      {
        fs::path path = data.root / f.key().c_str();
        std::string label = where + ": " + f.key().c_str();
        if (f.value().isNull())
          TEST_ASSERT_FALSE_MESSAGE(fs::exists(path), (label + " exists").c_str());
        else
        {
          TEST_ASSERT_TRUE_MESSAGE(fs::exists(path), (label + " is missing").c_str());
          TEST_ASSERT_TRUE_MESSAGE(read_file(path) == file_bytes(f.value()), (label + " has other content").c_str());
        }
      }
    }
    else
      TEST_FAIL_MESSAGE((where + ": unknown step").c_str());
  }
  TEST_ASSERT_TRUE_MESSAGE(replies.empty(), (name + ": unexpected reply " + replies.pop()).c_str());
}

static void test_conformance_cases()
{
  std::vector<fs::path> files;
  for (const auto &entry : fs::directory_iterator(SUITE))
    if (entry.path().extension() == ".json")
      files.push_back(entry.path());
  std::sort(files.begin(), files.end());
  TEST_ASSERT_TRUE_MESSAGE(files.size() >= 50, "protocol cases are missing");
  for (const fs::path &file : files)
    run_case(file);
}

// ---- What the cases cannot express ----

static void test_line_reader_limits()
{
  protocol::LineReader reader;
  auto feed = [&](const std::string &bytes)
  {
    protocol::LineReader::Event last = protocol::LineReader::Event::None;
    for (char c : bytes)
      last = reader.feed((uint8_t)c);
    return last;
  };
  using Event = protocol::LineReader::Event;

  TEST_ASSERT_TRUE(feed("@PR abc\n") == Event::Line);
  TEST_ASSERT_EQUAL_STRING("@PR abc", reader.line().c_str());
  TEST_ASSERT_TRUE(feed("@PR abc\r\n") == Event::Line);
  TEST_ASSERT_EQUAL_STRING("@PR abc", reader.line().c_str());
  TEST_ASSERT_TRUE(feed("\n") == Event::Line);
  TEST_ASSERT_EQUAL(0, reader.line().size());
  TEST_ASSERT_TRUE(feed("no newline yet") == Event::None);
  TEST_ASSERT_TRUE(feed(" and now\n") == Event::Line);
  TEST_ASSERT_EQUAL_STRING("no newline yet and now", reader.line().c_str());

  const std::string marker = "@PR ";
  TEST_ASSERT_TRUE(feed(marker + std::string(protocol::MAX_LINE - 4, 'x') + "\n") == Event::Line);
  TEST_ASSERT_EQUAL(protocol::MAX_LINE, reader.line().size());
  TEST_ASSERT_TRUE(feed(marker + std::string(protocol::MAX_LINE - 4, 'x') + "\r\n") == Event::Line);
  TEST_ASSERT_TRUE(feed(marker + std::string(protocol::MAX_LINE - 3, 'x') + "\n") == Event::Overflow);
  TEST_ASSERT_TRUE(feed(marker + std::string(100000, 'x') + "\n") == Event::Overflow);
  TEST_ASSERT_TRUE(feed(std::string(100000, 'y') + "\n") == Event::None);
  // The reader resynchronises at the newline: the next line is read normally.
  TEST_ASSERT_TRUE(feed("@PR ok\n") == Event::Line);
  TEST_ASSERT_EQUAL_STRING("@PR ok", reader.line().c_str());
}

// Sends a whole upload of DOT and returns the reply to put_end.
static std::string upload_dot(Replies &replies, unsigned seq = 1)
{
  replies.send(put_begin(seq, "animation", "dot", DOT));
  replies.pop();
  replies.send(put_chunk(seq + 1, DOT));
  replies.pop();
  replies.send(request(seq + 2, R"("cmd":"put_end")"));
  return reply_json(replies.pop(), "put_end");
}

static protocol::Memory low_memory() { return {5000, 3000}; }
static protocol::Memory plenty_of_memory() { return {400000, 300000}; }

// Sends put_begin of DOT and returns its reply.
static std::string begin_dot(Replies &replies)
{
  replies.send(put_begin(1, "animation", "dot", DOT));
  return reply_json(replies.pop(), "put_begin");
}

static void test_out_of_memory_at_begin_creates_nothing()
{
  sim::reset();
  TempData data("protocol");
  data.write("animations/dot.json", "old content");
  setup();
  Replies replies;

  protocol::set_memory_probe(low_memory);
  std::string refused = begin_dot(replies);
  protocol::set_memory_probe(nullptr);
  TEST_ASSERT_TRUE_MESSAGE(refused.find("\"out_of_memory\"") != std::string::npos, refused.c_str());
  TEST_ASSERT_TRUE(read_file(data.root / "animations/dot.json") == "old content");
  TEST_ASSERT_FALSE(fs::exists(data.root / "upload.tmp"));
  TEST_ASSERT_FALSE(protocol::upload_active());

  protocol::set_memory_probe(plenty_of_memory);
  std::string accepted = upload_dot(replies, 10);
  protocol::set_memory_probe(nullptr);
  TEST_ASSERT_TRUE_MESSAGE(accepted.find("\"ok\":true") != std::string::npos, accepted.c_str());
  TEST_ASSERT_TRUE(read_file(data.root / "animations/dot.json") == DOT);
}

static void test_out_of_memory_at_end_leaves_everything_unchanged()
{
  sim::reset();
  TempData data("protocol");
  data.write("animations/dot.json", "old content");
  setup();
  Replies replies;

  protocol::set_memory_probe(plenty_of_memory);
  std::string begun = begin_dot(replies);
  TEST_ASSERT_TRUE_MESSAGE(begun.find("\"ok\":true") != std::string::npos, begun.c_str());
  replies.send(put_chunk(2, DOT));
  replies.pop();
  protocol::set_memory_probe(low_memory); // memory shrank while the data came in
  replies.send(request(3, R"("cmd":"put_end")"));
  std::string refused = reply_json(replies.pop(), "put_end");
  protocol::set_memory_probe(nullptr);
  TEST_ASSERT_TRUE_MESSAGE(refused.find("\"out_of_memory\"") != std::string::npos, refused.c_str());
  TEST_ASSERT_TRUE(read_file(data.root / "animations/dot.json") == "old content");
  TEST_ASSERT_FALSE(fs::exists(data.root / "upload.tmp"));
  TEST_ASSERT_FALSE(protocol::upload_active());
}

static std::string boot_id_after_setup()
{
  setup();
  Replies replies;
  replies.send(request(1, R"("cmd":"info")"));
  JsonDocument doc;
  TEST_ASSERT_FALSE(deserializeJson(doc, reply_json(replies.pop(), "info")));
  return std::to_string(doc["boot_id"].as<uint32_t>());
}

static void test_boot_id_differs_between_starts()
{
  sim::reset();
  TempData data("protocol");
  std::string first = boot_id_after_setup();
  sim::reset();
  std::string second = boot_id_after_setup();
  TEST_ASSERT_TRUE_MESSAGE(first != second, ("boot_id repeated: " + first).c_str());
}

static void test_idle_upload_ends_when_a_line_is_handled_without_poll()
{
  // The WebSocket transport hands lines to handle_line() directly.
  sim::reset();
  TempData data("protocol");
  setup();
  Replies replies;
  begin_dot(replies);
  TEST_ASSERT_TRUE(protocol::upload_active());

  sim::advance_us((uint64_t)protocol::UPLOAD_IDLE_MS * 1000);
  std::string line = protocol::handle_line(protocol_frame(R"({"seq":2,"cmd":"put_end"})"));
  std::string json = reply_json(line, "put_end");
  TEST_ASSERT_TRUE_MESSAGE(json.find("\"error\":\"no_upload\"") != std::string::npos, json.c_str());
  TEST_ASSERT_FALSE(fs::exists(data.root / "upload.tmp"));
}

static void test_chunk_write_failure_cancels_the_upload()
{
  sim::reset();
  TempData data("protocol");
  setup();
  Replies replies;
  begin_dot(replies);
  TEST_ASSERT_TRUE(fs::exists(data.root / "upload.tmp"));

  storage::set_fail_writes(true);
  replies.send(put_chunk(2, DOT));
  storage::set_fail_writes(false);
  std::string json = reply_json(replies.pop(), "put_chunk");
  TEST_ASSERT_TRUE_MESSAGE(json.find("\"error\":\"storage_error\"") != std::string::npos, json.c_str());
  TEST_ASSERT_FALSE(protocol::upload_active());
  TEST_ASSERT_EQUAL(0, storage::open_writers());
  TEST_ASSERT_FALSE(fs::exists(data.root / "upload.tmp"));
}

// ---- Every way an upload ends closes its file ----

// The reply to put_begin of DOT, with `sha256` and `size` of the caller's choosing.
static std::string begin_with(Replies &replies, unsigned seq, size_t size, const std::string &sha256,
                              const char *id = "dot")
{
  replies.send(request(seq, std::string(R"("cmd":"put_begin","kind":"animation","id":")") + id + R"(","size":)" +
                                std::to_string(size) + R"(,"sha256":")" + sha256 + "\""));
  return reply_json(replies.pop(), "put_begin");
}

// Opens an upload declared as `declared` of `size` bytes, and checks that its file is open.
static void begin_upload(Replies &replies, const std::string &declared, size_t size)
{
  std::string begun = begin_with(replies, 1, size, sha256_hex(declared));
  TEST_ASSERT_TRUE_MESSAGE(begun.find("\"ok\":true") != std::string::npos, begun.c_str());
  TEST_ASSERT_TRUE(protocol::upload_active());
  TEST_ASSERT_EQUAL(1, storage::open_writers());
}

static void test_upload_file_is_open_only_while_the_upload_is()
{
  sim::reset();
  TempData data("protocol");
  setup();
  Replies replies;
  TEST_ASSERT_EQUAL(0, storage::open_writers());

  begin_upload(replies, DOT, DOT.size());
  replies.send(request(2, R"("cmd":"put_abort")"));
  replies.pop();
  TEST_ASSERT_EQUAL(0, storage::open_writers());
}

static void test_refused_put_begin_closes_the_open_upload_file()
{
  sim::reset();
  TempData data("protocol");
  setup();
  Replies replies;
  begin_upload(replies, DOT, DOT.size());
  std::string refused = begin_with(replies, 2, 0, sha256_hex(DOT)); // size 0 is a bad request
  TEST_ASSERT_TRUE_MESSAGE(refused.find("\"bad_request\"") != std::string::npos, refused.c_str());
  TEST_ASSERT_FALSE(protocol::upload_active());
  TEST_ASSERT_EQUAL(0, storage::open_writers());
}

// Runs one upload to put_end and returns the reply; the file must be closed afterwards.
static std::string end_upload(const std::string &sent, const std::string &declared, size_t declared_size,
                              protocol::MemoryProbe probe = nullptr)
{
  sim::reset();
  TempData data("protocol");
  setup();
  Replies replies;
  begin_upload(replies, declared, declared_size);
  replies.send(put_chunk(2, sent));
  replies.pop();
  TEST_ASSERT_EQUAL(1, storage::open_writers());
  protocol::set_memory_probe(probe);
  replies.send(request(3, R"("cmd":"put_end")"));
  std::string json = reply_json(replies.pop(), "put_end");
  protocol::set_memory_probe(nullptr);
  TEST_ASSERT_FALSE(protocol::upload_active());
  TEST_ASSERT_EQUAL(0, storage::open_writers());
  return json;
}

static void test_put_end_reply_stays_under_16_kib_with_long_texts()
{
  // 40 unknown fields named with 200 four-byte characters, 200 escaped quotes or
  // 200 U+0001 (written back as \u0001): every diagnostic quotes its field, so
  // uncut texts would make a reply of about 50 KB.
  static const char *const parts[] = {"\xF0\x9F\x98\x80", "\\\"", "\\u0001"};
  std::string file = DOT.substr(0, DOT.size() - 1);
  for (int i = 0; i < 40; i++)
  {
    std::string name = std::to_string(i);
    for (int j = 0; j < 200; j++)
      name += parts[i % 3];
    file += ",\"" + name + "\":1";
  }
  file += "}";
  sim::reset();
  TempData data("protocol");
  setup();
  Replies replies;
  replies.send(put_begin(1, "animation", "long", file));
  replies.pop();
  unsigned seq = 2;
  for (size_t offset = 0; offset < file.size(); offset += 512, seq++)
  {
    std::string piece = file.substr(offset, 512);
    replies.send(request(seq, R"("cmd":"put_chunk","offset":)" + std::to_string(offset) + R"(,"data":")" +
                                  pixelart::base64_encode(piece.data(), piece.size()) + "\""));
    replies.pop();
  }
  replies.send(request(seq, R"("cmd":"put_end")"));
  std::string line = replies.pop();
  std::string json = reply_json(line, "put_end");
  JsonDocument reply;
  TEST_ASSERT_FALSE(deserializeJson(reply, json));
  TEST_ASSERT_EQUAL_STRING("invalid_file", reply["error"]);
  TEST_ASSERT_EQUAL(32, reply["diagnostics"].size());
  TEST_ASSERT_LESS_THAN(16384, line.size() + 1);
  // The texts are cut between characters: a cut inside one would show as U+FFFD
  TEST_ASSERT_EQUAL(std::string::npos, json.find("\xEF\xBF\xBD"));
}

static void test_every_put_end_result_closes_the_upload_file()
{
  std::string json = end_upload(DOT, DOT, DOT.size());
  TEST_ASSERT_TRUE_MESSAGE(json.find("\"ok\":true") != std::string::npos, json.c_str());

  json = end_upload(DOT.substr(0, 100), DOT, DOT.size());
  TEST_ASSERT_TRUE_MESSAGE(json.find("\"size_mismatch\"") != std::string::npos, json.c_str());

  json = end_upload(std::string(DOT.size(), 'x'), DOT, DOT.size());
  TEST_ASSERT_TRUE_MESSAGE(json.find("\"checksum_mismatch\"") != std::string::npos, json.c_str());

  const std::string not_json = "this is not an animation";
  json = end_upload(not_json, not_json, not_json.size());
  TEST_ASSERT_TRUE_MESSAGE(json.find("\"invalid_file\"") != std::string::npos, json.c_str());

  json = end_upload(DOT, DOT, DOT.size(), low_memory);
  TEST_ASSERT_TRUE_MESSAGE(json.find("\"out_of_memory\"") != std::string::npos, json.c_str());
}

static void test_same_active_playlist_does_not_restart_playback()
{
  sim::reset();
  TempData data("protocol");
  data.write("playlists/christmas.json",
             R"({"format":"pixelart-playlist/1","canvas":{"width":16,"height":16},"items":[{"animation":"dot"}]})");
  setup();
  Replies replies;
  play_from_storage(); // clears any earlier reload request
  TEST_ASSERT_FALSE(playlist_reload_pending());

  replies.send(request(1, R"("cmd":"settings_set","playlist":"christmas")"));
  replies.pop();
  TEST_ASSERT_TRUE(playlist_reload_pending());

  play_from_storage();
  replies.send(request(2, R"("cmd":"settings_set","playlist":"christmas")"));
  std::string json = reply_json(replies.pop(), "settings_set");
  TEST_ASSERT_TRUE_MESSAGE(json.find("\"ok\":true") != std::string::npos, json.c_str());
  TEST_ASSERT_FALSE(playlist_reload_pending());
}

static void test_settings_set_is_all_or_nothing()
{
  sim::reset();
  TempData data("protocol");
  data.write("playlists/christmas.json",
             R"({"format":"pixelart-playlist/1","canvas":{"width":16,"height":16},"items":[{"animation":"dot"}]})");
  setup();
  Replies replies;
  play_from_storage();

  settings::fail_brightness_saves(true);
  replies.send(request(1, R"("cmd":"settings_set","brightness":7,"playlist":"christmas")"));
  settings::fail_brightness_saves(false);
  std::string json = reply_json(replies.pop(), "settings_set");
  TEST_ASSERT_TRUE_MESSAGE(json.find("\"error\":\"storage_error\"") != std::string::npos, json.c_str());
  TEST_ASSERT_EQUAL(settings::DEFAULT_BRIGHTNESS, settings::brightness());
  TEST_ASSERT_EQUAL_STRING(settings::DEFAULT_PLAYLIST, settings::playlist().c_str());
  TEST_ASSERT_FALSE(playlist_reload_pending());
}

static void test_settings_set_says_so_when_the_playlist_cannot_be_put_back()
{
  sim::reset();
  TempData data("protocol");
  data.write("playlists/christmas.json",
             R"({"format":"pixelart-playlist/1","canvas":{"width":16,"height":16},"items":[{"animation":"dot"}]})");
  setup();
  Replies replies;
  play_from_storage();

  settings::fail_brightness_saves(true);
  settings::fail_playlist_saves_after(1); // the new playlist is saved, putting the old one back fails
  replies.send(request(1, R"("cmd":"settings_set","brightness":7,"playlist":"christmas")"));
  std::string json = reply_json(replies.pop(), "settings_set");
  TEST_ASSERT_TRUE_MESSAGE(json.find("\"error\":\"storage_error\"") != std::string::npos, json.c_str());
  TEST_ASSERT_TRUE_MESSAGE(json.find("partly changed") != std::string::npos, json.c_str());
  TEST_ASSERT_EQUAL(settings::DEFAULT_BRIGHTNESS, settings::brightness());
  TEST_ASSERT_EQUAL_STRING("christmas", settings::playlist().c_str());
  TEST_ASSERT_TRUE(playlist_reload_pending()); // playback follows the playlist that stayed set
}

static void test_delete_all_keeps_the_settings_when_they_cannot_be_reset()
{
  sim::reset();
  TempData data("protocol");
  data.write("animations/dot.json", DOT);
  data.write("playlists/christmas.json",
             R"({"format":"pixelart-playlist/1","canvas":{"width":16,"height":16},"items":[{"animation":"dot"}]})");
  setup();
  settings::set_brightness(7);
  settings::set_playlist("christmas");
  Replies replies;

  settings::fail_brightness_saves(true);
  replies.send(request(1, R"("cmd":"delete_all","settings":true)"));
  std::string json = reply_json(replies.pop(), "delete_all");
  TEST_ASSERT_TRUE_MESSAGE(json.find("\"error\":\"storage_error\"") != std::string::npos, json.c_str());
  TEST_ASSERT_TRUE_MESSAGE(json.find("the files are removed") != std::string::npos, json.c_str());
  TEST_ASSERT_TRUE_MESSAGE(json.find("partly changed") == std::string::npos, json.c_str());
  TEST_ASSERT_FALSE(fs::exists(data.root / "animations/dot.json"));
  TEST_ASSERT_FALSE(fs::exists(data.root / "playlists/christmas.json"));
  TEST_ASSERT_EQUAL(7, settings::brightness());
  TEST_ASSERT_EQUAL_STRING("christmas", settings::playlist().c_str());

  // Once the settings memory works again, a new request finishes the reset.
  settings::fail_brightness_saves(false);
  replies.send(request(2, R"("cmd":"delete_all","settings":true)"));
  json = reply_json(replies.pop(), "delete_all");
  TEST_ASSERT_TRUE_MESSAGE(json.find("\"settings\":{\"brightness\":100,\"playlist\":\"default\"}") != std::string::npos,
                           json.c_str());
}

static void test_delete_all_says_so_when_the_settings_are_partly_reset()
{
  sim::reset();
  TempData data("protocol");
  data.write("playlists/christmas.json",
             R"({"format":"pixelart-playlist/1","canvas":{"width":16,"height":16},"items":[{"animation":"dot"}]})");
  setup();
  settings::set_brightness(7);
  settings::set_playlist("christmas");
  Replies replies;

  settings::fail_brightness_saves(true);
  settings::fail_playlist_saves_after(1); // the default playlist is saved, putting the old one back fails
  replies.send(request(1, R"("cmd":"delete_all","settings":true)"));
  std::string json = reply_json(replies.pop(), "delete_all");
  TEST_ASSERT_TRUE_MESSAGE(json.find("\"error\":\"storage_error\"") != std::string::npos, json.c_str());
  TEST_ASSERT_TRUE_MESSAGE(json.find("partly changed") != std::string::npos, json.c_str());
  TEST_ASSERT_EQUAL(7, settings::brightness());
  TEST_ASSERT_EQUAL_STRING(settings::DEFAULT_PLAYLIST, settings::playlist().c_str());
  TEST_ASSERT_TRUE(playlist_reload_pending());
}

static void test_info_reports_the_memory_probe()
{
  sim::reset();
  TempData data("protocol");
  setup();
  Replies replies;
  protocol::set_memory_probe(low_memory);
  replies.send(request(1, R"("cmd":"info")"));
  protocol::set_memory_probe(nullptr);
  std::string info = reply_json(replies.pop(), "info");
  TEST_ASSERT_TRUE_MESSAGE(info.find("\"memory\":{\"free\":5000,\"largest\":3000}") != std::string::npos, info.c_str());
}

static void test_replies_are_whole_lines()
{
  // Each reply is one serial line: nothing else is written between its bytes.
  sim::reset();
  TempData data("protocol");
  setup();
  Replies replies;
  replies.send(request(1, R"("cmd":"info")") + request(2, R"("cmd":"settings_get")"));
  TEST_ASSERT_EQUAL(2, replies.size());
  TEST_ASSERT_EQUAL(2, sim::serial().size());
  for (const sim::SerialLine &line : sim::serial())
    TEST_ASSERT_EQUAL(0, line.text.find("@PR "));
}

static void test_protocol_logs_do_not_stop_the_reader()
{
  sim::reset();
  TempData data("protocol");
  setup();
  Replies replies;
  replies.send("garbage\n" + request(1, R"("cmd":"settings_get")") + "more garbage\n");
  TEST_ASSERT_EQUAL(1, replies.size());
  replies.pop();
  TEST_ASSERT_TRUE(replies.empty());
}

static void test_path_traversal_ids_never_reach_storage()
{
  sim::reset();
  TempData data("protocol");
  data.write("animations/dot.json", DOT);
  fs::create_directories(data.root.parent_path() / "outside");
  std::ofstream(data.root.parent_path() / "outside" / "secret.json") << "x";
  setup();
  Replies replies;
  unsigned seq = 1;
  for (const char *id : {"../outside/secret", "..", ".", "a/b", "a\\\\b", "dot.json", "%2e%2e", "/etc/passwd"})
  {
    for (const char *cmd : {"delete", "get", "put_begin"})
    {
      std::string fields = std::string("\"cmd\":\"") + cmd + "\",\"kind\":\"animation\",\"id\":\"" + id + "\"";
      if (!strcmp(cmd, "get"))
        fields += ",\"offset\":0,\"length\":1";
      if (!strcmp(cmd, "put_begin"))
        fields += ",\"size\":1,\"sha256\":\"" + std::string(64, '0') + "\"";
      replies.send(request(seq++, fields));
      std::string json = reply_json(replies.pop(), id);
      TEST_ASSERT_TRUE_MESSAGE(json.find("\"invalid_id\"") != std::string::npos,
                               (std::string(id) + ": " + json).c_str());
    }
  }
  TEST_ASSERT_TRUE(fs::exists(data.root.parent_path() / "outside" / "secret.json"));
  TEST_ASSERT_TRUE(fs::exists(data.root / "animations/dot.json"));
  fs::remove_all(data.root.parent_path() / "outside");
}

// The reply of `list` for animations, as JSON text.
static std::string list_animations(Replies &replies, unsigned seq)
{
  replies.send(request(seq, R"("cmd":"list","kind":"animation")"));
  return reply_json(replies.pop(), "list");
}

static void expect_in(const std::string &part, const std::string &json)
{
  TEST_ASSERT_TRUE_MESSAGE(json.find(part) != std::string::npos, (part + " not in " + json).c_str());
}

static void expect_not_in(const std::string &part, const std::string &json)
{
  TEST_ASSERT_TRUE_MESSAGE(json.find(part) == std::string::npos, (part + " in " + json).c_str());
}

// SHA-256 values below were computed with Python hashlib over the bytes the
// test spells out.
static void test_control_characters_are_escaped_in_replies()
{
  // A diagnostic, a message that names a field and a list name, each quoting
  // U+0001 or U+001F: reply_json checks that every reply is strict JSON.
  std::string file = DOT.substr(0, DOT.size() - 1) + R"(,"a\u0001b":1})";
  std::string json = end_upload(file, file, file.size());
  expect_in(R"("code":"structure")", json);
  expect_in(R"(a\u0001b)", json);

  sim::reset();
  TempData data("protocol");
  std::string named = DOT;
  named.replace(named.find(R"("Dot")"), 5, R"("D\u001ft")");
  data.write("animations/named.json", named);
  setup();
  Replies replies;
  expect_in(R"("name":"D\u001ft")", list_animations(replies, 1));
  replies.send(request(2, R"("cmd":"list","kind":"animation","a\u0001b":1)"));
  json = reply_json(replies.pop(), "list");
  expect_in(R"("error":"bad_request")", json);
  expect_in(R"(a\u0001b)", json);
}

static void test_list_reads_metadata_only_up_to_the_size_limit()
{
  sim::reset();
  TempData data("protocol");
  // DOT padded with spaces: still valid JSON, 65536 bytes (the limit) and 65537.
  data.write("animations/limit.json", DOT + std::string(65536 - DOT.size(), ' '));
  data.write("animations/over.json", DOT + std::string(65537 - DOT.size(), ' '));
  data.write("animations/x.json", std::string(65537, 'x'));
  setup();
  Replies replies;
  std::string json = list_animations(replies, 1);
  expect_in(
      R"({"id":"limit","size":65536,"sha256":"f8d52b0990cd5e89e3836ff9018b72c5a147343a618c85eaa63320c21b6f305f","name":"Dot","version":1})",
      json);
  expect_in(R"({"id":"over","size":65537,"sha256":"5c2689ca514af6b8e0035e2da96a2b642c5719229db6962da497b750723ac846"})",
            json);
  expect_in(R"({"id":"x","size":65537,"sha256":"1abe08ebecf1c18cab71f6fe28aaddf20268f85bad78bb9a72f88ca47c874662"})",
            json);
}

static void test_list_a_folder_named_like_a_file_is_not_listed()
{
  sim::reset();
  TempData data("protocol");
  data.write("animations/dot.json", DOT);
  fs::create_directories(data.root / "animations" / "x.json");
  setup();
  Replies replies;
  std::string json = list_animations(replies, 1);
  expect_in(R"("id":"dot")", json);
  expect_not_in(R"("id":"x")", json);

  // A folder is not a stored file, so the other commands do not find it either.
  replies.send(request(2, R"("cmd":"get","kind":"animation","id":"x","offset":0,"length":1)"));
  expect_in(R"("error":"not_found")", reply_json(replies.pop(), "get"));
  replies.send(request(3, R"("cmd":"delete","kind":"animation","id":"x")"));
  expect_in(R"("error":"not_found")", reply_json(replies.pop(), "delete"));
  TEST_ASSERT_TRUE(fs::is_directory(data.root / "animations" / "x.json"));
}

static void test_list_keeps_size_of_a_file_it_cannot_open()
{
  sim::reset();
  TempData data("protocol");
  setup();
  storage::Writer writer;
  TEST_ASSERT_TRUE(writer.open("/animations/held.json"));
  TEST_ASSERT_TRUE(writer.write("abc", 3));
  Replies replies;
  expect_in(R"({"id":"held","size":3})", list_animations(replies, 1));
}

static void test_list_falls_back_to_piecewise_hash_when_read_all_fails()
{
  sim::reset();
  TempData data("protocol");
  data.write("animations/dot.json", DOT);
  setup();
  Replies replies;
  const char *entry_without_name =
      R"({"id":"dot","size":147,"sha256":"3c878c7d9776ae2066e60d164ef9d7f3d245fd1a844ba99d76ce31162d8fb225"})";

  // The buffer is filled and then the read is reported as failed: no name from it.
  storage::set_read_all_failure(storage::ReadResult::Unreadable);
  expect_in(entry_without_name, list_animations(replies, 1));
  // No memory for the buffer.
  storage::set_read_all_failure(storage::ReadResult::OutOfMemory);
  expect_in(entry_without_name, list_animations(replies, 2));
  storage::set_read_all_failure(storage::ReadResult::Ok);
  expect_in(R"("name":"Dot")", list_animations(replies, 3));
}

void setUp() {}
void tearDown() {}

int main(int, char **)
{
  UNITY_BEGIN();
  RUN_TEST(test_conformance_cases);
  RUN_TEST(test_line_reader_limits);
  RUN_TEST(test_out_of_memory_at_begin_creates_nothing);
  RUN_TEST(test_out_of_memory_at_end_leaves_everything_unchanged);
  RUN_TEST(test_boot_id_differs_between_starts);
  RUN_TEST(test_idle_upload_ends_when_a_line_is_handled_without_poll);
  RUN_TEST(test_chunk_write_failure_cancels_the_upload);
  RUN_TEST(test_upload_file_is_open_only_while_the_upload_is);
  RUN_TEST(test_refused_put_begin_closes_the_open_upload_file);
  RUN_TEST(test_every_put_end_result_closes_the_upload_file);
  RUN_TEST(test_put_end_reply_stays_under_16_kib_with_long_texts);
  RUN_TEST(test_control_characters_are_escaped_in_replies);
  RUN_TEST(test_same_active_playlist_does_not_restart_playback);
  RUN_TEST(test_settings_set_is_all_or_nothing);
  RUN_TEST(test_settings_set_says_so_when_the_playlist_cannot_be_put_back);
  RUN_TEST(test_delete_all_keeps_the_settings_when_they_cannot_be_reset);
  RUN_TEST(test_delete_all_says_so_when_the_settings_are_partly_reset);
  RUN_TEST(test_info_reports_the_memory_probe);
  RUN_TEST(test_replies_are_whole_lines);
  RUN_TEST(test_protocol_logs_do_not_stop_the_reader);
  RUN_TEST(test_path_traversal_ids_never_reach_storage);
  RUN_TEST(test_list_reads_metadata_only_up_to_the_size_limit);
  RUN_TEST(test_list_a_folder_named_like_a_file_is_not_listed);
  RUN_TEST(test_list_keeps_size_of_a_file_it_cannot_open);
  RUN_TEST(test_list_falls_back_to_piecewise_hash_when_read_all_fails);
  return UNITY_END();
}
