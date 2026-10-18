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
constexpr uint16_t gold = rgb565(249, 199, 47);
constexpr uint16_t brown = rgb565(140, 82, 39);
constexpr uint16_t yellow = rgb565(249, 199, 47);
constexpr uint16_t darkred = rgb565(152, 0, 0);

constexpr int TOTAL_FRAMES = DEFAULT_TOTAL_FRAMES;

const Pixel frame0[] = {
    {4, 1, red},     {5, 1, red},     {10, 1, red},    {11, 1, red},    {3, 2, red},     {4, 2, red},
    {5, 2, red},     {6, 2, red},     {9, 2, red},     {10, 2, red},    {11, 2, red},    {12, 2, red},
    {2, 3, red},     {3, 3, red},     {4, 3, red},     {5, 3, red},     {6, 3, red},     {9, 3, red},
    {10, 3, red},    {11, 3, red},    {12, 3, red},    {13, 3, red},    {3, 4, red},     {4, 4, red},
    {5, 4, red},     {6, 4, red},     {9, 4, red},     {10, 4, red},    {11, 4, red},    {12, 4, red},
    {5, 5, red},     {10, 5, red},    {4, 6, red},     {11, 6, red},    {3, 7, red},     {4, 7, red},
    {11, 7, red},    {12, 7, red},    {7, 3, darkred}, {8, 3, darkred}, {7, 4, darkred}, {8, 4, darkred},
    {6, 5, yellow},  {7, 5, yellow},  {8, 5, yellow},  {5, 6, yellow},  {6, 6, yellow},  {7, 6, yellow},
    {5, 7, yellow},  {6, 7, yellow},  {7, 7, yellow},  {4, 8, yellow},  {5, 8, yellow},  {6, 8, yellow},
    {7, 8, yellow},  {4, 9, yellow},  {5, 9, yellow},  {6, 9, yellow},  {7, 9, yellow},  {4, 10, yellow},
    {5, 10, yellow}, {6, 10, yellow}, {7, 10, yellow}, {4, 11, yellow}, {5, 11, yellow}, {6, 11, yellow},
    {7, 11, yellow}, {3, 12, yellow}, {4, 12, yellow}, {5, 12, yellow}, {6, 12, yellow}, {2, 13, yellow},
    {3, 13, yellow}, {4, 13, yellow}, {5, 13, yellow}, {9, 5, gold},    {8, 6, gold},    {9, 6, gold},
    {10, 6, gold},   {8, 7, gold},    {9, 7, gold},    {10, 7, gold},   {8, 8, gold},    {9, 8, gold},
    {10, 8, gold},   {11, 8, gold},   {8, 9, gold},    {9, 9, gold},    {10, 9, gold},   {11, 9, gold},
    {8, 10, gold},   {9, 10, gold},   {10, 10, gold},  {11, 10, gold},  {8, 11, gold},   {9, 11, gold},
    {10, 11, gold},  {11, 11, gold},  {7, 12, gold},   {8, 12, gold},   {9, 12, gold},   {10, 12, gold},
    {11, 12, gold},  {12, 12, gold},  {6, 13, gold},   {7, 13, gold},   {8, 13, gold},   {9, 13, gold},
    {10, 13, gold},  {11, 13, gold},  {12, 13, gold},  {13, 13, gold}};

const Pixel frame1[] = {{8, 14, brown}, {9, 14, brown}};

const Pixel frame2[] = {{6, 14, brown}, {7, 14, brown}, {6, 6, white}, {5, 7, white}, {5, 8, white}};

} // namespace

void bell()
{
  play_frames(TOTAL_FRAMES, DEFAULT_DELAY_MS,
              [](int frame)
              {
                // Draw the bell
                draw(frame0);

                // Move the clapper
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
