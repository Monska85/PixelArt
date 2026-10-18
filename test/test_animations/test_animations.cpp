// Runs the firmware's playback on the simulator: animations and playlists
// read from storage, the fallbacks of docs/format/playlist-v1.md, and the LED
// output. Run with: pio test -e native_test (or make test)

#include <sim.h>
#include <unity.h>

#include <cstring>
#include <filesystem>
#include <fstream>
#include <string>

#include "app.h"
#include "pixel_art.h"

namespace fs = std::filesystem;

static const std::string REPO_DATA = std::string(PIXELART_PROJECT_DIR) + "/data";

static uint8_t red(uint32_t c) { return c >> 16; }
static uint8_t green(uint32_t c) { return c >> 8; }
static uint8_t blue(uint32_t c) { return c; }

// A throwaway storage folder for one test.
struct TempData
{
  fs::path root;
  TempData()
  {
    root = fs::temp_directory_path() / ("pixelart-test-" + std::to_string(std::rand()));
    fs::remove_all(root);
    fs::create_directories(root / "animations");
    fs::create_directories(root / "playlists");
    sim::set_data_dir(root.string());
  }
  ~TempData() { fs::remove_all(root); }
  void write(const std::string &path, const std::string &text) const { std::ofstream(root / path) << text; }
};

static std::string dot_animation(const char *color)
{
  return std::string(R"({"format":"pixelart/1","name":"dot","canvas":{"width":16,"height":16},"frame_ms":100,)") +
         R"("sprites":{"d":{"points":{")" + color + R"(":[[0,0]]}}},"timeline":[{"show":["d"]}]})";
}

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
  TEST_ASSERT_EQUAL_UINT8((255 * (BRIGHTNESS + 1)) >> 8, red(white));
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
  TempData data;
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
  TempData data;
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
  TempData data;
  data.write("animations/a.json", dot_animation("#ff0000"));
  data.write("playlists/default.json", R"({"format":"pixelart-playlist/1","items":[]})");
  play_from_storage();
  TEST_ASSERT_EQUAL(1, sim::frames().size());
  TEST_ASSERT_NOT_NULL(strstr(serial_text().c_str(), "/playlists/default.json"));
}

void test_broken_animation_is_skipped_and_reported_once()
{
  TempData data;
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
  TempData data;
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
  RUN_TEST(test_repository_playlist_plays_every_animation);
  RUN_TEST(test_playlist_order_and_repeat);
  RUN_TEST(test_without_playlist_plays_all_in_alphabetical_order);
  RUN_TEST(test_invalid_playlist_falls_back_and_is_reported);
  RUN_TEST(test_broken_animation_is_skipped_and_reported_once);
  RUN_TEST(test_empty_storage_shows_the_no_animations_image);
  return UNITY_END();
}
