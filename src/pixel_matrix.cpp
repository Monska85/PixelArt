// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

#include "pixel_art.h"
#include "protocol.h"

void PixelMatrix::show()
{
  Adafruit_NeoMatrix::show();
#ifdef PIXELART_MIRROR
  mirror();
#endif
}

// Sends the LED strip as one serial line: "@PX <count> <rrggbb...>", in strip
// order with brightness applied, exactly what the LEDs receive. The monitor
// filter in monitor/filter_pixelart.py maps it onto the panel and draws it.
void PixelMatrix::mirror()
{
  static const char hex[] = "0123456789abcdef";
  static char *line = nullptr;
  static size_t line_size = 0;

  if (!Serial)
  {
    return; // USB serial not connected: skip instead of blocking
  }
  if (protocol::upload_active())
  {
    return; // the long mirror lines would compete with the upload
  }

  size_t needed = 16 + numLEDs * 6 + 1;
  if (line_size < needed)
  {
    free(line);
    line = (char *)malloc(needed);
    line_size = line ? needed : 0;
    if (!line)
    {
      return;
    }
  }

  int len = snprintf(line, line_size, "@PX %u ", numLEDs);
  const uint8_t bytes_per_pixel = (wOffset == rOffset) ? 3 : 4;
  for (uint16_t n = 0; n < numLEDs; n++)
  {
    const uint8_t *p = &pixels[n * bytes_per_pixel];
    const uint8_t rgb[3] = {p[rOffset], p[gOffset], p[bOffset]};
    for (uint8_t c : rgb)
    {
      line[len++] = hex[c >> 4];
      line[len++] = hex[c & 15];
    }
  }
  line[len++] = '\n';
  Serial.write((const uint8_t *)line, len);
}
