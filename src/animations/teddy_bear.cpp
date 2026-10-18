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
constexpr uint16_t darkbrown = rgb565(93, 41, 3);
constexpr uint16_t darkdarkbrown = rgb565(67, 36, 13);
constexpr uint16_t pink = rgb565(235, 179, 205);
constexpr uint16_t blue = rgb565(4, 43, 105);
constexpr uint16_t gold = rgb565(249, 199, 47);
constexpr uint16_t brown = rgb565(140, 82, 39);

constexpr int TOTAL_FRAMES = DEFAULT_TOTAL_FRAMES;

const Pixel frame0[] = {
    {3, 0, brown},       {4, 0, brown},       {10, 0, brown},        {11, 0, brown},      {2, 1, brown},
    {5, 1, brown},       {6, 1, brown},       {7, 1, brown},         {8, 1, brown},       {9, 1, brown},
    {12, 1, brown},      {2, 2, brown},       {3, 2, brown},         {4, 2, brown},       {5, 2, brown},
    {6, 2, brown},       {7, 2, brown},       {8, 2, brown},         {9, 2, brown},       {10, 2, brown},
    {12, 2, brown},      {2, 3, brown},       {3, 3, brown},         {4, 3, brown},       {6, 3, brown},
    {7, 3, brown},       {8, 3, brown},       {10, 3, brown},        {11, 3, brown},      {12, 3, brown},
    {3, 4, brown},       {4, 4, brown},       {5, 4, brown},         {9, 4, brown},       {10, 4, brown},
    {11, 4, brown},      {3, 5, brown},       {4, 5, brown},         {10, 5, brown},      {11, 5, brown},
    {4, 6, brown},       {5, 6, brown},       {9, 6, brown},         {10, 6, brown},      {3, 1, pink},
    {4, 1, pink},        {10, 1, pink},       {11, 1, pink},         {3, 2, pink},        {11, 2, pink},
    {5, 3, blue},        {9, 3, blue},        {7, 4, darkdarkbrown}, {6, 4, gold},        {8, 4, gold},
    {5, 5, gold},        {6, 5, gold},        {7, 5, gold},          {8, 5, gold},        {9, 5, gold},
    {6, 6, gold},        {7, 6, gold},        {8, 6, gold},          {3, 12, gold},       {4, 12, gold},
    {5, 12, gold},       {9, 12, gold},       {10, 12, gold},        {11, 12, gold},      {3, 13, gold},
    {4, 13, gold},       {5, 13, gold},       {9, 13, gold},         {10, 13, gold},      {11, 13, gold},
    {3, 14, gold},       {4, 14, gold},       {5, 14, gold},         {9, 14, gold},       {10, 14, gold},
    {11, 14, gold},      {3, 11, darkbrown},  {4, 11, darkbrown},    {5, 11, darkbrown},  {9, 11, darkbrown},
    {10, 11, darkbrown}, {11, 11, darkbrown}, {2, 12, darkbrown},    {6, 12, darkbrown},  {8, 12, darkbrown},
    {12, 12, darkbrown}, {2, 13, darkbrown},  {6, 13, darkbrown},    {8, 13, darkbrown},  {12, 13, darkbrown},
    {2, 14, darkbrown},  {6, 14, darkbrown},  {8, 14, darkbrown},    {12, 14, darkbrown}, {3, 15, darkbrown},
    {4, 15, darkbrown},  {5, 15, darkbrown},  {9, 15, darkbrown},    {10, 15, darkbrown}, {11, 15, darkbrown}};

const Pixel frame1[] = {
    {4, 7, brown},      {5, 7, brown},          {6, 7, brown},      {7, 7, brown},     {8, 7, brown},
    {9, 7, brown},      {10, 7, brown},         {5, 8, brown},      {6, 8, brown},     {7, 8, brown},
    {8, 8, brown},      {9, 8, brown},          {5, 9, brown},      {6, 9, brown},     {7, 9, brown},
    {8, 9, brown},      {9, 9, brown},          {4, 10, brown},     {5, 10, brown},    {6, 10, brown},
    {8, 10, brown},     {9, 10, brown},         {10, 10, brown},    {6, 11, brown},    {7, 11, brown},
    {8, 11, brown},     {7, 10, darkdarkbrown}, {3, 8, gold},       {11, 8, gold},     {3, 9, gold},
    {11, 9, gold},      {3, 7, darkbrown},      {11, 7, darkbrown}, {2, 8, darkbrown}, {4, 8, darkbrown},
    {10, 8, darkbrown}, {12, 8, darkbrown},     {2, 9, darkbrown},  {4, 9, darkbrown}, {10, 9, darkbrown},
    {12, 9, darkbrown}, {3, 10, darkbrown},     {11, 10, darkbrown}};

const Pixel frame2[] = {
    {5, 7, white},      {5, 6, red},        {9, 6, red},       {4, 7, red},        {6, 7, red},
    {8, 7, red},        {9, 7, red},        {10, 7, red},      {3, 8, red},        {4, 8, red},
    {5, 8, red},        {6, 8, red},        {7, 8, red},       {8, 8, red},        {9, 8, red},
    {10, 8, red},       {11, 8, red},       {4, 9, red},       {5, 9, red},        {6, 9, red},
    {7, 9, red},        {8, 9, red},        {9, 9, red},       {10, 9, red},       {5, 10, red},
    {6, 10, red},       {7, 10, red},       {8, 10, red},      {9, 10, red},       {6, 11, red},
    {7, 11, red},       {8, 11, red},       {7, 12, red},      {2, 7, brown},      {3, 7, brown},
    {7, 7, brown},      {11, 7, brown},     {12, 7, brown},    {3, 9, brown},      {11, 9, brown},
    {2, 10, brown},     {3, 10, brown},     {4, 10, brown},    {10, 10, brown},    {11, 10, brown},
    {12, 10, brown},    {1, 8, gold},       {13, 8, gold},     {1, 9, gold},       {13, 9, gold},
    {1, 7, darkbrown},  {13, 7, darkbrown}, {0, 8, darkbrown}, {2, 8, darkbrown},  {12, 8, darkbrown},
    {14, 8, darkbrown}, {0, 9, darkbrown},  {2, 9, darkbrown}, {12, 9, darkbrown}, {14, 9, darkbrown},
    {1, 10, darkbrown}, {13, 10, darkbrown}};

} // namespace

void teddy_bear()
{
  play_frames(TOTAL_FRAMES, DEFAULT_DELAY_MS,
              [](int frame)
              {
                // Draw the bear
                draw(frame0);

                // Move its arms and add the heart
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
