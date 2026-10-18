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

constexpr uint16_t grey = rgb565(153, 153, 153);
constexpr uint16_t darkgrey = rgb565(102, 102, 102);
constexpr uint16_t red = rgb565(255, 0, 0);
constexpr uint16_t darkred = rgb565(152, 0, 0);
constexpr uint16_t lightred = rgb565(234, 92, 92);
constexpr uint16_t yellow = rgb565(249, 199, 47);
constexpr uint16_t darkyellow = rgb565(161, 121, 5);
constexpr uint16_t lightyellow = rgb565(255, 255, 0);
constexpr uint16_t blue = rgb565(61, 133, 198);
constexpr uint16_t darkblue = rgb565(10, 54, 94);
constexpr uint16_t lightblue = rgb565(159, 197, 232);
constexpr uint16_t green = rgb565(78, 176, 19);
constexpr uint16_t darkgreen = rgb565(2, 93, 77);
constexpr uint16_t lightgreen = rgb565(149, 247, 91);

constexpr int TOTAL_FRAMES = round_up_to_even(DEFAULT_TOTAL_FRAMES);

const Pixel frame0[] = {{0, 7, grey},      {1, 7, grey},       {2, 7, grey},     {3, 7, grey},      {4, 7, grey},
                        {5, 7, grey},      {13, 7, grey},      {14, 7, grey},    {15, 7, grey},     {5, 5, grey},
                        {6, 5, grey},      {7, 5, grey},       {7, 10, grey},    {8, 10, grey},     {9, 10, grey},
                        {9, 9, grey},      {10, 9, grey},      {11, 9, grey},    {12, 9, grey},     {13, 9, grey},
                        {5, 6, grey},      {7, 6, grey},       {7, 7, grey},     {7, 8, grey},      {7, 9, grey},
                        {13, 8, grey},     {1, 6, darkgrey},   {6, 4, darkgrey}, {14, 6, darkgrey}, {3, 8, darkgrey},
                        {10, 8, darkgrey}, {12, 10, darkgrey}, {7, 11, darkgrey}};

const Pixel frame1[] = {
    {1, 2, darkred},      {0, 3, darkred},      {1, 3, darkred},      {2, 3, darkred},      {0, 4, darkred},
    {1, 4, darkred},      {2, 4, darkred},      {0, 5, darkred},      {1, 5, darkred},      {2, 5, darkred},
    {6, 12, darkred},     {7, 12, darkred},     {8, 12, darkred},     {6, 13, darkred},     {7, 13, darkred},
    {8, 13, darkred},     {6, 14, darkred},     {7, 14, darkred},     {8, 14, darkred},     {7, 15, darkred},
    {6, 0, darkyellow},   {5, 1, darkyellow},   {6, 1, darkyellow},   {7, 1, darkyellow},   {5, 2, darkyellow},
    {6, 2, darkyellow},   {7, 2, darkyellow},   {5, 3, darkyellow},   {6, 3, darkyellow},   {7, 3, darkyellow},
    {11, 11, darkyellow}, {12, 11, darkyellow}, {13, 11, darkyellow}, {11, 12, darkyellow}, {12, 12, darkyellow},
    {13, 12, darkyellow}, {11, 13, darkyellow}, {12, 13, darkyellow}, {13, 13, darkyellow}, {12, 14, darkyellow},
    {10, 4, darkblue},    {9, 5, darkblue},     {10, 5, darkblue},    {11, 5, darkblue},    {9, 6, darkblue},
    {10, 6, darkblue},    {11, 6, darkblue},    {9, 7, darkblue},     {10, 7, darkblue},    {11, 7, darkblue},
    {14, 2, darkgreen},   {13, 3, darkgreen},   {14, 3, darkgreen},   {15, 3, darkgreen},   {13, 4, darkgreen},
    {14, 4, darkgreen},   {15, 4, darkgreen},   {13, 5, darkgreen},   {14, 5, darkgreen},   {15, 5, darkgreen},
    {2, 9, darkgreen},    {3, 9, darkgreen},    {4, 9, darkgreen},    {2, 10, darkgreen},   {3, 10, darkgreen},
    {4, 10, darkgreen},   {2, 11, darkgreen},   {3, 11, darkgreen},   {4, 11, darkgreen},   {3, 12, darkgreen}};

const Pixel frame2[] = {
    {1, 2, lightred},    {0, 3, red},           {1, 3, lightred},      {2, 3, red},         {0, 4, red},
    {1, 4, lightred},    {2, 4, red},           {0, 5, red},           {1, 5, lightred},    {2, 5, red},
    {6, 12, red},        {7, 12, lightred},     {8, 12, red},          {6, 13, red},        {7, 13, lightred},
    {8, 13, red},        {6, 14, red},          {7, 14, lightred},     {8, 14, red},        {7, 15, lightred},
    {6, 0, lightyellow}, {5, 1, yellow},        {6, 1, lightyellow},   {7, 1, yellow},      {5, 2, yellow},
    {6, 2, lightyellow}, {7, 2, yellow},        {5, 3, yellow},        {6, 3, lightyellow}, {7, 3, yellow},
    {11, 11, yellow},    {12, 11, lightyellow}, {13, 11, yellow},      {11, 12, yellow},    {12, 12, lightyellow},
    {13, 12, yellow},    {11, 13, yellow},      {12, 13, lightyellow}, {13, 13, yellow},    {12, 14, lightyellow},
    {10, 4, lightblue},  {9, 5, blue},          {10, 5, lightblue},    {11, 5, blue},       {9, 6, blue},
    {10, 6, lightblue},  {11, 6, blue},         {9, 7, blue},          {10, 7, lightblue},  {11, 7, blue},
    {14, 2, lightgreen}, {13, 3, green},        {14, 3, lightgreen},   {15, 3, green},      {13, 4, green},
    {14, 4, lightgreen}, {15, 4, green},        {13, 5, green},        {14, 5, lightgreen}, {15, 5, green},
    {2, 9, green},       {3, 9, lightgreen},    {4, 9, green},         {2, 10, green},      {3, 10, lightgreen},
    {4, 10, green},      {2, 11, green},        {3, 11, lightgreen},   {4, 11, green},      {3, 12, lightgreen}};

} // namespace

void christmas_lights()
{
  play_frames(TOTAL_FRAMES, DEFAULT_DELAY_MS,
              [](int frame)
              {
                // Draw the lights
                draw(frame0);

                // Switch them on
                if (frame % 2 == 0)
                {
                  draw(frame1);
                }
                else
                {
                  draw(frame2);
                }
              });
}
