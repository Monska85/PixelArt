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
constexpr uint16_t teal = rgb565(6, 159, 132);
constexpr uint16_t red = rgb565(255, 0, 0);
constexpr uint16_t white = rgb565(255, 255, 255);

constexpr int TOTAL_FRAMES = 12;

const Pixel frame0[] = {
    {7, 0, gold},    {8, 0, gold},   {7, 1, gold},    {8, 1, gold},   {6, 2, gold},   {7, 2, gold},    {8, 2, gold},
    {9, 2, gold},    {6, 3, gold},   {7, 3, gold},    {8, 3, gold},   {9, 3, gold},   {5, 4, teal},    {6, 4, teal},
    {7, 4, teal},    {8, 4, teal},   {9, 4, teal},    {10, 4, teal},  {4, 5, teal},   {5, 5, teal},    {6, 5, teal},
    {7, 5, teal},    {8, 5, teal},   {9, 5, teal},    {10, 5, teal},  {11, 5, teal},  {3, 6, teal},    {4, 6, teal},
    {5, 6, teal},    {6, 6, teal},   {7, 6, teal},    {8, 6, teal},   {9, 6, teal},   {10, 6, teal},   {11, 6, teal},
    {12, 6, teal},   {3, 7, teal},   {4, 7, teal},    {5, 7, teal},   {7, 7, teal},   {8, 7, teal},    {9, 7, teal},
    {11, 7, teal},   {12, 7, teal},  {13, 7, teal},   {4, 8, teal},   {8, 8, teal},   {12, 8, teal},   {2, 11, teal},
    {6, 11, teal},   {10, 11, teal}, {2, 12, teal},   {3, 12, teal},  {5, 12, teal},  {6, 12, teal},   {7, 12, teal},
    {9, 12, teal},   {10, 12, teal}, {11, 12, teal},  {13, 12, teal}, {3, 13, teal},  {4, 13, teal},   {5, 13, teal},
    {6, 13, teal},   {7, 13, teal},  {8, 13, teal},   {9, 13, teal},  {10, 13, teal}, {11, 13, teal},  {12, 13, teal},
    {4, 14, teal},   {5, 14, teal},  {6, 14, teal},   {7, 14, teal},  {8, 14, teal},  {9, 14, teal},   {10, 14, teal},
    {11, 14, teal},  {5, 15, teal},  {6, 15, teal},   {7, 15, teal},  {8, 15, teal},  {9, 15, teal},   {10, 15, teal},
    {2, 7, white},   {6, 7, white},  {10, 7, white},  {3, 8, white},  {5, 8, white},  {7, 8, white},   {9, 8, white},
    {11, 8, white},  {13, 8, white}, {4, 9, white},   {8, 9, white},  {12, 9, white}, {2, 10, white},  {6, 10, white},
    {10, 10, white}, {3, 11, white}, {5, 11, white},  {7, 11, white}, {9, 11, white}, {11, 11, white}, {13, 11, white},
    {4, 12, white},  {8, 12, white}, {12, 12, white}, {2, 8, red},    {6, 8, red},    {10, 8, red},    {2, 9, red},
    {3, 9, red},     {5, 9, red},    {6, 9, red},     {7, 9, red},    {9, 9, red},    {10, 9, red},    {11, 9, red},
    {13, 9, red},    {3, 10, red},   {4, 10, red},    {5, 10, red},   {7, 10, red},   {8, 10, red},    {9, 10, red},
    {11, 10, red},   {12, 10, red},  {13, 10, red},   {4, 11, red},   {8, 11, red},   {12, 11, red}};

const Pixel frame1[] = {
    {2, 7, teal},    {3, 7, white},  {4, 7, teal},    {5, 7, teal},    {6, 7, teal},   {7, 7, white},  {8, 7, teal},
    {9, 7, teal},    {10, 7, teal},  {11, 7, white},  {12, 7, teal},   {13, 7, teal},  {2, 8, white},  {3, 8, red},
    {4, 8, white},   {5, 8, teal},   {6, 8, white},   {7, 8, red},     {8, 8, white},  {9, 8, teal},   {10, 8, white},
    {11, 8, red},    {12, 8, white}, {13, 8, teal},   {2, 9, red},     {3, 9, red},    {4, 9, red},    {5, 9, white},
    {6, 9, red},     {7, 9, red},    {8, 9, red},     {9, 9, white},   {10, 9, red},   {11, 9, red},   {12, 9, red},
    {13, 9, white},  {2, 10, red},   {3, 10, white},  {4, 10, red},    {5, 10, red},   {6, 10, red},   {7, 10, white},
    {8, 10, red},    {9, 10, red},   {10, 10, red},   {11, 10, white}, {12, 10, red},  {13, 10, red},  {2, 11, white},
    {3, 11, teal},   {4, 11, white}, {5, 11, red},    {6, 11, white},  {7, 11, teal},  {8, 11, white}, {9, 11, red},
    {10, 11, white}, {11, 11, teal}, {12, 11, white}, {13, 11, red},   {2, 12, teal},  {3, 12, teal},  {4, 12, teal},
    {5, 12, white},  {6, 12, teal},  {7, 12, teal},   {8, 12, teal},   {9, 12, white}, {10, 12, teal}, {11, 12, teal},
    {12, 12, teal},  {13, 12, white}};

