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

constexpr uint16_t teal = rgb565(6, 159, 132);
constexpr uint16_t dark_teal = rgb565(2, 93, 77);
constexpr uint16_t red = rgb565(255, 0, 0);
constexpr uint16_t orange = rgb565(255, 153, 0);
constexpr uint16_t brown = rgb565(140, 82, 39);
constexpr uint16_t white = rgb565(255, 255, 255);
constexpr uint16_t blue = rgb565(4, 43, 105);

constexpr int TOTAL_FRAMES = DEFAULT_TOTAL_FRAMES;

const Pixel frame0[] = {
    {5, 0, teal},      {6, 0, teal},      {7, 0, teal},    {8, 0, teal},      {9, 0, teal},      {4, 2, teal},
    {5, 2, teal},      {6, 2, teal},      {7, 2, teal},    {8, 2, teal},      {9, 2, teal},      {10, 2, teal},
    {7, 9, teal},      {7, 11, teal},     {7, 13, teal},   {5, 1, dark_teal}, {6, 1, dark_teal}, {7, 1, dark_teal},
    {8, 1, dark_teal}, {9, 1, dark_teal}, {8, 5, orange},  {9, 5, orange},    {10, 5, orange},   {6, 4, blue},
    {8, 4, blue},      {5, 7, red},       {6, 7, red},     {7, 7, red},       {8, 7, red},       {9, 7, red},
    {5, 8, red},       {5, 9, red},       {5, 10, red},    {4, 11, red},      {5, 11, red},      {5, 3, white},
    {6, 3, white},     {7, 3, white},     {8, 3, white},   {9, 3, white},     {5, 4, white},     {7, 4, white},
    {9, 4, white},     {5, 5, white},     {6, 5, white},   {7, 5, white},     {5, 6, white},     {6, 6, white},
    {7, 6, white},     {8, 6, white},     {9, 6, white},   {4, 8, white},     {6, 8, white},     {7, 8, white},
    {8, 8, white},     {9, 8, white},     {10, 8, white},  {4, 9, white},     {6, 9, white},     {8, 9, white},
    {9, 9, white},     {10, 9, white},    {3, 10, white},  {4, 10, white},    {6, 10, white},    {7, 10, white},
    {8, 10, white},    {9, 10, white},    {10, 10, white}, {11, 10, white},   {3, 11, white},    {6, 11, white},
    {8, 11, white},    {9, 11, white},    {10, 11, white}, {11, 11, white},   {3, 12, white},    {4, 12, white},
    {5, 12, white},    {6, 12, white},    {7, 12, white},  {8, 12, white},    {9, 12, white},    {10, 12, white},
    {11, 12, white},   {3, 13, white},    {4, 13, white},  {5, 13, white},    {6, 13, white},    {8, 13, white},
    {9, 13, white},    {10, 13, white},   {11, 13, white}, {4, 14, white},    {5, 14, white},    {6, 14, white},
    {7, 14, white},    {8, 14, white},    {9, 14, white},  {10, 14, white},   {5, 15, white},    {6, 15, white},
    {7, 15, white},    {8, 15, white},    {9, 15, white},  {3, 9, brown},     {11, 9, brown}};

const Pixel frame1[] = {{0, 12, brown},  {1, 11, brown},  {2, 10, brown},
                        {12, 10, brown}, {13, 11, brown}, {14, 12, brown}};

const Pixel frame2[] = {{0, 6, brown}, {1, 7, brown}, {2, 8, brown}, {12, 8, brown}, {13, 7, brown}, {14, 6, brown}};

} // namespace

void snowman()
{
  play_frames(TOTAL_FRAMES, DEFAULT_DELAY_MS,
              [](int frame)
              {
                // Draw the snowman
                draw(frame0);

                // Draw arms
                if (frame % 2 == 1)
                {
                  draw(frame1);
                }
                else
                {
                  draw(frame2);
                }
              });
}
