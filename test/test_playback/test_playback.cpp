// SPDX-License-Identifier: GPL-3.0-or-later

// Protocol traffic while the board plays: playback stays on schedule, and
// brightness, playlist and upload changes reach it at the times the protocol
// specification gives. Run with: pio test -e native_test (or make test)

#include <ArduinoJson.h>
#include <sim.h>
#include <unity.h>

#include <filesystem>
#include <string>
#include <vector>

#include "app.h"
#include "pixel_art.h"
#include "protocol.h"
#include "settings.h"
#include "pixelart_test.h"

namespace fs = std::filesystem;
using pixelart_test::dot_animation;
using pixelart_test::green;
using pixelart_test::put_begin;
using pixelart_test::put_chunk;
using pixelart_test::red;
using pixelart_test::REPO_DATA;
using pixelart_test::request;
using pixelart_test::TempData;

static std::string playlist_of(std::initializer_list<const char *> animations)
{
  std::string items;
  for (const char *a : animations)
    items += std::string(items.empty() ? "" : ",") + R"({"animation":")" + a + R"("})";
  return R"({"format":"pixelart-playlist/1","canvas":{"width":16,"height":16},"items":[)" + items + "]}";
}

// The animation (a is red, b is green) of each recorded frame, as a letter.
static std::string shown()
{
  std::string out;
  for (const sim::Frame &f : sim::frames())
    out += red(f.at(0, 0)) ? 'a' : green(f.at(0, 0)) ? 'b' : '?';
  return out;
}

static std::string logs_without_protocol_lines()
{
  std::string text;
  for (const sim::SerialLine &line : sim::serial())
    if (line.text.rfind("@PR ", 0) != 0)
      text += line.text + "\n";
  return text;
}

static size_t protocol_lines()
{
  size_t n = 0;
  for (const sim::SerialLine &line : sim::serial())
    n += line.text.rfind("@PR ", 0) == 0;
  return n;
}

void setUp()
{
  sim::reset();
  sim::set_data_dir(REPO_DATA);
  setup();
}

void tearDown() {}

struct Run
{
  std::vector<sim::Frame> frames;
  std::string logs;
  size_t replies;
};

static Run play_everything(const std::string &traffic)
{
  sim::reset();
  setup();
  sim::serial_input(traffic);
  for (int pass = 0; pass < 2; pass++)
    play_from_storage();
  return {sim::frames(), logs_without_protocol_lines(), protocol_lines()};
}

static void test_traffic_leaves_the_repository_animations_unchanged()
{
  Run quiet = play_everything("");
  std::string traffic = request(1, R"("cmd":"info")") + request(2, R"("cmd":"list","kind":"animation")") +
                        request(3, R"("cmd":"settings_get")") + "junk\n" +
                        request(4, R"("cmd":"list","kind":"playlist")") +
                        request(5, R"("cmd":"get","kind":"animation","id":"star","offset":0,"length":100)") +
                        request(6, R"("cmd":"nothing")");
  Run busy = play_everything(traffic);

  TEST_ASSERT_EQUAL(0, quiet.replies);
  TEST_ASSERT_EQUAL(6, busy.replies);
  TEST_ASSERT_TRUE(quiet.frames.size() > 100);
  TEST_ASSERT_EQUAL(quiet.frames.size(), busy.frames.size());
  for (size_t i = 0; i < quiet.frames.size(); i++)
  {
    TEST_ASSERT_EQUAL_UINT64_MESSAGE(quiet.frames[i].t_us, busy.frames[i].t_us, "frame time");
    TEST_ASSERT_EQUAL_UINT64_MESSAGE(quiet.frames[i].duration_us, busy.frames[i].duration_us, "frame duration");
    TEST_ASSERT_TRUE_MESSAGE(quiet.frames[i].rgb == busy.frames[i].rgb, "frame pixels");
  }
  TEST_ASSERT_TRUE(quiet.logs == busy.logs);
}

// A slow command: the memory probe that `info` calls takes 300 ms of virtual time.
static uint64_t slow_probe_calls = 0;
static protocol::Memory slow_probe()
{
  if (slow_probe_calls++ == 0)
    sim::advance_us(300000);
  return {0, 0};
}

