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

#include "animations.h"

namespace
{

constexpr uint16_t red = rgb565(255, 0, 0);
constexpr uint16_t yellow = rgb565(249, 199, 47);
constexpr uint16_t green = rgb565(78, 176, 19);
constexpr uint16_t darkgreen = rgb565(2, 93, 77);
constexpr uint16_t brown = rgb565(140, 82, 39);
constexpr uint16_t blue = rgb565(0, 0, 255);

constexpr int TOTAL_FRAMES = 33;

const Pixel frame0[] = {
    {0, 13, brown},     {1, 14, brown},     {6, 14, brown},     {10, 14, brown},    {2, 15, brown},
    {3, 15, brown},     {4, 15, brown},     {5, 15, brown},     {6, 15, brown},     {7, 15, brown},
    {8, 15, brown},     {9, 15, brown},     {10, 15, brown},    {11, 15, brown},    {12, 15, brown},
    {13, 15, brown},    {14, 15, brown},    {1, 7, red},        {15, 7, red},       {1, 8, red},
    {2, 8, red},        {15, 8, red},       {1, 9, red},        {2, 9, red},        {14, 9, red},
    {15, 9, red},       {1, 10, red},       {2, 10, red},       {3, 10, red},       {4, 10, red},
    {5, 10, red},       {6, 10, red},       {7, 10, red},       {8, 10, red},       {9, 10, red},
    {10, 10, red},      {11, 10, red},      {12, 10, red},      {13, 10, red},      {14, 10, red},
    {15, 10, red},      {1, 11, red},       {2, 11, red},       {3, 11, red},       {4, 11, red},
    {5, 11, red},       {6, 11, red},       {7, 11, red},       {8, 11, red},       {9, 11, red},
    {10, 11, red},      {11, 11, red},      {12, 11, red},      {13, 11, red},      {14, 11, red},
    {15, 11, red},      {2, 12, red},       {3, 12, red},       {4, 12, red},       {5, 12, red},
    {6, 12, red},       {7, 12, red},       {8, 12, red},       {9, 12, red},       {10, 12, red},
    {11, 12, red},      {12, 12, red},      {13, 12, red},      {14, 12, red},      {15, 12, red},
    {3, 13, red},       {4, 13, red},       {5, 13, red},       {6, 13, red},       {7, 13, red},
    {8, 13, red},       {9, 13, red},       {10, 13, red},      {11, 13, red},      {12, 13, red},
    {13, 13, red},      {14, 13, red},      {3, 5, blue},       {4, 5, blue},       {6, 5, blue},
    {7, 5, blue},       {3, 6, blue},       {4, 6, blue},       {6, 6, blue},       {7, 6, blue},
    {3, 8, blue},       {4, 8, blue},       {6, 8, blue},       {7, 8, blue},       {3, 9, blue},
    {4, 9, blue},       {6, 9, blue},       {7, 9, blue},       {7, 3, green},      {8, 3, green},
    {9, 3, green},      {11, 3, green},     {12, 3, green},     {13, 3, green},     {7, 4, green},
    {8, 4, green},      {9, 4, green},      {11, 4, green},     {12, 4, green},     {13, 4, green},
    {8, 6, green},      {9, 6, green},      {11, 6, green},     {12, 6, green},     {13, 6, green},
    {8, 7, green},      {9, 7, green},      {11, 7, green},     {12, 7, green},     {13, 7, green},
    {8, 8, green},      {9, 8, green},      {11, 8, green},     {12, 8, green},     {13, 8, green},
    {8, 9, green},      {9, 9, green},      {11, 9, green},     {12, 9, green},     {13, 9, green},
    {8, 1, darkgreen},  {9, 1, darkgreen},  {11, 1, darkgreen}, {12, 1, darkgreen}, {9, 2, darkgreen},
    {10, 2, darkgreen}, {11, 2, darkgreen}, {10, 3, darkgreen}, {10, 4, darkgreen}, {8, 5, darkgreen},
    {9, 5, darkgreen},  {10, 5, darkgreen}, {11, 5, darkgreen}, {12, 5, darkgreen}, {13, 5, darkgreen},
    {10, 6, darkgreen}, {10, 7, darkgreen}, {10, 8, darkgreen}, {10, 9, darkgreen}, {5, 5, yellow},
    {5, 6, yellow},     {5, 8, yellow},     {5, 9, yellow},     {3, 7, yellow},     {4, 7, yellow},
    {5, 7, yellow},     {6, 7, yellow},     {7, 7, yellow}};

} // namespace

void sleigh()
{
  play_frames(TOTAL_FRAMES, DEFAULT_DELAY_MS / 2,
              [](int frame)
              {
                // Slide the sleigh left one column per frame: it leaves on the left on
                // even passes and comes back in from the right on odd passes
                int shift =
                    (frame / MATRIX_WIDTH) % 2 == 0 ? -(frame % MATRIX_WIDTH) : MATRIX_WIDTH - (frame % MATRIX_WIDTH);
                for (const Pixel &p : frame0)
                {
                  int x = p.x + shift;
                  if (x >= 0 && x < MATRIX_WIDTH)
                  {
                    matrix.drawPixel(x, p.y, p.color);
                  }
                }
              });
}
