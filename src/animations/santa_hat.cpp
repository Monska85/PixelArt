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
constexpr uint16_t darkred = rgb565(152, 0, 0);
constexpr uint16_t white = rgb565(255, 255, 255);

constexpr int TOTAL_FRAMES = DEFAULT_TOTAL_FRAMES;

const Pixel frame0[] = {
    {8, 0, darkred},   {9, 0, darkred},  {10, 0, darkred},  {11, 0, darkred},  {6, 1, darkred},   {7, 1, darkred},
    {8, 1, darkred},   {9, 1, darkred},  {10, 1, darkred},  {11, 1, darkred},  {12, 1, darkred},  {13, 1, darkred},
    {6, 2, darkred},   {7, 2, darkred},  {8, 2, darkred},   {9, 2, darkred},   {10, 2, darkred},  {11, 2, darkred},
    {12, 2, darkred},  {13, 2, darkred}, {14, 2, darkred},  {5, 3, darkred},   {6, 3, darkred},   {7, 3, darkred},
    {8, 3, darkred},   {9, 3, darkred},  {10, 3, darkred},  {11, 3, darkred},  {12, 3, darkred},  {13, 3, darkred},
    {14, 3, darkred},  {15, 3, darkred}, {5, 4, darkred},   {6, 4, darkred},   {7, 4, darkred},   {8, 4, darkred},
    {9, 4, darkred},   {10, 4, darkred}, {11, 4, darkred},  {12, 4, darkred},  {13, 4, darkred},  {14, 4, darkred},
    {15, 4, darkred},  {4, 5, darkred},  {5, 5, darkred},   {6, 5, darkred},   {7, 5, darkred},   {8, 5, darkred},
    {9, 5, darkred},   {10, 5, darkred}, {11, 5, darkred},  {14, 5, darkred},  {15, 5, darkred},  {4, 6, darkred},
    {5, 6, darkred},   {6, 6, darkred},  {7, 6, darkred},   {8, 6, darkred},   {9, 6, darkred},   {10, 6, darkred},
    {11, 6, darkred},  {3, 7, darkred},  {4, 7, darkred},   {5, 7, darkred},   {6, 7, darkred},   {7, 7, darkred},
    {8, 7, darkred},   {9, 7, darkred},  {10, 7, darkred},  {11, 7, darkred},  {3, 8, darkred},   {4, 8, darkred},
    {5, 8, darkred},   {6, 8, darkred},  {7, 8, darkred},   {8, 8, darkred},   {9, 8, darkred},   {10, 8, darkred},
    {11, 8, darkred},  {2, 9, darkred},  {3, 9, darkred},   {4, 9, darkred},   {5, 9, darkred},   {6, 9, darkred},
    {7, 9, darkred},   {8, 9, darkred},  {9, 9, darkred},   {10, 9, darkred},  {11, 9, darkred},  {12, 9, darkred},
    {2, 10, darkred},  {3, 10, darkred}, {4, 10, darkred},  {5, 10, darkred},  {6, 10, darkred},  {7, 10, darkred},
    {8, 10, darkred},  {9, 10, darkred}, {10, 10, darkred}, {11, 10, darkred}, {12, 10, darkred}, {1, 11, darkred},
    {2, 11, darkred},  {3, 11, darkred}, {4, 11, darkred},  {5, 11, darkred},  {6, 11, darkred},  {7, 11, darkred},
    {8, 11, darkred},  {9, 11, darkred}, {10, 11, darkred}, {11, 11, darkred}, {12, 11, darkred}, {13, 11, darkred},
    {1, 12, darkred},  {2, 12, darkred}, {3, 12, darkred},  {4, 12, darkred},  {5, 12, darkred},  {6, 12, darkred},
    {7, 12, darkred},  {8, 12, darkred}, {9, 12, darkred},  {10, 12, darkred}, {11, 12, darkred}, {12, 12, darkred},
    {13, 12, darkred}, {14, 6, white},   {15, 6, white},    {14, 7, white},    {15, 7, white},    {0, 13, white},
    {1, 13, white},    {2, 13, white},   {3, 13, white},    {4, 13, white},    {5, 13, white},    {6, 13, white},
    {7, 13, white},    {8, 13, white},   {9, 13, white},    {10, 13, white},   {11, 13, white},   {12, 13, white},
    {13, 13, white},   {14, 13, white},  {0, 14, white},    {1, 14, white},    {2, 14, white},    {3, 14, white},
    {4, 14, white},    {5, 14, white},   {6, 14, white},    {7, 14, white},    {8, 14, white},    {9, 14, white},
    {10, 14, white},   {11, 14, white},  {12, 14, white},   {13, 14, white},   {14, 14, white},   {0, 15, white},
    {1, 15, white},    {2, 15, white},   {3, 15, white},    {4, 15, white},    {5, 15, white},    {6, 15, white},
    {7, 15, white},    {8, 15, white},   {9, 15, white},    {10, 15, white},   {11, 15, white},   {12, 15, white},
    {13, 15, white},   {14, 15, white}};

const Pixel frame1[] = {{12, 1, red},   {11, 2, red},   {11, 3, red},   {5, 4, red},   {12, 4, red},  {6, 5, red},
                        {7, 5, red},    {8, 6, red},    {9, 6, red},    {10, 7, red},  {11, 7, red},  {3, 8, red},
                        {4, 9, red},    {5, 9, red},    {6, 10, red},   {7, 10, red},  {8, 11, red},  {9, 11, red},
                        {10, 11, red},  {11, 12, red},  {12, 12, red},  {13, 12, red}, {1, 14, red},  {3, 14, red},
                        {5, 14, red},   {7, 14, red},   {9, 14, red},   {11, 14, red}, {13, 14, red}, {13, 6, white},
                        {13, 7, white}, {13, 8, white}, {14, 8, white}, {15, 8, white}};

} // namespace

void santa_hat()
{
  play_frames(TOTAL_FRAMES, DEFAULT_DELAY_MS,
              [](int frame)
              {
                // Draw the hat
                draw(frame0);

                // Add light
                if (frame % 2 == 1)
                {
                  draw(frame1);
                }
              });
}
