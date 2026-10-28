// SPDX-License-Identifier: GPL-3.0-or-later

// Runs the conformance suite in conformance/ against the C++ engine.
// Run with: pio test -e native_test (or make test)

#include <ArduinoJson.h>
#include <pixelart_engine.h>
#include <unity.h>

#include <algorithm>
#include <cstdio>
#include <filesystem>
#include <map>
#include <set>
#include <string>
#include <vector>

#include "pixelart_test.h"

namespace fs = std::filesystem;
using pixelart::Rgb;
using pixelart_test::read_file;

static const fs::path SUITE = fs::path(PIXELART_PROJECT_DIR) / "conformance";

static std::vector<fs::path> cases(const char *kind)
{
  std::vector<fs::path> out;
  for (const auto &entry : fs::directory_iterator(SUITE / kind))
  {
    std::string name = entry.path().filename().string();
    if (name.size() > 5 && name.substr(name.size() - 5) == ".json" && name.find(".expected.") == std::string::npos)
      out.push_back(entry.path());
  }
  std::sort(out.begin(), out.end());
  return out;
}

static fs::path expected_path(const fs::path &file)
{
  return file.parent_path() / (file.stem().string() + ".expected.json");
}

static Rgb parse_rgb(const char *hex) { return (Rgb)std::stoul(std::string(hex + 1), nullptr, 16); }

static std::string describe(const std::vector<pixelart::Diagnostic> &diagnostics)
{
  std::string out;
  for (const auto &d : diagnostics)
    out += (d.severity == pixelart::Severity::Error ? " error " : " warning ") + d.code + " at " + d.where + ": " +
           d.message + ";";
  return out;
}

// The expected error code must be among the errors, and the number of kept
// messages must respect "max_diagnostics" when the case sets it.
static void check_rejection(const std::string &name, const JsonDocument &expected,
                            const std::vector<pixelart::Diagnostic> &diagnostics)
{
  std::string want = expected["error"].as<const char *>();
  bool found = false;
  for (const auto &d : diagnostics)
    found = found || (d.severity == pixelart::Severity::Error && d.code == want);
  TEST_ASSERT_TRUE_MESSAGE(found, (name + ": expected error " + want + ", got:" + describe(diagnostics)).c_str());
  if (!expected["max_diagnostics"].isNull())
    TEST_ASSERT_TRUE_MESSAGE(diagnostics.size() <= expected["max_diagnostics"].as<size_t>(),
                             (name + ": kept " + std::to_string(diagnostics.size()) + " messages").c_str());
}

static void test_valid_cases()
{
  std::vector<fs::path> files = cases("valid");
  TEST_ASSERT_TRUE_MESSAGE(!files.empty(), "no valid cases found");
  for (const fs::path &file : files)
  {
    std::string name = file.stem().string();
    std::string json = read_file(file);
    std::vector<pixelart::Diagnostic> diagnostics;
    pixelart::Animation animation;
    bool ok = animation.load(json.data(), json.size(), diagnostics);
    TEST_ASSERT_TRUE_MESSAGE(ok, (name + ": rejected:" + describe(diagnostics)).c_str());

    JsonDocument expected;
    std::string expected_json = read_file(expected_path(file));
    TEST_ASSERT_FALSE_MESSAGE(deserializeJson(expected, expected_json), (name + ": bad expected file").c_str());

    std::set<std::string> want_warnings, got_warnings;
    for (JsonVariantConst w : expected["warnings"].as<JsonArrayConst>())
      want_warnings.insert(w.as<const char *>());
    for (const auto &d : diagnostics)
      if (d.severity == pixelart::Severity::Warning)
        got_warnings.insert(d.code);
    TEST_ASSERT_TRUE_MESSAGE(want_warnings == got_warnings,
                             (name + ": warnings differ:" + describe(diagnostics)).c_str());

    const int want_brightness = expected["brightness"].isNull() ? 100 : expected["brightness"].as<int>();
    TEST_ASSERT_EQUAL_MESSAGE(want_brightness, animation.brightness(), (name + ": brightness").c_str());

    pixelart::Player player(animation);
    pixelart::Frame frame;
    size_t index = 0;
    for (JsonVariantConst want : expected["frames"].as<JsonArrayConst>())
    {
      std::string at = name + ": frame " + std::to_string(index++);
      TEST_ASSERT_TRUE_MESSAGE(player.next(frame), (at + " missing").c_str());
      TEST_ASSERT_EQUAL_UINT16_MESSAGE(want["ms"].as<uint16_t>(), frame.ms, (at + " duration").c_str());

      Rgb grid[pixelart::CANVAS_HEIGHT][pixelart::CANVAS_WIDTH];
      Rgb background = want["background"].isNull() ? 0 : parse_rgb(want["background"].as<const char *>());
      for (auto &row : grid)
        for (Rgb &px : row)
          px = background;
      for (JsonPairConst group : want["pixels"].as<JsonObjectConst>())
        for (JsonVariantConst p : group.value().as<JsonArrayConst>())
          grid[p[1].as<int>()][p[0].as<int>()] = parse_rgb(group.key().c_str());

      for (int y = 0; y < pixelart::CANVAS_HEIGHT; y++)
        for (int x = 0; x < pixelart::CANVAS_WIDTH; x++)
          if (grid[y][x] != frame.pixels[y][x])
          {
            char msg[160];
            snprintf(msg, sizeof(msg), "%s pixel [%d, %d]: expected #%06x, got #%06x", at.c_str(), x, y,
                     (unsigned)grid[y][x], (unsigned)frame.pixels[y][x]);
            TEST_FAIL_MESSAGE(msg);
          }
    }
    TEST_ASSERT_FALSE_MESSAGE(player.next(frame), (name + ": more frames than expected").c_str());
  }
}

