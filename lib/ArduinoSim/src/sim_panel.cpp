// Physical panel wiring: where each LED of the strip sits on the grid.
//
// The same mapping exists in three places, keep them in sync:
// Adafruit_NeoMatrix::drawPixel() (the firmware), this file (the simulator)
// and strip_to_grid() in monitor/filter_pixelart.py (the live mirror).

#include <sstream>

#include "sim_internal.h"

namespace sim::detail
{
namespace
{

// NEO_MATRIX_* bit values from Adafruit_NeoMatrix.h
constexpr uint8_t MATRIX_BOTTOM = 0x01, MATRIX_RIGHT = 0x02, MATRIX_COLUMNS = 0x04, MATRIX_ZIGZAG = 0x08;

// Same single-matrix math as Adafruit_NeoMatrix::drawPixel().
int strip_index(const Panel &p, int x, int y)
{
  int minor = x, major = y, scale;
  if (p.layout & MATRIX_RIGHT)
    minor = p.width - 1 - minor;
  if (p.layout & MATRIX_BOTTOM)
    major = p.height - 1 - major;
  if (p.layout & MATRIX_COLUMNS)
  {
    std::swap(major, minor);
    scale = p.height;
  }
  else
  {
    scale = p.width;
  }
  if ((p.layout & MATRIX_ZIGZAG) && (major & 1))
    return (major + 1) * scale - 1 - minor;
  return major * scale + minor;
}

} // namespace

void build_strip_map()
{
  State &s = state();
  s.strip_to_grid.assign(s.panel.width * s.panel.height, -1);
  for (int y = 0; y < s.panel.height; y++)
    for (int x = 0; x < s.panel.width; x++)
      s.strip_to_grid[strip_index(s.panel, x, y)] = y * s.panel.width + x;
}

std::string layout_name(uint8_t layout)
{
  std::string name = (layout & MATRIX_BOTTOM) ? "bottom" : "top";
  name += (layout & MATRIX_RIGHT) ? ",right" : ",left";
  name += (layout & MATRIX_COLUMNS) ? ",columns" : ",rows";
  name += (layout & MATRIX_ZIGZAG) ? ",zigzag" : ",progressive";
  return name;
}

bool parse_layout(const std::string &spec, uint8_t &out)
{
  uint8_t layout = 0;
  std::stringstream ss(spec);
  std::string token;
  while (std::getline(ss, token, ','))
  {
    if (token == "bottom")
      layout |= MATRIX_BOTTOM;
    else if (token == "right")
      layout |= MATRIX_RIGHT;
    else if (token == "columns")
      layout |= MATRIX_COLUMNS;
    else if (token == "zigzag")
      layout |= MATRIX_ZIGZAG;
    else if (token != "top" && token != "left" && token != "rows" && token != "progressive")
      return false;
  }
  out = layout;
  return true;
}

} // namespace sim::detail
