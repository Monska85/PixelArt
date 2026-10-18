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
constexpr uint16_t brown = rgb565(67, 36, 13);
constexpr uint16_t white = rgb565(255, 255, 255);

constexpr int TOTAL_FRAMES = 10;

const Pixel frame0[] = {
    {4, 6, red},      {5, 6, red},      {6, 6, red},      {7, 6, red},      {8, 6, red},      {9, 6, red},
    {10, 6, red},     {11, 6, red},     {12, 6, red},     {13, 6, red},     {14, 6, red},     {2, 7, red},
    {3, 7, red},      {4, 7, red},      {5, 7, red},      {6, 7, red},      {8, 7, red},      {10, 7, red},
    {12, 7, red},     {13, 7, red},     {14, 7, red},     {1, 8, red},      {4, 8, red},      {5, 8, red},
    {8, 8, red},      {9, 8, red},      {10, 8, red},     {13, 8, red},     {14, 8, red},     {1, 9, red},
    {4, 9, red},      {5, 9, red},      {6, 9, red},      {7, 9, red},      {8, 9, red},      {10, 9, red},
    {11, 9, red},     {12, 9, red},     {13, 9, red},     {14, 9, red},     {1, 10, red},     {4, 10, red},
    {5, 10, red},     {7, 10, red},     {11, 10, red},    {13, 10, red},    {14, 10, red},    {1, 11, red},
    {4, 11, red},     {5, 11, red},     {6, 11, red},     {7, 11, red},     {8, 11, red},     {10, 11, red},
    {11, 11, red},    {12, 11, red},    {13, 11, red},    {14, 11, red},    {1, 12, red},     {4, 12, red},
    {5, 12, red},     {8, 12, red},     {9, 12, red},     {10, 12, red},    {13, 12, red},    {14, 12, red},
    {2, 13, red},     {3, 13, red},     {4, 13, red},     {5, 13, red},     {6, 13, red},     {8, 13, red},
    {10, 13, red},    {12, 13, red},    {13, 13, red},    {14, 13, red},    {4, 14, red},     {5, 14, red},
    {6, 14, red},     {7, 14, red},     {8, 14, red},     {9, 14, red},     {10, 14, red},    {11, 14, red},
    {12, 14, red},    {13, 14, red},    {14, 14, red},    {5, 15, red},     {6, 15, red},     {7, 15, red},
    {8, 15, red},     {9, 15, red},     {10, 15, red},    {11, 15, red},    {12, 15, red},    {13, 15, red},
    {4, 5, darkred},  {5, 5, darkred},  {6, 5, darkred},  {7, 5, darkred},  {8, 5, darkred},  {9, 5, darkred},
    {10, 5, darkred}, {11, 5, darkred}, {12, 5, darkred}, {13, 5, darkred}, {14, 5, darkred}, {4, 3, darkred},
    {5, 3, darkred},  {8, 3, darkred},  {11, 3, darkred}, {14, 3, darkred}, {3, 4, darkred},  {15, 4, darkred},
    {4, 4, brown},    {5, 4, brown},    {8, 4, brown},    {11, 4, brown},   {14, 4, brown},   {7, 7, white},
    {9, 7, white},    {11, 7, white},   {6, 8, white},    {7, 8, white},    {11, 8, white},   {12, 8, white},
    {9, 9, white},    {6, 10, white},   {8, 10, white},   {9, 10, white},   {10, 10, white},  {12, 10, white},
    {9, 11, white},   {6, 12, white},   {7, 12, white},   {11, 12, white},  {12, 12, white},  {7, 13, white},
    {9, 13, white},   {11, 13, white}};

const Pixel frame1[] = {
    {6, 3, darkred}, {9, 3, darkred}, {12, 3, darkred}, {6, 4, brown},  {9, 4, brown},  {12, 4, brown}, {7, 0, white},
    {10, 0, white},  {13, 0, white},  {7, 3, white},    {10, 3, white}, {13, 3, white}, {7, 4, white},  {10, 4, white},
    {13, 4, white},  {6, 1, white},   {9, 1, white},    {12, 1, white}, {6, 2, white},  {9, 2, white},  {12, 2, white}};

const Pixel frame2[] = {{7, 3, darkred}, {10, 3, darkred}, {13, 3, darkred}, {7, 4, brown},  {10, 4, brown},
                        {13, 4, brown},  {7, 1, white},    {10, 1, white},   {13, 1, white}, {7, 2, white},
                        {10, 2, white},  {13, 2, white},   {6, 0, white},    {9, 0, white},  {12, 0, white},
                        {6, 3, white},   {9, 3, white},    {12, 3, white},   {6, 4, white},  {9, 4, white},
                        {12, 4, white}};

} // namespace

void steaming_mug()
{
  play_frames(TOTAL_FRAMES, DEFAULT_DELAY_MS,
              [](int frame)
              {
                // Draw the mug
                draw(frame0);

                // Make the steam move
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