static void test_invalid_cases()
{
  std::vector<fs::path> files = cases("invalid");
  TEST_ASSERT_TRUE_MESSAGE(!files.empty(), "no invalid cases found");
  for (const fs::path &file : files)
  {
    std::string name = file.stem().string();
    std::string json = read_file(file);
    JsonDocument expected;
    std::string expected_json = read_file(expected_path(file));
    TEST_ASSERT_FALSE_MESSAGE(deserializeJson(expected, expected_json), (name + ": bad expected file").c_str());
    std::string want = expected["error"].as<const char *>();

    std::vector<pixelart::Diagnostic> diagnostics;
    pixelart::Animation animation;
    bool ok = animation.load(json.data(), json.size(), diagnostics);
    TEST_ASSERT_FALSE_MESSAGE(ok, (name + ": accepted, expected error " + want).c_str());
    TEST_ASSERT_FALSE_MESSAGE(animation.loaded(), (name + ": rejected but marked as loaded").c_str());
    check_rejection(name, expected, diagnostics);
  }
}

static void test_playlist_valid_cases()
{
  std::vector<fs::path> files = cases("playlist/valid");
  TEST_ASSERT_TRUE_MESSAGE(!files.empty(), "no valid playlist cases found");
  for (const fs::path &file : files)
  {
    std::string name = file.stem().string();
    std::string json = read_file(file);
    std::vector<pixelart::Diagnostic> diagnostics;
    pixelart::Playlist playlist;
    TEST_ASSERT_TRUE_MESSAGE(playlist.load(json.data(), json.size(), diagnostics),
                             (name + ": rejected:" + describe(diagnostics)).c_str());

    JsonDocument expected;
    std::string expected_json = read_file(expected_path(file));
    TEST_ASSERT_FALSE_MESSAGE(deserializeJson(expected, expected_json), (name + ": bad expected file").c_str());
    JsonArrayConst items = expected["items"].as<JsonArrayConst>();
    TEST_ASSERT_EQUAL_MESSAGE(items.size(), playlist.items().size(), (name + ": number of items").c_str());
    size_t i = 0;
    for (JsonVariantConst want : items)
    {
      const pixelart::PlaylistItem &got = playlist.items()[i++];
      TEST_ASSERT_EQUAL_STRING_MESSAGE(want["animation"].as<const char *>(), got.animation.c_str(), name.c_str());
      TEST_ASSERT_EQUAL_MESSAGE(want["repeat"].as<int>(), got.repeat, name.c_str());
    }
  }
}

static void test_playlist_invalid_cases()
{
  std::vector<fs::path> files = cases("playlist/invalid");
  TEST_ASSERT_TRUE_MESSAGE(!files.empty(), "no invalid playlist cases found");
  for (const fs::path &file : files)
  {
    std::string name = file.stem().string();
    std::string json = read_file(file);
    JsonDocument expected;
    std::string expected_json = read_file(expected_path(file));
    TEST_ASSERT_FALSE_MESSAGE(deserializeJson(expected, expected_json), (name + ": bad expected file").c_str());

    std::vector<pixelart::Diagnostic> diagnostics;
    pixelart::Playlist playlist;
    TEST_ASSERT_FALSE_MESSAGE(playlist.load(json.data(), json.size(), diagnostics), (name + ": accepted").c_str());
    TEST_ASSERT_TRUE_MESSAGE(playlist.items().empty(), (name + ": rejected but kept items").c_str());
    check_rejection(name, expected, diagnostics);
  }
}

// "YYYY-MM-DD" of a row.
static pixelart::LocalDate row_date(const char *text)
{
  unsigned year = 0, month = 0, day = 0;
  TEST_ASSERT_EQUAL_MESSAGE(3, sscanf(text, "%u-%u-%u", &year, &month, &day), "a date is YYYY-MM-DD");
  return {(uint16_t)year, (uint8_t)month, (uint8_t)day};
}

