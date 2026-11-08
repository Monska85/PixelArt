// SPDX-License-Identifier: GPL-3.0-or-later

// Power protection (docs/board/power-protection-v1.md): the engine's rules against the hand-computed rows of
// conformance/power.json, the NVS record, and the firmware's recording, marker and dimming on the simulator.
// Run with: make test

#include <ArduinoJson.h>
#include <gamma.h>
#include <power_rules.h>
#include <sim.h>
#include <unity.h>

#include <cstring>
#include <filesystem>
#include <string>
#include <vector>

#include "app.h"
#include "install.h"
#include "protocol.h"
#include "pixel_art.h"
#include "power.h"
#include "settings.h"
#include "updates.h"
#include "pixelart_test.h"

namespace fs = std::filesystem;
using pixelart_test::read_file;
using pixelart_test::red;
using pixelart_test::request;
using pixelart_test::TempData;

static const pixelart::LedGamma GAMMA = {gamma5, gamma6};

static JsonDocument rows_doc;

static JsonArrayConst rows(const char *key)
{
  if (rows_doc.isNull())
  {
    const std::string text = read_file(std::string(PIXELART_PROJECT_DIR) + "/conformance/power.json");
    TEST_ASSERT_FALSE_MESSAGE(deserializeJson(rows_doc, text), "conformance/power.json is not valid JSON");
  }
  JsonArrayConst list = rows_doc[key].as<JsonArrayConst>();
  TEST_ASSERT_TRUE_MESSAGE(list.size() > 0, (std::string("conformance/power.json has no ") + key).c_str());
  return list;
}

static uint32_t color_of(const char *hex) { return (uint32_t)strtoul(hex + 1, nullptr, 16); }

// A frame written as in a valid case's expected frames.
static pixelart::Frame frame_of(JsonVariantConst spec)
{
  pixelart::Frame frame = {};
  const uint32_t background = spec["background"].isNull() ? 0 : color_of(spec["background"].as<const char *>());
  for (auto &row : frame.pixels)
    for (pixelart::Rgb &pixel : row)
      pixel = background;
  for (JsonPairConst color : spec["pixels"].as<JsonObjectConst>())
    for (JsonVariantConst xy : color.value().as<JsonArrayConst>())
      frame.pixels[xy[1].as<int>()][xy[0].as<int>()] = color_of(color.key().c_str());
  return frame;
}

void setUp() { sim::reset(); }

void tearDown() {}

// ---- Engine rows ----

static void test_estimate_rows()
{
  for (JsonVariantConst row : rows("estimate"))
    TEST_ASSERT_EQUAL_UINT32_MESSAGE(
        row["expected"].as<uint32_t>(),
        pixelart::frame_estimate_ma(frame_of(row["frame"]), row["brightness"].as<uint8_t>(), GAMMA),
        row["name"].as<const char *>());
}

static void test_white_estimate_matches_a_white_frame()
{
  pixelart::Frame white;
  for (auto &row : white.pixels)
    for (pixelart::Rgb &pixel : row)
      pixel = 0xffffff;
  for (int e = 0; e <= 255; e++)
    TEST_ASSERT_EQUAL_UINT32(pixelart::frame_estimate_ma(white, (uint8_t)e, GAMMA),
                             pixelart::white_frame_estimate_ma((uint8_t)e));
}

static void test_power_brightness_rows()
{
  for (JsonVariantConst row : rows("power_brightness"))
    TEST_ASSERT_EQUAL_UINT8_MESSAGE(
        row["expected"].as<uint8_t>(),
        pixelart::power_brightness(row["brightness"].as<uint8_t>(), row["scale"].as<uint8_t>()),
        ("brightness " + std::to_string(row["brightness"].as<int>()) + ", scale " +
         std::to_string(row["scale"].as<int>()))
            .c_str());
}

static void test_scale_rows()
{
  for (JsonVariantConst row : rows("scale"))
  {
    const pixelart::Frame frame = frame_of(row["frame"]);
    TEST_ASSERT_EQUAL_UINT8_MESSAGE(
        row["expected"].as<uint8_t>(),
        pixelart::power_scale(&frame, row["brightness"].as<uint8_t>(), row["limit"].as<uint32_t>(), GAMMA),
        row["name"].as<const char *>());
  }
}

