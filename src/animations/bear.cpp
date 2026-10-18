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
constexpr uint16_t lightblue = rgb565(140, 239, 255);
constexpr uint16_t blue = rgb565(4, 43, 105);
constexpr uint16_t darkgrey = rgb565(102, 102, 102);
constexpr uint16_t pink = rgb565(244, 99, 166);

constexpr int TOTAL_FRAMES = round_up_to_even(DEFAULT_TOTAL_FRAMES);

const Pixel frame0[] = {
    {3, 5, lightblue},   {4, 5, lightblue},   {5, 5, lightblue},  {6, 5, lightblue},   {7, 5, lightblue},
    {8, 5, lightblue},   {9, 5, lightblue},   {10, 5, lightblue}, {11, 5, lightblue},  {1, 6, lightblue},
    {2, 6, lightblue},   {3, 6, lightblue},   {11, 6, lightblue}, {12, 6, lightblue},  {13, 6, lightblue},
    {0, 7, lightblue},   {2, 7, lightblue},   {12, 7, lightblue}, {14, 7, lightblue},  {0, 8, lightblue},
    {14, 8, lightblue},  {1, 9, lightblue},   {13, 9, lightblue}, {1, 10, lightblue},  {13, 10, lightblue},
    {0, 11, lightblue},  {14, 11, lightblue}, {0, 12, lightblue}, {14, 12, lightblue}, {0, 13, lightblue},
    {14, 13, lightblue}, {1, 14, lightblue},  {2, 14, lightblue}, {3, 14, lightblue},  {11, 14, lightblue},
    {12, 14, lightblue}, {13, 14, lightblue}, {3, 15, lightblue}, {4, 15, lightblue},  {5, 15, lightblue},
    {6, 15, lightblue},  {7, 15, lightblue},  {8, 15, lightblue}, {9, 15, lightblue},  {10, 15, lightblue},
    {11, 15, lightblue}, {4, 10, blue},       {10, 10, blue},     {6, 10, darkgrey},   {7, 10, darkgrey},
    {8, 10, darkgrey},   {7, 11, darkgrey},   {7, 12, darkgrey},  {3, 11, pink},       {11, 11, pink},
    {4, 6, white},       {5, 6, white},       {6, 6, white},      {7, 6, white},       {8, 6, white},
    {9, 6, white},       {10, 6, white},      {1, 7, white},      {3, 7, white},       {4, 7, white},
    {5, 7, white},       {6, 7, white},       {7, 7, white},      {8, 7, white},       {9, 7, white},
    {10, 7, white},      {11, 7, white},      {13, 7, white},     {1, 8, white},       {2, 8, white},
    {3, 8, white},       {4, 8, white},       {5, 8, white},      {6, 8, white},       {7, 8, white},
    {8, 8, white},       {9, 8, white},       {10, 8, white},     {11, 8, white},      {12, 8, white},
    {13, 8, white},      {2, 9, white},       {3, 9, white},      {4, 9, white},       {5, 9, white},
    {6, 9, white},       {7, 9, white},       {8, 9, white},      {9, 9, white},       {10, 9, white},
    {11, 9, white},      {12, 9, white},      {2, 10, white},     {3, 10, white},      {5, 10, white},
    {9, 10, white},      {11, 10, white},     {12, 10, white},    {1, 11, white},      {2, 11, white},
    {4, 11, white},      {5, 11, white},      {6, 11, white},     {8, 11, white},      {9, 11, white},
    {10, 11, white},     {12, 11, white},     {13, 11, white},    {1, 12, white},      {2, 12, white},
    {3, 12, white},      {4, 12, white},      {5, 12, white},     {6, 12, white},      {8, 12, white},
    {9, 12, white},      {10, 12, white},     {11, 12, white},    {12, 12, white},     {13, 12, white},
    {1, 13, white},      {2, 13, white},      {3, 13, white},     {4, 13, white},      {5, 13, white},
    {6, 13, white},      {7, 13, white},      {8, 13, white},     {9, 13, white},      {10, 13, white},
    {11, 13, white},     {12, 13, white},     {13, 13, white},    {4, 14, white},      {5, 14, white},
    {6, 14, white},      {7, 14, white},      {8, 14, white},     {9, 14, white},      {10, 14, white}};

const Pixel frame1[] = {{14, 2, white}, {15, 2, white}, {14, 3, white}, {15, 3, white}, {3, 4, white},  {4, 4, white},
                        {5, 4, white},  {6, 4, white},  {7, 4, white},  {8, 4, white},  {9, 4, white},  {10, 4, white},
                        {11, 4, white}, {2, 11, pink},  {2, 12, pink},  {3, 12, pink},  {12, 11, pink}, {11, 12, pink},
                        {12, 12, pink}, {5, 0, red},    {6, 0, red},    {7, 0, red},    {8, 0, red},    {9, 0, red},
                        {10, 0, red},   {11, 0, red},   {12, 0, red},   {4, 1, red},    {5, 1, red},    {6, 1, red},
                        {7, 1, red},    {8, 1, red},    {9, 1, red},    {10, 1, red},   {13, 1, red},   {4, 2, red},
                        {5, 2, red},    {6, 2, red},    {7, 2, red},    {8, 2, red},    {9, 2, red},    {10, 2, red},
                        {3, 3, red},    {4, 3, red},    {5, 3, red},    {6, 3, red},    {7, 3, red},    {8, 3, red},
                        {9, 3, red},    {10, 3, red},   {11, 3, red}};

} // namespace

void bear()
{
  play_frames(TOTAL_FRAMES, DEFAULT_DELAY_MS,
              [](int frame)
              {
                // Draw the bear
                draw(frame0);

                // Add Christmas hat
                if (frame % 2 == 1)
                {
                  draw(frame1);
                }
              });
}