const Pixel frame2[] = {
    {2, 7, teal},   {3, 7, teal},    {4, 7, white},  {5, 7, teal},    {6, 7, teal},    {7, 7, teal},    {8, 7, white},
    {9, 7, teal},   {10, 7, teal},   {11, 7, teal},  {12, 7, white},  {13, 7, teal},   {2, 8, teal},    {3, 8, white},
    {4, 8, red},    {5, 8, white},   {6, 8, teal},   {7, 8, white},   {8, 8, red},     {9, 8, white},   {10, 8, teal},
    {11, 8, white}, {12, 8, red},    {13, 8, white}, {2, 9, white},   {3, 9, red},     {4, 9, red},     {5, 9, red},
    {6, 9, white},  {7, 9, red},     {8, 9, red},    {9, 9, red},     {10, 9, white},  {11, 9, red},    {12, 9, red},
    {13, 9, red},   {2, 10, red},    {3, 10, red},   {4, 10, white},  {5, 10, red},    {6, 10, red},    {7, 10, red},
    {8, 10, white}, {9, 10, red},    {10, 10, red},  {11, 10, red},   {12, 10, white}, {13, 10, red},   {2, 11, red},
    {3, 11, white}, {4, 11, teal},   {5, 11, white}, {6, 11, red},    {7, 11, white},  {8, 11, teal},   {9, 11, white},
    {10, 11, red},  {11, 11, white}, {12, 11, teal}, {13, 11, white}, {2, 12, white},  {3, 12, teal},   {4, 12, teal},
    {5, 12, teal},  {6, 12, white},  {7, 12, teal},  {8, 12, teal},   {9, 12, teal},   {10, 12, white}, {11, 12, teal},
    {12, 12, teal}, {13, 12, teal}};

const Pixel frame3[] = {
    {2, 7, teal},    {3, 7, teal},   {4, 7, teal},    {5, 7, white},  {6, 7, teal},   {7, 7, teal},    {8, 7, teal},
    {9, 7, white},   {10, 7, teal},  {11, 7, teal},   {12, 7, teal},  {13, 7, white}, {2, 8, white},   {3, 8, teal},
    {4, 8, white},   {5, 8, red},    {6, 8, white},   {7, 8, teal},   {8, 8, white},  {9, 8, red},     {10, 8, white},
    {11, 8, teal},   {12, 8, white}, {13, 8, red},    {2, 9, red},    {3, 9, white},  {4, 9, red},     {5, 9, red},
    {6, 9, red},     {7, 9, white},  {8, 9, red},     {9, 9, red},    {10, 9, red},   {11, 9, white},  {12, 9, red},
    {13, 9, red},    {2, 10, red},   {3, 10, red},    {4, 10, red},   {5, 10, white}, {6, 10, red},    {7, 10, red},
    {8, 10, red},    {9, 10, white}, {10, 10, red},   {11, 10, red},  {12, 10, red},  {13, 10, white}, {2, 11, white},
    {3, 11, red},    {4, 11, white}, {5, 11, teal},   {6, 11, white}, {7, 11, red},   {8, 11, white},  {9, 11, teal},
    {10, 11, white}, {11, 11, red},  {12, 11, white}, {13, 11, teal}, {2, 12, teal},  {3, 12, white},  {4, 12, teal},
    {5, 12, teal},   {6, 12, teal},  {7, 12, white},  {8, 12, teal},  {9, 12, teal},  {10, 12, teal},  {11, 12, white},
    {12, 12, teal},  {13, 12, teal}};

} // namespace

void ball()
{
  play_frames(TOTAL_FRAMES, DEFAULT_DELAY_MS,
              [](int frame)
              {
                // Draw the ball
                draw(frame0);

                // Make it turn
                if (frame % 4 == 1)
                {
                  draw(frame1);
                }
                else if (frame % 4 == 2)
                {
                  draw(frame2);
                }
                else if (frame % 4 == 3)
                {
                  draw(frame3);
                }
              });
}
