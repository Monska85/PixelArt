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
constexpr uint16_t blue = rgb565(4, 43, 105);
constexpr uint16_t orange = rgb565(255, 153, 0);
constexpr uint16_t brown = rgb565(140, 82, 39);
constexpr uint16_t white = rgb565(255, 255, 255);
constexpr uint16_t lightblue = rgb565(76, 208, 252);
constexpr uint16_t grey = rgb565(165, 165, 165);
constexpr uint16_t darkbrown = rgb565(67, 36, 13);
constexpr uint16_t yellow = rgb565(255, 255, 0);
constexpr uint16_t green = rgb565(78, 176, 19);
constexpr uint16_t darkgreen = rgb565(2, 93, 77);

constexpr int TOTAL_FRAMES = DEFAULT_TOTAL_FRAMES;

const Pixel frame0[] = {{3, 13, red},      {4, 13, red},      {5, 13, red},     {6, 13, red},      {7, 13, red},
                        {8, 13, red},      {9, 13, red},      {10, 13, red},    {11, 13, red},     {12, 13, red},
                        {1, 15, red},      {2, 15, red},      {3, 15, red},     {4, 15, red},      {5, 15, red},
                        {6, 15, red},      {7, 15, red},      {8, 15, red},     {9, 15, red},      {10, 15, red},
                        {11, 15, red},     {12, 15, red},     {13, 15, red},    {14, 15, red},     {1, 14, darkred},
                        {2, 14, darkred},  {3, 14, darkred},  {4, 14, darkred}, {5, 14, darkred},  {6, 14, darkred},
                        {7, 14, darkred},  {8, 14, darkred},  {9, 14, darkred}, {10, 14, darkred}, {11, 14, darkred},
                        {12, 14, darkred}, {13, 14, darkred}, {14, 14, darkred}};

