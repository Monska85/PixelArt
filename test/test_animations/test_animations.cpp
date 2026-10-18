// Runs animations on the simulator and checks the recorded frames.
// Run with: pio test -e native_test (or make test)

#include <sim.h>
#include <unity.h>

#include "animations.h"

static bool is_off(uint32_t c) { return c == 0; }

static uint8_t red(uint32_t c) { return c >> 16; }
static uint8_t green(uint32_t c) { return c >> 8; }
static uint8_t blue(uint32_t c) { return c; }

void setUp()
{
  sim::reset();
  setup();
}

void tearDown() {}

void test_every_animation_shows_frames_and_returns()
{
  for (size_t i = 0; i < ANIMATION_COUNT; i++)
  {
    sim::reset();
    ANIMATIONS[i].play();
    TEST_ASSERT_GREATER_THAN_MESSAGE(0, sim::frames().size(), ANIMATIONS[i].name);
  }
}

void test_xmas_tree_frames_and_timing()
{
  xmas_tree();
  const auto &frames = sim::frames();
  TEST_ASSERT_EQUAL(17, frames.size());
  TEST_ASSERT_EQUAL_UINT64(0, frames[0].t_us);
  TEST_ASSERT_EQUAL_UINT64(500000, frames[1].t_us - frames[0].t_us);
}

void test_xmas_tree_star_is_yellow_and_corner_is_off()
{
  xmas_tree();
  const sim::Frame &f = sim::frames()[0];

  uint32_t star = f.at(7, 0);
  TEST_ASSERT_FALSE(is_off(star));
  TEST_ASSERT_TRUE(red(star) > blue(star) * 4);
  TEST_ASSERT_TRUE(green(star) > blue(star) * 4);

  TEST_ASSERT_TRUE(is_off(f.at(0, 0)));
}

void test_brightness_scales_led_output()
{
  matrix.fillScreen(matrix.Color(255, 255, 255));
  matrix.show();
  uint32_t white = sim::frames().back().at(0, 0);
  TEST_ASSERT_EQUAL_UINT8((255 * (BRIGHTNESS + 1)) >> 8, red(white));
}

int main(int, char **)
{
  UNITY_BEGIN();
  RUN_TEST(test_every_animation_shows_frames_and_returns);
  RUN_TEST(test_xmas_tree_frames_and_timing);
  RUN_TEST(test_xmas_tree_star_is_yellow_and_corner_is_off);
  RUN_TEST(test_brightness_scales_led_output);
  return UNITY_END();
}
