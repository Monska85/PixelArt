// frames.json and the self-contained HTML player built around it.

#include <cmath>
#include <sstream>

#include "sim_internal.h"

// Generated at build time from assets/player.html by scripts/embed_assets.py.
#include "player_html.h"

namespace sim::detail
{
namespace
{

std::string json_escape(const std::string &s)
{
  std::string out;
  for (unsigned char c : s)
  {
    if (c == '"' || c == '\\')
    {
      out += '\\';
      out += (char)c;
    }
    else if (c < 0x20)
    {
      char buf[8];
      snprintf(buf, sizeof(buf), "\\u%04x", c);
      out += buf;
    }
    else
    {
      out += (char)c;
    }
  }
  return out;
}

long long ms(uint64_t us) { return std::llround(us / 1000.0); }

} // namespace

std::string frames_json()
{
  const State &s = state();
  static const char hex[] = "0123456789abcdef";
  std::ostringstream o;
  o << "{\n  \"panel\": {\"width\": " << s.panel.width << ", \"height\": " << s.panel.height << ", \"layout\": \""
    << layout_name(s.panel.layout) << "\"},\n"
    << "  \"pixel_format\": \"row-major hex rrggbb, LED output values (brightness and gamma applied)\",\n"
    << "  \"frames\": [";
  for (size_t i = 0; i < s.frames.size(); i++)
  {
    const Frame &f = s.frames[i];
    std::string px;
    px.reserve(f.rgb.size() * 2);
    for (uint8_t b : f.rgb)
    {
      px += hex[b >> 4];
      px += hex[b & 15];
    }
    o << (i ? ",\n    " : "\n    ") << "{\"i\": " << i << ", \"t_ms\": " << ms(f.t_us)
      << ", \"duration_ms\": " << ms(f.duration_us) << ", \"scene\": \"" << json_escape(f.scene) << "\", \"pixels\": \""
      << px << "\"}";
  }
  o << "\n  ],\n  \"serial\": [";
  for (size_t i = 0; i < s.serial.size(); i++)
    o << (i ? ",\n    " : "\n    ") << "{\"t_ms\": " << ms(s.serial[i].t_us) << ", \"text\": \""
      << json_escape(s.serial[i].text) << "\"}";
  o << "\n  ]\n}\n";
  return o.str();
}

std::string player_html(const std::string &frames_json)
{
  std::string html = reinterpret_cast<const char *>(PLAYER_HTML);
  const std::string placeholder = "__DATA__";
  size_t at = html.find(placeholder);
  if (at != std::string::npos)
    html.replace(at, placeholder.size(), frames_json);
  return html;
}

} // namespace sim::detail
