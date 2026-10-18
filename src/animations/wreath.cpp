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

constexpr int TOTAL_FRAMES = DEFAULT_TOTAL_FRAMES;

const Pixel frame0[] = {
    {5, 0, green},      {6, 0, green},       {7, 0, green},       {9, 0, green},       {10, 0, green},
    {3, 1, green},      {4, 1, green},       {5, 1, green},       {6, 1, green},       {8, 1, green},
    {9, 1, green},      {3, 2, green},       {4, 2, green},       {5, 2, green},       {7, 2, green},
    {8, 2, green},      {3, 3, green},       {4, 3, green},       {5, 3, green},       {7, 3, green},
    {12, 3, green},     {13, 3, green},      {14, 3, green},      {4, 4, green},       {5, 4, green},
    {10, 4, green},     {11, 4, green},      {12, 4, green},      {13, 4, green},      {14, 4, green},
    {0, 5, green},      {4, 5, green},       {11, 5, green},      {12, 5, green},      {13, 5, green},
    {14, 5, green},     {15, 5, green},      {0, 6, green},       {1, 6, green},       {14, 6, green},
    {15, 6, green},     {1, 7, green},       {2, 7, green},       {12, 7, green},      {13, 7, green},
    {15, 7, green},     {0, 8, green},       {2, 8, green},       {3, 8, green},       {13, 8, green},
    {14, 8, green},     {0, 9, green},       {1, 9, green},       {14, 9, green},      {15, 9, green},
    {0, 10, green},     {1, 10, green},      {2, 10, green},      {3, 10, green},      {4, 10, green},
    {11, 10, green},    {15, 10, green},     {1, 11, green},      {2, 11, green},      {3, 11, green},
    {4, 11, green},     {5, 11, green},      {10, 11, green},     {11, 11, green},     {1, 12, green},
    {2, 12, green},     {3, 12, green},      {8, 12, green},      {10, 12, green},     {11, 12, green},
    {12, 12, green},    {7, 13, green},      {8, 13, green},      {10, 13, green},     {11, 13, green},
    {12, 13, green},    {6, 14, green},      {7, 14, green},      {9, 14, green},      {10, 14, green},
    {11, 14, green},    {12, 14, green},     {5, 15, green},      {6, 15, green},      {8, 15, green},
    {9, 15, green},     {10, 15, green},     {8, 0, darkgreen},   {7, 1, darkgreen},   {2, 2, darkgreen},
    {6, 2, darkgreen},  {12, 2, darkgreen},  {13, 2, darkgreen},  {2, 3, darkgreen},   {6, 3, darkgreen},
    {10, 3, darkgreen}, {11, 3, darkgreen},  {3, 4, darkgreen},   {3, 5, darkgreen},   {12, 6, darkgreen},
    {13, 6, darkgreen}, {0, 7, darkgreen},   {14, 7, darkgreen},  {1, 8, darkgreen},   {15, 8, darkgreen},
    {2, 9, darkgreen},  {3, 9, darkgreen},   {12, 10, darkgreen}, {12, 11, darkgreen}, {4, 12, darkgreen},
    {5, 12, darkgreen}, {9, 12, darkgreen},  {13, 12, darkgreen}, {2, 13, darkgreen},  {3, 13, darkgreen},
    {9, 13, darkgreen}, {13, 13, darkgreen}, {8, 14, darkgreen},  {7, 15, darkgreen},  {10, 1, red},
    {11, 1, red},       {12, 1, red},        {9, 2, red},         {10, 2, red},        {11, 2, red},
    {8, 3, red},        {9, 3, red},         {1, 3, red},         {1, 4, red},         {2, 4, red},
    {1, 5, red},        {2, 5, red},         {2, 6, red},         {3, 6, red},         {3, 7, red},
    {12, 8, red},       {12, 9, red},        {13, 9, red},        {13, 10, red},       {14, 10, red},
    {13, 11, red},      {14, 11, red},       {6, 12, red},        {7, 12, red},        {14, 12, red},
    {4, 13, red},       {5, 13, red},        {6, 13, red},        {3, 14, red},        {4, 14, red},
    {5, 14, red}};

const Pixel frame1[] = {{7, 0, white},   {4, 1, white},  {9, 1, white},   {4, 4, white},
                        {11, 4, white},  {14, 4, white}, {1, 6, white},   {15, 7, white},
                        {0, 8, white},   {14, 9, white}, {1, 11, white},  {4, 11, white},
                        {11, 11, white}, {6, 14, white}, {11, 14, white}, {8, 15, white}};

} // namespace

void wreath()
{
  play_frames(TOTAL_FRAMES, DEFAULT_DELAY_MS,
              [](int frame)
              {
                // Draw the wreath
                draw(frame0);

                // Add the lights
                if (frame % 2 == 1)
                {
                  draw(frame1);
                }
              });
}