static std::vector<std::string> text_list(JsonVariantConst list)
{
  std::vector<std::string> out;
  for (JsonVariantConst v : list.as<JsonArrayConst>())
    out.push_back(v.as<std::string>());
  return out;
}

// The parts of `end` that are present, as the expected file writes them.
static std::string end_text(const pixelart::ScheduleEnd &end)
{
  JsonDocument doc;
  if (end.year)
    doc["year"] = end.year;
  if (end.month)
    doc["month"] = end.month;
  if (end.day)
    doc["day"] = end.day;
  return doc.as<std::string>();
}

static std::string expected_end_text(JsonVariantConst end)
{
  JsonDocument doc;
  for (const char *part : {"year", "month", "day"})
    if (!end[part].isNull())
      doc[part] = end[part].as<int>();
  return doc.as<std::string>();
}

// The schedules of a row file, loaded with the real loader, by key.
static std::map<std::string, pixelart::Schedule> row_schedules(const JsonDocument &rows, const std::string &file)
{
  std::map<std::string, pixelart::Schedule> out;
  for (JsonPairConst pair : rows["schedules"].as<JsonObjectConst>())
  {
    const std::string json = pair.value().as<std::string>();
    std::vector<pixelart::Diagnostic> diagnostics;
    TEST_ASSERT_TRUE_MESSAGE(
        out[pair.key().c_str()].load(json.data(), json.size(), diagnostics),
        (file + ": schedule " + pair.key().c_str() + " rejected:" + describe(diagnostics)).c_str());
  }
  return out;
}

static void test_schedule_valid_cases()
{
  std::vector<fs::path> files = cases("schedule/valid");
  TEST_ASSERT_TRUE_MESSAGE(!files.empty(), "no valid schedule cases found");
  for (const fs::path &file : files)
  {
    std::string name = file.stem().string();
    std::string json = read_file(file);
    std::vector<pixelart::Diagnostic> diagnostics;
    pixelart::Schedule schedule;
    TEST_ASSERT_TRUE_MESSAGE(schedule.load(json.data(), json.size(), diagnostics),
                             (name + ": rejected:" + describe(diagnostics)).c_str());

    JsonDocument expected;
    std::string expected_json = read_file(expected_path(file));
    TEST_ASSERT_FALSE_MESSAGE(deserializeJson(expected, expected_json), (name + ": bad expected file").c_str());
    TEST_ASSERT_TRUE_MESSAGE(text_list(expected["fallback"]) == schedule.fallback(), (name + ": fallback").c_str());
    JsonArrayConst entries = expected["entries"].as<JsonArrayConst>();
    TEST_ASSERT_EQUAL_MESSAGE(entries.size(), schedule.entry_count(), (name + ": number of entries").c_str());
    size_t i = 0;
    for (JsonVariantConst want : entries)
    {
      const std::string at = name + ": entry " + std::to_string(i);
      TEST_ASSERT_EQUAL_STRING_MESSAGE(expected_end_text(want["from"]).c_str(), end_text(schedule.from(i)).c_str(),
                                       (at + " from").c_str());
      TEST_ASSERT_EQUAL_STRING_MESSAGE(expected_end_text(want["to"]).c_str(), end_text(schedule.to(i)).c_str(),
                                       (at + " to").c_str());
      TEST_ASSERT_TRUE_MESSAGE(text_list(want["playlists"]) == schedule.playlists(i), (at + " playlists").c_str());
      i++;
    }
  }
}

static void test_schedule_invalid_cases()
{
  std::vector<fs::path> files = cases("schedule/invalid");
  TEST_ASSERT_TRUE_MESSAGE(!files.empty(), "no invalid schedule cases found");
  for (const fs::path &file : files)
  {
    std::string name = file.stem().string();
    std::string json = read_file(file);
    JsonDocument expected;
    std::string expected_json = read_file(expected_path(file));
    TEST_ASSERT_FALSE_MESSAGE(deserializeJson(expected, expected_json), (name + ": bad expected file").c_str());

    std::vector<pixelart::Diagnostic> diagnostics;
    pixelart::Schedule schedule;
    TEST_ASSERT_FALSE_MESSAGE(schedule.load(json.data(), json.size(), diagnostics), (name + ": accepted").c_str());
    TEST_ASSERT_TRUE_MESSAGE(schedule.fallback().empty() && schedule.entry_count() == 0,
                             (name + ": rejected but kept its content").c_str());
    check_rejection(name, expected, diagnostics);
  }
}

