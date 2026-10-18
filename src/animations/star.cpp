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

constexpr uint16_t yellow = rgb565(251, 188, 4);
constexpr uint16_t gold = rgb565(255, 227, 0);

constexpr int TOTAL_FRAMES = round_up_to_even(DEFAULT_TOTAL_FRAMES);

const Pixel frame0[] = {
    {8, 2, yellow},   {7, 3, yellow},   {8, 3, yellow},  {7, 4, yellow},   {8, 4, yellow},   {6, 5, yellow},
    {7, 5, yellow},   {7, 6, yellow},   {9, 6, yellow},  {10, 6, yellow},  {11, 6, yellow},  {12, 6, yellow},
    {13, 6, yellow},  {3, 7, yellow},   {4, 7, yellow},  {7, 7, yellow},   {9, 7, yellow},   {10, 7, yellow},
    {11, 7, yellow},  {4, 8, yellow},   {5, 8, yellow},  {6, 8, yellow},   {5, 9, yellow},   {7, 9, yellow},
    {9, 9, yellow},   {10, 9, yellow},  {11, 9, yellow}, {6, 10, yellow},  {7, 10, yellow},  {10, 10, yellow},
    {11, 10, yellow}, {6, 11, yellow},  {7, 11, yellow}, {11, 11, yellow}, {12, 11, yellow}, {5, 12, yellow},
    {6, 12, yellow},  {12, 12, yellow}, {4, 13, yellow}, {5, 13, yellow},  {9, 3, gold},     {9, 4, gold},
    {8, 5, gold},     {9, 5, gold},     {10, 5, gold},   {2, 6, gold},     {3, 6, gold},     {4, 6, gold},
    {5, 6, gold},     {6, 6, gold},     {8, 6, gold},    {14, 6, gold},    {5, 7, gold},     {6, 7, gold},
    {8, 7, gold},     {12, 7, gold},    {13, 7, gold},   {7, 8, gold},     {8, 8, gold},     {9, 8, gold},
    {10, 8, gold},    {11, 8, gold},    {12, 8, gold},   {6, 9, gold},     {8, 9, gold},     {5, 10, gold},
    {8, 10, gold},    {9, 10, gold},    {4, 11, gold},   {5, 11, gold},    {9, 11, gold},    {10, 11, gold},
    {4, 12, gold},    {10, 12, gold},   {11, 12, gold},  {11, 13, gold},   {12, 13, gold}};

} // namespace

void star()
{
  play_frames(TOTAL_FRAMES, DEFAULT_DELAY_MS,
              [](int frame)
              {
                if (frame % 2 == 0)
                {
                  // Draw image
                  draw(frame0);
                }
                else
                {
                  // Flip colors
                  for (const Pixel &p : frame0)
                  {
                    matrix.drawPixel(p.x, p.y, p.color == yellow ? gold : yellow);
                  }
                }
              });
}
