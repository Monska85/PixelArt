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

constexpr uint16_t lightblue = rgb565(140, 239, 255);
constexpr uint16_t orange = rgb565(255, 109, 1);
constexpr uint16_t brown = rgb565(140, 82, 39);
constexpr uint16_t darkbrown = rgb565(67, 36, 13);
constexpr uint16_t gold = rgb565(211, 159, 6);
constexpr uint16_t darkred = rgb565(152, 0, 0);

constexpr int TOTAL_FRAMES = DEFAULT_TOTAL_FRAMES;

const Pixel frame0[] = {{0, 13, lightblue},  {15, 13, lightblue}, {0, 14, lightblue},  {1, 14, lightblue},
                        {14, 14, lightblue}, {15, 14, lightblue}, {1, 15, lightblue},  {2, 15, lightblue},
                        {3, 15, lightblue},  {4, 15, lightblue},  {5, 15, lightblue},  {6, 15, lightblue},
                        {7, 15, lightblue},  {8, 15, lightblue},  {9, 15, lightblue},  {10, 15, lightblue},
                        {11, 15, lightblue}, {12, 15, lightblue}, {13, 15, lightblue}, {14, 15, lightblue}};

const Pixel frame1[] = {
    {2, 8, darkbrown},   {3, 8, darkbrown},   {4, 8, darkbrown},   {5, 8, darkbrown},   {6, 8, darkbrown},
    {7, 8, darkbrown},   {8, 8, darkbrown},   {9, 8, darkbrown},   {10, 8, darkbrown},  {11, 8, darkbrown},
    {12, 8, darkbrown},  {13, 8, darkbrown},  {2, 9, darkbrown},   {3, 9, darkbrown},   {4, 9, darkbrown},
    {5, 9, darkbrown},   {6, 9, darkbrown},   {7, 9, darkbrown},   {8, 9, darkbrown},   {9, 9, darkbrown},
    {10, 9, darkbrown},  {11, 9, darkbrown},  {12, 9, darkbrown},  {13, 9, darkbrown},  {2, 10, darkbrown},
    {3, 10, darkbrown},  {4, 10, darkbrown},  {5, 10, darkbrown},  {6, 10, darkbrown},  {7, 10, darkbrown},
    {8, 10, darkbrown},  {9, 10, darkbrown},  {10, 10, darkbrown}, {11, 10, darkbrown}, {12, 10, darkbrown},
    {13, 10, darkbrown}, {2, 11, darkbrown},  {3, 11, darkbrown},  {4, 11, darkbrown},  {5, 11, darkbrown},
    {6, 11, darkbrown},  {7, 11, darkbrown},  {8, 11, darkbrown},  {9, 11, darkbrown},  {10, 11, darkbrown},
    {11, 11, darkbrown}, {12, 11, darkbrown}, {13, 11, darkbrown}, {2, 12, darkbrown},  {3, 12, darkbrown},
    {4, 12, darkbrown},  {5, 12, darkbrown},  {6, 12, darkbrown},  {7, 12, darkbrown},  {8, 12, darkbrown},
    {9, 12, darkbrown},  {10, 12, darkbrown}, {11, 12, darkbrown}, {12, 12, darkbrown}, {13, 12, darkbrown},
    {2, 13, darkbrown},  {3, 13, darkbrown},  {4, 13, darkbrown},  {5, 13, darkbrown},  {6, 13, darkbrown},
    {7, 13, darkbrown},  {8, 13, darkbrown},  {9, 13, darkbrown},  {10, 13, darkbrown}, {11, 13, darkbrown},
    {12, 13, darkbrown}, {13, 13, darkbrown}, {2, 14, darkbrown},  {3, 14, darkbrown},  {4, 14, darkbrown},
    {5, 14, darkbrown},  {6, 14, darkbrown},  {7, 14, darkbrown},  {8, 14, darkbrown},  {9, 14, darkbrown},
    {10, 14, darkbrown}, {11, 14, darkbrown}, {12, 14, darkbrown}, {13, 14, darkbrown}, {4, 0, brown},
    {5, 0, brown},       {6, 0, brown},       {7, 0, brown},       {8, 0, brown},       {9, 0, brown},
    {10, 0, brown},      {11, 0, brown},      {2, 1, brown},       {3, 1, brown},       {4, 1, brown},
    {5, 1, brown},       {6, 1, brown},       {7, 1, brown},       {8, 1, brown},       {9, 1, brown},
    {10, 1, brown},      {11, 1, brown},      {12, 1, brown},      {13, 1, brown},      {1, 2, brown},
    {2, 2, brown},       {3, 2, brown},       {4, 2, brown},       {5, 2, brown},       {6, 2, brown},
    {7, 2, brown},       {8, 2, brown},       {9, 2, brown},       {10, 2, brown},      {11, 2, brown},
    {12, 2, brown},      {13, 2, brown},      {14, 2, brown},      {0, 3, brown},       {1, 3, brown},
    {2, 3, brown},       {3, 3, brown},       {4, 3, brown},       {5, 3, brown},       {6, 3, brown},
    {7, 3, brown},       {8, 3, brown},       {9, 3, brown},       {10, 3, brown},      {11, 3, brown},
    {12, 3, brown},      {13, 3, brown},      {14, 3, brown},      {15, 3, brown},      {0, 4, brown},
    {1, 4, brown},       {2, 4, brown},       {3, 4, brown},       {4, 4, brown},       {5, 4, brown},
    {6, 4, brown},       {7, 4, brown},       {8, 4, brown},       {9, 4, brown},       {10, 4, brown},
    {11, 4, brown},      {12, 4, brown},      {13, 4, brown},      {14, 4, brown},      {15, 4, brown},
    {0, 5, brown},       {1, 5, brown},       {2, 5, brown},       {3, 5, brown},       {4, 5, brown},
    {5, 5, brown},       {6, 5, brown},       {7, 5, brown},       {8, 5, brown},       {9, 5, brown},
    {10, 5, brown},      {11, 5, brown},      {12, 5, brown},      {13, 5, brown},      {14, 5, brown},
    {15, 5, brown},      {0, 6, brown},       {1, 6, brown},       {2, 6, brown},       {3, 6, brown},
    {4, 6, brown},       {5, 6, brown},       {6, 6, brown},       {7, 6, brown},       {8, 6, brown},
    {9, 6, brown},       {10, 6, brown},      {11, 6, brown},      {12, 6, brown},      {13, 6, brown},
    {14, 6, brown},      {15, 6, brown},      {1, 7, brown},       {2, 7, brown},       {3, 7, brown},
    {4, 7, brown},       {5, 7, brown},       {6, 7, brown},       {7, 7, brown},       {8, 7, brown},
    {9, 7, brown},       {10, 7, brown},      {11, 7, brown},      {12, 7, brown},      {13, 7, brown},
    {14, 7, brown},      {10, 1, orange},     {5, 3, orange},      {13, 4, orange},     {4, 6, orange},
    {9, 6, orange},      {5, 1, darkred},     {2, 3, darkred},     {10, 3, darkred},    {6, 5, darkred},
    {2, 6, darkred},     {13, 6, darkred}};

