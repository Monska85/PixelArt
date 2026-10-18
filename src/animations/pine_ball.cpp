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

constexpr uint16_t green = rgb565(78, 176, 19);
constexpr uint16_t darkgreen = rgb565(2, 93, 77);
constexpr uint16_t red = rgb565(255, 0, 0);
constexpr uint16_t brown = rgb565(140, 82, 39);
constexpr uint16_t gold = rgb565(211, 159, 6);
constexpr uint16_t white = rgb565(255, 255, 255);

constexpr int TOTAL_FRAMES = round_up_to_even(DEFAULT_TOTAL_FRAMES);

const Pixel frame0[] = {
    {0, 5, brown},      {1, 6, brown},      {0, 12, brown},     {1, 13, brown},     {4, 0, green},
    {6, 0, green},      {11, 0, green},     {13, 0, green},     {4, 1, green},      {11, 1, green},
    {2, 2, green},      {4, 2, green},      {5, 2, green},      {6, 2, green},      {9, 2, green},
    {11, 2, green},     {12, 2, green},     {13, 2, green},     {2, 3, green},      {9, 3, green},
    {2, 4, green},      {3, 4, green},      {4, 4, green},      {7, 4, green},      {9, 4, green},
    {10, 4, green},     {11, 4, green},     {7, 5, green},      {5, 6, green},      {7, 6, green},
    {8, 6, green},      {9, 6, green},      {5, 7, green},      {3, 8, green},      {5, 8, green},
    {6, 8, green},      {7, 8, green},      {3, 9, green},      {1, 10, green},     {3, 10, green},
    {4, 10, green},     {5, 10, green},     {1, 11, green},     {1, 12, green},     {2, 12, green},
    {3, 12, green},     {5, 0, darkgreen},  {6, 0, darkgreen},  {11, 0, darkgreen}, {13, 0, darkgreen},
    {5, 1, darkgreen},  {6, 1, darkgreen},  {10, 1, darkgreen}, {11, 1, darkgreen}, {12, 1, darkgreen},
    {3, 1, darkgreen},  {3, 2, darkgreen},  {10, 2, darkgreen}, {1, 3, darkgreen},  {3, 3, darkgreen},
    {4, 3, darkgreen},  {5, 3, darkgreen},  {8, 3, darkgreen},  {10, 3, darkgreen}, {11, 3, darkgreen},
    {12, 3, darkgreen}, {1, 4, darkgreen},  {8, 4, darkgreen},  {1, 5, darkgreen},  {2, 5, darkgreen},
    {3, 5, darkgreen},  {6, 5, darkgreen},  {8, 5, darkgreen},  {9, 5, darkgreen},  {10, 5, darkgreen},
    {6, 6, darkgreen},  {4, 7, darkgreen},  {6, 7, darkgreen},  {7, 7, darkgreen},  {8, 7, darkgreen},
    {4, 8, darkgreen},  {2, 9, darkgreen},  {4, 9, darkgreen},  {5, 9, darkgreen},  {6, 9, darkgreen},
    {2, 10, darkgreen}, {2, 11, darkgreen}, {3, 11, darkgreen}, {4, 11, darkgreen}};

const Pixel frame1[] = {{11, 2, gold},  {11, 5, gold},  {11, 6, gold}, {11, 7, gold}, {11, 8, gold}, {10, 10, white},
                        {9, 11, white}, {9, 12, white}, {10, 9, red},  {11, 9, red},  {12, 9, red},  {9, 10, red},
                        {11, 10, red},  {12, 10, red},  {13, 10, red}, {8, 11, red},  {10, 11, red}, {11, 11, red},
                        {12, 11, red},  {13, 11, red},  {14, 11, red}, {8, 12, red},  {10, 12, red}, {11, 12, red},
                        {12, 12, red},  {13, 12, red},  {14, 12, red}, {8, 13, red},  {9, 13, red},  {10, 13, red},
                        {11, 13, red},  {12, 13, red},  {13, 13, red}, {14, 13, red}, {9, 14, red},  {10, 14, red},
                        {11, 14, red},  {12, 14, red},  {13, 14, red}, {10, 15, red}, {11, 15, red}, {12, 15, red}};

} // namespace

void pine_ball()
{
  play_frames(TOTAL_FRAMES, DEFAULT_DELAY_MS,
              [](int frame)
              {
                // Draw the pine branches
                draw(frame0);

                // Add ball
                if (frame % 2 == 1)
                {
                  draw(frame1);
                }
              });
}