const Pixel frame1[] = {
    {5, 0, blue},        {6, 0, blue},       {7, 0, blue},        {8, 0, blue},        {9, 0, blue},
    {4, 2, blue},        {5, 2, blue},       {6, 2, blue},        {7, 2, blue},        {8, 2, blue},
    {9, 2, blue},        {10, 2, blue},      {6, 4, blue},        {8, 4, blue},        {7, 9, blue},
    {7, 11, blue},       {5, 1, red},        {6, 1, red},         {7, 1, red},         {8, 1, red},
    {9, 1, red},         {4, 7, red},        {6, 7, red},         {8, 7, red},         {4, 8, red},
    {5, 8, red},         {4, 10, red},       {5, 10, red},        {7, 5, orange},      {5, 7, green},
    {7, 7, green},       {4, 9, green},      {5, 9, green},       {11, 8, brown},      {12, 7, brown},
    {12, 6, brown},      {5, 3, white},      {6, 3, white},       {7, 3, white},       {8, 3, white},
    {9, 3, white},       {4, 4, white},      {5, 4, white},       {7, 4, white},       {9, 4, white},
    {10, 4, white},      {4, 5, white},      {5, 5, white},       {6, 5, white},       {8, 5, white},
    {9, 5, white},       {10, 5, white},     {5, 6, white},       {6, 6, white},       {7, 6, white},
    {8, 6, white},       {9, 6, white},      {6, 8, white},       {7, 8, white},       {8, 8, white},
    {9, 8, white},       {10, 8, white},     {3, 9, white},       {6, 9, white},       {8, 9, white},
    {9, 9, white},       {10, 9, white},     {11, 9, white},      {3, 10, white},      {6, 10, white},
    {7, 10, white},      {8, 10, white},     {9, 10, white},      {10, 10, white},     {11, 10, white},
    {3, 11, white},      {4, 11, white},     {5, 11, white},      {6, 11, white},      {8, 11, white},
    {9, 11, white},      {10, 11, white},    {11, 11, white},     {4, 12, white},      {5, 12, white},
    {6, 12, white},      {7, 12, white},     {8, 12, white},      {9, 12, white},      {10, 12, white},
    {4, 0, lightblue},   {10, 0, lightblue}, {11, 0, lightblue},  {3, 1, lightblue},   {4, 1, lightblue},
    {10, 1, lightblue},  {11, 1, lightblue}, {12, 1, lightblue},  {2, 2, lightblue},   {3, 2, lightblue},
    {11, 2, lightblue},  {12, 2, lightblue}, {13, 2, lightblue},  {1, 3, lightblue},   {2, 3, lightblue},
    {3, 3, lightblue},   {4, 3, lightblue},  {10, 3, lightblue},  {11, 3, lightblue},  {12, 3, lightblue},
    {13, 3, lightblue},  {14, 3, lightblue}, {1, 4, lightblue},   {2, 4, lightblue},   {3, 4, lightblue},
    {11, 4, lightblue},  {12, 4, lightblue}, {13, 4, lightblue},  {14, 4, lightblue},  {0, 5, lightblue},
    {1, 5, lightblue},   {2, 5, lightblue},  {3, 5, lightblue},   {11, 5, lightblue},  {12, 5, lightblue},
    {13, 5, lightblue},  {14, 5, lightblue}, {15, 5, lightblue},  {0, 6, lightblue},   {1, 6, lightblue},
    {2, 6, lightblue},   {3, 6, lightblue},  {4, 6, lightblue},   {10, 6, lightblue},  {11, 6, lightblue},
    {13, 6, lightblue},  {14, 6, lightblue}, {15, 6, lightblue},  {0, 7, lightblue},   {1, 7, lightblue},
    {2, 7, lightblue},   {3, 7, lightblue},  {9, 7, lightblue},   {10, 7, lightblue},  {11, 7, lightblue},
    {13, 7, lightblue},  {14, 7, lightblue}, {15, 7, lightblue},  {0, 8, lightblue},   {1, 8, lightblue},
    {2, 8, lightblue},   {3, 8, lightblue},  {12, 8, lightblue},  {13, 8, lightblue},  {14, 8, lightblue},
    {15, 8, lightblue},  {1, 9, lightblue},  {2, 9, lightblue},   {12, 9, lightblue},  {13, 9, lightblue},
    {14, 9, lightblue},  {1, 10, lightblue}, {2, 10, lightblue},  {12, 10, lightblue}, {13, 10, lightblue},
    {14, 10, lightblue}, {2, 11, lightblue}, {12, 11, lightblue}, {13, 11, lightblue}, {3, 12, lightblue},
    {11, 12, lightblue}, {12, 12, lightblue}};