static void test_scan_rows()
{
  for (JsonVariantConst row : rows("scan"))
  {
    const char *name = row["name"].as<const char *>();
    const std::string text = row["animation"].as<std::string>();
    pixelart::Animation animation;
    std::vector<pixelart::Diagnostic> diagnostics;
    TEST_ASSERT_TRUE_MESSAGE(animation.load(text.data(), text.size(), diagnostics), name);
    pixelart::Frame scratch;
    const uint8_t e1 = row["brightness"].as<uint8_t>();
    const pixelart::HeaviestFrame heaviest = pixelart::heaviest_frame(animation, e1, GAMMA, scratch);
    JsonVariantConst expected = row["expected"];
    TEST_ASSERT_EQUAL_UINT32_MESSAGE(expected["estimate"].as<uint32_t>(), heaviest.estimate, name);
    TEST_ASSERT_EQUAL_MESSAGE(expected["frame"].isNull(), heaviest.white, name);
    if (!heaviest.white)
    {
      TEST_ASSERT_EQUAL_UINT32_MESSAGE(expected["frame"].as<uint32_t>(), heaviest.number, name);
      // The scratch frame holds the heaviest frame afterwards.
      TEST_ASSERT_EQUAL_UINT32_MESSAGE(heaviest.estimate, pixelart::frame_estimate_ma(scratch, e1, GAMMA), name);
    }
  }
}

static pixelart::ResetReason reason_named(const char *name)
{
  pixelart::ResetReason reason;
  TEST_ASSERT_TRUE_MESSAGE(pixelart::reset_reason_from_name(name, reason), name);
  return reason;
}

static void test_limit_rows()
{
  for (JsonVariantConst row : rows("limit"))
  {
    const char *name = row["name"].as<const char *>();
    pixelart::PowerRecord record;
    for (JsonVariantConst start : row["starts"].as<JsonArrayConst>())
      pixelart::power_apply_start(record, reason_named(start["reason"].as<const char *>()),
                                  start["estimate"].isNull() ? 0 : start["estimate"].as<uint32_t>());
    JsonVariantConst expected = row["expected"];
    TEST_ASSERT_EQUAL_UINT8_MESSAGE(expected["brownouts"].as<uint8_t>(), record.brownouts(), name);
    TEST_ASSERT_EQUAL_MESSAGE(expected["limit_active"].as<bool>(), record.limit_active, name);
    if (record.limit_active)
      TEST_ASSERT_EQUAL_UINT16_MESSAGE(expected["limit_ma"].as<uint16_t>(), record.limit_ma, name);
    else
      TEST_ASSERT_TRUE_MESSAGE(expected["limit_ma"].isNull(), name);
    TEST_ASSERT_EQUAL_MESSAGE(expected["at_floor"].as<bool>(), record.at_floor(), name);
  }
}

static void test_reason_names()
{
  const char *names[] = {"brownout", "power_on", "software", "panic", "watchdog", "deep_sleep", "other"};
  for (const char *name : names)
    TEST_ASSERT_EQUAL_STRING(name, pixelart::reset_reason_name(reason_named(name)));
  pixelart::ResetReason reason;
  TEST_ASSERT_FALSE(pixelart::reset_reason_from_name("usb", reason));
  TEST_ASSERT_FALSE(pixelart::reset_reason_from_name("", reason));
}

// ---- Frame numbers and the player's position ----

static const char *NUMBERED =
    R"({"format":"pixelart/1","name":"N","canvas":{"width":16,"height":16},"sprites":{"a":{"points":[[0,0,"#ffffff"]]}},)"
    R"("timeline":[{"show":["a"]},{"loop":3,"steps":[{"show":["a"],"repeat":2},{"loop":2,"steps":[{"show":["a"]}]}]},{"show":["a"],"repeat":4}]})";

