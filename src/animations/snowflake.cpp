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

constexpr uint16_t white = rgb565(255, 255, 255);
constexpr uint16_t lightblue = rgb565(140, 239, 255);

constexpr int TOTAL_FRAMES = round_up_to_even(DEFAULT_TOTAL_FRAMES);

const Pixel frame0[] = {
    {7, 1, white},      {5, 2, white},      {9, 2, white},       {6, 3, white},     {7, 3, white},
    {8, 3, white},      {7, 4, white},      {2, 5, white},       {12, 5, white},    {3, 6, white},
    {7, 6, white},      {11, 6, white},     {1, 7, white},       {4, 7, white},     {3, 7, white},
    {6, 7, white},      {7, 7, white},      {8, 7, white},       {10, 7, white},    {11, 7, white},
    {13, 7, white},     {3, 8, white},      {7, 8, white},       {11, 8, white},    {2, 9, white},
    {12, 9, white},     {7, 10, white},     {6, 11, white},      {7, 11, white},    {8, 11, white},
    {5, 12, white},     {9, 12, white},     {7, 13, white},      {7, 2, lightblue}, {4, 4, lightblue},
    {10, 4, lightblue}, {5, 5, lightblue},  {7, 5, lightblue},   {9, 5, lightblue}, {6, 6, lightblue},
    {8, 6, lightblue},  {2, 7, lightblue},  {5, 7, lightblue},   {7, 7, lightblue}, {9, 7, lightblue},
    {12, 7, lightblue}, {6, 8, lightblue},  {8, 8, lightblue},   {5, 9, lightblue}, {7, 9, lightblue},
    {9, 9, lightblue},  {4, 10, lightblue}, {10, 10, lightblue}, {7, 12, lightblue}};

} // namespace

void snowflake()
{
  play_frames(TOTAL_FRAMES, DEFAULT_DELAY_MS,
              [](int frame)
              {
                if (frame % 2 == 0)
                {
                  // Draw the image
                  draw(frame0);
                }
                else
                {
                  // Flip colors
                  for (const Pixel &p : frame0)
                  {
                    matrix.drawPixel(p.x, p.y, p.color == lightblue ? white : lightblue);
                  }
                }
              });
}
