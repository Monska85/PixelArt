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

constexpr uint16_t lightgreen = rgb565(164, 214, 32);
constexpr uint16_t darkgreen = rgb565(2, 93, 77);
constexpr uint16_t red = rgb565(255, 0, 0);
constexpr uint16_t pinkface = rgb565(249, 203, 203);
constexpr uint16_t blue = rgb565(4, 43, 105);
constexpr uint16_t yellow = rgb565(249, 199, 47);

constexpr int TOTAL_FRAMES = 18;

const Pixel frame0[] = {
    {6, 0, lightgreen},  {7, 0, lightgreen},  {8, 0, lightgreen},  {5, 1, lightgreen},   {6, 1, lightgreen},
    {7, 1, lightgreen},  {8, 1, lightgreen},  {9, 1, lightgreen},  {4, 2, lightgreen},   {5, 2, lightgreen},
    {6, 2, lightgreen},  {7, 2, lightgreen},  {8, 2, lightgreen},  {9, 2, lightgreen},   {10, 2, lightgreen},
    {2, 7, lightgreen},  {3, 7, lightgreen},  {11, 7, lightgreen}, {12, 7, lightgreen},  {5, 8, lightgreen},
    {7, 8, lightgreen},  {9, 8, lightgreen},  {5, 9, lightgreen},  {7, 9, lightgreen},   {9, 9, lightgreen},
    {5, 10, lightgreen}, {9, 10, lightgreen}, {4, 14, lightgreen}, {10, 14, lightgreen}, {5, 15, lightgreen},
    {6, 15, lightgreen}, {8, 15, lightgreen}, {9, 15, lightgreen}, {6, 14, darkgreen},   {8, 14, darkgreen},
    {7, 5, red},         {4, 7, red},         {5, 7, red},         {6, 7, red},          {7, 7, red},
    {8, 7, red},         {9, 7, red},         {10, 7, red},        {6, 8, red},          {8, 8, red},
    {6, 9, red},         {8, 9, red},         {6, 10, red},        {7, 10, red},         {8, 10, red},
    {5, 11, red},        {6, 11, red},        {7, 11, red},        {8, 11, red},         {9, 11, red},
    {5, 12, red},        {6, 12, red},        {8, 12, red},        {9, 12, red},         {6, 13, red},
    {8, 13, red},        {4, 3, pinkface},    {5, 3, pinkface},    {7, 3, pinkface},     {9, 3, pinkface},
    {10, 3, pinkface},   {4, 4, pinkface},    {5, 4, pinkface},    {6, 4, pinkface},     {7, 4, pinkface},
    {8, 4, pinkface},    {9, 4, pinkface},    {10, 4, pinkface},   {5, 5, pinkface},     {9, 5, pinkface},
    {6, 6, pinkface},    {7, 6, pinkface},    {8, 6, pinkface},    {6, 3, blue},         {8, 3, blue}};

const Pixel frame1[] = {{0, 1, red},        {1, 1, red},        {0, 2, red},        {1, 2, red},     {3, 0, lightgreen},
                        {4, 0, lightgreen}, {5, 0, lightgreen}, {2, 1, lightgreen}, {6, 5, red},     {8, 5, red},
                        {13, 6, red},       {1, 8, red},        {14, 4, yellow},    {14, 5, yellow}, {15, 5, yellow}};

const Pixel frame2[] = {{13, 1, red},       {14, 1, red},        {13, 2, red},        {14, 2, red},
                        {9, 0, lightgreen}, {10, 0, lightgreen}, {11, 0, lightgreen}, {12, 1, lightgreen},
                        {6, 5, pinkface},   {8, 5, pinkface},    {13, 8, red},        {1, 6, red},
                        {14, 10, yellow},   {14, 9, yellow},     {15, 9, yellow}};

} // namespace

void elf()
{
  play_frames(TOTAL_FRAMES, DEFAULT_DELAY_MS,
              [](int frame)
              {
                // Draw the elf
                draw(frame0);

                // Make their arms move
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
