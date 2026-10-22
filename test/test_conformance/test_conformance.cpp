// SPDX-License-Identifier: GPL-3.0-or-later

// Runs the conformance suite in conformance/ against the C++ engine.
// Run with: pio test -e native_test (or make test)

#include <ArduinoJson.h>
#include <pixelart_engine.h>
#include <unity.h>

#include <algorithm>
#include <filesystem>
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
  return UNITY_END();
}