const Pixel frame2[] = {
    {5, 0, white},       {8, 1, white},       {12, 1, white},      {3, 3, white},      {7, 3, white},
    {8, 3, white},       {11, 3, white},      {1, 5, white},       {6, 5, white},      {7, 5, white},
    {8, 5, white},       {9, 5, white},       {15, 5, white},      {12, 6, white},     {3, 7, white},
    {5, 7, white},       {6, 7, white},       {7, 7, white},       {8, 7, white},      {9, 7, white},
    {10, 7, white},      {4, 9, white},       {5, 9, white},       {6, 9, white},      {7, 9, white},
    {8, 9, white},       {9, 9, white},       {10, 9, white},      {11, 9, white},     {1, 9, white},
    {13, 9, white},      {2, 11, white},      {3, 11, white},      {4, 11, white},     {11, 11, white},
    {12, 11, white},     {13, 11, white},     {3, 12, white},      {4, 12, white},     {5, 12, white},
    {6, 12, white},      {7, 12, white},      {8, 12, white},      {9, 12, white},     {10, 12, white},
    {11, 12, white},     {12, 12, white},     {7, 4, green},       {8, 4, green},      {6, 6, darkgreen},
    {7, 6, darkgreen},   {8, 6, darkgreen},   {9, 6, darkgreen},   {5, 8, green},      {6, 8, green},
    {7, 8, green},       {8, 8, green},       {9, 8, green},       {10, 8, green},     {4, 10, darkgreen},
    {5, 10, darkgreen},  {6, 10, darkgreen},  {7, 10, darkgreen},  {8, 10, darkgreen}, {9, 10, darkgreen},
    {10, 10, darkgreen}, {11, 10, darkgreen}, {7, 11, brown},      {8, 11, brown},     {4, 0, lightblue},
    {6, 0, lightblue},   {7, 0, lightblue},   {8, 0, lightblue},   {9, 0, lightblue},  {10, 0, lightblue},
    {11, 0, lightblue},  {3, 1, lightblue},   {4, 1, lightblue},   {5, 1, lightblue},  {6, 1, lightblue},
    {7, 1, lightblue},   {9, 1, lightblue},   {10, 1, lightblue},  {11, 1, lightblue}, {2, 2, lightblue},
    {3, 2, lightblue},   {4, 2, lightblue},   {5, 2, lightblue},   {6, 2, lightblue},  {7, 2, lightblue},
    {8, 2, lightblue},   {9, 2, lightblue},   {10, 2, lightblue},  {11, 2, lightblue}, {12, 2, lightblue},
    {13, 2, lightblue},  {1, 3, lightblue},   {2, 3, lightblue},   {4, 3, lightblue},  {5, 3, lightblue},
    {6, 3, lightblue},   {9, 3, lightblue},   {10, 3, lightblue},  {12, 3, lightblue}, {13, 3, lightblue},
    {14, 3, lightblue},  {1, 4, lightblue},   {2, 4, lightblue},   {3, 4, lightblue},  {4, 4, lightblue},
    {5, 4, lightblue},   {6, 4, lightblue},   {9, 4, lightblue},   {10, 4, lightblue}, {11, 4, lightblue},
    {12, 4, lightblue},  {13, 4, lightblue},  {14, 4, lightblue},  {0, 5, lightblue},  {2, 5, lightblue},
    {3, 5, lightblue},   {4, 5, lightblue},   {5, 5, lightblue},   {10, 5, lightblue}, {11, 5, lightblue},
    {12, 5, lightblue},  {13, 5, lightblue},  {14, 5, lightblue},  {0, 6, lightblue},  {1, 6, lightblue},
    {2, 6, lightblue},   {3, 6, lightblue},   {4, 6, lightblue},   {5, 6, lightblue},  {10, 6, lightblue},
    {11, 6, lightblue},  {13, 6, lightblue},  {14, 6, lightblue},  {15, 6, lightblue}, {0, 7, lightblue},
    {1, 7, lightblue},   {2, 7, lightblue},   {4, 7, lightblue},   {11, 7, lightblue}, {12, 7, lightblue},
    {13, 7, lightblue},  {14, 7, lightblue},  {15, 7, lightblue},  {0, 8, lightblue},  {1, 8, lightblue},
    {2, 8, lightblue},   {3, 8, lightblue},   {4, 8, lightblue},   {11, 8, lightblue}, {12, 8, lightblue},
    {13, 8, lightblue},  {14, 8, lightblue},  {15, 8, lightblue},  {2, 9, lightblue},  {3, 9, lightblue},
    {12, 9, lightblue},  {14, 9, lightblue},  {1, 10, lightblue},  {2, 10, lightblue}, {3, 10, lightblue},
    {12, 10, lightblue}, {13, 10, lightblue}, {14, 10, lightblue}, {5, 11, lightblue}, {6, 11, lightblue},
    {9, 11, lightblue},  {10, 11, lightblue}};

