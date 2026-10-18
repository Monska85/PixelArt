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
constexpr uint16_t brown = rgb565(140, 82, 39);
constexpr uint16_t yellow = rgb565(249, 199, 47);
constexpr uint16_t grey = rgb565(165, 165, 165);
constexpr uint16_t darkbrown = rgb565(67, 36, 13);
constexpr uint16_t orange = rgb565(255, 109, 1);

constexpr int TOTAL_FRAMES = 32;

const Pixel frame0[] = {
    {0, 0, grey},        {1, 0, grey},        {2, 0, grey},        {3, 0, grey},        {4, 0, grey},
    {5, 0, grey},        {6, 0, grey},        {7, 0, grey},        {8, 0, grey},        {9, 0, grey},
    {10, 0, grey},       {11, 0, grey},       {12, 0, grey},       {13, 0, grey},       {14, 0, grey},
    {15, 0, grey},       {1, 1, grey},        {1, 2, grey},        {2, 2, grey},        {3, 2, grey},
    {4, 2, grey},        {5, 2, grey},        {6, 2, grey},        {7, 2, grey},        {8, 2, grey},
    {9, 2, grey},        {10, 2, grey},       {11, 2, grey},       {12, 2, grey},       {13, 2, grey},
    {14, 2, grey},       {1, 13, grey},       {2, 13, grey},       {3, 13, grey},       {4, 13, grey},
    {5, 13, grey},       {6, 13, grey},       {7, 13, grey},       {8, 13, grey},       {9, 13, grey},
    {10, 13, grey},      {11, 13, grey},      {12, 13, grey},      {13, 13, grey},      {14, 13, grey},
    {0, 15, grey},       {1, 15, grey},       {2, 15, grey},       {3, 15, grey},       {4, 15, grey},
    {5, 15, grey},       {6, 15, grey},       {7, 15, grey},       {8, 15, grey},       {9, 15, grey},
    {10, 15, grey},      {11, 15, grey},      {12, 15, grey},      {13, 15, grey},      {14, 15, grey},
    {15, 15, grey},      {1, 2, grey},        {1, 3, grey},        {1, 4, grey},        {1, 5, grey},
    {1, 6, grey},        {1, 7, grey},        {1, 8, grey},        {1, 9, grey},        {1, 10, grey},
    {1, 11, grey},       {1, 12, grey},       {1, 13, grey},       {14, 2, grey},       {14, 3, grey},
    {14, 4, grey},       {14, 5, grey},       {14, 6, grey},       {14, 7, grey},       {14, 8, grey},
    {14, 9, grey},       {14, 10, grey},      {14, 11, grey},      {14, 12, grey},      {14, 13, grey},
    {0, 1, darkbrown},   {1, 1, darkbrown},   {2, 1, darkbrown},   {3, 1, darkbrown},   {4, 1, darkbrown},
    {5, 1, darkbrown},   {6, 1, darkbrown},   {7, 1, darkbrown},   {8, 1, darkbrown},   {9, 1, darkbrown},
    {10, 1, darkbrown},  {11, 1, darkbrown},  {12, 1, darkbrown},  {13, 1, darkbrown},  {14, 1, darkbrown},
    {15, 1, darkbrown},  {0, 14, darkbrown},  {1, 14, darkbrown},  {2, 14, darkbrown},  {3, 14, darkbrown},
    {4, 14, darkbrown},  {5, 14, darkbrown},  {6, 14, darkbrown},  {7, 14, darkbrown},  {8, 14, darkbrown},
    {9, 14, darkbrown},  {10, 14, darkbrown}, {11, 14, darkbrown}, {12, 14, darkbrown}, {13, 14, darkbrown},
    {14, 14, darkbrown}, {15, 14, darkbrown}, {0, 2, darkbrown},   {0, 3, darkbrown},   {0, 4, darkbrown},
    {0, 5, darkbrown},   {0, 6, darkbrown},   {0, 7, darkbrown},   {0, 8, darkbrown},   {0, 9, darkbrown},
    {0, 10, darkbrown},  {0, 11, darkbrown},  {0, 12, darkbrown},  {0, 13, darkbrown},  {15, 2, darkbrown},
    {15, 3, darkbrown},  {15, 4, darkbrown},  {15, 5, darkbrown},  {15, 6, darkbrown},  {15, 7, darkbrown},
    {15, 8, darkbrown},  {15, 9, darkbrown},  {15, 10, darkbrown}, {15, 11, darkbrown}, {15, 12, darkbrown},
    {15, 13, darkbrown}, {4, 11, brown},      {5, 11, brown},      {6, 11, brown},      {7, 11, brown},
    {8, 11, brown},      {9, 11, brown},      {10, 11, brown},     {11, 11, brown},     {3, 12, brown},
    {4, 12, brown},      {5, 12, brown},      {6, 12, brown},      {7, 12, brown},      {8, 12, brown},
    {9, 12, brown},      {10, 12, brown},     {11, 12, brown},     {12, 12, brown}};

const Pixel frame1[] = {{8, 3, yellow},  {7, 4, yellow},  {8, 4, yellow},  {9, 4, yellow},   {7, 5, yellow},
                        {8, 5, yellow},  {9, 5, yellow},  {6, 6, yellow},  {7, 6, yellow},   {8, 6, yellow},
                        {9, 6, yellow},  {10, 6, yellow}, {5, 7, yellow},  {6, 7, yellow},   {7, 7, yellow},
                        {9, 7, yellow},  {10, 7, yellow}, {5, 8, yellow},  {6, 8, yellow},   {9, 8, yellow},
                        {10, 8, yellow}, {11, 8, yellow}, {4, 9, yellow},  {5, 9, yellow},   {6, 9, yellow},
                        {10, 9, yellow}, {11, 9, yellow}, {5, 10, yellow}, {10, 10, yellow}, {8, 7, orange},
                        {7, 8, orange},  {8, 8, orange},  {7, 9, orange},  {8, 9, orange},   {9, 9, orange},
                        {6, 10, orange}, {7, 10, orange}, {8, 10, orange}, {9, 10, orange}};

