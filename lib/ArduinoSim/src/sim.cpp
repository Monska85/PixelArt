// Virtual clock, frame recorder and serial capture: the hooks the Arduino and
// NeoPixel shims call while the sketch runs.

#include <cstdio>
#include <thread>

#include "sim_internal.h"

namespace sim
{
namespace detail
{

State &state()
{
  static State s;
  return s;
}

void finish_frames()
{
  State &s = state();
  for (size_t i = 0; i < s.frames.size(); i++)
  {
    uint64_t next = i + 1 < s.frames.size() ? s.frames[i + 1].t_us : s.clock_us;
    s.frames[i].duration_us = next - s.frames[i].t_us;
  }
  if (!s.serial_buf.empty())
  {
    s.serial.push_back({s.clock_us, s.serial_buf});
    s.serial_buf.clear();
  }
}

} // namespace detail

using detail::state;
using detail::State;

uint32_t Frame::at(int x, int y) const
{
  const Panel &p = state().panel;
  if (x < 0 || y < 0 || x >= p.width || y >= p.height)
    return 0;
  const uint8_t *c = &rgb[(y * p.width + x) * 3];
  return ((uint32_t)c[0] << 16) | ((uint32_t)c[1] << 8) | c[2];
}

const std::vector<Frame> &frames() { return state().frames; }
const std::vector<SerialLine> &serial() { return state().serial; }
const Panel &panel() { return state().panel; }
uint64_t now_us() { return state().clock_us; }
unsigned long seed() { return state().opts.seed; }
const std::string &data_dir() { return state().opts.data_dir; }
void set_data_dir(const std::string &dir) { state().opts.data_dir = dir; }

void reset()
{
  State &s = state();
  s.clock_us = 0;
  s.scene.clear();
  s.frames.clear();
  s.serial.clear();
  s.serial_buf.clear();
  s.shown_frames = 0;
  s.live_log.clear();
}

void set_scene(const std::string &name) { state().scene = name; }

void advance_us(uint64_t us)
{
  State &s = state();
  s.clock_us += us;
  if (s.clock_us > s.opts.max_us)
    throw detail::Stop{"virtual time limit reached (--max-ms)"};
}

void on_show(const uint8_t *pixels, uint16_t count, uint8_t r_off, uint8_t g_off, uint8_t b_off,
             uint8_t bytes_per_pixel)
{
  State &s = state();
  if (s.frames.size() >= s.opts.max_frames)
    throw detail::Stop{"frame limit reached (--max-frames)"};
  if (s.strip_to_grid.empty())
    detail::build_strip_map();

  Frame f;
  f.t_us = s.clock_us;
  f.scene = s.scene;
  f.rgb.assign((size_t)s.panel.width * s.panel.height * 3, 0);
  for (uint16_t n = 0; n < count && n < s.strip_to_grid.size(); n++)
  {
    const uint8_t *p = &pixels[n * bytes_per_pixel];
    uint8_t *dst = &f.rgb[s.strip_to_grid[n] * 3];
    dst[0] = p[r_off];
    dst[1] = p[g_off];
    dst[2] = p[b_off];
  }
  if (s.opts.live)
    s.frames.clear(); // live mode runs forever: keep only the current frame
  s.frames.push_back(std::move(f));

  size_t index = s.shown_frames++;
  if (s.opts.realtime)
    std::this_thread::sleep_until(s.wall_start + std::chrono::microseconds(s.clock_us));
  if (s.opts.ansi && detail::in_range(index))
    detail::print_ansi(s.frames.back(), index);
}

void on_serial(char c)
{
  State &s = state();
  if (c == '\r')
    return;
  if (!s.opts.live)
    fputc(c, s.opts.ansi ? stderr : stdout);
  if (c != '\n')
  {
    s.serial_buf += c;
    return;
  }

  if (s.opts.live)
  {
    // Live mode keeps only the latest lines, shown below the matrix
    s.live_log.push_back(s.serial_buf);
    if (s.live_log.size() > detail::LIVE_LOG_LINES)
      s.live_log.erase(s.live_log.begin());
    if (!s.frames.empty())
      detail::print_ansi(s.frames.back(), s.shown_frames - 1);
  }
  else
  {
    s.serial.push_back({s.clock_us, s.serial_buf});
  }
  s.serial_buf.clear();
}

} // namespace sim