const Pixel frame3[] = {
    {4, 0, lightblue},  {5, 0, lightblue},  {6, 0, lightblue},  {7, 0, lightblue},  {8, 0, lightblue},
    {9, 0, lightblue},  {10, 0, lightblue}, {11, 0, lightblue}, {3, 1, lightblue},  {4, 1, lightblue},
    {5, 1, lightblue},  {6, 1, lightblue},  {7, 1, lightblue},  {8, 1, lightblue},  {9, 1, lightblue},
    {10, 1, lightblue}, {11, 1, lightblue}, {12, 1, lightblue}, {2, 2, lightblue},  {4, 2, lightblue},
    {5, 2, lightblue},  {10, 2, lightblue}, {11, 2, lightblue}, {12, 2, lightblue}, {13, 2, lightblue},
    {1, 3, lightblue},  {2, 3, lightblue},  {4, 3, lightblue},  {11, 3, lightblue}, {12, 3, lightblue},
    {13, 3, lightblue}, {14, 3, lightblue}, {1, 4, lightblue},  {12, 4, lightblue}, {13, 4, lightblue},
    {0, 5, lightblue},  {1, 5, lightblue},  {15, 5, lightblue}, {0, 6, lightblue},  {15, 6, lightblue},
    {0, 7, lightblue},  {2, 9, lightblue},  {3, 12, white},     {4, 12, white},     {5, 12, white},
    {6, 12, white},     {7, 12, white},     {8, 12, white},     {9, 12, white},     {10, 12, white},
    {11, 12, white},    {12, 12, white},    {6, 2, white},      {7, 2, white},      {8, 2, white},
    {9, 2, white},      {5, 3, white},      {6, 3, white},      {7, 3, white},      {8, 3, white},
    {9, 3, white},      {10, 3, white},     {4, 4, white},      {5, 4, white},      {6, 4, white},
    {7, 4, white},      {8, 4, white},      {9, 4, white},      {3, 5, white},      {5, 5, white},
    {6, 5, white},      {1, 10, white},     {2, 10, white},     {13, 10, white},    {14, 10, white},
    {2, 11, white},     {13, 11, white},    {10, 4, red},       {11, 4, red},       {4, 5, red},
    {7, 5, red},        {8, 5, red},        {9, 5, red},        {10, 5, red},       {11, 5, red},
    {12, 5, red},       {2, 6, red},        {3, 6, red},        {4, 6, red},        {5, 6, red},
    {6, 6, red},        {7, 6, red},        {8, 6, red},        {9, 6, red},        {10, 6, red},
    {11, 6, red},       {12, 6, red},       {13, 6, red},       {3, 7, grey},       {4, 7, grey},
    {5, 7, grey},       {6, 7, grey},       {7, 7, grey},       {8, 7, grey},       {9, 7, grey},
    {10, 7, grey},      {11, 7, grey},      {12, 7, grey},      {3, 8, grey},       {7, 8, grey},
    {8, 8, grey},       {9, 8, grey},       {10, 8, grey},      {11, 8, grey},      {12, 8, grey},
    {3, 9, grey},       {7, 9, grey},       {8, 9, grey},       {12, 9, grey},      {3, 10, grey},
    {7, 10, grey},      {8, 10, grey},      {12, 10, grey},     {3, 11, grey},      {4, 11, grey},
    {5, 11, grey},      {6, 11, grey},      {7, 11, grey},      {8, 11, grey},      {12, 11, grey},
    {5, 9, yellow},     {3, 2, green},      {3, 3, green},      {2, 4, green},      {3, 4, green},
    {14, 4, green},     {2, 5, green},      {13, 5, green},     {14, 5, green},     {1, 6, green},
    {14, 6, green},     {1, 7, green},      {14, 7, green},     {15, 7, green},     {2, 7, darkgreen},
    {13, 7, darkgreen}, {0, 8, darkgreen},  {1, 8, darkgreen},  {2, 8, darkgreen},  {13, 8, darkgreen},
    {14, 8, darkgreen}, {15, 8, darkgreen}, {1, 9, darkgreen},  {2, 9, darkgreen},  {14, 9, darkgreen},
    {13, 9, darkgreen}, {4, 8, brown},      {5, 8, brown},      {6, 8, brown},      {4, 9, brown},
    {6, 9, brown},      {9, 9, brown},      {10, 9, brown},     {11, 9, brown},     {4, 10, brown},
    {5, 10, brown},     {6, 10, brown},     {10, 10, brown},    {11, 10, brown},    {9, 11, brown},
    {10, 11, brown},    {11, 11, brown},    {9, 10, darkbrown}};

} // namespace

void snow_globe()
{
  play_frames(TOTAL_FRAMES, DEFAULT_DELAY_MS,
              [](int frame)
              {
                // Draw the globe stand
                draw(frame0);

                // Change the scene inside the globe
                if (frame < (TOTAL_FRAMES / 3))
                {
                  draw(frame1);
                }
                else if (frame < 2 * (TOTAL_FRAMES / 3))
                {
                  draw(frame2);
                }
                else
                {
                  draw(frame3);
                }
              });
}
