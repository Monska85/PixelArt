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

constexpr uint16_t white = rgb565(255, 255, 255);
constexpr uint16_t green = rgb565(78, 176, 19);
constexpr uint16_t darkgreen = rgb565(2, 93, 77);

constexpr int TOTAL_FRAMES = 32;

const Pixel frame0[] = {
    {4, 7, green},       {3, 8, green},       {4, 8, green},       {5, 8, green},       {2, 9, green},
    {3, 9, green},       {4, 9, green},       {5, 9, green},       {6, 9, green},       {3, 10, green},
    {4, 10, green},      {5, 10, green},      {2, 11, green},      {3, 11, green},      {4, 11, green},
    {5, 11, green},      {6, 11, green},      {1, 12, green},      {2, 12, green},      {3, 12, green},
    {4, 12, green},      {5, 12, green},      {6, 12, green},      {7, 12, green},      {2, 13, green},
    {3, 13, green},      {4, 13, green},      {5, 13, green},      {6, 13, green},      {1, 14, green},
    {2, 14, green},      {3, 14, green},      {4, 14, green},      {5, 14, green},      {6, 14, green},
    {7, 14, green},      {0, 15, green},      {1, 15, green},      {2, 15, green},      {3, 15, green},
    {4, 15, green},      {5, 15, green},      {6, 15, green},      {7, 15, green},      {8, 15, green},
    {11, 5, darkgreen},  {10, 6, darkgreen},  {11, 6, darkgreen},  {12, 6, darkgreen},  {9, 7, darkgreen},
    {10, 7, darkgreen},  {11, 7, darkgreen},  {12, 7, darkgreen},  {13, 7, darkgreen},  {8, 8, darkgreen},
    {9, 8, darkgreen},   {10, 8, darkgreen},  {11, 8, darkgreen},  {12, 8, darkgreen},  {13, 8, darkgreen},
    {14, 8, darkgreen},  {10, 9, darkgreen},  {11, 9, darkgreen},  {12, 9, darkgreen},  {9, 10, darkgreen},
    {10, 10, darkgreen}, {11, 10, darkgreen}, {12, 10, darkgreen}, {13, 10, darkgreen}, {8, 11, darkgreen},
    {9, 11, darkgreen},  {10, 11, darkgreen}, {11, 11, darkgreen}, {12, 11, darkgreen}, {13, 11, darkgreen},
    {14, 11, darkgreen}, {8, 12, darkgreen},  {9, 12, darkgreen},  {10, 12, darkgreen}, {11, 12, darkgreen},
    {12, 12, darkgreen}, {13, 12, darkgreen}, {14, 12, darkgreen}, {15, 12, darkgreen}, {7, 13, darkgreen},
    {8, 13, darkgreen},  {9, 13, darkgreen},  {10, 13, darkgreen}, {11, 13, darkgreen}, {12, 13, darkgreen},
    {13, 13, darkgreen}, {14, 13, darkgreen}, {15, 13, darkgreen}, {8, 14, darkgreen},  {9, 14, darkgreen},
    {10, 14, darkgreen}, {11, 14, darkgreen}, {12, 14, darkgreen}, {13, 14, darkgreen}, {14, 14, darkgreen},
    {15, 14, darkgreen}, {9, 15, darkgreen},  {10, 15, darkgreen}, {11, 15, darkgreen}, {12, 15, darkgreen},
    {13, 15, darkgreen}, {14, 15, darkgreen}, {15, 15, darkgreen}};

const Pixel snow[] = {
    {0, 0, white},  {11, 0, white},  {3, 1, white},  {9, 1, white},   {15, 1, white}, {1, 2, white},   {7, 2, white},
    {13, 2, white}, {4, 3, white},   {10, 3, white}, {2, 4, white},   {8, 4, white},  {14, 4, white},  {5, 5, white},
    {11, 5, white}, {0, 6, white},   {7, 6, white},  {13, 6, white},  {3, 7, white},  {10, 7, white},  {1, 8, white},
    {7, 8, white},  {14, 8, white},  {4, 9, white},  {12, 9, white},  {0, 10, white}, {10, 10, white}, {2, 11, white},
    {6, 11, white}, {13, 11, white}, {4, 12, white}, {11, 12, white}, {0, 13, white}, {7, 13, white},  {15, 13, white},
    {2, 14, white}, {9, 14, white},  {5, 15, white}, {13, 15, white}};

} // namespace

void snow_trees()
{
  play_frames(TOTAL_FRAMES, 250,
              [](int frame)
              {
                // Draw the trees
                draw(frame0);

                // Add the snow, moved down one row per frame
                for (const Pixel &p : snow)
                {
                  matrix.drawPixel(p.x, (p.y + frame) % MATRIX_HEIGHT, p.color);
                }
              });
}