static void test_schedule_winner_rows()
{
  JsonDocument rows;
  TEST_ASSERT_FALSE(deserializeJson(rows, read_file(SUITE / "schedule" / "winner.json")));
  const std::map<std::string, pixelart::Schedule> schedules = row_schedules(rows, "winner.json");
  TEST_ASSERT_TRUE(rows["rows"].size() > 0);
  for (JsonVariantConst row : rows["rows"].as<JsonArrayConst>())
  {
    const std::string schedule = row["schedule"].as<std::string>(), date = row["date"].as<std::string>();
    const std::string at = "winner.json: " + schedule + " on " + date;
    TEST_ASSERT_TRUE_MESSAGE(schedules.count(schedule) == 1, (at + ": no such schedule").c_str());
    const pixelart::LocalDate local = row_date(date.c_str());
    TEST_ASSERT_TRUE_MESSAGE(pixelart::is_schedule_date(local), (at + ": not a date").c_str());
    const int want = row["entry"].isNull() ? -1 : row["entry"].as<int>();
    TEST_ASSERT_EQUAL_INT_MESSAGE(want, schedules.at(schedule).winner(local), at.c_str());
  }
}

static void test_schedule_resolver_rows()
{
  JsonDocument rows;
  TEST_ASSERT_FALSE(deserializeJson(rows, read_file(SUITE / "schedule" / "resolver.json")));
  const std::map<std::string, pixelart::Schedule> schedules = row_schedules(rows, "resolver.json");
  TEST_ASSERT_TRUE(rows["rows"].size() > 0);
  for (JsonVariantConst row : rows["rows"].as<JsonArrayConst>())
  {
    const std::string at = std::string("resolver.json: ") + row["name"].as<const char *>();
    const std::string play = row["play"].as<std::string>();
    TEST_ASSERT_TRUE_MESSAGE(play == "auto" || play == "playlists", (at + ": play").c_str());
    const pixelart::Schedule *schedule = nullptr;
    if (!row["schedule"].isNull())
    {
      TEST_ASSERT_TRUE_MESSAGE(schedules.count(row["schedule"].as<std::string>()) == 1,
                               (at + ": no such schedule").c_str());
      schedule = &schedules.at(row["schedule"].as<std::string>());
    }
    pixelart::LocalDate date;
    if (!row["date"].isNull())
      date = row_date(row["date"].as<const char *>());
    const std::vector<std::string> playable = text_list(row["playable"]);
    const pixelart::PlayChoice choice =
        pixelart::choose_playlists(play == "auto" ? pixelart::PlayMode::Auto : pixelart::PlayMode::Playlists,
                                   text_list(row["playlists"]), schedule, row["date"].isNull() ? nullptr : &date,
                                   [&](const std::string &id)
                                   {
                                     return std::find(playable.begin(), playable.end(), id) != playable.end();
                                   });

    JsonVariantConst expected = row["expected"];
    TEST_ASSERT_EQUAL_STRING_MESSAGE(expected["reason"].as<const char *>(), pixelart::play_reason_name(choice.reason),
                                     (at + ": reason").c_str());
    TEST_ASSERT_EQUAL_INT_MESSAGE(expected["entry"].isNull() ? -1 : expected["entry"].as<int>(), choice.entry,
                                  (at + ": entry").c_str());
    TEST_ASSERT_TRUE_MESSAGE(text_list(expected["playlists"]) == choice.playlists, (at + ": playlists").c_str());
    const std::string playing = choice.playing < 0 ? "" : choice.playlists[choice.playing];
    TEST_ASSERT_EQUAL_STRING_MESSAGE(expected["playing"].isNull() ? "" : expected["playing"].as<const char *>(),
                                     playing.c_str(), (at + ": playing").c_str());
  }
}

static void test_restart_replays_from_start()
{
  std::string json = read_file(SUITE / "valid" / "timeline_loops_and_ms.json");
  std::vector<pixelart::Diagnostic> diagnostics;
  pixelart::Animation animation;
  TEST_ASSERT_TRUE(animation.load(json.data(), json.size(), diagnostics));
  pixelart::Player player(animation);
  pixelart::Frame frame;
  size_t first_run = 0, second_run = 0;
  while (player.next(frame))
    first_run++;
  player.restart();
  while (player.next(frame))
    second_run++;
  TEST_ASSERT_EQUAL(8, first_run);
  TEST_ASSERT_EQUAL(first_run, second_run);
}

void setUp() {}
void tearDown() {}

int main(int, char **)
{
  UNITY_BEGIN();
  RUN_TEST(test_valid_cases);
  RUN_TEST(test_invalid_cases);
  RUN_TEST(test_restart_replays_from_start);
  RUN_TEST(test_playlist_valid_cases);
  RUN_TEST(test_playlist_invalid_cases);
  RUN_TEST(test_schedule_valid_cases);
  RUN_TEST(test_schedule_invalid_cases);
  RUN_TEST(test_schedule_winner_rows);
  RUN_TEST(test_schedule_resolver_rows);
  return UNITY_END();
}
