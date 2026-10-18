// Terminal rendering: truecolor ANSI frames, redrawn in place in real-time
// and live modes.

#include <cmath>
#include <cstdio>

#include "sim_internal.h"

namespace sim::detail
{

// LED output is linear light; convert to sRGB so the screen looks like the panel.
uint8_t display_value(uint8_t v)
{
  if (state().opts.raw_colors)
    return v;
  return (uint8_t)std::lround(255.0 * std::pow(v / 255.0, 1.0 / 2.2));
}

bool in_range(size_t index)
{
  const Options &o = state().opts;
  return index >= o.range_from && index <= o.range_to;
}

void print_ansi(const Frame &f, size_t index)
{
  const State &s = state();
  std::string out;
  if (s.opts.realtime)
    out += "\x1b[H";
  char head[160];
  snprintf(head, sizeof(head), "frame %zu  t=%.0fms  scene=%s\x1b[K\n", index, f.t_us / 1000.0,
           f.scene.empty() ? "-" : f.scene.c_str());
  out += head;
  for (int y = 0; y < s.panel.height; y++)
  {
    for (int x = 0; x < s.panel.width; x++)
    {
      const uint8_t *c = &f.rgb[(y * s.panel.width + x) * 3];
      char cell[48];
      if (c[0] == 0 && c[1] == 0 && c[2] == 0)
        snprintf(cell, sizeof(cell), "\x1b[38;2;60;60;60m\xC2\xB7\xC2\xB7");
      else
        snprintf(cell, sizeof(cell), "\x1b[38;2;%d;%d;%dm\xE2\x96\x88\xE2\x96\x88", display_value(c[0]),
                 display_value(c[1]), display_value(c[2]));
      out += cell;
    }
    out += "\x1b[0m\x1b[K\n";
  }
  if (s.opts.live)
  {
    out += "\x1b[2m" + std::string(s.panel.width * 2, '-') + "  Ctrl+C to quit\x1b[0m\x1b[K\n";
    for (const std::string &line : s.live_log)
      out += line + "\x1b[K\n";
    out += "\x1b[J";
  }
  fputs(out.c_str(), stdout);
  fflush(stdout);
}

} // namespace sim::detail
