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

constexpr uint16_t yellow = rgb565(249, 199, 47);
constexpr uint16_t green = rgb565(78, 176, 19);
constexpr uint16_t red = rgb565(255, 0, 0);
constexpr uint16_t purple = rgb565(193, 65, 242);

constexpr int TOTAL_FRAMES = 17;

const Pixel frame0[] = {
    {7, 0, yellow},  {8, 0, yellow},  {6, 1, yellow},  {7, 1, yellow},  {8, 1, yellow},  {9, 1, yellow},
    {7, 2, yellow},  {8, 2, yellow},  {6, 3, green},   {7, 3, green},   {8, 3, green},   {9, 3, green},
    {6, 4, green},   {7, 4, green},   {8, 4, green},   {9, 4, green},   {5, 5, green},   {6, 5, green},
    {7, 5, green},   {8, 5, green},   {9, 5, green},   {10, 5, green},  {5, 6, green},   {6, 6, green},
    {7, 6, green},   {8, 6, green},   {9, 6, green},   {10, 6, green},  {4, 7, green},   {5, 7, green},
    {6, 7, green},   {7, 7, green},   {8, 7, green},   {9, 7, green},   {10, 7, green},  {11, 7, green},
    {4, 8, green},   {5, 8, green},   {6, 8, green},   {7, 8, green},   {8, 8, green},   {9, 8, green},
    {10, 8, green},  {11, 8, green},  {3, 9, green},   {4, 9, green},   {5, 9, green},   {6, 9, green},
    {7, 9, green},   {8, 9, green},   {9, 9, green},   {10, 9, green},  {11, 9, green},  {12, 9, green},
    {3, 10, green},  {4, 10, green},  {5, 10, green},  {6, 10, green},  {7, 10, green},  {8, 10, green},
    {9, 10, green},  {10, 10, green}, {11, 10, green}, {12, 10, green}, {2, 11, green},  {3, 11, green},
    {4, 11, green},  {5, 11, green},  {6, 11, green},  {7, 11, green},  {8, 11, green},  {9, 11, green},
    {10, 11, green}, {11, 11, green}, {12, 11, green}, {13, 11, green}, {2, 12, green},  {3, 12, green},
    {4, 12, green},  {5, 12, green},  {6, 12, green},  {7, 12, green},  {8, 12, green},  {9, 12, green},
    {10, 12, green}, {11, 12, green}, {12, 12, green}, {13, 12, green}, {1, 13, green},  {2, 13, green},
    {3, 13, green},  {4, 13, green},  {5, 13, green},  {6, 13, green},  {7, 13, green},  {8, 13, green},
    {9, 13, green},  {10, 13, green}, {11, 13, green}, {12, 13, green}, {13, 13, green}, {14, 13, green},
    {1, 14, green},  {2, 14, green},  {3, 14, green},  {4, 14, green},  {5, 14, green},  {6, 14, green},
    {7, 14, green},  {8, 14, green},  {9, 14, green},  {10, 14, green}, {11, 14, green}, {12, 14, green},
    {13, 14, green}, {14, 14, green}, {0, 15, green},  {1, 15, green},  {2, 15, green},  {3, 15, green},
    {4, 15, green},  {5, 15, green},  {6, 15, green},  {7, 15, green},  {8, 15, green},  {9, 15, green},
    {10, 15, green}, {11, 15, green}, {12, 15, green}, {13, 15, green}, {14, 15, green}, {15, 15, green}};

const Pixel frame1[] = {{8, 3, red},   {6, 5, red},  {4, 7, red},   {9, 7, red},  {6, 9, red},
                        {12, 9, red},  {4, 11, red}, {10, 11, red}, {7, 12, red}, {5, 13, red},
                        {11, 13, red}, {1, 14, red}, {13, 14, red}, {3, 15, red}, {8, 15, red}};

const Pixel frame2[] = {{7, 3, purple},   {9, 5, purple},  {6, 7, purple},   {11, 7, purple}, {3, 9, purple},
                        {9, 9, purple},   {5, 11, purple}, {11, 11, purple}, {8, 12, purple}, {4, 13, purple},
                        {10, 13, purple}, {2, 14, purple}, {14, 14, purple}, {7, 15, purple}, {12, 15, purple}};

} // namespace

void xmas_tree()
{
  play_frames(TOTAL_FRAMES, DEFAULT_DELAY_MS,
              [](int frame)
              {
                // Draw the tree
                draw(frame0);

                // Add the balls
                if (frame % 4 == 1)
                {
                  draw(frame1);
                }
                else if (frame % 4 == 3)
                {
                  draw(frame2);
                }
              });
}