static void test_frame_numbers_count_loops_once()
{
  pixelart::Animation animation;
  std::vector<pixelart::Diagnostic> diagnostics;
  TEST_ASSERT_TRUE(animation.load(NUMBERED, strlen(NUMBERED), diagnostics));
  // 1 + (2 + 1) + 4 distinct frames.
  TEST_ASSERT_EQUAL_UINT32(8, pixelart::frame_count(animation));
  for (uint32_t number = 0; number < 8; number++)
  {
    uint32_t item = 0, repetition = 0, back = 99;
    TEST_ASSERT_TRUE(pixelart::frame_position(animation, number, item, repetition));
    TEST_ASSERT_TRUE(pixelart::frame_number(animation, item, repetition, back));
    TEST_ASSERT_EQUAL_UINT32(number, back);
  }
  uint32_t item = 0, repetition = 0;
  TEST_ASSERT_FALSE(pixelart::frame_position(animation, 8, item, repetition));
  // The player passes the loops 3 and 2 times, and reports the same positions as the numbering.
  pixelart::Player player(animation);
  pixelart::Frame frame;
  std::vector<uint32_t> numbers;
  while (player.next(frame))
  {
    uint32_t n = 0;
    TEST_ASSERT_TRUE(player.position(item, repetition));
    TEST_ASSERT_TRUE(pixelart::frame_number(animation, item, repetition, n));
    numbers.push_back(n);
  }
  const std::vector<uint32_t> expected = {0, 1, 2, 3, 3, 1, 2, 3, 3, 1, 2, 3, 3, 4, 5, 6, 7};
  TEST_ASSERT_TRUE(numbers == expected);
  TEST_ASSERT_FALSE(player.position(item, repetition));
  // A loop item or a repetition past the end is no frame.
  uint32_t loop_item = 0, r = 0;
  TEST_ASSERT_TRUE(pixelart::frame_position(animation, 1, loop_item, r));
  TEST_ASSERT_FALSE(player.render_at(loop_item, 2, frame));
  TEST_ASSERT_FALSE(player.render_at(100000, 0, frame));
}

// ---- The NVS record ----

static void test_record_round_trip()
{
  pixelart::PowerRecord record;
  for (int i = 0; i < 12; i++)
    pixelart::power_apply_start(record, i % 3 ? pixelart::ResetReason::Brownout : pixelart::ResetReason::Panic,
                                2000 + i);
  record.has_last = true;
  record.last_frame_known = true;
  strcpy(record.last_animation, "snow_globe-2");
  record.last_frame = 70000;
  record.last_date_known = true;
  record.last_date = {2026, 12, 24};
  uint8_t bytes[pixelart::POWER_RECORD_BYTES];
  pixelart::power_record_encode(record, 7, bytes);
  pixelart::PowerRecord back;
  uint8_t model = 0;
  TEST_ASSERT_TRUE(pixelart::power_record_decode(bytes, sizeof(bytes), back, model));
  TEST_ASSERT_EQUAL_UINT8(7, model);
  TEST_ASSERT_EQUAL_UINT8(record.count, back.count);
  TEST_ASSERT_EQUAL_MEMORY(record.reasons, back.reasons, sizeof(record.reasons));
  TEST_ASSERT_EQUAL_MEMORY(record.estimates, back.estimates, sizeof(record.estimates));
  TEST_ASSERT_EQUAL(record.limit_active, back.limit_active);
  TEST_ASSERT_EQUAL_UINT16(record.limit_ma, back.limit_ma);
  TEST_ASSERT_EQUAL_STRING("snow_globe-2", back.last_animation);
  TEST_ASSERT_EQUAL_UINT32(70000, back.last_frame);
  TEST_ASSERT_TRUE(back.last_date == record.last_date);

  pixelart::PowerRecord empty;
  pixelart::power_record_encode(empty, 1, bytes);
  TEST_ASSERT_TRUE(pixelart::power_record_decode(bytes, sizeof(bytes), back, model));
  TEST_ASSERT_EQUAL_UINT8(0, back.count);
  TEST_ASSERT_FALSE(back.has_last);
}

