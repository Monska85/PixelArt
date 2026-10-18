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

constexpr uint16_t darkteal = rgb565(2, 93, 77);
constexpr uint16_t yellow = rgb565(255, 255, 0);
constexpr uint16_t red = rgb565(255, 0, 0);
constexpr uint16_t darkred = rgb565(152, 0, 0);
constexpr uint16_t blue = rgb565(4, 43, 105);
constexpr uint16_t darkbrown = rgb565(67, 36, 13);
constexpr uint16_t white = rgb565(255, 255, 255);
constexpr uint16_t lightblue = rgb565(76, 208, 252);
constexpr uint16_t pinkface = rgb565(249, 203, 203);

constexpr int TOTAL_FRAMES = 12;

const Pixel frame0[] = {
    {0, 7, yellow},  {1, 7, yellow},  {2, 7, yellow},  {4, 7, yellow},  {5, 7, yellow},  {10, 7, yellow},
    {11, 7, yellow}, {13, 7, yellow}, {14, 7, yellow}, {15, 7, yellow}, {0, 8, yellow},  {1, 8, yellow},
    {2, 8, yellow},  {3, 8, yellow},  {12, 8, yellow}, {13, 8, yellow}, {14, 8, yellow}, {15, 8, yellow},
    {7, 0, yellow},  {7, 1, yellow},  {7, 2, yellow},  {7, 3, yellow},  {7, 4, yellow},  {7, 5, yellow},
    {7, 6, yellow},  {7, 9, yellow},  {7, 10, yellow}, {7, 11, yellow}, {7, 12, yellow}, {7, 13, yellow},
    {7, 14, yellow}, {7, 15, yellow}, {8, 0, yellow},  {8, 1, yellow},  {8, 2, yellow},  {8, 3, yellow},
    {8, 4, yellow},  {8, 5, yellow},  {8, 6, yellow},  {8, 9, yellow},  {8, 10, yellow}, {8, 11, yellow},
    {8, 12, yellow}, {8, 13, yellow}, {8, 14, yellow}, {8, 15, yellow}, {7, 7, darkred}, {8, 7, darkred},
    {7, 8, darkred}, {8, 8, darkred}, {3, 5, red},     {4, 5, red},     {5, 5, red},     {10, 5, red},
    {11, 5, red},    {12, 5, red},    {3, 6, red},     {6, 6, red},     {9, 6, red},     {12, 6, red},
    {3, 7, red},     {6, 7, red},     {9, 7, red},     {12, 7, red},    {4, 8, red},     {5, 8, red},
    {6, 8, red},     {9, 8, red},     {10, 8, red},    {11, 8, red},    {6, 9, red},     {9, 9, red},
    {5, 10, red},    {10, 10, red},   {3, 11, red},    {4, 11, red},    {11, 11, red},   {12, 11, red}};

const Pixel frame1[] = {
    {0, 7, yellow},  {1, 7, yellow},  {2, 7, yellow},  {3, 7, yellow},  {4, 7, yellow},  {5, 7, yellow},
    {6, 7, yellow},  {7, 7, yellow},  {8, 7, yellow},  {9, 7, yellow},  {10, 7, yellow}, {11, 7, yellow},
    {12, 7, yellow}, {13, 7, yellow}, {14, 7, yellow}, {15, 7, yellow}, {0, 8, yellow},  {1, 8, yellow},
    {2, 8, yellow},  {3, 8, yellow},  {4, 8, yellow},  {5, 8, yellow},  {6, 8, yellow},  {7, 8, yellow},
    {8, 8, yellow},  {9, 8, yellow},  {10, 8, yellow}, {11, 8, yellow}, {12, 8, yellow}, {13, 8, yellow},
    {14, 8, yellow}, {15, 8, yellow}, {7, 0, yellow},  {7, 1, yellow},  {7, 2, yellow},  {7, 3, yellow},
    {7, 4, yellow},  {7, 5, yellow},  {7, 6, yellow},  {7, 9, yellow},  {7, 10, yellow}, {7, 11, yellow},
    {7, 12, yellow}, {7, 13, yellow}, {7, 14, yellow}, {7, 15, yellow}, {8, 0, yellow},  {8, 1, yellow},
    {8, 2, yellow},  {8, 3, yellow},  {8, 4, yellow},  {8, 5, yellow},  {8, 6, yellow},  {8, 9, yellow},
    {8, 10, yellow}, {8, 11, yellow}, {8, 12, yellow}, {8, 13, yellow}, {8, 14, yellow}, {8, 15, yellow}};