const Pixel frame2[] = {{7, 3, yellow},  {6, 4, yellow},  {7, 4, yellow},  {8, 4, yellow},   {6, 5, yellow},
                        {7, 5, yellow},  {8, 5, yellow},  {5, 6, yellow},  {6, 6, yellow},   {7, 6, yellow},
                        {8, 6, yellow},  {9, 6, yellow},  {5, 7, yellow},  {6, 7, yellow},   {8, 7, yellow},
                        {9, 7, yellow},  {10, 7, yellow}, {4, 8, yellow},  {5, 8, yellow},   {6, 8, yellow},
                        {9, 8, yellow},  {10, 8, yellow}, {4, 9, yellow},  {5, 9, yellow},   {9, 9, yellow},
                        {10, 9, yellow}, {11, 9, yellow}, {5, 10, yellow}, {10, 10, yellow}, {7, 7, orange},
                        {7, 8, orange},  {8, 8, orange},  {6, 9, orange},  {7, 9, orange},   {8, 9, orange},
                        {6, 10, orange}, {7, 10, orange}, {8, 10, orange}, {9, 10, orange}};

const Pixel frame3[] = {{7, 5, yellow}, {7, 6, yellow},  {6, 7, yellow},  {7, 7, yellow},  {8, 7, yellow},
                        {6, 8, yellow}, {7, 8, yellow},  {8, 8, yellow},  {9, 8, yellow},  {5, 9, yellow},
                        {6, 9, yellow}, {8, 9, yellow},  {9, 9, yellow},  {5, 10, yellow}, {9, 10, yellow},
                        {7, 9, orange}, {6, 10, orange}, {7, 10, orange}, {8, 10, orange}};

const Pixel frame4[] = {{8, 5, yellow}, {8, 6, yellow},  {7, 7, yellow},  {8, 7, yellow},  {9, 7, yellow},
                        {6, 8, yellow}, {7, 8, yellow},  {8, 8, yellow},  {9, 8, yellow},  {6, 9, yellow},
                        {7, 9, yellow}, {9, 9, yellow},  {10, 9, yellow}, {6, 10, yellow}, {10, 10, yellow},
                        {8, 9, orange}, {7, 10, orange}, {8, 10, orange}, {9, 10, orange}};

const Pixel frame6[] = {{4, 11, darkbrown},  {5, 11, darkbrown}, {6, 11, darkbrown},  {7, 11, darkbrown},
                        {8, 11, darkbrown},  {9, 11, darkbrown}, {10, 11, darkbrown}, {11, 11, darkbrown},
                        {3, 12, darkbrown},  {4, 12, darkbrown}, {5, 12, darkbrown},  {6, 12, darkbrown},
                        {7, 12, darkbrown},  {8, 12, darkbrown}, {9, 12, darkbrown},  {10, 12, darkbrown},
                        {11, 12, darkbrown}, {12, 12, darkbrown}};

const Pixel frame7[] = {
    {4, 11, darkbrown},  {5, 11, darkbrown},  {6, 11, darkbrown},  {7, 11, darkbrown}, {8, 11, darkbrown},
    {9, 11, darkbrown},  {10, 11, darkbrown}, {11, 11, darkbrown}, {3, 12, darkbrown}, {4, 12, darkbrown},
    {5, 12, darkbrown},  {6, 12, darkbrown},  {7, 12, darkbrown},  {8, 12, darkbrown}, {9, 12, darkbrown},
    {10, 12, darkbrown}, {11, 12, darkbrown}, {12, 12, darkbrown}, {5, 5, white},      {6, 5, white},
    {9, 5, white},       {10, 5, white},      {5, 3, red},         {6, 3, red},        {9, 3, red},
    {10, 3, red},        {5, 4, red},         {6, 4, red},         {9, 4, red},        {10, 4, red},
    {5, 6, brown},       {6, 6, brown},       {9, 6, brown},       {10, 6, brown},     {4, 7, brown},
    {5, 7, brown},       {6, 7, brown},       {9, 7, brown},       {10, 7, brown},     {11, 7, brown}};

} // namespace

void fireplace()
{
  play_frames(TOTAL_FRAMES, DEFAULT_DELAY_MS / 2,
              [](int frame)
              {
                // Draw the fireplace
                draw(frame0);

                if (frame < (2 * TOTAL_FRAMES / 8))
                {
                  // Draw big fire
                  if (frame % 2 == 0)
                  {
                    draw(frame1);
                  }
                  else
                  {
                    draw(frame2);
                  }
                }
                else if (frame < (4 * TOTAL_FRAMES / 8))
                {
                  // Draw small fire
                  if (frame % 2 == 0)
                  {
                    draw(frame3);
                  }
                  else
                  {
                    draw(frame4);
                  }
                }
                else if (frame >= (5 * TOTAL_FRAMES / 8) && frame < (6 * TOTAL_FRAMES / 8))
                {
                  // Draw the fireplace without fire
                  draw(frame6);
                }
                else if (frame >= (6 * TOTAL_FRAMES / 8))
                {
                  // Draw Santa's legs
                  draw(frame7);
                }
              });
}