static void test_record_rejects_malformed_bytes()
{
  pixelart::PowerRecord record;
  pixelart::power_apply_start(record, pixelart::ResetReason::Brownout, 0);
  pixelart::power_apply_start(record, pixelart::ResetReason::Brownout, 0);
  pixelart::power_apply_start(record, pixelart::ResetReason::Brownout, 0);
  record.has_last = true;
  record.last_frame_known = true;
  strcpy(record.last_animation, "bear");
  record.last_date_known = true;
  record.last_date = {2026, 1, 31};
  uint8_t good[pixelart::POWER_RECORD_BYTES];
  pixelart::power_record_encode(record, 1, good);
  pixelart::PowerRecord out;
  uint8_t model = 0;
  TEST_ASSERT_TRUE(pixelart::power_record_decode(good, sizeof(good), out, model));
  TEST_ASSERT_FALSE(pixelart::power_record_decode(good, sizeof(good) - 1, out, model)); // another size

  struct Change
  {
    const char *what;
    size_t at;
    uint8_t value;
  };
  const Change changes[] = {
      {"an unknown layout", 0, 2},     {"11 reasons", 2, 11},
      {"an unknown reason", 3, 7},     {"an unknown flag", 33, 0x1f},
      {"a limit under 300", 34, 0x2b}, {"a frame without a last brownout", 33, 0x05},
      {"an invalid ID", 44, 'B'},      {"an ID without its end", 76, 'x'},
      {"February 31", 42, 2},
  };
  for (const Change &change : changes)
  {
    uint8_t bytes[sizeof(good)];
    memcpy(bytes, good, sizeof(good));
    bytes[change.at] = change.value;
    if (change.at == 34)
      bytes[35] = 1; // 0x012b = 299
    TEST_ASSERT_FALSE_MESSAGE(pixelart::power_record_decode(bytes, sizeof(bytes), out, model), change.what);
  }
}

// ---- The firmware on the simulator ----

static const std::string WHITE =
    R"({"format":"pixelart/1","name":"White","canvas":{"width":16,"height":16},"background":"#ffffff",)"
    R"("sprites":{"dot":{"points":[[0,0,"#000000"]]}},"frame_ms":100,"timeline":[{"show":[]},{"show":["dot"]},{"show":[]}]})";

// Starts the board after three brownouts without a marker: the limit is 1000 mA.
static void start_with_limit_1000()
{
  for (int i = 0; i < 3; i++)
    power::sim_queue_boot(pixelart::ResetReason::Brownout, "", 0);
  setup();
  TEST_ASSERT_TRUE(power::limit_active());
  TEST_ASSERT_EQUAL_UINT16(1000, power::status().limit_ma);
}

static void test_limit_off_plays_at_full_brightness()
{
  TempData data("power");
  data.write("animations/white.json", WHITE);
  setup();
  TEST_ASSERT_FALSE(power::limit_active());
  play_stored_animation("white");
  TEST_ASSERT_EQUAL(3, sim::frames().size());
  // Brightness 100: (255 x 101) >> 8.
  for (const sim::Frame &f : sim::frames())
    TEST_ASSERT_EQUAL_UINT8(100, red(f.at(5, 5)));
  TEST_ASSERT_EQUAL_UINT8(100, power::current_scale());
}

static void test_heavy_animation_plays_at_one_scale()
{
  TempData data("power");
  data.write("animations/white.json", WHITE);
  start_with_limit_1000();
  play_stored_animation("white");
  // White at 4864 mA does not fit 1000 mA: V <= 16 needs E <= 16, and (100 x 16 + 50) / 100 = 16, so the scale
  // is 16 and white is (255 x 17) >> 8 = 16 on every frame, the one with the black dot too.
  TEST_ASSERT_EQUAL(3, sim::frames().size());
  for (const sim::Frame &f : sim::frames())
    TEST_ASSERT_EQUAL_UINT8(16, red(f.at(5, 5)));
  TEST_ASSERT_EQUAL_UINT8(0, red(sim::frames()[1].at(0, 0)));
  // No animation plays any more.
  TEST_ASSERT_EQUAL_UINT8(100, power::status().scale);
}

static void test_light_animation_plays_unchanged_with_the_limit_on()
{
  TempData data("power");
  data.write("animations/dot.json", pixelart_test::dot_animation("#ff0000"));
  start_with_limit_1000();
  play_stored_animation("dot");
  TEST_ASSERT_EQUAL_UINT8(100, red(sim::frames()[0].at(0, 0)));
}

static void test_no_animations_image_is_never_dimmed()
{
  TempData data("power");
  setup();
  play_from_storage();
  const std::vector<sim::Frame> healthy = sim::frames();
  sim::reset();
  start_with_limit_1000();
  play_from_storage();
  TEST_ASSERT_EQUAL(healthy.size(), sim::frames().size());
  TEST_ASSERT_TRUE(healthy.back().rgb == sim::frames().back().rgb);
}

