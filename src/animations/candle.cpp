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
constexpr uint16_t yellow = rgb565(249, 199, 47);
constexpr uint16_t darkbrown = rgb565(112, 66, 32);
constexpr uint16_t orange = rgb565(255, 109, 1);
constexpr uint16_t green = rgb565(78, 176, 19);
constexpr uint16_t darkgreen = rgb565(2, 93, 77);

constexpr int TOTAL_FRAMES = DEFAULT_TOTAL_FRAMES;

const Pixel frame0[] = {
    {8, 2, orange},      {8, 3, orange},      {8, 4, darkbrown},   {7, 5, red},         {8, 5, red},
    {9, 5, red},         {7, 6, red},         {8, 6, red},         {9, 6, red},         {7, 7, red},
    {8, 7, red},         {9, 7, red},         {7, 8, red},         {8, 8, red},         {9, 8, red},
    {7, 9, red},         {8, 9, red},         {9, 9, red},         {7, 10, red},        {8, 10, red},
    {9, 10, red},        {7, 11, red},        {8, 11, red},        {9, 11, red},        {7, 12, red},
    {9, 12, red},        {3, 10, darkgreen},  {4, 10, darkgreen},  {5, 10, darkgreen},  {11, 10, darkgreen},
    {12, 10, darkgreen}, {6, 11, darkgreen},  {10, 11, darkgreen}, {13, 11, darkgreen}, {6, 12, darkgreen},
    {8, 12, darkgreen},  {11, 12, darkgreen}, {5, 13, darkgreen},  {7, 13, darkgreen},  {9, 13, darkgreen},
    {10, 13, darkgreen}, {12, 13, darkgreen}, {13, 13, darkgreen}, {7, 14, darkgreen},  {11, 14, darkgreen},
    {8, 15, darkgreen},  {9, 15, darkgreen},  {10, 15, darkgreen}, {11, 15, darkgreen}, {3, 11, green},
    {4, 11, green},      {5, 11, green},      {11, 11, green},     {12, 11, green},     {5, 12, green},
    {12, 12, green},     {8, 13, green},      {8, 14, green},      {9, 14, green},      {10, 14, green},
    {2, 10, darkgreen},  {1, 11, darkgreen},  {2, 11, green},      {14, 11, darkgreen}, {2, 12, darkgreen},
    {3, 12, green},      {4, 12, green},      {3, 13, darkgreen},  {4, 13, darkgreen},  {13, 12, green},
    {14, 12, darkgreen}, {14, 13, darkgreen}};

const Pixel frame1[] = {{6, 0, yellow}, {7, 0, yellow}, {6, 1, yellow}, {7, 1, yellow}, {8, 1, yellow},
                        {6, 2, yellow}, {7, 2, yellow}, {7, 3, yellow}, {9, 2, yellow}, {9, 3, yellow}};

const Pixel frame2[] = {{9, 0, yellow}, {10, 0, yellow}, {8, 1, yellow}, {9, 1, yellow}, {10, 1, yellow},
                        {9, 2, yellow}, {10, 2, yellow}, {9, 3, yellow}, {7, 2, yellow}, {7, 3, yellow}};

} // namespace

void candle()
{
  play_frames(TOTAL_FRAMES, DEFAULT_DELAY_MS,
              [](int frame)
              {
                // Draw the candle
                draw(frame0);

                // Add light
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
