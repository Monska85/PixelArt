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

constexpr uint16_t gold = rgb565(191, 144, 0);
constexpr uint16_t yellow = rgb565(249, 199, 47);
constexpr uint16_t red = rgb565(255, 0, 0);
constexpr uint16_t darkred = rgb565(152, 0, 0);
constexpr uint16_t brown = rgb565(140, 82, 39);
constexpr uint16_t cheek = rgb565(235, 179, 205);
constexpr uint16_t white = rgb565(255, 255, 255);
constexpr uint16_t blue = rgb565(4, 43, 105);

constexpr int TOTAL_FRAMES = DEFAULT_TOTAL_FRAMES;

const Pixel frame0[] = {
    {7, 13, darkred}, {8, 13, darkred}, {7, 14, darkred}, {8, 14, darkred}, {4, 0, gold},    {11, 0, gold},
    {1, 1, gold},     {4, 1, gold},     {11, 1, gold},    {14, 1, gold},    {2, 2, gold},    {4, 2, gold},
    {11, 2, gold},    {13, 2, gold},    {1, 3, gold},     {2, 3, gold},     {3, 3, gold},    {4, 3, gold},
    {6, 3, gold},     {9, 3, gold},     {11, 3, gold},    {12, 3, gold},    {13, 3, gold},   {14, 3, gold},
    {4, 4, gold},     {5, 4, gold},     {6, 4, gold},     {9, 4, gold},     {10, 4, gold},   {11, 4, gold},
    {6, 5, gold},     {9, 5, gold},     {6, 6, gold},     {9, 6, gold},     {1, 7, cheek},   {14, 7, cheek},
    {2, 8, cheek},    {3, 8, cheek},    {12, 8, cheek},   {13, 8, cheek},   {1, 6, brown},   {14, 6, brown},
    {2, 7, brown},    {3, 7, brown},    {4, 7, brown},    {5, 7, brown},    {6, 7, brown},   {7, 7, brown},
    {8, 7, brown},    {9, 7, brown},    {10, 7, brown},   {11, 7, brown},   {12, 7, brown},  {13, 7, brown},
    {4, 8, brown},    {5, 8, brown},    {6, 8, brown},    {7, 8, brown},    {8, 8, brown},   {9, 8, brown},
    {10, 8, brown},   {11, 8, brown},   {4, 9, brown},    {5, 9, brown},    {6, 9, brown},   {7, 9, brown},
    {8, 9, brown},    {9, 9, brown},    {10, 9, brown},   {11, 9, brown},   {4, 10, brown},  {5, 10, brown},
    {7, 10, brown},   {8, 10, brown},   {10, 10, brown},  {11, 10, brown},  {4, 11, brown},  {5, 11, brown},
    {7, 11, brown},   {8, 11, brown},   {10, 11, brown},  {11, 11, brown},  {4, 12, brown},  {5, 12, brown},
    {6, 12, brown},   {7, 12, brown},   {8, 12, brown},   {9, 12, brown},   {10, 12, brown}, {11, 12, brown},
    {4, 13, brown},   {5, 13, brown},   {6, 13, brown},   {9, 13, brown},   {10, 13, brown}, {11, 13, brown},
    {5, 14, brown},   {6, 14, brown},   {9, 14, brown},   {10, 14, brown},  {5, 15, brown},  {6, 15, brown},
    {7, 15, brown},   {8, 15, brown},   {9, 15, brown},   {10, 15, brown},  {6, 10, blue},   {9, 10, blue},
    {6, 11, blue},    {9, 11, blue}};

const Pixel frame1[] = {
    {7, 13, white},  {8, 13, red},    {7, 14, red},    {8, 14, red},   {4, 0, yellow}, {11, 0, yellow}, {1, 1, yellow},
    {4, 1, yellow},  {11, 1, yellow}, {14, 1, yellow}, {2, 2, yellow}, {4, 2, yellow}, {11, 2, yellow}, {13, 2, yellow},
    {1, 3, yellow},  {2, 3, yellow},  {3, 3, yellow},  {4, 3, yellow}, {6, 3, yellow}, {9, 3, yellow},  {11, 3, yellow},
    {12, 3, yellow}, {13, 3, yellow}, {14, 3, yellow}, {4, 4, yellow}, {5, 4, yellow}, {6, 4, yellow},  {9, 4, yellow},
    {10, 4, yellow}, {11, 4, yellow}, {6, 5, yellow},  {9, 5, yellow}, {6, 6, yellow}, {9, 6, yellow}};

} // namespace

void reindeer()
{
  play_frames(TOTAL_FRAMES, DEFAULT_DELAY_MS,
              [](int frame)
              {
                // Draw the reindeer
                draw(frame0);

                // Make the nose and antlers shiny
                if (frame % 2 == 1)
                {
                  draw(frame1);
                }
              });
}