static void test_a_changed_animation_is_scanned_again()
{
  TempData data("power");
  data.write("animations/white.json", WHITE);
  start_with_limit_1000();
  play_stored_animation("white");
  TEST_ASSERT_EQUAL_UINT8(16, red(sim::frames().back().at(5, 5)));
  // The same ID now holds a light animation: the scale from the last scan must not be reused once the file changed.
  data.write("animations/white.json", pixelart_test::dot_animation("#ffffff"));
  power::animations_changed();
  sim::reset();
  play_stored_animation("white");
  TEST_ASSERT_EQUAL_UINT8(100, red(sim::frames().back().at(0, 0)));
  // Back to the heavy content, then played twice: the second start reuses the scale of the first.
  data.write("animations/white.json", WHITE);
  power::animations_changed();
  sim::reset();
  play_stored_animation("white");
  const uint8_t at_100 = red(sim::frames().back().at(5, 5));
  sim::reset();
  play_stored_animation("white"); // the cached scale: the same frames
  TEST_ASSERT_EQUAL_UINT8(at_100, red(sim::frames().back().at(5, 5)));
}

// Runs one protocol request now, on the loop task, as the board does between frames.
static void run_request(const std::string &line)
{
  sim::serial_input(line);
  protocol::poll();
}

static void test_file_changes_reach_the_scale_cache()
{
  TempData data("power");
  data.write("animations/white.json", WHITE);
  start_with_limit_1000();
  play_stored_animation("white");
  TEST_ASSERT_EQUAL_UINT8(16, red(sim::frames().back().at(5, 5)));
  // A stored or replaced file, as an upload or an update installs it.
  data.write("animations/white.json", pixelart_test::dot_animation("#ffffff"));
  install::file_changed(install::Kind::Animation);
  sim::reset();
  play_stored_animation("white");
  TEST_ASSERT_EQUAL_UINT8(100, red(sim::frames().back().at(0, 0)));
  // delete_all removes it; the same ID stored again afterwards is scanned again.
  data.write("animations/white.json", WHITE);
  install::file_changed(install::Kind::Animation);
  sim::reset();
  play_stored_animation("white");
  data.write("animations/white.json", pixelart_test::dot_animation("#ffffff"));
  run_request(request(1, R"("cmd":"delete_all")"));
  TEST_ASSERT_FALSE(fs::exists(data.root / "animations/white.json"));
  data.write("animations/white.json", pixelart_test::dot_animation("#ffffff"));
  sim::reset();
  play_stored_animation("white");
  TEST_ASSERT_EQUAL_UINT8(100, red(sim::frames().back().at(0, 0)));
}

static void test_power_reset_restores_full_brightness_at_the_next_frame()
{
  TempData data("power");
  data.write("animations/white.json", WHITE);
  start_with_limit_1000();
  sim::serial_input(request(1, R"("cmd":"power_reset")"));
  play_stored_animation("white");
  // The request runs while the first frame waits.
  TEST_ASSERT_EQUAL_UINT8(16, red(sim::frames()[0].at(5, 5)));
  TEST_ASSERT_EQUAL_UINT8(100, red(sim::frames()[1].at(5, 5)));
  TEST_ASSERT_EQUAL_UINT8(100, red(sim::frames()[2].at(5, 5)));
  TEST_ASSERT_FALSE(power::limit_active());
}

// A brownout during frame `number` of the white animation, as the player leaves the marker, then a start.
static void brownout_during_white_frame(uint32_t item, uint32_t repetition, uint8_t brightness)
{
  power::animation_started("white", 100);
  power::frame_shown(item, repetition, brightness);
  power::sim_set_next_reason(pixelart::ResetReason::Brownout);
  setup();
}

