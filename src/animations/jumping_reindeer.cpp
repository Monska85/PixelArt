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

constexpr uint16_t gold = rgb565(249, 199, 47);
constexpr uint16_t brown = rgb565(140, 82, 39);
constexpr uint16_t darkbrown = rgb565(67, 36, 13);
constexpr uint16_t red = rgb565(255, 0, 0);
constexpr uint16_t darkred = rgb565(152, 0, 0);
constexpr uint16_t blue = rgb565(4, 43, 105);
constexpr uint16_t cheek = rgb565(244, 99, 166);
constexpr uint16_t yellow = rgb565(255, 238, 0);
constexpr uint16_t white = rgb565(255, 255, 255);

constexpr int TOTAL_FRAMES = 18;

const Pixel frame0[] = {
    {6, 2, gold},       {7, 2, gold},       {7, 3, gold},       {8, 3, gold},        {8, 4, gold},    {6, 11, gold},
    {5, 12, gold},      {9, 4, brown},      {10, 4, brown},     {8, 5, brown},       {9, 5, brown},   {10, 5, brown},
    {11, 5, brown},     {7, 6, brown},      {8, 6, brown},      {9, 6, brown},       {11, 6, brown},  {12, 6, brown},
    {8, 7, brown},      {10, 7, brown},     {11, 7, brown},     {12, 7, brown},      {8, 8, brown},   {9, 8, brown},
    {10, 8, brown},     {11, 8, brown},     {5, 10, brown},     {6, 10, brown},      {7, 10, brown},  {8, 10, brown},
    {9, 10, brown},     {10, 10, brown},    {4, 11, brown},     {5, 11, brown},      {7, 11, brown},  {8, 11, brown},
    {9, 11, brown},     {10, 11, brown},    {3, 12, brown},     {4, 12, brown},      {6, 12, brown},  {7, 12, brown},
    {8, 12, brown},     {9, 12, brown},     {10, 12, brown},    {4, 13, brown},      {5, 13, brown},  {6, 13, brown},
    {9, 13, brown},     {10, 13, brown},    {4, 14, brown},     {5, 14, brown},      {9, 14, brown},  {10, 14, brown},
    {4, 15, darkbrown}, {5, 15, darkbrown}, {9, 15, darkbrown}, {10, 15, darkbrown}, {8, 9, red},     {9, 9, red},
    {10, 9, red},       {13, 6, darkred},   {10, 6, blue},      {9, 7, cheek},       {11, 10, yellow}};

const Pixel frame1[] = {
    {6, 0, gold},       {7, 0, gold},       {7, 1, gold},        {8, 1, gold},        {8, 2, gold},    {6, 9, gold},
    {5, 10, gold},      {9, 2, brown},      {10, 2, brown},      {8, 3, brown},       {9, 3, brown},   {10, 3, brown},
    {11, 3, brown},     {7, 4, brown},      {8, 4, brown},       {9, 4, brown},       {11, 4, brown},  {12, 4, brown},
    {8, 5, brown},      {10, 5, brown},     {11, 5, brown},      {12, 5, brown},      {8, 6, brown},   {9, 6, brown},
    {10, 6, brown},     {11, 6, brown},     {5, 8, brown},       {6, 8, brown},       {7, 8, brown},   {8, 8, brown},
    {9, 8, brown},      {10, 8, brown},     {4, 9, brown},       {5, 9, brown},       {7, 9, brown},   {8, 9, brown},
    {9, 9, brown},      {10, 9, brown},     {3, 10, brown},      {4, 10, brown},      {6, 10, brown},  {7, 10, brown},
    {8, 10, brown},     {9, 10, brown},     {10, 10, brown},     {4, 11, brown},      {5, 11, brown},  {6, 11, brown},
    {9, 11, brown},     {10, 11, brown},    {3, 12, brown},      {4, 12, brown},      {10, 12, brown}, {11, 12, brown},
    {2, 13, darkbrown}, {3, 13, darkbrown}, {11, 13, darkbrown}, {12, 13, darkbrown}, {8, 7, red},     {9, 7, red},
    {10, 7, red},       {13, 4, red},       {10, 4, blue},       {9, 5, cheek},       {11, 8, yellow}};

const Pixel snow[] = {
    {4, 0, white},   {9, 0, white},   {1, 1, white},   {13, 2, white},  {5, 3, white},   {10, 3, white},
    {2, 4, white},   {15, 5, white},  {4, 6, white},   {0, 7, white},   {6, 8, white},   {0, 12, white},
    {1, 12, white},  {2, 12, white},  {3, 12, white},  {4, 12, white},  {5, 12, white},  {6, 12, white},
    {7, 12, white},  {8, 12, white},  {9, 12, white},  {10, 12, white}, {11, 12, white}, {12, 12, white},
    {13, 12, white}, {14, 12, white}, {15, 12, white}, {0, 13, white},  {1, 13, white},  {2, 13, white},
    {3, 13, white},  {4, 13, white},  {5, 13, white},  {6, 13, white},  {7, 13, white},  {8, 13, white},
    {9, 13, white},  {10, 13, white}, {11, 13, white}, {12, 13, white}, {13, 13, white}, {14, 13, white},
    {15, 13, white}, {0, 14, white},  {1, 14, white},  {2, 14, white},  {3, 14, white},  {4, 14, white},
    {5, 14, white},  {6, 14, white},  {7, 14, white},  {8, 14, white},  {9, 14, white},  {10, 14, white},
    {11, 14, white}, {12, 14, white}, {13, 14, white}, {14, 14, white}, {15, 14, white}, {0, 15, white},
    {1, 15, white},  {2, 15, white},  {3, 15, white},  {4, 15, white},  {5, 15, white},  {6, 15, white},
    {7, 15, white},  {8, 15, white},  {9, 15, white},  {10, 15, white}, {11, 15, white}, {12, 15, white},
    {13, 15, white}, {14, 15, white}, {15, 15, white}};

const Pixel snow_0[] = {{0, 10, white},  {7, 10, white},  {8, 10, white},  {15, 10, white},
                        {0, 11, white},  {1, 11, white},  {2, 11, white},  {5, 11, white},
                        {6, 11, white},  {7, 11, white},  {8, 11, white},  {9, 11, white},
                        {10, 11, white}, {13, 11, white}, {14, 11, white}, {15, 11, white}};

const Pixel snow_1[] = {{3, 10, white},  {4, 10, white},  {11, 10, white}, {12, 10, white},
                        {1, 11, white},  {2, 11, white},  {3, 11, white},  {4, 11, white},
                        {5, 11, white},  {6, 11, white},  {9, 11, white},  {10, 11, white},
                        {11, 11, white}, {12, 11, white}, {13, 11, white}, {14, 11, white}};

} // namespace

void jumping_reindeer()
{
  play_frames(TOTAL_FRAMES, DEFAULT_DELAY_MS,
              [](int frame)
              {
                // Draw the common snow
                draw(snow);

                // Make reindeer run and add snow
                if (frame % 2 == 0)
                {
                  draw(snow_0);
                  draw(frame0);
                }
                else
                {
                  draw(snow_1);
                  draw(frame1);
                }
              });
}
