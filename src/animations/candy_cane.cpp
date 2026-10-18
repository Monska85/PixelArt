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

constexpr uint16_t white = rgb565(255, 255, 255);
constexpr uint16_t red = rgb565(255, 0, 0);
constexpr uint16_t green = rgb565(78, 176, 19);
constexpr uint16_t darkgreen = rgb565(2, 93, 77);

constexpr int TOTAL_FRAMES = round_up_to_even(DEFAULT_TOTAL_FRAMES);

const Pixel frame0[] = {
    {11, 0, white},      {12, 0, white},      {11, 1, white},      {12, 1, white},      {14, 1, white},
    {11, 2, white},      {14, 2, white},      {15, 2, white},      {13, 3, white},      {14, 3, white},
    {12, 5, white},      {13, 5, white},      {14, 5, white},      {11, 6, white},      {12, 6, white},
    {13, 6, white},      {8, 9, white},       {9, 9, white},       {10, 9, white},      {7, 10, white},
    {8, 10, white},      {9, 10, white},      {4, 13, white},      {5, 13, white},      {6, 13, white},
    {3, 14, white},      {4, 14, white},      {5, 14, white},      {13, 0, red},        {10, 1, red},
    {13, 1, red},        {9, 2, red},         {10, 2, red},        {13, 2, red},        {9, 3, red},
    {10, 3, red},        {15, 3, red},        {13, 4, red},        {14, 4, red},        {15, 4, red},
    {10, 7, red},        {11, 7, red},        {12, 7, red},        {9, 8, red},         {10, 8, red},
    {11, 8, red},        {6, 11, red},        {7, 11, red},        {8, 11, red},        {5, 12, red},
    {6, 12, red},        {7, 12, red},        {2, 15, red},        {3, 15, red},        {4, 15, red},
    {3, 0, darkgreen},   {4, 0, darkgreen},   {1, 1, darkgreen},   {3, 1, darkgreen},   {4, 1, darkgreen},
    {0, 2, darkgreen},   {1, 2, darkgreen},   {4, 2, darkgreen},   {1, 3, darkgreen},   {2, 3, darkgreen},
    {1, 5, darkgreen},   {2, 5, darkgreen},   {3, 5, darkgreen},   {2, 6, darkgreen},   {3, 6, darkgreen},
    {4, 6, darkgreen},   {5, 9, darkgreen},   {6, 9, darkgreen},   {7, 9, darkgreen},   {6, 10, darkgreen},
    {9, 13, darkgreen},  {10, 13, darkgreen}, {11, 13, darkgreen}, {10, 14, darkgreen}, {11, 14, darkgreen},
    {12, 14, darkgreen}, {2, 0, green},       {2, 1, green},       {5, 1, green},       {2, 2, green},
    {5, 2, green},       {6, 2, green},       {0, 3, green},       {5, 3, green},       {6, 3, green},
    {0, 4, green},       {1, 4, green},       {2, 4, green},       {3, 7, green},       {4, 7, green},
    {5, 7, green},       {4, 8, green},       {5, 8, green},       {6, 8, green},       {9, 11, green},
    {8, 12, green},      {9, 12, green},      {10, 12, green},     {11, 15, green},     {12, 15, green},
    {13, 15, green}};

const Pixel frame1[] = {
    {11, 0, red},       {12, 0, red},       {11, 1, red},        {12, 1, red},        {14, 1, red},
    {11, 2, red},       {14, 2, red},       {15, 2, red},        {13, 3, red},        {14, 3, red},
    {12, 5, red},       {13, 5, red},       {14, 5, red},        {11, 6, red},        {12, 6, red},
    {13, 6, red},       {8, 9, red},        {9, 9, red},         {10, 9, red},        {7, 10, red},
    {8, 10, red},       {9, 10, red},       {4, 13, red},        {5, 13, red},        {6, 13, red},
    {3, 14, red},       {4, 14, red},       {5, 14, red},        {13, 0, white},      {10, 1, white},
    {13, 1, white},     {9, 2, white},      {10, 2, white},      {13, 2, white},      {9, 3, white},
    {10, 3, white},     {15, 3, white},     {13, 4, white},      {14, 4, white},      {15, 4, white},
    {10, 7, white},     {11, 7, white},     {12, 7, white},      {9, 8, white},       {10, 8, white},
    {11, 8, white},     {6, 11, white},     {7, 11, white},      {8, 11, white},      {5, 12, white},
    {6, 12, white},     {7, 12, white},     {2, 15, white},      {3, 15, white},      {4, 15, white},
    {3, 0, green},      {4, 0, green},      {1, 1, green},       {3, 1, green},       {4, 1, green},
    {0, 2, green},      {1, 2, green},      {4, 2, green},       {1, 3, green},       {2, 3, green},
    {1, 5, green},      {2, 5, green},      {3, 5, green},       {2, 6, green},       {3, 6, green},
    {4, 6, green},      {5, 9, green},      {6, 9, green},       {7, 9, green},       {6, 10, green},
    {9, 13, green},     {10, 13, green},    {11, 13, green},     {10, 14, green},     {11, 14, green},
    {12, 14, green},    {2, 0, darkgreen},  {2, 1, darkgreen},   {5, 1, darkgreen},   {2, 2, darkgreen},
    {5, 2, darkgreen},  {6, 2, darkgreen},  {0, 3, darkgreen},   {5, 3, darkgreen},   {6, 3, darkgreen},
    {0, 4, darkgreen},  {1, 4, darkgreen},  {2, 4, darkgreen},   {3, 7, darkgreen},   {4, 7, darkgreen},
    {5, 7, darkgreen},  {4, 8, darkgreen},  {5, 8, darkgreen},   {6, 8, darkgreen},   {9, 11, darkgreen},
    {8, 12, darkgreen}, {9, 12, darkgreen}, {10, 12, darkgreen}, {11, 15, darkgreen}, {12, 15, darkgreen},
    {13, 15, darkgreen}};

} // namespace

void candy_cane()
{
  play_frames(TOTAL_FRAMES, DEFAULT_DELAY_MS,
              [](int frame)
              {
                // Draw candy canes and flip the colors
                if (frame % 2 == 1)
                {
                  draw(frame0);
                }
                else
                {
                  draw(frame1);
                }
              });
}