const Pixel frame2[] = {
    {5, 0, darkbrown},   {6, 0, darkbrown},   {7, 0, darkbrown},   {8, 0, darkbrown},   {9, 0, darkbrown},
    {10, 0, darkbrown},  {1, 1, darkbrown},   {2, 1, darkbrown},   {3, 1, darkbrown},   {12, 1, darkbrown},
    {1, 2, darkbrown},   {2, 2, darkbrown},   {3, 2, darkbrown},   {12, 2, darkbrown},  {1, 3, darkbrown},
    {2, 3, darkbrown},   {3, 3, darkbrown},   {12, 3, darkbrown},  {13, 3, darkbrown},  {14, 3, darkbrown},
    {6, 2, blue},        {9, 2, blue},        {4, 1, red},         {11, 1, red},        {7, 4, red},
    {8, 4, red},         {3, 8, red},         {4, 8, red},         {5, 8, red},         {6, 8, red},
    {7, 8, red},         {8, 8, red},         {9, 8, red},         {10, 8, red},        {11, 8, red},
    {12, 8, red},        {3, 9, red},         {4, 9, red},         {5, 9, red},         {6, 9, red},
    {7, 9, red},         {8, 9, red},         {9, 9, red},         {10, 9, red},        {11, 9, red},
    {12, 9, red},        {5, 10, red},        {6, 10, red},        {7, 10, red},        {8, 10, red},
    {9, 10, red},        {10, 10, red},       {5, 12, red},        {6, 12, red},        {9, 12, red},
    {10, 12, red},       {5, 13, red},        {6, 13, red},        {9, 13, red},        {10, 13, red},
    {6, 14, red},        {9, 14, red},        {10, 14, red},       {6, 7, white},       {7, 7, white},
    {8, 7, white},       {9, 7, white},       {2, 8, white},       {13, 8, white},      {2, 9, white},
    {13, 9, white},      {5, 11, white},      {6, 11, white},      {7, 11, white},      {8, 11, white},
    {9, 11, white},      {10, 11, white},     {6, 15, white},      {9, 15, white},      {10, 15, white},
    {0, 0, lightblue},   {1, 0, lightblue},   {2, 0, lightblue},   {3, 0, lightblue},   {4, 0, lightblue},
    {11, 0, lightblue},  {0, 1, lightblue},   {0, 2, lightblue},   {4, 2, lightblue},   {11, 2, lightblue},
    {0, 3, lightblue},   {4, 3, lightblue},   {11, 3, lightblue},  {0, 4, lightblue},   {1, 4, lightblue},
    {2, 4, lightblue},   {3, 4, lightblue},   {4, 4, lightblue},   {11, 4, lightblue},  {12, 4, lightblue},
    {13, 4, lightblue},  {14, 4, lightblue},  {0, 5, lightblue},   {1, 5, lightblue},   {2, 5, lightblue},
    {3, 5, lightblue},   {4, 5, lightblue},   {5, 5, lightblue},   {10, 5, lightblue},  {11, 5, lightblue},
    {12, 5, lightblue},  {13, 5, lightblue},  {14, 5, lightblue},  {15, 5, lightblue},  {0, 6, lightblue},
    {1, 6, lightblue},   {2, 6, lightblue},   {3, 6, lightblue},   {4, 6, lightblue},   {5, 6, lightblue},
    {6, 6, lightblue},   {9, 6, lightblue},   {10, 6, lightblue},  {11, 6, lightblue},  {12, 6, lightblue},
    {13, 6, lightblue},  {14, 6, lightblue},  {15, 6, lightblue},  {0, 7, lightblue},   {1, 7, lightblue},
    {2, 7, lightblue},   {3, 7, lightblue},   {4, 7, lightblue},   {5, 7, lightblue},   {10, 7, lightblue},
    {11, 7, lightblue},  {12, 7, lightblue},  {13, 7, lightblue},  {14, 7, lightblue},  {15, 7, lightblue},
    {0, 8, lightblue},   {15, 8, lightblue},  {0, 9, lightblue},   {1, 9, lightblue},   {14, 9, lightblue},
    {15, 9, lightblue},  {0, 10, lightblue},  {1, 10, lightblue},  {2, 10, lightblue},  {3, 10, lightblue},
    {4, 10, lightblue},  {11, 10, lightblue}, {12, 10, lightblue}, {13, 10, lightblue}, {14, 10, lightblue},
    {15, 10, lightblue}, {0, 11, lightblue},  {1, 11, lightblue},  {2, 11, lightblue},  {3, 11, lightblue},
    {4, 11, lightblue},  {11, 11, lightblue}, {12, 11, lightblue}, {13, 11, lightblue}, {15, 11, lightblue},
    {4, 12, lightblue},  {7, 12, lightblue},  {8, 12, lightblue},  {11, 12, lightblue}, {12, 12, lightblue},
    {7, 13, lightblue},  {8, 13, lightblue},  {11, 13, lightblue}, {12, 13, lightblue}, {7, 14, lightblue},
    {8, 14, lightblue},  {11, 14, lightblue}, {12, 14, lightblue}, {7, 15, lightblue},  {8, 15, lightblue},
    {11, 15, lightblue}, {5, 1, pinkface},    {6, 1, pinkface},    {7, 1, pinkface},    {8, 1, pinkface},
    {9, 1, pinkface},    {10, 1, pinkface},   {5, 2, pinkface},    {7, 2, pinkface},    {8, 2, pinkface},
    {10, 2, pinkface},   {5, 3, pinkface},    {6, 3, pinkface},    {7, 3, pinkface},    {8, 3, pinkface},
    {9, 3, pinkface},    {10, 3, pinkface},   {5, 4, pinkface},    {6, 4, pinkface},    {9, 4, pinkface},
    {10, 4, pinkface},   {6, 5, pinkface},    {7, 5, pinkface},    {8, 5, pinkface},    {9, 5, pinkface},
    {7, 6, pinkface},    {8, 6, pinkface},    {1, 8, pinkface},    {14, 8, pinkface}};

} // namespace

void open_gift()
{
  play_frames(TOTAL_FRAMES, DEFAULT_DELAY_MS,
              [](int frame)
              {
                // Draw the wrapping paper
                matrix.fillScreen(darkteal);

                if (frame <= (TOTAL_FRAMES / 8))
                {
                  draw(frame0);
                }
                else if (frame <= (2 * TOTAL_FRAMES / 8))
                {
                  draw(frame1);
                }
                else if (frame >= (5 * TOTAL_FRAMES / 8))
                {
                  draw(frame2);
                }
              });
}