static void test_marker_estimate_sets_the_first_limit()
{
  TempData data("power");
  data.write("animations/white.json", WHITE);
  setup();
  pixelart::Animation animation;
  std::vector<pixelart::Diagnostic> diagnostics;
  TEST_ASSERT_TRUE(load_stored_animation("white", animation, diagnostics));
  uint32_t item = 0, repetition = 0;
  TEST_ASSERT_TRUE(pixelart::frame_position(animation, 2, item, repetition));
  for (int i = 0; i < 3; i++)
    brownout_during_white_frame(item, repetition, 100);
  // Frame 2 is all white: 4864 mA at 100, so the limit is 3891 mA.
  const power::Status s = power::status();
  TEST_ASSERT_TRUE(s.limit_active);
  TEST_ASSERT_EQUAL_UINT16(3891, s.limit_ma);
  TEST_ASSERT_TRUE(s.last_frame_known);
  TEST_ASSERT_EQUAL_STRING("white", s.last_animation.c_str());
  TEST_ASSERT_EQUAL_UINT32(2, s.last_frame);
}

static pixelart::PowerRecord stored_record(const std::vector<uint8_t> &bytes)
{
  pixelart::PowerRecord record;
  uint8_t model = 0;
  TEST_ASSERT_TRUE(pixelart::power_record_decode(bytes.data(), bytes.size(), record, model));
  return record;
}

static void test_brownout_is_stored_before_its_frame_is_read()
{
  TempData data("power");
  data.write("animations/white.json", WHITE);
  setup();
  const size_t before = power::sim_stores().size();
  brownout_during_white_frame(0, 0, 100);
  // The first write already holds the brownout, without its frame, in case the power fails again while the frame
  // is read and rendered; the second adds the frame.
  const std::vector<std::vector<uint8_t>> stores = power::sim_stores();
  TEST_ASSERT_EQUAL_size_t(before + 2, stores.size());
  const pixelart::PowerRecord first = stored_record(stores[before]);
  TEST_ASSERT_EQUAL_UINT8(2, first.count);
  TEST_ASSERT_TRUE(first.reasons[1] == pixelart::ResetReason::Brownout);
  TEST_ASSERT_TRUE(first.has_last);
  TEST_ASSERT_FALSE(first.last_frame_known);
  const pixelart::PowerRecord second = stored_record(stores[before + 1]);
  TEST_ASSERT_EQUAL_UINT8(2, second.count);
  TEST_ASSERT_TRUE(second.last_frame_known);
  TEST_ASSERT_EQUAL_STRING("white", second.last_animation);
  // Without a marker there is no frame to read: one write.
  power::sim_set_next_reason(pixelart::ResetReason::Brownout);
  setup();
  TEST_ASSERT_EQUAL_size_t(before + 3, power::sim_stores().size());
}

static void test_damaged_or_missing_marker_gives_no_estimate()
{
  TempData data("power");
  data.write("animations/white.json", WHITE);
  setup();
  // A torn frame write, a marker cleared after the animation, and a marker of a deleted animation.
  power::animation_started("white", 100);
  power::frame_shown(0, 0, 100);
  power::detail::marker().brightness = 99;
  power::sim_set_next_reason(pixelart::ResetReason::Brownout);
  setup();
  play_stored_animation("white");
  power::sim_set_next_reason(pixelart::ResetReason::Brownout);
  setup();
  power::animation_started("gone", 100);
  power::frame_shown(0, 0, 100);
  power::sim_set_next_reason(pixelart::ResetReason::Brownout);
  setup();
  const power::Status s = power::status();
  TEST_ASSERT_EQUAL_UINT16(1000, s.limit_ma);
  TEST_ASSERT_FALSE(s.last_frame_known);
  // Any start clears the marker after reading it.
  power::animation_started("white", 100);
  power::frame_shown(0, 0, 100);
  setup(); // software start
  TEST_ASSERT_EQUAL_UINT32(0, power::detail::marker().magic);
}

static void test_update_icon_clears_the_marker_and_keeps_the_animation()
{
  power::animation_started("white", 60);
  power::frame_shown(0, 0, 60);
  power::icon_started();
  TEST_ASSERT_EQUAL_UINT32(0, power::detail::marker().magic);
  power::icon_ended();
  // The animation's ID is back, but no frame until the next one is shown: a brownout now has no estimate.
  TEST_ASSERT_NOT_EQUAL(0, power::detail::marker().magic);
  TEST_ASSERT_EQUAL_UINT16(0xffff, power::detail::marker().item);
  TEST_ASSERT_EQUAL_UINT8(60, power::current_scale());
  power::animation_stopped();
  power::icon_ended();
  TEST_ASSERT_EQUAL_UINT32(0, power::detail::marker().magic);
  TEST_ASSERT_EQUAL_UINT8(100, power::current_scale());
  // A frame without a known position leaves the marker without a frame.
  power::animation_started("white", 100);
  power::frame_shown(UINT32_MAX, UINT32_MAX, 100);
  TEST_ASSERT_EQUAL_UINT16(0xffff, power::detail::marker().item);
  power::animation_stopped();
}

