// Native LED matrix simulator: records every NeoPixel show() as a frame on
// a virtual clock and renders the result (terminal, PNG, JSON, HTML player).

#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace sim
{

// One show() call, mapped onto the physical panel grid.
struct Frame
{
  uint64_t t_us = 0;        // virtual time of the show() call
  uint64_t duration_us = 0; // time until the next show() (or end of run)
  std::string scene;        // scene running when the frame was shown
  std::vector<uint8_t> rgb; // width * height * 3 bytes, row-major, LED output values

  // Packed 0xRRGGBB LED output value at panel coordinate (x, y).
  uint32_t at(int x, int y) const;
};

struct SerialLine
{
  uint64_t t_us;
  std::string text;
};

// A named entry point the simulator can run on its own (--anim).
struct Scene
{
  const char *name;
  void (*play)();
};

// Physical panel: size and how the LED strip snakes through it. Uses the
// NEO_MATRIX_* bit values so it can be compared with the sketch's flags.
struct Panel
{
  int width = 16;
  int height = 16;
  uint8_t layout = 0x04 | 0x08; // top, left, columns, zigzag
};

const std::vector<Frame> &frames();
const std::vector<SerialLine> &serial();
const Panel &panel();
uint64_t now_us();
unsigned long seed();

// Clears recorded frames, serial output and the clock. Call between tests.
void reset();
void set_scene(const std::string &name);

// Runs setup() then loop() (or the selected scenes) and writes the outputs.
// Pass the sketch's scenes to enable --list and --anim.
int run(int argc, char **argv, const Scene *scenes, size_t count);

// Hooks used by the Arduino and NeoPixel shims.
void advance_us(uint64_t us);
void on_show(const uint8_t *pixels, uint16_t count, uint8_t r_off, uint8_t g_off, uint8_t b_off,
             uint8_t bytes_per_pixel);
void on_serial(char c);

} // namespace sim
