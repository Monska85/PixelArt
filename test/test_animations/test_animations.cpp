// Runs the firmware's playback on the simulator: animations and playlists
// read from storage, the fallbacks of docs/format/playlist-v1.md, and the LED
// output. Run with: pio test -e native_test (or make test)

#include <sim.h>
#include <unity.h>

#include <cstring>
#include <filesystem>
#include <fstream>
#include <string>

#include <pixelart_engine.h>

#include "app.h"
#include "pixel_art.h"
#include "settings.h"
#include "pixelart_test.h"

namespace fs = std::filesystem;
using pixelart_test::dot_animation;
using pixelart_test::TempData;

static const std::string REPO_DATA = std::string(PIXELART_PROJECT_DIR) + "/data";

static uint8_t red(uint32_t c) { return c >> 16; }
static uint8_t green(uint32_t c) { return c >> 8; }
static uint8_t blue(uint32_t c) { return c; }

static std::string serial_text()
{
  std::string text;
  for (const sim::SerialLine &line : sim::serial())
    text += line.text + "\n";
  return text;
}

void setUp()
{
  sim::reset();
  sim::set_data_dir(REPO_DATA);
  setup();
}

void tearDown() {}

void test_xmas_tree_frames_and_timing()
{
  TEST_ASSERT_TRUE(play_stored_animation("xmas_tree"));
  const auto &frames = sim::frames();
  TEST_ASSERT_EQUAL(17, frames.size());
  TEST_ASSERT_EQUAL_UINT64(0, frames[0].t_us);
  TEST_ASSERT_EQUAL_UINT64(500000, frames[1].t_us - frames[0].t_us);
}

void test_xmas_tree_star_is_yellow_and_corner_is_off()
{
  TEST_ASSERT_TRUE(play_stored_animation("xmas_tree"));
  const sim::Frame &f = sim::frames()[0];
  uint32_t star = f.at(7, 0);
  TEST_ASSERT_TRUE(red(star) > blue(star) * 4);
  TEST_ASSERT_TRUE(green(star) > blue(star) * 4);
  TEST_ASSERT_EQUAL_UINT32(0, f.at(0, 0));
}

void test_brightness_scales_led_output()
{
  matrix.fillScreen(matrix.Color(255, 255, 255));
  matrix.show();
  uint32_t white = sim::frames().back().at(0, 0);
  TEST_ASSERT_EQUAL_UINT8((255 * (settings::DEFAULT_BRIGHTNESS + 1)) >> 8, red(white));
}

void test_effective_brightness_rule()
{
  struct Row
  {
    uint8_t board, percent, expected;
  };
  // Hand-computed from docs/format/pixelart-v1.md#brightness.
  static const Row ROWS[] = {{100, 100, 100}, {100, 50, 50},  {255, 33, 84}, {255, 100, 255}, {3, 50, 2},    {1, 1, 1},
                             {0, 50, 0},      {200, 99, 198}, {149, 1, 1},   {249, 1, 2},     {151, 99, 149}};
  for (const Row &row : ROWS)
    TEST_ASSERT_EQUAL_UINT8_MESSAGE(
        row.expected, pixelart::effective_brightness(row.board, row.percent),
        ("board " + std::to_string(row.board) + ", percent " + std::to_string(row.percent)).c_str());
}

void test_animation_brightness_lowers_led_output()
{
  TempData data("animations");
  data.write("animations/a.json", dot_animation("#ffffff", 1, 100, 50));
  play_stored_animation("a");
  TEST_ASSERT_EQUAL(1, sim::frames().size());
  TEST_ASSERT_EQUAL_UINT8(50, red(sim::frames()[0].at(0, 0)));
}

