// SPDX-License-Identifier: GPL-3.0-or-later

// Protocol traffic while the board plays: playback stays on schedule, and
// brightness, playlist and upload changes reach it at the times the protocol
// specification gives. Also the list of playlists the board plays, from the
// play settings and the schedule (docs/format/playlist-v1.md#how-the-board-chooses-what-to-play).
// Run with: pio test -e native_test (or make test)

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
#include "task_sync.h"
#include "updates.h"
#include "pixelart_test.h"

namespace fs = std::filesystem;
using pixelart_test::dot_animation;
using pixelart_test::green;
using pixelart_test::put_begin;
using pixelart_test::put_chunk;
using pixelart_test::red;
using pixelart_test::request;
using pixelart_test::TempData;

static std::string playlist_of(std::initializer_list<const char *> animations)
{
  std::string items;
  for (const char *a : animations)
    items += std::string(items.empty() ? "" : ",") + R"({"animation":")" + a + R"("})";
  return R"({"format":"pixelart-playlist/1","canvas":{"width":16,"height":16},"items":[)" + items + "]}";
}

// The animation (a is red, b is green, c is blue) of each recorded frame, as a letter.
static std::string shown()
{
  std::string out;
  for (const sim::Frame &f : sim::frames())
    out += red(f.at(0, 0)) ? 'a' : green(f.at(0, 0)) ? 'b' : pixelart_test::blue(f.at(0, 0)) ? 'c' : '?';
  return out;
}

// A schedule with `fallback` and one entry from `from` to `to` ({month, day} ends) with `playlists`.
static std::string schedule_of(const char *fallback, const char *from, const char *to, const char *playlists)
{
  return std::string(R"({"format":"pixelart-schedule/1","fallback":)") + fallback + R"(,"entries":[{"from":)" + from +
         R"(,"to":)" + to + R"(,"playlists":)" + playlists + "}]}";
}

