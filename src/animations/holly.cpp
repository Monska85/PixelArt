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

constexpr uint16_t green = rgb565(78, 176, 19);
constexpr uint16_t darkgreen = rgb565(2, 93, 77);
constexpr uint16_t red = rgb565(255, 0, 0);
constexpr uint16_t darkred = rgb565(152, 0, 0);
constexpr uint16_t white = rgb565(255, 255, 255);
constexpr uint16_t yellow = rgb565(249, 199, 47);
constexpr uint16_t gold = rgb565(191, 144, 0);

constexpr int TOTAL_FRAMES = DEFAULT_TOTAL_FRAMES;

const Pixel frame0[] = {
    {1, 0, green},       {2, 0, green},       {4, 0, green},       {0, 1, green},       {2, 1, green},
    {3, 1, green},       {4, 1, green},       {6, 1, green},       {0, 2, green},       {1, 2, green},
    {3, 2, green},       {4, 2, green},       {5, 2, green},       {6, 2, green},       {1, 3, green},
    {2, 3, green},       {4, 3, green},       {5, 3, green},       {6, 3, green},       {0, 4, green},
    {1, 4, green},       {2, 4, green},       {3, 4, green},       {5, 4, green},       {2, 5, green},
    {3, 5, green},       {4, 5, green},       {1, 6, green},       {2, 6, green},       {3, 6, green},
    {13, 9, green},      {14, 9, green},      {1, 10, green},      {2, 10, green},      {3, 10, green},
    {4, 10, green},      {14, 10, green},     {15, 10, green},     {2, 11, green},      {3, 11, green},
    {5, 11, green},      {13, 11, green},     {15, 11, green},     {1, 12, green},      {2, 12, green},
    {4, 12, green},      {5, 12, green},      {6, 12, green},      {13, 12, green},     {14, 12, green},
    {0, 13, green},      {1, 13, green},      {3, 13, green},      {4, 13, green},      {5, 13, green},
    {7, 13, green},      {13, 13, green},     {15, 13, green},     {0, 14, green},      {2, 14, green},
    {3, 14, green},      {5, 14, green},      {1, 15, green},      {2, 15, green},      {0, 0, darkgreen},
    {1, 1, darkgreen},   {2, 2, darkgreen},   {3, 3, darkgreen},   {8, 3, darkgreen},   {4, 4, darkgreen},
    {6, 4, darkgreen},   {7, 4, darkgreen},   {8, 4, darkgreen},   {5, 5, darkgreen},   {8, 5, darkgreen},
    {4, 6, darkgreen},   {3, 7, darkgreen},   {4, 7, darkgreen},   {12, 8, darkgreen},  {13, 8, darkgreen},
    {14, 8, darkgreen},  {15, 8, darkgreen},  {3, 9, darkgreen},   {4, 9, darkgreen},   {5, 9, darkgreen},
    {6, 9, darkgreen},   {11, 9, darkgreen},  {12, 9, darkgreen},  {5, 10, darkgreen},  {6, 10, darkgreen},
    {11, 10, darkgreen}, {12, 10, darkgreen}, {13, 10, darkgreen}, {4, 11, darkgreen},  {6, 11, darkgreen},
    {7, 11, darkgreen},  {11, 11, darkgreen}, {12, 11, darkgreen}, {14, 11, darkgreen}, {3, 12, darkgreen},
    {7, 12, darkgreen},  {12, 12, darkgreen}, {15, 12, darkgreen}, {2, 13, darkgreen},  {1, 14, darkgreen},
    {0, 15, darkgreen},  {6, 6, red},         {10, 6, red},        {6, 5, red},         {7, 5, red},
    {10, 5, red},        {11, 5, red},        {5, 6, red},         {7, 6, red},         {9, 6, red},
    {11, 6, red},        {5, 7, red},         {6, 7, red},         {7, 7, red},         {9, 7, red},
    {10, 7, red},        {11, 7, red},        {8, 8, red},         {7, 9, red},         {8, 9, red},
    {9, 9, red},         {8, 6, darkred},     {12, 6, darkred},    {8, 7, darkred},     {12, 7, darkred},
    {6, 8, darkred},     {7, 8, darkred},     {9, 8, darkred},     {10, 8, darkred},    {11, 8, darkred},
    {10, 9, darkred},    {7, 10, red},        {8, 10, red},        {9, 10, red},        {8, 11, darkred},
    {9, 11, darkred}};

const Pixel frame1[] = {{6, 6, white},   {10, 6, white},  {13, 1, yellow}, {12, 2, yellow},
                        {14, 2, yellow}, {13, 3, yellow}, {13, 2, gold}};

} // namespace

void holly()
{
  play_frames(TOTAL_FRAMES, DEFAULT_DELAY_MS,
              [](int frame)
              {
                // Draw the holly
                draw(frame0);

                // Make it shine
                if (frame % 2 == 1)
                {
                  draw(frame1);
                }
              });
}