static void test_date_is_stored_once_the_time_is_known()
{
  TempData data("power");
  data.write("animations/white.json", WHITE);
  updates::sim_reset();
  power::sim_set_next_reason(pixelart::ResetReason::Brownout);
  setup();
  TEST_ASSERT_TRUE(power::status().has_last);
  TEST_ASSERT_FALSE(power::status().last_date_known);
  updates::sim_set_local_date({2026, 12, 24});
  play_stored_animation("white");
  setup(); // the date was stored: a restart reads it back
  const power::Status s = power::status();
  TEST_ASSERT_TRUE(s.last_date_known);
  TEST_ASSERT_TRUE(s.last_date == (pixelart::LocalDate{2026, 12, 24}));
  updates::sim_reset();
}

static void test_store_failure_is_logged_once_and_the_record_stays_in_memory()
{
  TempData data("power");
  power::sim_fail_stores(true);
  power::sim_set_next_reason(pixelart::ResetReason::Brownout);
  setup();
  TEST_ASSERT_EQUAL_UINT8(1, power::status().brownouts);
  TEST_ASSERT_FALSE(power::clear());
  TEST_ASSERT_EQUAL_UINT8(1, power::status().brownouts);
  size_t logged = 0;
  for (const sim::SerialLine &line : sim::serial())
    logged += line.text.find("power protection: the record cannot be stored") != std::string::npos;
  TEST_ASSERT_EQUAL(1, logged);
  power::sim_fail_stores(false);
  setup(); // nothing was stored: the history starts again
  TEST_ASSERT_EQUAL(1, power::status().resets.size());
}

static void test_model_change_clears_the_record()
{
  TempData data("power");
  start_with_limit_1000();
  power::sim_set_model(2);
  setup();
  const power::Status s = power::status();
  TEST_ASSERT_FALSE(s.limit_active);
  TEST_ASSERT_FALSE(s.has_last);
  TEST_ASSERT_EQUAL(1, s.resets.size());
}

int main(int, char **)
{
  UNITY_BEGIN();
  RUN_TEST(test_estimate_rows);
  RUN_TEST(test_white_estimate_matches_a_white_frame);
  RUN_TEST(test_power_brightness_rows);
  RUN_TEST(test_scale_rows);
  RUN_TEST(test_scan_rows);
  RUN_TEST(test_limit_rows);
  RUN_TEST(test_reason_names);
  RUN_TEST(test_frame_numbers_count_loops_once);
  RUN_TEST(test_record_round_trip);
  RUN_TEST(test_record_rejects_malformed_bytes);
  RUN_TEST(test_limit_off_plays_at_full_brightness);
  RUN_TEST(test_heavy_animation_plays_at_one_scale);
  RUN_TEST(test_light_animation_plays_unchanged_with_the_limit_on);
  RUN_TEST(test_no_animations_image_is_never_dimmed);
  RUN_TEST(test_a_changed_animation_is_scanned_again);
  RUN_TEST(test_file_changes_reach_the_scale_cache);
  RUN_TEST(test_power_reset_restores_full_brightness_at_the_next_frame);
  RUN_TEST(test_marker_estimate_sets_the_first_limit);
  RUN_TEST(test_brownout_is_stored_before_its_frame_is_read);
  RUN_TEST(test_damaged_or_missing_marker_gives_no_estimate);
  RUN_TEST(test_update_icon_clears_the_marker_and_keeps_the_animation);
  RUN_TEST(test_date_is_stored_once_the_time_is_known);
  RUN_TEST(test_store_failure_is_logged_once_and_the_record_stays_in_memory);
  RUN_TEST(test_model_change_clears_the_record);
  return UNITY_END();
}