// Three animations of `frames` frames, a red, b green and c blue, and playlists p_a, p_b and p_c of one each.
static void write_abc(const TempData &data, int frames)
{
  data.write("animations/a.json", dot_animation("#ff0000", frames, 100));
  data.write("animations/b.json", dot_animation("#00ff00", frames, 100));
  data.write("animations/c.json", dot_animation("#0000ff", frames, 100));
  data.write("playlists/p_a.json", playlist_of({"a"}));
  data.write("playlists/p_b.json", playlist_of({"b"}));
  data.write("playlists/p_c.json", playlist_of({"c"}));
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

void setUp() { sim::reset(); }

void tearDown()
{
  task_sync::sim_block_loop(false);
  updates::sim_reset();
}

struct Run
{
  std::vector<sim::Frame> frames;
  std::string logs;
  size_t replies;
};

static Run play_everything(const fs::path &data, const std::string &traffic)
{
  sim::reset();
  sim::set_data_dir(data.string());
  setup();
  sim::serial_input(traffic);
  for (int pass = 0; pass < 2; pass++)
    play_from_storage();
  return {sim::frames(), logs_without_protocol_lines(), protocol_lines()};
}

static void test_traffic_leaves_the_stored_animation_unchanged()
{
  TempData data("playback");
  write_abc(data, 2);
  data.write("playlists/default.json", playlist_of({"a", "b", "c"}));
  Run quiet = play_everything(data.root, "");
  std::string traffic = request(1, R"("cmd":"info")") + request(2, R"("cmd":"list","kind":"animation")") +
                        request(3, R"("cmd":"settings_get")") + "junk\n" +
                        request(4, R"("cmd":"list","kind":"playlist")") +
                        request(5, R"("cmd":"get","kind":"animation","id":"a","offset":0,"length":100)") +
                        request(6, R"("cmd":"nothing")");
  Run busy = play_everything(data.root, traffic);

  TEST_ASSERT_EQUAL(0, quiet.replies);
  TEST_ASSERT_EQUAL(6, busy.replies);
  // Two frames per animation, three animations per pass, played for two passes.
  TEST_ASSERT_EQUAL(12, quiet.frames.size());
  TEST_ASSERT_EQUAL_STRING("aabbccaabbcc", shown().c_str());
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
static install::Memory slow_probe()
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
  install::set_memory_probe(slow_probe);
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

static void test_a_busy_heap_keeps_the_last_frame_and_retries_after_200_ms()
{
  TempData data("playback");
  data.write("animations/a.json", dot_animation("#ff0000", 3, 100));
  data.write("playlists/default.json", playlist_of({"a"}));
  setup();
  const uint64_t start = sim::now_us();

  task_sync::sim_block_loop(true);
  play_stored_animation("a");
  TEST_ASSERT_EQUAL(0, sim::frames().size());
  TEST_ASSERT_EQUAL_UINT64(200000, sim::now_us() - start);

  play_from_storage(); // the playlist is busy too
  task_sync::sim_block_loop(false);
  TEST_ASSERT_EQUAL(0, sim::frames().size());
  TEST_ASSERT_EQUAL_UINT64(400000, sim::now_us() - start);
  TEST_ASSERT_EQUAL_STRING("", logs_without_protocol_lines().c_str());

  play_from_storage(); // the memory is free: the playlist plays
  TEST_ASSERT_EQUAL_STRING("aaa", shown().c_str());
}

static void test_a_new_choice_waits_while_an_update_holds_the_memory_when_an_animation_ends()
{
  TempData data("playback");
  write_abc(data, 2);
  setup();
  sim::serial_input(request(1, R"("cmd":"settings_set","play":"playlists","playlists":["p_a"])"));
  play_from_storage(); // the default list, every animation, until the setting is read
  play_from_storage();
  TEST_ASSERT_FALSE(choice_pending());
  sim::reset();

  // During a, a setting asks for a new choice and an update takes the memory. When a ends the board does not
  // try to choose, which would wait for the memory up to 2 seconds on the board: it loaded p_a and a only.
  sim::serial_input(request(2, R"("cmd":"settings_set","timezone":"CET-1")"));
  task_sync::sim_block_loop_after_frames(1);
  const unsigned attempts = task_sync::sim_loop_lock_attempts();
  play_from_storage();
  TEST_ASSERT_EQUAL(2, task_sync::sim_loop_lock_attempts() - attempts);
  TEST_ASSERT_TRUE(choice_pending());
  task_sync::sim_block_loop(false);
  TEST_ASSERT_EQUAL_STRING("aa", shown().c_str());
}

static void test_a_new_choice_when_an_animation_ends_never_waits_for_the_memory()
{
  TempData data("playback");
  write_abc(data, 2);
  setup();
  sim::serial_input(request(1, R"("cmd":"settings_set","play":"playlists","playlists":["p_a"])"));
  play_from_storage(); // the default list, every animation, until the setting is read
  play_from_storage();
  TEST_ASSERT_FALSE(choice_pending());
  sim::reset();

  // During a, a setting asks for a new choice. When a ends the board chooses with reads that never wait for the
  // memory, as an update could take it right after the board checked: p_a and a wait, the new choice does not.
  // The new choice reads the play file and p_a, then a plays.
  sim::serial_input(request(2, R"("cmd":"settings_set","timezone":"CET-1")"));
  const unsigned attempts = task_sync::sim_loop_lock_attempts();
  const unsigned waiting = task_sync::sim_loop_waiting_lock_attempts();
  play_from_storage();
  TEST_ASSERT_EQUAL(4, task_sync::sim_loop_lock_attempts() - attempts);
  TEST_ASSERT_EQUAL(2, task_sync::sim_loop_waiting_lock_attempts() - waiting);
  TEST_ASSERT_FALSE(choice_pending());
  TEST_ASSERT_EQUAL_STRING("aa", shown().c_str());
}

static void test_my_playlists_play_each_in_full_then_from_the_first()
{
  TempData data("playback");
  write_abc(data, 1);
  data.write("playlists/two.json", playlist_of({"b", "c"}));
  setup();
  sim::serial_input(request(1, R"("cmd":"settings_set","play":"playlists","playlists":["p_a","two"])"));
  play_from_storage(); // the default list, every animation, until the setting is read
  sim::reset();
  play_from_storage();
  play_from_storage();
  TEST_ASSERT_EQUAL_STRING("abcabc", shown().c_str());
}

static void test_a_missing_playlist_of_the_list_is_skipped()
{
  TempData data("playback");
  write_abc(data, 1);
  setup();
  sim::serial_input(request(1, R"("cmd":"settings_set","play":"playlists","playlists":["p_a","p_c"])") +
                    request(2, R"("cmd":"delete","kind":"playlist","id":"p_a")"));
  play_from_storage();
  sim::reset();
  play_from_storage();
  TEST_ASSERT_EQUAL_STRING("c", shown().c_str());
}

static void test_a_playlist_skipped_at_every_pass_is_remembered_once()
{
  TempData data("playback");
  write_abc(data, 1);
  data.write("playlists/broken.json", playlist_of({"gone"}));
  setup();
  sim::serial_input(request(1, R"("cmd":"settings_set","play":"playlists","playlists":["p_a","broken","p_c"])") +
                    request(2, R"("cmd":"delete","kind":"playlist","id":"p_a")"));
  play_from_storage();
  for (int pass = 0; pass < 50; pass++)
    play_from_storage();
  sim::reset();
  play_from_storage();
  TEST_ASSERT_EQUAL_STRING("c", shown().c_str());
  TEST_ASSERT_EQUAL(2, skipped_playlist_count()); // p_a, missing, and broken, which plays nothing
}

static void test_automatic_plays_the_winning_entry_of_the_date()
{
  TempData data("playback");
  write_abc(data, 1);
  data.write("playlists/default.json", playlist_of({"a"}));
  data.write("schedules/default.json",
             schedule_of(R"(["p_b"])", R"({"month":12,"day":1})", R"({"month":1,"day":6})", R"(["p_c"])"));
  setup();
  play_from_storage(); // the time is not known: the fallback
  updates::sim_set_local_date({2026, 12, 25});
  play_from_storage(); // the time became known: the board notices it when this animation ends
  play_from_storage();
  TEST_ASSERT_EQUAL_STRING("bbc", shown().c_str());
  updates::sim_set_local_date({2026, 11, 30});
  play_from_storage();
  play_from_storage();
  TEST_ASSERT_EQUAL_STRING("bbccb", shown().c_str());
}

static void test_local_midnight_switches_when_the_current_animation_ends()
{
  TempData data("playback");
  data.write("animations/a.json", dot_animation("#ff0000", 2, 100));
  data.write("animations/b.json", dot_animation("#00ff00", 2, 100));
  data.write(
      "playlists/p_a.json",
      R"({"format":"pixelart-playlist/1","canvas":{"width":16,"height":16},"items":[{"animation":"a","repeat":3}]})");
  data.write("playlists/p_b.json", playlist_of({"b"}));
  data.write("schedules/default.json",
             schedule_of(R"(["p_b"])", R"({"month":12,"day":24})", R"({"month":12,"day":24})", R"(["p_a"])"));
  updates::sim_set_local_date({2026, 12, 24});
  setup();
  play_from_storage();
  TEST_ASSERT_EQUAL_STRING("aaaaaa", shown().c_str());
  // Midnight: the board notices it when the next animation ends, and cuts the other repeats.
  updates::sim_set_local_date({2026, 12, 25});
  play_from_storage();
  TEST_ASSERT_EQUAL_STRING("aaaaaaaa", shown().c_str());
  play_from_storage();
  TEST_ASSERT_EQUAL_STRING("aaaaaaaabb", shown().c_str());
}

static void test_the_same_list_keeps_its_position()
{
  TempData data("playback");
  write_abc(data, 2);
  setup();
  sim::serial_input(request(1, R"("cmd":"settings_set","play":"playlists","playlists":["p_a","p_b","p_c"])"));
  play_from_storage();
  sim::reset();
  // A change that gives the same list, during a: the board goes on with b, then c.
  sim::serial_input(request(2, R"("cmd":"settings_set","timezone":"CET-1")"));
  play_from_storage();
  TEST_ASSERT_EQUAL_STRING("aabbcc", shown().c_str());
}

static void test_a_stored_playlist_starts_the_list_again()
{
  TempData data("playback");
  write_abc(data, 2);
  setup();
  sim::serial_input(request(1, R"("cmd":"settings_set","play":"playlists","playlists":["p_a","p_b","p_c"])"));
  play_from_storage();
  sim::reset();
  // p_c is stored again during a: a finishes, and the list starts again from p_a.
  const std::string uploaded = playlist_of({"c"});
  sim::serial_input(put_begin(2, "playlist", "p_c", uploaded) + put_chunk(3, uploaded) +
                    request(4, R"("cmd":"put_end")"));
  play_from_storage();
  play_from_storage();
  TEST_ASSERT_EQUAL_STRING("aaaabbcc", shown().c_str());
}

static void test_a_stored_or_deleted_schedule_keeps_the_position_of_the_same_list()
{
  TempData data("playback");
  write_abc(data, 2);
  data.write("schedules/other.json", schedule_of(R"(["p_c"])", R"({"month":1})", R"({"month":12})", R"(["p_c"])"));
  setup();
  sim::serial_input(request(1, R"("cmd":"settings_set","play":"playlists","playlists":["p_a","p_b","p_c"])"));
  play_from_storage();
  sim::reset();
  // The schedule `default` is stored during a: My playlists ignore it, so the list stays and goes on with b.
  const std::string uploaded = schedule_of(R"(["p_c"])", R"({"month":1})", R"({"month":12})", R"(["p_c"])");
  sim::serial_input(put_begin(2, "schedule", "default", uploaded) + put_chunk(3, uploaded) +
                    request(4, R"("cmd":"put_end")"));
  play_from_storage();
  TEST_ASSERT_EQUAL_STRING("aabbcc", shown().c_str());
  // Another schedule is deleted during a: the same.
  sim::serial_input(request(5, R"("cmd":"delete","kind":"schedule","id":"other")"));
  play_from_storage();
  TEST_ASSERT_EQUAL_STRING("aabbccaabbcc", shown().c_str());
}

static void test_an_entry_whose_animations_fail_falls_back_in_the_same_pass()
{
  TempData data("playback");
  write_abc(data, 1);
  data.write("animations/bad.json", dot_animation("gren"));
  data.write("playlists/broken.json", playlist_of({"bad"}));
  data.write("schedules/default.json", schedule_of(R"(["p_b"])", R"({"month":1})", R"({"month":12})", R"(["broken"])"));
  updates::sim_set_local_date({2027, 3, 3});
  setup();
  play_from_storage();
  TEST_ASSERT_EQUAL_STRING("b", shown().c_str());
}

static void test_a_skipped_entry_playlist_plays_again_after_local_midnight()
{
  TempData data("playback");
  write_abc(data, 1);
  data.write("animations/bad.json", dot_animation("gren"));
  data.write("playlists/broken.json", playlist_of({"bad"}));
  data.write("schedules/default.json", schedule_of(R"(["p_b"])", R"({"month":1})", R"({"month":12})", R"(["broken"])"));
  updates::sim_set_local_date({2027, 3, 3});
  setup();
  play_from_storage();
  TEST_ASSERT_EQUAL_STRING("b", shown().c_str());
  // bad is repaired without an event: broken stays skipped and the fallback goes on.
  data.write("animations/bad.json", dot_animation("#0000ff"));
  play_from_storage();
  TEST_ASSERT_EQUAL_STRING("bb", shown().c_str());
  // Midnight, another day of the same entry: the board notices it when b ends, and tries broken again.
  updates::sim_set_local_date({2027, 3, 4});
  play_from_storage();
  play_from_storage();
  TEST_ASSERT_EQUAL_STRING("bbbc", shown().c_str());
}

static void test_status_after_local_midnight_reports_the_skipped_entry_playlist_again()
{
  TempData data("playback");
  write_abc(data, 1);
  data.write("animations/bad.json", dot_animation("gren"));
  data.write("playlists/broken.json", playlist_of({"bad"}));
  data.write("schedules/default.json", schedule_of(R"(["p_b"])", R"({"month":1})", R"({"month":12})", R"(["broken"])"));
  updates::sim_set_local_date({2027, 3, 3});
  setup();
  play_from_storage();
  TEST_ASSERT_EQUAL(1, skipped_playlist_count());
  data.write("animations/bad.json", dot_animation("#0000ff"));
  // Midnight, then `status` before the next animation ends: it chooses again and tries broken again.
  updates::sim_set_local_date({2027, 3, 4});
  refresh_choice();
  const PlayStatus status = play_status();
  TEST_ASSERT_EQUAL(1, status.playlists.size());
  TEST_ASSERT_EQUAL_STRING("broken", status.playlists[0].c_str());
  TEST_ASSERT_EQUAL(0, skipped_playlist_count());
}

static void test_the_time_is_asked_for_while_a_schedule_plays()
{
  TempData data("playback");
  write_abc(data, 1);
  data.write("playlists/default.json", playlist_of({"a"}));
  setup();
  updates::poll();
  play_from_storage();
  updates::poll();
  TEST_ASSERT_FALSE(updates::sim_time_needed()); // no schedule
  data.write("schedules/default.json", schedule_of(R"(["default"])", R"({"month":1})", R"({"month":1})", R"(["p_b"])"));
  sim::serial_input(request(1, R"("cmd":"settings_set","timezone":"CET-1")"));
  play_from_storage();
  play_from_storage();
  updates::poll();
  TEST_ASSERT_TRUE(updates::sim_time_needed());
  sim::serial_input(request(2, R"("cmd":"settings_set","play":"playlists","playlists":["p_a"])"));
  play_from_storage();
  play_from_storage();
  updates::poll();
  TEST_ASSERT_FALSE(updates::sim_time_needed()); // My playlists ignore the schedule
}

int main(int, char **)
{
  UNITY_BEGIN();
  RUN_TEST(test_traffic_leaves_the_stored_animation_unchanged);
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
  RUN_TEST(test_a_busy_heap_keeps_the_last_frame_and_retries_after_200_ms);
  RUN_TEST(test_a_new_choice_waits_while_an_update_holds_the_memory_when_an_animation_ends);
  RUN_TEST(test_a_new_choice_when_an_animation_ends_never_waits_for_the_memory);
  RUN_TEST(test_my_playlists_play_each_in_full_then_from_the_first);
  RUN_TEST(test_a_missing_playlist_of_the_list_is_skipped);
  RUN_TEST(test_a_playlist_skipped_at_every_pass_is_remembered_once);
  RUN_TEST(test_automatic_plays_the_winning_entry_of_the_date);
  RUN_TEST(test_local_midnight_switches_when_the_current_animation_ends);
  RUN_TEST(test_the_same_list_keeps_its_position);
  RUN_TEST(test_a_stored_playlist_starts_the_list_again);
  RUN_TEST(test_a_stored_or_deleted_schedule_keeps_the_position_of_the_same_list);
  RUN_TEST(test_an_entry_whose_animations_fail_falls_back_in_the_same_pass);
  RUN_TEST(test_a_skipped_entry_playlist_plays_again_after_local_midnight);
  RUN_TEST(test_status_after_local_midnight_reports_the_skipped_entry_playlist_again);
  RUN_TEST(test_the_time_is_asked_for_while_a_schedule_plays);
  return UNITY_END();
}
