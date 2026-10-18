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
constexpr uint16_t pinkface = rgb565(249, 203, 203);
constexpr uint16_t cheek = rgb565(244, 99, 166);
constexpr uint16_t white = rgb565(255, 255, 255);
constexpr uint16_t blue = rgb565(4, 43, 105);
constexpr uint16_t lightgray = rgb565(200, 200, 200);

constexpr int TOTAL_FRAMES = DEFAULT_TOTAL_FRAMES;

const Pixel frame0[] = {
    {7, 0, red},         {8, 0, red},         {9, 0, red},         {10, 0, red},        {6, 1, red},
    {7, 1, red},         {8, 1, red},         {9, 1, red},         {10, 1, red},        {11, 1, red},
    {5, 2, red},         {6, 2, red},         {7, 2, red},         {8, 2, red},         {9, 2, red},
    {10, 2, red},        {11, 2, red},        {12, 2, red},        {4, 3, red},         {5, 3, red},
    {6, 3, red},         {7, 3, red},         {8, 3, red},         {9, 3, red},         {10, 3, red},
    {11, 3, red},        {12, 3, red},        {13, 3, red},        {3, 4, red},         {4, 4, red},
    {5, 4, red},         {3, 5, red},         {4, 5, red},         {3, 6, red},         {4, 6, red},
    {4, 7, red},         {9, 9, red},         {10, 9, red},        {8, 6, blue},        {11, 6, blue},
    {9, 5, pinkface},    {10, 5, pinkface},   {7, 6, pinkface},    {9, 6, pinkface},    {10, 6, pinkface},
    {12, 6, pinkface},   {6, 7, pinkface},    {9, 7, pinkface},    {10, 7, pinkface},   {13, 7, pinkface},
    {7, 7, cheek},       {8, 7, cheek},       {11, 7, cheek},      {12, 7, cheek},      {7, 8, cheek},
    {12, 8, cheek},      {6, 4, white},       {7, 4, white},       {8, 4, white},       {9, 4, white},
    {10, 4, white},      {11, 4, white},      {12, 4, white},      {13, 4, white},      {5, 5, white},
    {6, 5, white},       {7, 5, white},       {8, 5, white},       {9, 5, white},       {10, 5, white},
    {11, 5, white},      {12, 5, white},      {13, 5, white},      {14, 5, white},      {5, 6, white},
    {6, 6, white},       {13, 6, white},      {14, 6, white},      {2, 7, white},       {3, 7, white},
    {5, 7, white},       {14, 7, white},      {1, 8, white},       {2, 8, white},       {3, 8, white},
    {4, 8, white},       {6, 8, lightgray},   {8, 8, lightgray},   {9, 8, lightgray},   {10, 8, lightgray},
    {11, 8, lightgray},  {13, 8, lightgray},  {1, 9, white},       {2, 9, white},       {3, 9, white},
    {4, 9, white},       {5, 9, lightgray},   {6, 9, lightgray},   {7, 9, lightgray},   {8, 9, lightgray},
    {11, 9, lightgray},  {12, 9, lightgray},  {13, 9, lightgray},  {14, 9, lightgray},  {2, 10, white},
    {3, 10, white},      {5, 10, lightgray},  {6, 10, lightgray},  {7, 10, lightgray},  {8, 10, lightgray},
    {9, 10, lightgray},  {10, 10, lightgray}, {11, 10, lightgray}, {12, 10, lightgray}, {13, 10, lightgray},
    {14, 10, lightgray}, {5, 11, lightgray},  {6, 11, lightgray},  {7, 11, lightgray},  {8, 11, lightgray},
    {9, 11, lightgray},  {10, 11, lightgray}, {11, 11, lightgray}, {12, 11, lightgray}, {13, 11, lightgray},
    {14, 11, lightgray}, {6, 12, lightgray},  {7, 12, lightgray},  {8, 12, lightgray},  {9, 12, lightgray},
    {10, 12, lightgray}, {11, 12, lightgray}, {12, 12, lightgray}, {13, 12, lightgray}, {7, 13, lightgray},
    {8, 13, lightgray},  {9, 13, lightgray},  {10, 13, lightgray}, {11, 13, lightgray}, {12, 13, lightgray},
    {8, 14, lightgray},  {9, 14, lightgray},  {10, 14, lightgray}, {11, 14, lightgray}, {9, 15, lightgray},
    {10, 15, lightgray}};

const Pixel frame1[] = {{8, 9, red}, {11, 9, red}, {9, 10, red}, {10, 10, red}};

} // namespace

void santa()
{
  play_frames(TOTAL_FRAMES, DEFAULT_DELAY_MS,
              [](int frame)
              {
                // Draw Santa
                draw(frame0);

                // Draw smile
                if (frame % 2 == 1)
                {
                  draw(frame1);
                }
              });
}