void test_animation_brightness_lowers_the_background()
{
  TempData data("animations");
  data.write("animations/a.json",
             R"({"format":"pixelart/1","name":"bg","canvas":{"width":16,"height":16},"brightness":50,)"
             R"("background":"#ffffff","sprites":{"d":{"points":{"#ff0000":[[0,0]]}}},"timeline":[{"show":["d"]}]})");
  play_stored_animation("a");
  TEST_ASSERT_EQUAL(1, sim::frames().size());
  TEST_ASSERT_EQUAL_UINT8(50, red(sim::frames()[0].at(15, 15)));
  TEST_ASSERT_EQUAL_UINT8(50, green(sim::frames()[0].at(15, 15)));
}

void test_no_animations_image_ignores_the_animation_brightness()
{
  TempData data("animations");
  data.write("animations/a.json", dot_animation("#ffffff", 1, 100, 50));
  play_stored_animation("a");
  TEST_ASSERT_EQUAL_UINT8(50, matrix.getBrightness());
  fs::remove(data.root / "animations" / "a.json");
  play_from_storage();
  TEST_ASSERT_EQUAL_UINT8(settings::brightness(), matrix.getBrightness());
  TEST_ASSERT_TRUE(sim::frames().back().at(7, 11) != 0);
}

void test_repository_playlist_plays_every_animation()
{
  play_from_storage();
  TEST_ASSERT_EQUAL(30, stored_animations().size());
  TEST_ASSERT_EQUAL(374, sim::frames().size());
  TEST_ASSERT_EQUAL_STRING("", serial_text().c_str());
}

void test_playlist_order_and_repeat()
{
  TempData data("animations");
  data.write("animations/a.json", dot_animation("#ff0000"));
  data.write("animations/b.json", dot_animation("#00ff00"));
  data.write("playlists/default.json", R"({"format":"pixelart-playlist/1","canvas":{"width":16,"height":16},)"
                                       R"("items":[{"animation":"b","repeat":2},{"animation":"a","enabled":false},)"
                                       R"({"animation":"a"}]})");
  play_from_storage();
  const auto &frames = sim::frames();
  TEST_ASSERT_EQUAL(3, frames.size());
  TEST_ASSERT_TRUE(green(frames[0].at(0, 0)) > 0 && red(frames[0].at(0, 0)) == 0);
  TEST_ASSERT_TRUE(green(frames[1].at(0, 0)) > 0);
  TEST_ASSERT_TRUE(red(frames[2].at(0, 0)) > 0 && green(frames[2].at(0, 0)) == 0);
}

void test_without_playlist_plays_all_in_alphabetical_order()
{
  TempData data("animations");
  data.write("animations/b.json", dot_animation("#00ff00"));
  data.write("animations/a.json", dot_animation("#ff0000"));
  play_from_storage();
  const auto &frames = sim::frames();
  TEST_ASSERT_EQUAL(2, frames.size());
  TEST_ASSERT_TRUE(red(frames[0].at(0, 0)) > 0);
  TEST_ASSERT_TRUE(green(frames[1].at(0, 0)) > 0);
}

void test_invalid_playlist_falls_back_and_is_reported()
{
  TempData data("animations");
  data.write("animations/a.json", dot_animation("#ff0000"));
  data.write("playlists/default.json", R"({"format":"pixelart-playlist/1","items":[]})");
  play_from_storage();
  TEST_ASSERT_EQUAL(1, sim::frames().size());
  TEST_ASSERT_NOT_NULL(strstr(serial_text().c_str(), "/playlists/default.json"));
}

void test_broken_animation_is_skipped_and_reported_once()
{
  TempData data("animations");
  data.write("animations/a.json", dot_animation("#ff0000"));
  data.write("animations/bad.json", dot_animation("gren"));
  data.write("playlists/default.json", R"({"format":"pixelart-playlist/1","canvas":{"width":16,"height":16},)"
                                       R"("items":[{"animation":"bad"},{"animation":"a"}]})");
  play_from_storage();
  play_from_storage();
  TEST_ASSERT_EQUAL(2, sim::frames().size());
  std::string text = serial_text();
  const char *first = strstr(text.c_str(), "unknown_color");
  TEST_ASSERT_NOT_NULL(first);
  TEST_ASSERT_NULL(strstr(first + 1, "unknown_color"));
}

void test_empty_storage_shows_the_no_animations_image()
{
  TempData data("animations");
  play_from_storage();
  const auto &frames = sim::frames();
  TEST_ASSERT_EQUAL(1, frames.size());
  TEST_ASSERT_EQUAL_UINT64(2000000, sim::now_us() - frames[0].t_us);
  TEST_ASSERT_TRUE(frames[0].at(7, 11) != 0);
}

int main(int, char **)
{
  UNITY_BEGIN();
  RUN_TEST(test_xmas_tree_frames_and_timing);
  RUN_TEST(test_xmas_tree_star_is_yellow_and_corner_is_off);
  RUN_TEST(test_brightness_scales_led_output);
  RUN_TEST(test_effective_brightness_rule);
  RUN_TEST(test_animation_brightness_lowers_led_output);
  RUN_TEST(test_animation_brightness_lowers_the_background);
  RUN_TEST(test_no_animations_image_ignores_the_animation_brightness);
  RUN_TEST(test_repository_playlist_plays_every_animation);
  RUN_TEST(test_playlist_order_and_repeat);
  RUN_TEST(test_without_playlist_plays_all_in_alphabetical_order);
  RUN_TEST(test_invalid_playlist_falls_back_and_is_reported);
  RUN_TEST(test_broken_animation_is_skipped_and_reported_once);
  RUN_TEST(test_empty_storage_shows_the_no_animations_image);
  return UNITY_END();
}