static void test_a_slow_command_delays_one_frame_and_the_schedule_holds()
{
  TempData data("playback");
  data.write("animations/a.json", dot_animation("#ff0000", 8, 100));
  setup();

  play_stored_animation("a");
  std::vector<uint64_t> expected;
  for (const sim::Frame &f : sim::frames())
    expected.push_back(f.t_us);
  uint64_t expected_end = sim::now_us();
  TEST_ASSERT_EQUAL(8, expected.size());

  sim::reset();
  setup();
  slow_probe_calls = 0;
  protocol::set_memory_probe(slow_probe);
  sim::serial_input(request(1, R"("cmd":"info")"));
  play_stored_animation("a");

  TEST_ASSERT_EQUAL(1, slow_probe_calls);
  TEST_ASSERT_EQUAL(8, sim::frames().size());
  // Frame 0 is on time. The command runs during its wait, so frame 1 is late; the frames
  // that were due meanwhile follow at once, and from then on every frame is on schedule.
  TEST_ASSERT_EQUAL_UINT64(expected[0], sim::frames()[0].t_us);
  TEST_ASSERT_EQUAL_UINT64(300000, sim::frames()[1].t_us);
  TEST_ASSERT_EQUAL_UINT64(300000, sim::frames()[2].t_us);
  TEST_ASSERT_EQUAL_UINT64(300000, sim::frames()[3].t_us);
  for (size_t i = 4; i < 8; i++)
    TEST_ASSERT_EQUAL_UINT64_MESSAGE(expected[i], sim::frames()[i].t_us, "frame back on schedule");
  TEST_ASSERT_EQUAL_UINT64(expected_end, sim::now_us());
}

static void test_brightness_applies_from_the_next_frame()
{
  TempData data("playback");
  data.write("animations/a.json", dot_animation("#ffffff", 3, 100));
  setup();
  // The request is read while the first frame waits.
  sim::serial_input(request(1, R"("cmd":"settings_set","brightness":50)"));
  play_stored_animation("a");

  TEST_ASSERT_EQUAL(3, sim::frames().size());
  TEST_ASSERT_EQUAL_UINT8((255 * (settings::DEFAULT_BRIGHTNESS + 1)) >> 8, red(sim::frames()[0].at(0, 0)));
  TEST_ASSERT_EQUAL_UINT8((255 * (50 + 1)) >> 8, red(sim::frames()[1].at(0, 0)));
  TEST_ASSERT_EQUAL_UINT8((255 * (50 + 1)) >> 8, red(sim::frames()[2].at(0, 0)));
  TEST_ASSERT_EQUAL(50, settings::brightness());
}

static void test_board_brightness_change_applies_to_the_animation_factor_from_the_next_frame()
{
  TempData data("playback");
  data.write("animations/a.json", dot_animation("#ffffff", 3, 100, 50));
  setup();
  sim::serial_input(request(1, R"("cmd":"settings_set","brightness":200)"));
  play_stored_animation("a");

  TEST_ASSERT_EQUAL(3, sim::frames().size());
  // Board 100 and 50 percent give 50; board 200 gives (200 * 50 + 50) / 100 = 100.
  TEST_ASSERT_EQUAL_UINT8(50, red(sim::frames()[0].at(0, 0)));
  TEST_ASSERT_EQUAL_UINT8(100, red(sim::frames()[1].at(0, 0)));
  TEST_ASSERT_EQUAL_UINT8(100, red(sim::frames()[2].at(0, 0)));
}

static void test_boot_applies_the_brightness_setting()
{
  TempData data("playback");
  data.write("animations/a.json", dot_animation("#ffffff", 1, 100));
  setup();
  settings::set_brightness(20);
  play_stored_animation("a");
  TEST_ASSERT_EQUAL_UINT8((255 * (20 + 1)) >> 8, red(sim::frames()[0].at(0, 0)));
}

static void test_active_playlist_change_waits_for_the_current_animation()
{
  TempData data("playback");
  data.write("animations/a.json", dot_animation("#ff0000", 4, 100));
  data.write("animations/b.json", dot_animation("#00ff00", 4, 100));
  data.write("playlists/default.json", playlist_of({"a", "b"}));
  data.write("playlists/only_b.json", playlist_of({"b"}));
  setup();
  sim::serial_input(request(1, R"("cmd":"settings_set","playlist":"only_b")"));

  play_from_storage();
  TEST_ASSERT_EQUAL_STRING("aaaa", shown().c_str()); // a finishes, b of the old playlist does not start
  play_from_storage();
  TEST_ASSERT_EQUAL_STRING("aaaabbbb", shown().c_str());
  play_from_storage();
  TEST_ASSERT_EQUAL_STRING("aaaabbbbbbbb", shown().c_str());
}

static void test_deleting_a_playlist_waits_for_the_current_animation()
{
  TempData data("playback");
  data.write("animations/a.json", dot_animation("#ff0000", 3, 100));
  data.write("animations/b.json", dot_animation("#00ff00", 3, 100));
  data.write("playlists/default.json", playlist_of({"b", "a"}));
  setup();
  sim::serial_input(request(1, R"("cmd":"delete","kind":"playlist","id":"default")"));

  play_from_storage();
  TEST_ASSERT_EQUAL_STRING("bbb", shown().c_str());
  play_from_storage(); // no playlist: every animation in alphabetical order
  TEST_ASSERT_EQUAL_STRING("bbbaaabbb", shown().c_str());
}

