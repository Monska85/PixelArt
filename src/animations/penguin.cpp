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
constexpr uint16_t blue = rgb565(4, 43, 105);
constexpr uint16_t orange = rgb565(255, 153, 0);
constexpr uint16_t pink = rgb565(255, 0, 255);

constexpr int TOTAL_FRAMES = DEFAULT_TOTAL_FRAMES;

const Pixel frame0[] = {
    {4, 1, red},     {3, 2, red},     {4, 2, red},      {5, 2, red},     {6, 2, red},     {7, 2, red},
    {3, 3, red},     {4, 3, red},     {5, 3, red},      {6, 3, red},     {7, 3, red},     {8, 3, red},
    {9, 3, red},     {10, 3, red},    {11, 3, red},     {3, 4, red},     {4, 4, red},     {5, 4, red},
    {2, 5, red},     {3, 5, red},     {2, 6, red},      {1, 7, red},     {5, 6, blue},    {6, 6, blue},
    {7, 6, blue},    {8, 6, blue},    {9, 6, blue},     {10, 6, blue},   {11, 6, blue},   {12, 6, blue},
    {4, 7, blue},    {8, 7, blue},    {12, 7, blue},    {13, 7, blue},   {3, 8, blue},    {13, 8, blue},
    {14, 8, blue},   {2, 9, blue},    {6, 9, blue},     {10, 9, blue},   {14, 9, blue},   {2, 10, blue},
    {14, 10, blue},  {2, 11, blue},   {14, 11, blue},   {2, 12, blue},   {13, 12, blue},  {3, 13, blue},
    {4, 13, blue},   {12, 13, blue},  {4, 14, blue},    {5, 14, blue},   {10, 14, blue},  {11, 14, blue},
    {2, 15, blue},   {3, 15, blue},   {4, 15, blue},    {5, 15, blue},   {11, 15, blue},  {12, 15, blue},
    {13, 15, blue},  {2, 0, white},   {3, 0, white},    {2, 1, white},   {3, 1, white},   {6, 4, white},
    {7, 4, white},   {8, 4, white},   {9, 4, white},    {10, 4, white},  {4, 5, white},   {5, 5, white},
    {6, 5, white},   {7, 5, white},   {8, 5, white},    {9, 5, white},   {10, 5, white},  {11, 5, white},
    {12, 5, white},  {13, 5, white},  {3, 6, white},    {4, 6, white},   {13, 6, white},  {14, 6, white},
    {2, 7, white},   {3, 7, white},   {5, 7, white},    {6, 7, white},   {7, 7, white},   {9, 7, white},
    {10, 7, white},  {11, 7, white},  {14, 7, white},   {1, 8, white},   {2, 8, white},   {4, 8, white},
    {5, 8, white},   {6, 8, white},   {7, 8, white},    {8, 8, white},   {9, 8, white},   {10, 8, white},
    {11, 8, white},  {12, 8, white},  {1, 9, white},    {3, 9, white},   {4, 9, white},   {5, 9, white},
    {7, 9, white},   {8, 9, white},   {9, 9, white},    {11, 9, white},  {12, 9, white},  {13, 9, white},
    {3, 10, white},  {4, 10, white},  {5, 10, white},   {6, 10, white},  {7, 10, white},  {8, 10, white},
    {9, 10, white},  {10, 10, white}, {11, 10, white},  {12, 10, white}, {13, 10, white}, {3, 11, white},
    {4, 11, white},  {5, 11, white},  {11, 11, white},  {12, 11, white}, {13, 11, white}, {3, 12, white},
    {4, 12, white},  {5, 12, white},  {6, 12, white},   {10, 12, white}, {11, 12, white}, {12, 12, white},
    {5, 13, white},  {6, 13, white},  {7, 13, white},   {9, 13, white},  {10, 13, white}, {11, 13, white},
    {6, 14, white},  {7, 14, white},  {8, 14, white},   {9, 14, white},  {6, 14, white},  {6, 15, white},
    {7, 15, white},  {8, 15, white},  {9, 15, white},   {10, 15, white}, {6, 11, orange}, {7, 11, orange},
    {8, 11, orange}, {9, 11, orange}, {10, 11, orange}, {7, 12, orange}, {8, 12, orange}, {9, 12, orange},
    {8, 13, orange}};

const Pixel frame1[] = {{3, 8, pink},  {4, 8, pink},   {5, 8, pink},  {6, 8, pink},  {7, 8, pink},  {8, 8, pink},
                        {9, 8, pink},  {10, 8, pink},  {11, 8, pink}, {12, 8, pink}, {13, 8, pink}, {5, 9, pink},
                        {7, 9, pink},  {9, 9, pink},   {11, 9, pink}, {5, 10, pink}, {6, 10, pink}, {7, 10, pink},
                        {9, 10, pink}, {10, 10, pink}, {11, 10, pink}};

} // namespace

void penguin()
{
  play_frames(TOTAL_FRAMES, DEFAULT_DELAY_MS,
              [](int frame)
              {
                // Draw the penguin
                draw(frame0);

                // Add the sunglasses
                if (frame % 2 == 1)
                {
                  draw(frame1);
                }
              });
}
