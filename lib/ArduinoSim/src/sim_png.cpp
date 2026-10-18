// PNG output: one image per frame, or a sheet with many frames side by side.
// Uses uncompressed deflate blocks, so it needs no external library.

#include <algorithm>
#include <cstring>
#include <fstream>

#include "sim_internal.h"

namespace sim::detail
{
namespace
{

uint32_t crc32(const uint8_t *data, size_t len)
{
  static uint32_t table[256];
  static bool init = false;
  if (!init)
  {
    for (uint32_t n = 0; n < 256; n++)
    {
      uint32_t c = n;
      for (int k = 0; k < 8; k++)
        c = (c & 1) ? 0xEDB88320u ^ (c >> 1) : c >> 1;
      table[n] = c;
    }
    init = true;
  }
  uint32_t crc = 0xFFFFFFFFu;
  for (size_t i = 0; i < len; i++)
    crc = table[(crc ^ data[i]) & 0xff] ^ (crc >> 8);
  return ~crc;
}

void put32(std::string &s, uint32_t v)
{
  s += (char)(v >> 24);
  s += (char)(v >> 16);
  s += (char)(v >> 8);
  s += (char)v;
}

void png_chunk(std::string &out, const char *type, const std::string &data)
{
  put32(out, (uint32_t)data.size());
  std::string body = std::string(type, 4) + data;
  out += body;
  put32(out, crc32((const uint8_t *)body.data(), body.size()));
}

// zlib stream made of stored (uncompressed) deflate blocks.
std::string zlib_stored(const std::string &raw)
{
  std::string z = "\x78\x01";
  for (size_t pos = 0;; pos += 65535)
  {
    size_t len = std::min<size_t>(65535, raw.size() - pos);
    bool last = pos + len >= raw.size();
    z += (char)(last ? 1 : 0);
    z += (char)(len & 0xff);
    z += (char)(len >> 8);
    z += (char)(~len & 0xff);
    z += (char)((~len >> 8) & 0xff);
    z.append(raw, pos, len);
    if (last)
      break;
  }
  uint32_t a = 1, b = 0;
  for (unsigned char c : raw)
  {
    a = (a + c) % 65521;
    b = (b + a) % 65521;
  }
  put32(z, (b << 16) | a);
  return z;
}

bool write_png(const std::filesystem::path &path, int w, int h, const std::vector<uint8_t> &rgb)
{
  std::string raw;
  raw.reserve((size_t)h * (w * 3 + 1));
  for (int y = 0; y < h; y++)
  {
    raw += '\0'; // filter type: none
    raw.append((const char *)&rgb[(size_t)y * w * 3], (size_t)w * 3);
  }

  std::string ihdr;
  put32(ihdr, w);
  put32(ihdr, h);
  ihdr += std::string("\x08\x02\x00\x00\x00", 5); // 8-bit RGB
  std::string out = "\x89PNG\r\n\x1a\n";
  png_chunk(out, "IHDR", ihdr);
  png_chunk(out, "IDAT", zlib_stored(raw));
  png_chunk(out, "IEND", "");
  std::ofstream f(path, std::ios::binary);
  f.write(out.data(), out.size());
  return (bool)f;
}

// Draws one frame into an image buffer: each LED is a square with a 1px gap.
void draw_frame(std::vector<uint8_t> &img, int img_w, int ox, int oy, const Frame &f, int cell)
{
  const Panel &p = state().panel;
  for (int y = 0; y < p.height; y++)
    for (int x = 0; x < p.width; x++)
    {
      const uint8_t *c = &f.rgb[(y * p.width + x) * 3];
      bool off = c[0] == 0 && c[1] == 0 && c[2] == 0;
      uint8_t px[3] = {32, 32, 32};
      if (!off)
        for (int k = 0; k < 3; k++)
          px[k] = display_value(c[k]);
      for (int dy = 0; dy < cell - 1; dy++)
        for (int dx = 0; dx < cell - 1; dx++)
          memcpy(&img[((size_t)(oy + y * cell + dy) * img_w + ox + x * cell + dx) * 3], px, 3);
    }
}

} // namespace

bool write_frame_png(const std::filesystem::path &path, const Frame &f)
{
  const Panel &p = state().panel;
  const int cell = 16, pad = 8;
  int w = p.width * cell + pad * 2, h = p.height * cell + pad * 2;
  std::vector<uint8_t> img((size_t)w * h * 3, 12);
  draw_frame(img, w, pad, pad, f, cell);
  return write_png(path, w, h, img);
}

bool write_sheet_png(const std::filesystem::path &path, const std::vector<const Frame *> &frames)
{
  const Panel &p = state().panel;
  const int cell = 6, pad = 6, cols = (int)std::min<size_t>(12, frames.size());
  const int fw = p.width * cell, fh = p.height * cell;
  const int rows = (int)((frames.size() + cols - 1) / cols);
  const int w = cols * (fw + pad) + pad, h = rows * (fh + pad) + pad;
  std::vector<uint8_t> img((size_t)w * h * 3, 12);
  for (size_t i = 0; i < frames.size(); i++)
    draw_frame(img, w, pad + (int)(i % cols) * (fw + pad), pad + (int)(i / cols) * (fh + pad), *frames[i], cell);
  return write_png(path, w, h, img);
}

} // namespace sim::detail