static void test_uploading_a_playlist_waits_for_the_current_animation()
{
  TempData data("playback");
  data.write("animations/a.json", dot_animation("#ff0000", 3, 100));
  data.write("animations/b.json", dot_animation("#00ff00", 3, 100));
  data.write("playlists/default.json", playlist_of({"a", "b"}));
  setup();

  const std::string uploaded = playlist_of({"b", "b"});
  sim::serial_input(put_begin(1, "playlist", "default", uploaded) + put_chunk(2, uploaded) +
                    request(3, R"("cmd":"put_end")"));
  play_from_storage();
  TEST_ASSERT_EQUAL_STRING("aaa", shown().c_str());
  play_from_storage();
  TEST_ASSERT_EQUAL_STRING("aaabbbbbb", shown().c_str());
}

static void test_an_uploaded_animation_applies_when_the_playlist_reaches_it()
{
  TempData data("playback");
  data.write("animations/a.json", dot_animation("#ff0000", 3, 100));
  data.write("animations/b.json", dot_animation("#00ff00", 3, 100));
  data.write("playlists/default.json", playlist_of({"a", "b"}));
  setup();

  // b is replaced while a plays: the pass goes on with a, then plays the new b.
  const std::string uploaded = dot_animation("#00ff00", 5, 100);
  sim::serial_input(put_begin(1, "animation", "b", uploaded) + put_chunk(2, uploaded) +
                    request(3, R"("cmd":"put_end")"));
  play_from_storage();
  TEST_ASSERT_EQUAL_STRING("aaabbbbb", shown().c_str());
}

static void test_an_idle_upload_ends_while_the_board_plays()
{
  TempData data("playback");
  data.write("animations/a.json", dot_animation("#ff0000", 6, 4000)); // 24 seconds
  setup();
  const std::string file = dot_animation("#00ff00", 2, 100);
  sim::serial_input(put_begin(1, "animation", "b", file) + put_chunk(2, file.substr(0, 20)));
  play_stored_animation("a");

  TEST_ASSERT_FALSE(protocol::upload_active());
  TEST_ASSERT_EQUAL(0, storage::open_writers());
  TEST_ASSERT_FALSE(fs::exists(data.root / "upload.tmp"));
  TEST_ASSERT_FALSE(fs::exists(data.root / "animations/b.json"));
  TEST_ASSERT_EQUAL(6, sim::frames().size());
}

static void test_an_upload_is_open_while_chunks_arrive()
{
  TempData data("playback");
  setup();
  const std::string file = dot_animation("#00ff00", 2, 100);
  sim::serial_input(put_begin(1, "animation", "b", file));
  protocol::poll();
  TEST_ASSERT_TRUE(protocol::upload_active());
  sim::serial_input(request(2, R"("cmd":"put_abort")"));
  protocol::poll();
  TEST_ASSERT_FALSE(protocol::upload_active());
}

static void test_boot_removes_a_leftover_temporary_file()
{
  TempData data("playback");
  data.write("upload.tmp", "half a file");
  data.write("animations/a.json", dot_animation("#ff0000", 1, 100));
  setup();
  TEST_ASSERT_FALSE(fs::exists(data.root / "upload.tmp"));
  TEST_ASSERT_TRUE(fs::exists(data.root / "animations/a.json"));
}

static void test_no_animations_image_waits_for_commands_too()
{
  TempData data("playback");
  setup();
  sim::serial_input(request(1, R"("cmd":"settings_get")"));
  play_from_storage();
  TEST_ASSERT_EQUAL(1, sim::frames().size());
  TEST_ASSERT_EQUAL(1, protocol_lines());
  TEST_ASSERT_EQUAL_UINT64(2000000, sim::now_us());
}

int main(int, char **)
{
  UNITY_BEGIN();
  RUN_TEST(test_traffic_leaves_the_repository_animations_unchanged);
  RUN_TEST(test_a_slow_command_delays_one_frame_and_the_schedule_holds);
  RUN_TEST(test_brightness_applies_from_the_next_frame);
  RUN_TEST(test_board_brightness_change_applies_to_the_animation_factor_from_the_next_frame);
  RUN_TEST(test_boot_applies_the_brightness_setting);
  RUN_TEST(test_active_playlist_change_waits_for_the_current_animation);
  RUN_TEST(test_deleting_a_playlist_waits_for_the_current_animation);
  RUN_TEST(test_uploading_a_playlist_waits_for_the_current_animation);
  RUN_TEST(test_an_uploaded_animation_applies_when_the_playlist_reaches_it);
  RUN_TEST(test_an_idle_upload_ends_while_the_board_plays);
  RUN_TEST(test_an_upload_is_open_while_chunks_arrive);
  RUN_TEST(test_boot_removes_a_leftover_temporary_file);
  RUN_TEST(test_no_animations_image_waits_for_commands_too);
  return UNITY_END();
}
