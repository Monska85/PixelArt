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

constexpr uint16_t brown = rgb565(140, 82, 39);
constexpr uint16_t blue = rgb565(4, 43, 105);
constexpr uint16_t red = rgb565(255, 0, 0);
constexpr uint16_t darkgreen = rgb565(2, 93, 77);
constexpr uint16_t darkred = rgb565(152, 0, 0);
constexpr uint16_t lightblue = rgb565(140, 239, 255);
constexpr uint16_t green = rgb565(78, 176, 19);
constexpr uint16_t white = rgb565(255, 255, 255);

constexpr int TOTAL_FRAMES = DEFAULT_TOTAL_FRAMES;

const Pixel frame0[] = {
    {6, 0, brown},   {7, 0, brown},   {8, 0, brown},   {9, 0, brown},   {5, 1, brown},   {6, 1, brown},
    {7, 1, brown},   {8, 1, brown},   {9, 1, brown},   {10, 1, brown},  {4, 2, brown},   {5, 2, brown},
    {7, 2, brown},   {8, 2, brown},   {10, 2, brown},  {11, 2, brown},  {4, 3, brown},   {5, 3, brown},
    {6, 3, brown},   {7, 3, brown},   {8, 3, brown},   {9, 3, brown},   {10, 3, brown},  {11, 3, brown},
    {4, 4, brown},   {5, 4, brown},   {7, 4, brown},   {8, 4, brown},   {10, 4, brown},  {11, 4, brown},
    {5, 5, brown},   {6, 5, brown},   {9, 5, brown},   {10, 5, brown},  {6, 6, brown},   {7, 6, brown},
    {8, 6, brown},   {9, 6, brown},   {1, 7, brown},   {2, 7, brown},   {3, 7, brown},   {5, 7, brown},
    {6, 7, brown},   {7, 7, brown},   {8, 7, brown},   {9, 7, brown},   {10, 7, brown},  {12, 7, brown},
    {13, 7, brown},  {14, 7, brown},  {0, 8, brown},   {1, 8, brown},   {2, 8, brown},   {3, 8, brown},
    {5, 8, brown},   {6, 8, brown},   {9, 8, brown},   {10, 8, brown},  {12, 8, brown},  {13, 8, brown},
    {14, 8, brown},  {15, 8, brown},  {1, 9, brown},   {2, 9, brown},   {3, 9, brown},   {5, 9, brown},
    {6, 9, brown},   {7, 9, brown},   {8, 9, brown},   {9, 9, brown},   {10, 9, brown},  {12, 9, brown},
    {13, 9, brown},  {14, 9, brown},  {4, 10, brown},  {5, 10, brown},  {6, 10, brown},  {9, 10, brown},
    {10, 10, brown}, {11, 10, brown}, {3, 11, brown},  {4, 11, brown},  {5, 11, brown},  {6, 11, brown},
    {7, 11, brown},  {8, 11, brown},  {9, 11, brown},  {10, 11, brown}, {11, 11, brown}, {12, 11, brown},
    {4, 12, brown},  {5, 12, brown},  {6, 12, brown},  {9, 12, brown},  {10, 12, brown}, {11, 12, brown},
    {2, 13, brown},  {3, 13, brown},  {5, 13, brown},  {6, 13, brown},  {7, 13, brown},  {8, 13, brown},
    {9, 13, brown},  {10, 13, brown}, {12, 13, brown}, {13, 13, brown}, {2, 14, brown},  {3, 14, brown},
    {4, 14, brown},  {11, 14, brown}, {12, 14, brown}, {13, 14, brown}, {2, 15, brown},  {3, 15, brown},
    {4, 15, brown},  {5, 15, brown},  {10, 15, brown}, {11, 15, brown}, {12, 15, brown}, {13, 15, brown},
    {6, 2, blue},    {9, 2, blue},    {7, 5, red},     {8, 5, red}};

const Pixel frame1[] = {{7, 8, darkgreen},  {8, 8, darkgreen},   {7, 12, darkgreen}, {8, 12, darkgreen},
                        {7, 10, darkred},   {8, 10, darkred},    {6, 4, brown},      {9, 4, brown},
                        {4, 7, lightblue},  {11, 7, lightblue},  {4, 8, lightblue},  {11, 8, lightblue},
                        {4, 9, lightblue},  {11, 9, lightblue},  {3, 12, lightblue}, {12, 12, lightblue},
                        {4, 13, lightblue}, {11, 13, lightblue}, {5, 14, lightblue}, {10, 14, lightblue}};

const Pixel frame2[] = {{7, 8, green},   {8, 8, green},  {7, 12, green},  {8, 12, green}, {7, 10, red},
                        {8, 10, red},    {6, 4, red},    {9, 4, red},     {4, 7, white},  {11, 7, white},
                        {4, 8, white},   {11, 8, white}, {4, 9, white},   {11, 9, white}, {3, 12, white},
                        {12, 12, white}, {4, 13, white}, {11, 13, white}, {5, 14, white}, {10, 14, white}};

} // namespace

void gingerbread_man()
{
  play_frames(TOTAL_FRAMES, DEFAULT_DELAY_MS,
              [](int frame)
              {
                // Draw the gingerbread man
                draw(frame0);

                // Make it shine
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
