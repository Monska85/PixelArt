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

constexpr uint16_t darkgreen = rgb565(2, 93, 77);
constexpr uint16_t green = rgb565(78, 176, 19);
constexpr uint16_t red = rgb565(255, 0, 0);
constexpr uint16_t white = rgb565(255, 255, 255);
constexpr uint16_t darkred = rgb565(152, 0, 0);

constexpr int TOTAL_FRAMES = DEFAULT_TOTAL_FRAMES;

const Pixel frame0[] = {
    {0, 0, darkgreen},  {4, 0, green},       {11, 0, green},      {15, 0, darkgreen},  {1, 1, darkgreen},
    {4, 1, green},      {5, 1, green},       {10, 1, green},      {11, 1, green},      {14, 1, darkgreen},
    {2, 2, darkgreen},  {4, 2, green},       {5, 2, green},       {6, 2, green},       {9, 2, green},
    {10, 2, green},     {11, 2, green},      {13, 2, darkgreen},  {3, 3, darkgreen},   {4, 3, green},
    {5, 3, green},      {6, 3, green},       {9, 3, green},       {10, 3, green},      {11, 3, green},
    {12, 3, darkgreen}, {0, 4, green},       {1, 4, green},       {2, 4, green},       {3, 4, green},
    {5, 4, green},      {6, 4, green},       {9, 4, green},       {10, 4, green},      {12, 4, green},
    {13, 4, green},     {14, 4, green},      {15, 4, green},      {1, 5, green},       {2, 5, green},
    {3, 5, green},      {4, 5, green},       {6, 5, green},       {9, 5, green},       {11, 5, green},
    {12, 5, green},     {13, 5, green},      {14, 5, green},      {2, 6, green},       {3, 6, green},
    {4, 6, green},      {5, 6, green},       {10, 6, green},      {11, 6, green},      {12, 6, green},
    {13, 6, green},     {2, 9, green},       {3, 9, green},       {4, 9, green},       {5, 9, green},
    {10, 9, green},     {11, 9, green},      {12, 9, green},      {13, 9, green},      {1, 10, green},
    {2, 10, green},     {3, 10, green},      {4, 10, green},      {6, 10, green},      {9, 10, green},
    {11, 10, green},    {12, 10, green},     {13, 10, green},     {14, 10, green},     {0, 11, green},
    {1, 11, green},     {2, 11, green},      {3, 11, green},      {5, 11, green},      {6, 11, green},
    {9, 11, green},     {10, 11, green},     {12, 11, green},     {13, 11, green},     {14, 11, green},
    {15, 11, green},    {3, 12, darkgreen},  {4, 12, green},      {5, 12, green},      {6, 12, green},
    {9, 12, green},     {10, 12, green},     {11, 12, green},     {12, 12, darkgreen}, {2, 13, darkgreen},
    {4, 13, green},     {5, 13, green},      {6, 13, green},      {9, 13, green},      {10, 13, green},
    {11, 13, green},    {13, 13, darkgreen}, {1, 14, darkgreen},  {4, 14, green},      {5, 14, green},
    {10, 14, green},    {11, 14, green},     {14, 14, darkgreen}, {0, 15, darkgreen},  {4, 15, green},
    {11, 15, green},    {15, 15, darkgreen}, {11, 11, darkgreen}, {4, 11, darkgreen},  {4, 4, darkgreen},
    {11, 4, darkgreen}, {8, 6, red},         {7, 7, red},         {8, 7, red},         {9, 7, red},
    {7, 8, red},        {8, 8, red},         {9, 8, red}};

const Pixel frame1[] = {{7, 6, white}, {6, 7, red}, {6, 8, red}, {7, 9, red}, {8, 9, red}};

const Pixel frame2[] = {{7, 6, red}, {6, 7, darkred}, {6, 8, darkred}, {7, 9, darkred}, {8, 9, darkred}};

} // namespace

void poinsettia()
{
  play_frames(TOTAL_FRAMES, DEFAULT_DELAY_MS,
              [](int frame)
              {
                // Draw the common parts
                draw(frame0);

                // Make it shine
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
