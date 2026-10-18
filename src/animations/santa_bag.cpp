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
constexpr uint16_t white = rgb565(255, 255, 255);
constexpr uint16_t yellow = rgb565(249, 199, 47);
constexpr uint16_t darkred = rgb565(152, 0, 0);
constexpr uint16_t darkpink = rgb565(244, 99, 166);
constexpr uint16_t pinkface = rgb565(249, 203, 203);
constexpr uint16_t blue = rgb565(4, 43, 105);
constexpr uint16_t brown = rgb565(140, 82, 39);

constexpr int TOTAL_FRAMES = round_up_to_even(DEFAULT_TOTAL_FRAMES / 2);

const Pixel frame0[] = {
    {2, 0, red},      {3, 0, red},      {4, 0, red},      {5, 0, red},      {1, 1, red},      {2, 1, red},
    {3, 1, red},      {4, 1, red},      {5, 1, red},      {6, 1, red},      {0, 2, red},      {1, 2, red},
    {2, 2, red},      {3, 2, red},      {4, 2, red},      {5, 2, red},      {6, 2, red},      {7, 2, red},
    {1, 8, red},      {5, 8, red},      {0, 9, red},      {1, 9, red},      {2, 9, red},      {4, 9, red},
    {5, 9, red},      {6, 9, red},      {0, 10, red},     {1, 10, red},     {2, 10, red},     {3, 10, red},
    {4, 10, red},     {5, 10, red},     {0, 11, red},     {1, 12, red},     {2, 12, red},     {3, 12, red},
    {4, 12, red},     {5, 12, red},     {1, 13, red},     {2, 13, red},     {4, 13, red},     {5, 13, red},
    {0, 3, white},    {1, 3, white},    {2, 3, white},    {3, 3, white},    {4, 3, white},    {5, 3, white},
    {6, 3, white},    {8, 3, white},    {9, 3, white},    {0, 4, white},    {6, 4, white},    {8, 4, white},
    {9, 4, white},    {0, 6, white},    {1, 6, white},    {2, 6, white},    {3, 6, white},    {4, 6, white},
    {5, 6, white},    {6, 6, white},    {1, 7, white},    {2, 7, white},    {3, 7, white},    {4, 7, white},
    {5, 7, white},    {2, 8, white},    {3, 8, white},    {4, 8, white},    {3, 9, white},    {3, 11, yellow},
    {1, 11, brown},   {2, 11, brown},   {4, 11, brown},   {5, 11, brown},   {1, 14, brown},   {2, 14, brown},
    {4, 14, brown},   {5, 14, brown},   {0, 15, brown},   {1, 15, brown},   {2, 15, brown},   {4, 15, brown},
    {5, 15, brown},   {6, 15, brown},   {2, 5, blue},     {4, 5, blue},     {1, 4, pinkface}, {2, 4, pinkface},
    {3, 4, pinkface}, {4, 4, pinkface}, {5, 4, pinkface}, {0, 5, pinkface}, {1, 5, pinkface}, {3, 5, pinkface},
    {5, 5, pinkface}, {6, 5, pinkface}, {0, 12, pinkface}};

const Pixel frame1[] = {{6, 12, pinkface}, {6, 10, red}, {6, 11, red}};

const Pixel frame2[] = {
    {9, 9, pinkface},  {7, 9, red},       {8, 9, red},       {3, 7, pinkface},  {9, 7, darkred},   {10, 7, darkred},
    {11, 7, darkred},  {12, 7, darkred},  {13, 7, darkred},  {14, 7, darkred},  {10, 8, darkred},  {11, 8, darkred},
    {12, 8, darkred},  {13, 8, darkred},  {10, 10, darkred}, {11, 10, darkred}, {13, 10, darkred}, {9, 11, darkred},
    {10, 11, darkred}, {12, 11, darkred}, {14, 11, darkred}, {8, 12, darkred},  {9, 12, darkred},  {10, 12, darkred},
    {11, 12, darkred}, {12, 12, darkred}, {13, 12, darkred}, {14, 12, darkred}, {15, 12, darkred}, {8, 13, darkred},
    {9, 13, darkred},  {10, 13, darkred}, {11, 13, darkred}, {12, 13, darkred}, {13, 13, darkred}, {14, 13, darkred},
    {15, 13, darkred}, {8, 14, darkred},  {9, 14, darkred},  {10, 14, darkred}, {11, 14, darkred}, {12, 14, darkred},
    {13, 14, darkred}, {14, 14, darkred}, {15, 14, darkred}, {9, 15, darkred},  {10, 15, darkred}, {11, 15, darkred},
    {12, 15, darkred}, {13, 15, darkred}, {14, 15, darkred}, {10, 9, yellow},   {11, 9, yellow},   {12, 9, yellow},
    {13, 9, yellow},   {12, 10, yellow},  {11, 11, yellow},  {13, 11, yellow},  {3, 7, darkpink}};

} // namespace

void santa_bag()
{
  play_frames(TOTAL_FRAMES, DEFAULT_DELAY_MS * 2,
              [](int frame)
              {
                // Draw the Santa
                draw(frame0);

                // Add Santa's bag
                if (frame % 2 == 0)
                {
                  draw(frame1);
                }
                else
                {
                  draw(frame2);
                }
              });
}