const Pixel frame2[] = {
    {8, 0, brown},   {9, 0, brown},    {10, 0, brown},    {11, 0, brown},   {12, 0, brown},  {6, 1, brown},
    {7, 1, brown},   {5, 2, brown},    {6, 2, brown},     {4, 3, brown},    {4, 4, brown},   {3, 5, brown},
    {3, 6, brown},   {3, 7, brown},    {3, 8, brown},     {3, 9, brown},    {3, 10, brown},  {3, 11, brown},
    {3, 12, brown},  {3, 13, brown},   {3, 14, brown},    {11, 2, orange},  {7, 5, orange},  {11, 7, orange},
    {5, 8, orange},  {8, 11, orange},  {5, 13, orange},   {11, 13, orange}, {9, 3, darkred}, {5, 6, darkred},
    {8, 8, darkred}, {5, 10, darkred}, {11, 10, darkred}, {8, 13, darkred}, {8, 1, gold},    {9, 1, gold},
    {10, 1, gold},   {11, 1, gold},    {12, 1, gold},     {7, 2, gold},     {8, 2, gold},    {9, 2, gold},
    {10, 2, gold},   {12, 2, gold},    {5, 3, gold},      {6, 3, gold},     {7, 3, gold},    {8, 3, gold},
    {10, 3, gold},   {11, 3, gold},    {12, 3, gold},     {5, 4, gold},     {6, 4, gold},    {7, 4, gold},
    {8, 4, gold},    {9, 4, gold},     {10, 4, gold},     {11, 4, gold},    {12, 4, gold},   {4, 5, gold},
    {5, 5, gold},    {6, 5, gold},     {8, 5, gold},      {9, 5, gold},     {10, 5, gold},   {11, 5, gold},
    {12, 5, gold},   {4, 6, gold},     {6, 6, gold},      {7, 6, gold},     {8, 6, gold},    {9, 6, gold},
    {10, 6, gold},   {11, 6, gold},    {12, 6, gold},     {4, 7, gold},     {5, 7, gold},    {6, 7, gold},
    {7, 7, gold},    {8, 7, gold},     {9, 7, gold},      {10, 7, gold},    {12, 7, gold},   {4, 8, gold},
    {6, 8, gold},    {7, 8, gold},     {9, 8, gold},      {10, 8, gold},    {11, 8, gold},   {12, 8, gold},
    {4, 9, gold},    {5, 9, gold},     {6, 9, gold},      {7, 9, gold},     {8, 9, gold},    {9, 9, gold},
    {10, 9, gold},   {11, 9, gold},    {12, 9, gold},     {4, 10, gold},    {6, 10, gold},   {7, 10, gold},
    {8, 10, gold},   {9, 10, gold},    {10, 10, gold},    {12, 10, gold},   {4, 11, gold},   {5, 11, gold},
    {6, 11, gold},   {7, 11, gold},    {9, 11, gold},     {10, 11, gold},   {11, 11, gold},  {12, 11, gold},
    {4, 12, gold},   {5, 12, gold},    {6, 12, gold},     {7, 12, gold},    {8, 12, gold},   {9, 12, gold},
    {10, 12, gold},  {11, 12, gold},   {12, 12, gold},    {4, 13, gold},    {6, 13, gold},   {7, 13, gold},
    {9, 13, gold},   {10, 13, gold},   {12, 13, gold},    {4, 14, gold},    {5, 14, gold},   {6, 14, gold},
    {7, 14, gold},   {8, 14, gold},    {9, 14, gold},     {10, 14, gold},   {11, 14, gold},  {12, 14, gold}};

const Pixel frame3[] = {{3, 13, gold}, {10, 13, gold}, {3, 14, gold},   {4, 14, gold},
                        {7, 14, gold}, {10, 14, gold}, {6, 13, orange}, {12, 14, darkred}};

} // namespace

void panettone()
{
  play_frames(TOTAL_FRAMES, DEFAULT_DELAY_MS,
              [](int frame)
              {
                draw(frame0);

                if (frame <= (TOTAL_FRAMES / 3))
                {
                  draw(frame1);
                }
                else if (frame <= 2 * (TOTAL_FRAMES / 3))
                {
                  draw(frame2);
                }
                else
                {
                  draw(frame3);
                }
              });
}
