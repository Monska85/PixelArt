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

#include <Adafruit_GFX.h>
#include <Adafruit_NeoMatrix.h>
#include <Adafruit_NeoPixel.h>

#ifndef PSTR
#define PSTR // Make Arduino Due happy
#endif

#define PIN_WS2812B 4
#define ROW_LEN 16
#define COL_LEN 16
#define NUM_PIXELS ROW_LEN *COL_LEN
#define BRIGHTNESS 100
#define DEFAULT_DELAY 500
#define DEFAULT_TOTAL_FRAME 9

struct Pixel
{
  int16_t x;
  int16_t y;
  uint16_t color;
};

Adafruit_NeoMatrix matrix = Adafruit_NeoMatrix(ROW_LEN, COL_LEN, PIN_WS2812B,
                                               NEO_MATRIX_TOP + NEO_MATRIX_LEFT +
                                                   NEO_MATRIX_COLUMNS + NEO_MATRIX_ZIGZAG,
                                               NEO_GRB + NEO_KHZ800);

void setup()
{
  Serial.begin(9600);
  matrix.begin();
  matrix.setBrightness(BRIGHTNESS);
}

void loop()
{
  xmas_tree();
  santa();
  ball();
  reindeer();
  snowman();
  wreath();
  penguin();
  snow_trees();
  snowflake();
  sleigh();
  holly();
  star();
  gingerbread_man();
  poinsettia();
  elf();
  jumping_reindeer();
  candy_cane();
  steaming_mug();
  snow_globe();
  open_gift();
  santa_hat();
  teddy_bear();
  bell();
  fireplace();
  panettone();
  candle();
  christmas_lights();
  pine_ball();
  santa_bag();
  bear();
}

void xmas_tree()
{
  int cur_frame = 0;
  int total_frame = 17;

  uint16_t yellow = matrix.Color(249, 199, 47);
  uint16_t green = matrix.Color(78, 176, 19);
  uint16_t red = matrix.Color(255, 0, 0);
  uint16_t purple = matrix.Color(193, 65, 242);

  Pixel frame0[] = {
      {7, 0, yellow}, {8, 0, yellow}, {6, 1, yellow}, {7, 1, yellow}, {8, 1, yellow}, {9, 1, yellow}, {7, 2, yellow}, {8, 2, yellow}, {6, 3, green}, {7, 3, green}, {8, 3, green}, {9, 3, green}, {6, 4, green}, {7, 4, green}, {8, 4, green}, {9, 4, green}, {5, 5, green}, {6, 5, green}, {7, 5, green}, {8, 5, green}, {9, 5, green}, {10, 5, green}, {5, 6, green}, {6, 6, green}, {7, 6, green}, {8, 6, green}, {9, 6, green}, {10, 6, green}, {4, 7, green}, {5, 7, green}, {6, 7, green}, {7, 7, green}, {8, 7, green}, {9, 7, green}, {10, 7, green}, {11, 7, green}, {4, 8, green}, {5, 8, green}, {6, 8, green}, {7, 8, green}, {8, 8, green}, {9, 8, green}, {10, 8, green}, {11, 8, green}, {3, 9, green}, {4, 9, green}, {5, 9, green}, {6, 9, green}, {7, 9, green}, {8, 9, green}, {9, 9, green}, {10, 9, green}, {11, 9, green}, {12, 9, green}, {3, 10, green}, {4, 10, green}, {5, 10, green}, {6, 10, green}, {7, 10, green}, {8, 10, green}, {9, 10, green}, {10, 10, green}, {11, 10, green}, {12, 10, green}, {2, 11, green}, {3, 11, green}, {4, 11, green}, {5, 11, green}, {6, 11, green}, {7, 11, green}, {8, 11, green}, {9, 11, green}, {10, 11, green}, {11, 11, green}, {12, 11, green}, {13, 11, green}, {2, 12, green}, {3, 12, green}, {4, 12, green}, {5, 12, green}, {6, 12, green}, {7, 12, green}, {8, 12, green}, {9, 12, green}, {10, 12, green}, {11, 12, green}, {12, 12, green}, {13, 12, green}, {1, 13, green}, {2, 13, green}, {3, 13, green}, {4, 13, green}, {5, 13, green}, {6, 13, green}, {7, 13, green}, {8, 13, green}, {9, 13, green}, {10, 13, green}, {11, 13, green}, {12, 13, green}, {13, 13, green}, {14, 13, green}, {1, 14, green}, {2, 14, green}, {3, 14, green}, {4, 14, green}, {5, 14, green}, {6, 14, green}, {7, 14, green}, {8, 14, green}, {9, 14, green}, {10, 14, green}, {11, 14, green}, {12, 14, green}, {13, 14, green}, {14, 14, green}, {0, 15, green}, {1, 15, green}, {2, 15, green}, {3, 15, green}, {4, 15, green}, {5, 15, green}, {6, 15, green}, {7, 15, green}, {8, 15, green}, {9, 15, green}, {10, 15, green}, {11, 15, green}, {12, 15, green}, {13, 15, green}, {14, 15, green}, {15, 15, green}};

  Pixel frame1[] = {
      {8, 3, red}, {6, 5, red}, {4, 7, red}, {9, 7, red}, {6, 9, red}, {12, 9, red}, {4, 11, red}, {10, 11, red}, {7, 12, red}, {5, 13, red}, {11, 13, red}, {1, 14, red}, {13, 14, red}, {3, 15, red}, {8, 15, red}};

  Pixel frame2[] = {
      {7, 3, purple}, {9, 5, purple}, {6, 7, purple}, {11, 7, purple}, {3, 9, purple}, {9, 9, purple}, {5, 11, purple}, {11, 11, purple}, {8, 12, purple}, {4, 13, purple}, {10, 13, purple}, {2, 14, purple}, {14, 14, purple}, {7, 15, purple}, {12, 15, purple}};

  for (int cur_frame = 0; cur_frame < total_frame; cur_frame++)
  {
    matrix.fillScreen(0);

    // Draw the tree
    set_up_matrix(&matrix, frame0, sizeof(frame0) / sizeof(Pixel));

    // Add the balls
    if (cur_frame % 4 == 1)
    {
      set_up_matrix(&matrix, frame1, sizeof(frame1) / sizeof(Pixel));
    }
    else if (cur_frame % 4 == 3)
    {
      set_up_matrix(&matrix, frame2, sizeof(frame2) / sizeof(Pixel));
    }

    matrix.show();
    delay(DEFAULT_DELAY);
  }
}

void santa()
{
  int cur_frame = 0;
  int total_frame = DEFAULT_TOTAL_FRAME;

  uint16_t red = matrix.Color(255, 0, 0);
  uint16_t pinkface = matrix.Color(249, 203, 203);
  uint16_t cheek = matrix.Color(244, 99, 166);
  uint16_t white = matrix.Color(255, 255, 255);
  uint16_t blue = matrix.Color(4, 43, 105);
  uint16_t lightgray = matrix.Color(200, 200, 200);

  Pixel frame0[] = {
      {7, 0, red}, {8, 0, red}, {9, 0, red}, {10, 0, red}, {6, 1, red}, {7, 1, red}, {8, 1, red}, {9, 1, red}, {10, 1, red}, {11, 1, red}, {5, 2, red}, {6, 2, red}, {7, 2, red}, {8, 2, red}, {9, 2, red}, {10, 2, red}, {11, 2, red}, {12, 2, red}, {4, 3, red}, {5, 3, red}, {6, 3, red}, {7, 3, red}, {8, 3, red}, {9, 3, red}, {10, 3, red}, {11, 3, red}, {12, 3, red}, {13, 3, red}, {3, 4, red}, {4, 4, red}, {5, 4, red}, {3, 5, red}, {4, 5, red}, {3, 6, red}, {4, 6, red}, {4, 7, red}, {9, 9, red}, {10, 9, red}, {8, 6, blue}, {11, 6, blue}, {9, 5, pinkface}, {10, 5, pinkface}, {7, 6, pinkface}, {9, 6, pinkface}, {10, 6, pinkface}, {12, 6, pinkface}, {6, 7, pinkface}, {9, 7, pinkface}, {10, 7, pinkface}, {13, 7, pinkface}, {7, 7, cheek}, {8, 7, cheek}, {11, 7, cheek}, {12, 7, cheek}, {7, 8, cheek}, {12, 8, cheek}, {6, 4, white}, {7, 4, white}, {8, 4, white}, {9, 4, white}, {10, 4, white}, {11, 4, white}, {12, 4, white}, {13, 4, white}, {5, 5, white}, {6, 5, white}, {7, 5, white}, {8, 5, white}, {9, 5, white}, {10, 5, white}, {11, 5, white}, {12, 5, white}, {13, 5, white}, {14, 5, white}, {5, 6, white}, {6, 6, white}, {13, 6, white}, {14, 6, white}, {2, 7, white}, {3, 7, white}, {5, 7, white}, {14, 7, white}, {1, 8, white}, {2, 8, white}, {3, 8, white}, {4, 8, white}, {6, 8, lightgray}, {8, 8, lightgray}, {9, 8, lightgray}, {10, 8, lightgray}, {11, 8, lightgray}, {13, 8, lightgray}, {1, 9, white}, {2, 9, white}, {3, 9, white}, {4, 9, white}, {5, 9, lightgray}, {6, 9, lightgray}, {7, 9, lightgray}, {8, 9, lightgray}, {11, 9, lightgray}, {12, 9, lightgray}, {13, 9, lightgray}, {14, 9, lightgray}, {2, 10, white}, {3, 10, white}, {5, 10, lightgray}, {6, 10, lightgray}, {7, 10, lightgray}, {8, 10, lightgray}, {9, 10, lightgray}, {10, 10, lightgray}, {11, 10, lightgray}, {12, 10, lightgray}, {13, 10, lightgray}, {14, 10, lightgray}, {5, 11, lightgray}, {6, 11, lightgray}, {7, 11, lightgray}, {8, 11, lightgray}, {9, 11, lightgray}, {10, 11, lightgray}, {11, 11, lightgray}, {12, 11, lightgray}, {13, 11, lightgray}, {14, 11, lightgray}, {6, 12, lightgray}, {7, 12, lightgray}, {8, 12, lightgray}, {9, 12, lightgray}, {10, 12, lightgray}, {11, 12, lightgray}, {12, 12, lightgray}, {13, 12, lightgray}, {7, 13, lightgray}, {8, 13, lightgray}, {9, 13, lightgray}, {10, 13, lightgray}, {11, 13, lightgray}, {12, 13, lightgray}, {8, 14, lightgray}, {9, 14, lightgray}, {10, 14, lightgray}, {11, 14, lightgray}, {9, 15, lightgray}, {10, 15, lightgray}};

  Pixel frame1[] = {
      {8, 9, red}, {11, 9, red}, {9, 10, red}, {10, 10, red}};

  for (int cur_frame = 0; cur_frame < total_frame; cur_frame++)
  {
    matrix.fillScreen(0);

    // Draw Santa
    set_up_matrix(&matrix, frame0, sizeof(frame0) / sizeof(Pixel));

    // Draw smile
    if (cur_frame % 2 == 1)
    {
      set_up_matrix(&matrix, frame1, sizeof(frame1) / sizeof(Pixel));
    }

    matrix.show();
    delay(DEFAULT_DELAY);
  }
}

void snowman()
{
  int cur_frame = 0;
  int total_frame = DEFAULT_TOTAL_FRAME;

  uint16_t teal = matrix.Color(6, 159, 132);
  uint16_t dark_teal = matrix.Color(2, 93, 77);
  uint16_t red = matrix.Color(255, 0, 0);
  uint16_t orange = matrix.Color(255, 153, 0);
  uint16_t brown = matrix.Color(140, 82, 39);
  uint16_t white = matrix.Color(255, 255, 255);
  uint16_t blue = matrix.Color(4, 43, 105);

  Pixel frame0[] = {
      {5, 0, teal}, {6, 0, teal}, {7, 0, teal}, {8, 0, teal}, {9, 0, teal}, {4, 2, teal}, {5, 2, teal}, {6, 2, teal}, {7, 2, teal}, {8, 2, teal}, {9, 2, teal}, {10, 2, teal}, {7, 9, teal}, {7, 11, teal}, {7, 13, teal}, {5, 1, dark_teal}, {6, 1, dark_teal}, {7, 1, dark_teal}, {8, 1, dark_teal}, {9, 1, dark_teal}, {8, 5, orange}, {9, 5, orange}, {10, 5, orange}, {6, 4, blue}, {8, 4, blue}, {5, 7, red}, {6, 7, red}, {7, 7, red}, {8, 7, red}, {9, 7, red}, {5, 8, red}, {5, 9, red}, {5, 10, red}, {4, 11, red}, {5, 11, red}, {5, 3, white}, {6, 3, white}, {7, 3, white}, {8, 3, white}, {9, 3, white}, {5, 4, white}, {7, 4, white}, {9, 4, white}, {5, 5, white}, {6, 5, white}, {7, 5, white}, {5, 6, white}, {6, 6, white}, {7, 6, white}, {8, 6, white}, {9, 6, white}, {4, 8, white}, {6, 8, white}, {7, 8, white}, {8, 8, white}, {9, 8, white}, {10, 8, white}, {4, 9, white}, {6, 9, white}, {8, 9, white}, {9, 9, white}, {10, 9, white}, {3, 10, white}, {4, 10, white}, {6, 10, white}, {7, 10, white}, {8, 10, white}, {9, 10, white}, {10, 10, white}, {11, 10, white}, {3, 11, white}, {6, 11, white}, {8, 11, white}, {9, 11, white}, {10, 11, white}, {11, 11, white}, {3, 12, white}, {4, 12, white}, {5, 12, white}, {6, 12, white}, {7, 12, white}, {8, 12, white}, {9, 12, white}, {10, 12, white}, {11, 12, white}, {3, 13, white}, {4, 13, white}, {5, 13, white}, {6, 13, white}, {8, 13, white}, {9, 13, white}, {10, 13, white}, {11, 13, white}, {4, 14, white}, {5, 14, white}, {6, 14, white}, {7, 14, white}, {8, 14, white}, {9, 14, white}, {10, 14, white}, {5, 15, white}, {6, 15, white}, {7, 15, white}, {8, 15, white}, {9, 15, white}, {3, 9, brown}, {11, 9, brown}};

  Pixel frame1[] = {
      {0, 12, brown}, {1, 11, brown}, {2, 10, brown}, {12, 10, brown}, {13, 11, brown}, {14, 12, brown}};

  Pixel frame2[] = {
      {0, 6, brown}, {1, 7, brown}, {2, 8, brown}, {12, 8, brown}, {13, 7, brown}, {14, 6, brown}};

  for (int cur_frame = 0; cur_frame < total_frame; cur_frame++)
  {
    matrix.fillScreen(0);

    // Draw the snowman
    set_up_matrix(&matrix, frame0, sizeof(frame0) / sizeof(Pixel));

    // Draw arms
    if (cur_frame % 2 == 1)
    {
      set_up_matrix(&matrix, frame1, sizeof(frame1) / sizeof(Pixel));
    }
    else
    {
      set_up_matrix(&matrix, frame2, sizeof(frame2) / sizeof(Pixel));
    }

    matrix.show();
    delay(DEFAULT_DELAY);
  }
}

void reindeer()
{
  int cur_frame = 0;
  int total_frame = DEFAULT_TOTAL_FRAME;

  uint16_t gold = matrix.Color(191, 144, 0);
  uint16_t yellow = matrix.Color(249, 199, 47);
  uint16_t red = matrix.Color(255, 0, 0);
  uint16_t darkred = matrix.Color(152, 0, 0);
  uint16_t brown = matrix.Color(140, 82, 39);
  uint16_t cheek = matrix.Color(235, 179, 205);
  uint16_t white = matrix.Color(255, 255, 255);
  uint16_t blue = matrix.Color(4, 43, 105);

  Pixel frame0[] = {
      {7, 13, darkred}, {8, 13, darkred}, {7, 14, darkred}, {8, 14, darkred}, {4, 0, gold}, {11, 0, gold}, {1, 1, gold}, {4, 1, gold}, {11, 1, gold}, {14, 1, gold}, {2, 2, gold}, {4, 2, gold}, {11, 2, gold}, {13, 2, gold}, {1, 3, gold}, {2, 3, gold}, {3, 3, gold}, {4, 3, gold}, {6, 3, gold}, {9, 3, gold}, {11, 3, gold}, {12, 3, gold}, {13, 3, gold}, {14, 3, gold}, {4, 4, gold}, {5, 4, gold}, {6, 4, gold}, {9, 4, gold}, {10, 4, gold}, {11, 4, gold}, {6, 5, gold}, {9, 5, gold}, {6, 6, gold}, {9, 6, gold}, {1, 7, cheek}, {14, 7, cheek}, {2, 8, cheek}, {3, 8, cheek}, {12, 8, cheek}, {13, 8, cheek}, {1, 6, brown}, {14, 6, brown}, {2, 7, brown}, {3, 7, brown}, {4, 7, brown}, {5, 7, brown}, {6, 7, brown}, {7, 7, brown}, {8, 7, brown}, {9, 7, brown}, {10, 7, brown}, {11, 7, brown}, {12, 7, brown}, {13, 7, brown}, {4, 8, brown}, {5, 8, brown}, {6, 8, brown}, {7, 8, brown}, {8, 8, brown}, {9, 8, brown}, {10, 8, brown}, {11, 8, brown}, {4, 9, brown}, {5, 9, brown}, {6, 9, brown}, {7, 9, brown}, {8, 9, brown}, {9, 9, brown}, {10, 9, brown}, {11, 9, brown}, {4, 10, brown}, {5, 10, brown}, {7, 10, brown}, {8, 10, brown}, {10, 10, brown}, {11, 10, brown}, {4, 11, brown}, {5, 11, brown}, {7, 11, brown}, {8, 11, brown}, {10, 11, brown}, {11, 11, brown}, {4, 12, brown}, {5, 12, brown}, {6, 12, brown}, {7, 12, brown}, {8, 12, brown}, {9, 12, brown}, {10, 12, brown}, {11, 12, brown}, {4, 13, brown}, {5, 13, brown}, {6, 13, brown}, {9, 13, brown}, {10, 13, brown}, {11, 13, brown}, {5, 14, brown}, {6, 14, brown}, {9, 14, brown}, {10, 14, brown}, {5, 15, brown}, {6, 15, brown}, {7, 15, brown}, {8, 15, brown}, {9, 15, brown}, {10, 15, brown}, {6, 10, blue}, {9, 10, blue}, {6, 11, blue}, {9, 11, blue}};

  Pixel frame1[] = {
      {7, 13, white}, {8, 13, red}, {7, 14, red}, {8, 14, red}, {4, 0, yellow}, {11, 0, yellow}, {1, 1, yellow}, {4, 1, yellow}, {11, 1, yellow}, {14, 1, yellow}, {2, 2, yellow}, {4, 2, yellow}, {11, 2, yellow}, {13, 2, yellow}, {1, 3, yellow}, {2, 3, yellow}, {3, 3, yellow}, {4, 3, yellow}, {6, 3, yellow}, {9, 3, yellow}, {11, 3, yellow}, {12, 3, yellow}, {13, 3, yellow}, {14, 3, yellow}, {4, 4, yellow}, {5, 4, yellow}, {6, 4, yellow}, {9, 4, yellow}, {10, 4, yellow}, {11, 4, yellow}, {6, 5, yellow}, {9, 5, yellow}, {6, 6, yellow}, {9, 6, yellow}};

  for (int cur_frame = 0; cur_frame < total_frame; cur_frame++)
  {
    matrix.fillScreen(0);

    // Draw the reindeer
    set_up_matrix(&matrix, frame0, sizeof(frame0) / sizeof(Pixel));

    // Make the nose and antlers shiny
    if (cur_frame % 2 == 1)
    {
      set_up_matrix(&matrix, frame1, sizeof(frame1) / sizeof(Pixel));
    }

    matrix.show();
    delay(DEFAULT_DELAY);
  }
}

void ball()
{
  int cur_frame = 0;
  int total_frame = 12;

  uint16_t gold = matrix.Color(191, 144, 0);
  uint16_t teal = matrix.Color(6, 159, 132);
  uint16_t red = matrix.Color(255, 0, 0);
  uint16_t white = matrix.Color(255, 255, 255);

  Pixel frame0[] = {
      {7, 0, gold}, {8, 0, gold}, {7, 1, gold}, {8, 1, gold}, {6, 2, gold}, {7, 2, gold}, {8, 2, gold}, {9, 2, gold}, {6, 3, gold}, {7, 3, gold}, {8, 3, gold}, {9, 3, gold}, {5, 4, teal}, {6, 4, teal}, {7, 4, teal}, {8, 4, teal}, {9, 4, teal}, {10, 4, teal}, {4, 5, teal}, {5, 5, teal}, {6, 5, teal}, {7, 5, teal}, {8, 5, teal}, {9, 5, teal}, {10, 5, teal}, {11, 5, teal}, {3, 6, teal}, {4, 6, teal}, {5, 6, teal}, {6, 6, teal}, {7, 6, teal}, {8, 6, teal}, {9, 6, teal}, {10, 6, teal}, {11, 6, teal}, {12, 6, teal}, {3, 7, teal}, {4, 7, teal}, {5, 7, teal}, {7, 7, teal}, {8, 7, teal}, {9, 7, teal}, {11, 7, teal}, {12, 7, teal}, {13, 7, teal}, {4, 8, teal}, {8, 8, teal}, {12, 8, teal}, {2, 11, teal}, {6, 11, teal}, {10, 11, teal}, {2, 12, teal}, {3, 12, teal}, {5, 12, teal}, {6, 12, teal}, {7, 12, teal}, {9, 12, teal}, {10, 12, teal}, {11, 12, teal}, {13, 12, teal}, {3, 13, teal}, {4, 13, teal}, {5, 13, teal}, {6, 13, teal}, {7, 13, teal}, {8, 13, teal}, {9, 13, teal}, {10, 13, teal}, {11, 13, teal}, {12, 13, teal}, {4, 14, teal}, {5, 14, teal}, {6, 14, teal}, {7, 14, teal}, {8, 14, teal}, {9, 14, teal}, {10, 14, teal}, {11, 14, teal}, {5, 15, teal}, {6, 15, teal}, {7, 15, teal}, {8, 15, teal}, {9, 15, teal}, {10, 15, teal}, {2, 7, white}, {6, 7, white}, {10, 7, white}, {3, 8, white}, {5, 8, white}, {7, 8, white}, {9, 8, white}, {11, 8, white}, {13, 8, white}, {4, 9, white}, {8, 9, white}, {12, 9, white}, {2, 10, white}, {6, 10, white}, {10, 10, white}, {3, 11, white}, {5, 11, white}, {7, 11, white}, {9, 11, white}, {11, 11, white}, {13, 11, white}, {4, 12, white}, {8, 12, white}, {12, 12, white}, {2, 8, red}, {6, 8, red}, {10, 8, red}, {2, 9, red}, {3, 9, red}, {5, 9, red}, {6, 9, red}, {7, 9, red}, {9, 9, red}, {10, 9, red}, {11, 9, red}, {13, 9, red}, {3, 10, red}, {4, 10, red}, {5, 10, red}, {7, 10, red}, {8, 10, red}, {9, 10, red}, {11, 10, red}, {12, 10, red}, {13, 10, red}, {4, 11, red}, {8, 11, red}, {12, 11, red}};

  Pixel frame1[] = {
      {2, 7, teal}, {3, 7, white}, {4, 7, teal}, {5, 7, teal}, {6, 7, teal}, {7, 7, white}, {8, 7, teal}, {9, 7, teal}, {10, 7, teal}, {11, 7, white}, {12, 7, teal}, {13, 7, teal}, {2, 8, white}, {3, 8, red}, {4, 8, white}, {5, 8, teal}, {6, 8, white}, {7, 8, red}, {8, 8, white}, {9, 8, teal}, {10, 8, white}, {11, 8, red}, {12, 8, white}, {13, 8, teal}, {2, 9, red}, {3, 9, red}, {4, 9, red}, {5, 9, white}, {6, 9, red}, {7, 9, red}, {8, 9, red}, {9, 9, white}, {10, 9, red}, {11, 9, red}, {12, 9, red}, {13, 9, white}, {2, 10, red}, {3, 10, white}, {4, 10, red}, {5, 10, red}, {6, 10, red}, {7, 10, white}, {8, 10, red}, {9, 10, red}, {10, 10, red}, {11, 10, white}, {12, 10, red}, {13, 10, red}, {2, 11, white}, {3, 11, teal}, {4, 11, white}, {5, 11, red}, {6, 11, white}, {7, 11, teal}, {8, 11, white}, {9, 11, red}, {10, 11, white}, {11, 11, teal}, {12, 11, white}, {13, 11, red}, {2, 12, teal}, {3, 12, teal}, {4, 12, teal}, {5, 12, white}, {6, 12, teal}, {7, 12, teal}, {8, 12, teal}, {9, 12, white}, {10, 12, teal}, {11, 12, teal}, {12, 12, teal}, {13, 12, white}};

  Pixel frame2[] = {
      {2, 7, teal}, {3, 7, teal}, {4, 7, white}, {5, 7, teal}, {6, 7, teal}, {7, 7, teal}, {8, 7, white}, {9, 7, teal}, {10, 7, teal}, {11, 7, teal}, {12, 7, white}, {13, 7, teal}, {2, 8, teal}, {3, 8, white}, {4, 8, red}, {5, 8, white}, {6, 8, teal}, {7, 8, white}, {8, 8, red}, {9, 8, white}, {10, 8, teal}, {11, 8, white}, {12, 8, red}, {13, 8, white}, {2, 9, white}, {3, 9, red}, {4, 9, red}, {5, 9, red}, {6, 9, white}, {7, 9, red}, {8, 9, red}, {9, 9, red}, {10, 9, white}, {11, 9, red}, {12, 9, red}, {13, 9, red}, {2, 10, red}, {3, 10, red}, {4, 10, white}, {5, 10, red}, {6, 10, red}, {7, 10, red}, {8, 10, white}, {9, 10, red}, {10, 10, red}, {11, 10, red}, {12, 10, white}, {13, 10, red}, {2, 11, red}, {3, 11, white}, {4, 11, teal}, {5, 11, white}, {6, 11, red}, {7, 11, white}, {8, 11, teal}, {9, 11, white}, {10, 11, red}, {11, 11, white}, {12, 11, teal}, {13, 11, white}, {2, 12, white}, {3, 12, teal}, {4, 12, teal}, {5, 12, teal}, {6, 12, white}, {7, 12, teal}, {8, 12, teal}, {9, 12, teal}, {10, 12, white}, {11, 12, teal}, {12, 12, teal}, {13, 12, teal}};

  Pixel frame3[] = {
      {2, 7, teal}, {3, 7, teal}, {4, 7, teal}, {5, 7, white}, {6, 7, teal}, {7, 7, teal}, {8, 7, teal}, {9, 7, white}, {10, 7, teal}, {11, 7, teal}, {12, 7, teal}, {13, 7, white}, {2, 8, white}, {3, 8, teal}, {4, 8, white}, {5, 8, red}, {6, 8, white}, {7, 8, teal}, {8, 8, white}, {9, 8, red}, {10, 8, white}, {11, 8, teal}, {12, 8, white}, {13, 8, red}, {2, 9, red}, {3, 9, white}, {4, 9, red}, {5, 9, red}, {6, 9, red}, {7, 9, white}, {8, 9, red}, {9, 9, red}, {10, 9, red}, {11, 9, white}, {12, 9, red}, {13, 9, red}, {2, 10, red}, {3, 10, red}, {4, 10, red}, {5, 10, white}, {6, 10, red}, {7, 10, red}, {8, 10, red}, {9, 10, white}, {10, 10, red}, {11, 10, red}, {12, 10, red}, {13, 10, white}, {2, 11, white}, {3, 11, red}, {4, 11, white}, {5, 11, teal}, {6, 11, white}, {7, 11, red}, {8, 11, white}, {9, 11, teal}, {10, 11, white}, {11, 11, red}, {12, 11, white}, {13, 11, teal}, {2, 12, teal}, {3, 12, white}, {4, 12, teal}, {5, 12, teal}, {6, 12, teal}, {7, 12, white}, {8, 12, teal}, {9, 12, teal}, {10, 12, teal}, {11, 12, white}, {12, 12, teal}, {13, 12, teal}};

  for (int cur_frame = 0; cur_frame < total_frame; cur_frame++)
  {
    matrix.fillScreen(0);

    // Draw the ball
    set_up_matrix(&matrix, frame0, sizeof(frame0) / sizeof(Pixel));

    // Make it turn
    if (cur_frame % 4 == 1)
    {
      set_up_matrix(&matrix, frame1, sizeof(frame1) / sizeof(Pixel));
    }
    else if (cur_frame % 4 == 2)
    {
      set_up_matrix(&matrix, frame2, sizeof(frame2) / sizeof(Pixel));
    }
    else if (cur_frame % 4 == 3)
    {
      set_up_matrix(&matrix, frame3, sizeof(frame3) / sizeof(Pixel));
    }

    matrix.show();
    delay(DEFAULT_DELAY);
  }
}

void wreath()
{
  int cur_frame = 0;
  int total_frame = DEFAULT_TOTAL_FRAME;

  uint16_t white = matrix.Color(255, 255, 255);
  uint16_t red = matrix.Color(255, 0, 0);
  uint16_t green = matrix.Color(78, 176, 19);
  uint16_t darkgreen = matrix.Color(2, 93, 77);

  Pixel frame0[] = {
      {5, 0, green}, {6, 0, green}, {7, 0, green}, {9, 0, green}, {10, 0, green}, {3, 1, green}, {4, 1, green}, {5, 1, green}, {6, 1, green}, {8, 1, green}, {9, 1, green}, {3, 2, green}, {4, 2, green}, {5, 2, green}, {7, 2, green}, {8, 2, green}, {3, 3, green}, {4, 3, green}, {5, 3, green}, {7, 3, green}, {12, 3, green}, {13, 3, green}, {14, 3, green}, {4, 4, green}, {5, 4, green}, {10, 4, green}, {11, 4, green}, {12, 4, green}, {13, 4, green}, {14, 4, green}, {0, 5, green}, {4, 5, green}, {11, 5, green}, {12, 5, green}, {13, 5, green}, {14, 5, green}, {15, 5, green}, {0, 6, green}, {1, 6, green}, {14, 6, green}, {15, 6, green}, {1, 7, green}, {2, 7, green}, {12, 7, green}, {13, 7, green}, {15, 7, green}, {0, 8, green}, {2, 8, green}, {3, 8, green}, {13, 8, green}, {14, 8, green}, {0, 9, green}, {1, 9, green}, {14, 9, green}, {15, 9, green}, {0, 10, green}, {1, 10, green}, {2, 10, green}, {3, 10, green}, {4, 10, green}, {11, 10, green}, {15, 10, green}, {1, 11, green}, {2, 11, green}, {3, 11, green}, {4, 11, green}, {5, 11, green}, {10, 11, green}, {11, 11, green}, {1, 12, green}, {2, 12, green}, {3, 12, green}, {8, 12, green}, {10, 12, green}, {11, 12, green}, {12, 12, green}, {7, 13, green}, {8, 13, green}, {10, 13, green}, {11, 13, green}, {12, 13, green}, {6, 14, green}, {7, 14, green}, {9, 14, green}, {10, 14, green}, {11, 14, green}, {12, 14, green}, {5, 15, green}, {6, 15, green}, {8, 15, green}, {9, 15, green}, {10, 15, green}, {8, 0, darkgreen}, {7, 1, darkgreen}, {2, 2, darkgreen}, {6, 2, darkgreen}, {12, 2, darkgreen}, {13, 2, darkgreen}, {2, 3, darkgreen}, {6, 3, darkgreen}, {10, 3, darkgreen}, {11, 3, darkgreen}, {3, 4, darkgreen}, {3, 5, darkgreen}, {12, 6, darkgreen}, {13, 6, darkgreen}, {0, 7, darkgreen}, {14, 7, darkgreen}, {1, 8, darkgreen}, {15, 8, darkgreen}, {2, 9, darkgreen}, {3, 9, darkgreen}, {12, 10, darkgreen}, {12, 11, darkgreen}, {4, 12, darkgreen}, {5, 12, darkgreen}, {9, 12, darkgreen}, {13, 12, darkgreen}, {2, 13, darkgreen}, {3, 13, darkgreen}, {9, 13, darkgreen}, {13, 13, darkgreen}, {8, 14, darkgreen}, {7, 15, darkgreen}, {10, 1, red}, {11, 1, red}, {12, 1, red}, {9, 2, red}, {10, 2, red}, {11, 2, red}, {8, 3, red}, {9, 3, red}, {1, 3, red}, {1, 4, red}, {2, 4, red}, {1, 5, red}, {2, 5, red}, {2, 6, red}, {3, 6, red}, {3, 7, red}, {12, 8, red}, {12, 9, red}, {13, 9, red}, {13, 10, red}, {14, 10, red}, {13, 11, red}, {14, 11, red}, {6, 12, red}, {7, 12, red}, {14, 12, red}, {4, 13, red}, {5, 13, red}, {6, 13, red}, {3, 14, red}, {4, 14, red}, {5, 14, red}};

  Pixel frame1[] = {
      {7, 0, white}, {4, 1, white}, {9, 1, white}, {4, 4, white}, {11, 4, white}, {14, 4, white}, {1, 6, white}, {15, 7, white}, {0, 8, white}, {14, 9, white}, {1, 11, white}, {4, 11, white}, {11, 11, white}, {6, 14, white}, {11, 14, white}, {8, 15, white}};

  for (int cur_frame = 0; cur_frame < total_frame; cur_frame++)
  {
    matrix.fillScreen(0);

    // Draw the wreath
    set_up_matrix(&matrix, frame0, sizeof(frame0) / sizeof(Pixel));

    // Add the lights
    if (cur_frame % 2 == 1)
    {
      set_up_matrix(&matrix, frame1, sizeof(frame1) / sizeof(Pixel));
    }

    matrix.show();
    delay(DEFAULT_DELAY);
  }
}

void penguin()
{
  int cur_frame = 0;
  int total_frame = DEFAULT_TOTAL_FRAME;

  uint16_t red = matrix.Color(255, 0, 0);
  uint16_t white = matrix.Color(255, 255, 255);
  uint16_t blue = matrix.Color(4, 43, 105);
  uint16_t orange = matrix.Color(255, 153, 0);
  uint16_t pink = matrix.Color(255, 0, 255);

  Pixel frame0[] = {
      {4, 1, red}, {3, 2, red}, {4, 2, red}, {5, 2, red}, {6, 2, red}, {7, 2, red}, {3, 3, red}, {4, 3, red}, {5, 3, red}, {6, 3, red}, {7, 3, red}, {8, 3, red}, {9, 3, red}, {10, 3, red}, {11, 3, red}, {3, 4, red}, {4, 4, red}, {5, 4, red}, {2, 5, red}, {3, 5, red}, {2, 6, red}, {1, 7, red}, {5, 6, blue}, {6, 6, blue}, {7, 6, blue}, {8, 6, blue}, {9, 6, blue}, {10, 6, blue}, {11, 6, blue}, {12, 6, blue}, {4, 7, blue}, {8, 7, blue}, {12, 7, blue}, {13, 7, blue}, {3, 8, blue}, {13, 8, blue}, {14, 8, blue}, {2, 9, blue}, {6, 9, blue}, {10, 9, blue}, {14, 9, blue}, {2, 10, blue}, {14, 10, blue}, {2, 11, blue}, {14, 11, blue}, {2, 12, blue}, {13, 12, blue}, {3, 13, blue}, {4, 13, blue}, {12, 13, blue}, {4, 14, blue}, {5, 14, blue}, {10, 14, blue}, {11, 14, blue}, {2, 15, blue}, {3, 15, blue}, {4, 15, blue}, {5, 15, blue}, {11, 15, blue}, {12, 15, blue}, {13, 15, blue}, {2, 0, white}, {3, 0, white}, {2, 1, white}, {3, 1, white}, {6, 4, white}, {7, 4, white}, {8, 4, white}, {9, 4, white}, {10, 4, white}, {4, 5, white}, {5, 5, white}, {6, 5, white}, {7, 5, white}, {8, 5, white}, {9, 5, white}, {10, 5, white}, {11, 5, white}, {12, 5, white}, {13, 5, white}, {3, 6, white}, {4, 6, white}, {13, 6, white}, {14, 6, white}, {2, 7, white}, {3, 7, white}, {5, 7, white}, {6, 7, white}, {7, 7, white}, {9, 7, white}, {10, 7, white}, {11, 7, white}, {14, 7, white}, {1, 8, white}, {2, 8, white}, {4, 8, white}, {5, 8, white}, {6, 8, white}, {7, 8, white}, {8, 8, white}, {9, 8, white}, {10, 8, white}, {11, 8, white}, {12, 8, white}, {1, 9, white}, {3, 9, white}, {4, 9, white}, {5, 9, white}, {7, 9, white}, {8, 9, white}, {9, 9, white}, {11, 9, white}, {12, 9, white}, {13, 9, white}, {3, 10, white}, {4, 10, white}, {5, 10, white}, {6, 10, white}, {7, 10, white}, {8, 10, white}, {9, 10, white}, {10, 10, white}, {11, 10, white}, {12, 10, white}, {13, 10, white}, {3, 11, white}, {4, 11, white}, {5, 11, white}, {11, 11, white}, {12, 11, white}, {13, 11, white}, {3, 12, white}, {4, 12, white}, {5, 12, white}, {6, 12, white}, {10, 12, white}, {11, 12, white}, {12, 12, white}, {5, 13, white}, {6, 13, white}, {7, 13, white}, {9, 13, white}, {10, 13, white}, {11, 13, white}, {6, 14, white}, {7, 14, white}, {8, 14, white}, {9, 14, white}, {6, 14, white}, {6, 15, white}, {7, 15, white}, {8, 15, white}, {9, 15, white}, {10, 15, white}, {6, 11, orange}, {7, 11, orange}, {8, 11, orange}, {9, 11, orange}, {10, 11, orange}, {7, 12, orange}, {8, 12, orange}, {9, 12, orange}, {8, 13, orange}};

  Pixel frame1[] = {
      {3, 8, pink}, {4, 8, pink}, {5, 8, pink}, {6, 8, pink}, {7, 8, pink}, {8, 8, pink}, {9, 8, pink}, {10, 8, pink}, {11, 8, pink}, {12, 8, pink}, {13, 8, pink}, {5, 9, pink}, {7, 9, pink}, {9, 9, pink}, {11, 9, pink}, {5, 10, pink}, {6, 10, pink}, {7, 10, pink}, {9, 10, pink}, {10, 10, pink}, {11, 10, pink}};

  for (int cur_frame = 0; cur_frame < total_frame; cur_frame++)
  {
    matrix.fillScreen(0);

    // Draw the penguin
    set_up_matrix(&matrix, frame0, sizeof(frame0) / sizeof(Pixel));

    // Add the sunglasses
    if (cur_frame % 2 == 1)
    {
      set_up_matrix(&matrix, frame1, sizeof(frame1) / sizeof(Pixel));
    }

    matrix.show();
    delay(DEFAULT_DELAY);
  }
}

void snow_trees()
{
  int cur_frame = 0;
  int total_frame = 32;

  uint16_t white = matrix.Color(255, 255, 255);
  uint16_t green = matrix.Color(78, 176, 19);
  uint16_t darkgreen = matrix.Color(2, 93, 77);

  Pixel frame0[] = {
      {4, 7, green}, {3, 8, green}, {4, 8, green}, {5, 8, green}, {2, 9, green}, {3, 9, green}, {4, 9, green}, {5, 9, green}, {6, 9, green}, {3, 10, green}, {4, 10, green}, {5, 10, green}, {2, 11, green}, {3, 11, green}, {4, 11, green}, {5, 11, green}, {6, 11, green}, {1, 12, green}, {2, 12, green}, {3, 12, green}, {4, 12, green}, {5, 12, green}, {6, 12, green}, {7, 12, green}, {2, 13, green}, {3, 13, green}, {4, 13, green}, {5, 13, green}, {6, 13, green}, {1, 14, green}, {2, 14, green}, {3, 14, green}, {4, 14, green}, {5, 14, green}, {6, 14, green}, {7, 14, green}, {0, 15, green}, {1, 15, green}, {2, 15, green}, {3, 15, green}, {4, 15, green}, {5, 15, green}, {6, 15, green}, {7, 15, green}, {8, 15, green}, {11, 5, darkgreen}, {10, 6, darkgreen}, {11, 6, darkgreen}, {12, 6, darkgreen}, {9, 7, darkgreen}, {10, 7, darkgreen}, {11, 7, darkgreen}, {12, 7, darkgreen}, {13, 7, darkgreen}, {8, 8, darkgreen}, {9, 8, darkgreen}, {10, 8, darkgreen}, {11, 8, darkgreen}, {12, 8, darkgreen}, {13, 8, darkgreen}, {14, 8, darkgreen}, {10, 9, darkgreen}, {11, 9, darkgreen}, {12, 9, darkgreen}, {9, 10, darkgreen}, {10, 10, darkgreen}, {11, 10, darkgreen}, {12, 10, darkgreen}, {13, 10, darkgreen}, {8, 11, darkgreen}, {9, 11, darkgreen}, {10, 11, darkgreen}, {11, 11, darkgreen}, {12, 11, darkgreen}, {13, 11, darkgreen}, {14, 11, darkgreen}, {8, 12, darkgreen}, {9, 12, darkgreen}, {10, 12, darkgreen}, {11, 12, darkgreen}, {12, 12, darkgreen}, {13, 12, darkgreen}, {14, 12, darkgreen}, {15, 12, darkgreen}, {7, 13, darkgreen}, {8, 13, darkgreen}, {9, 13, darkgreen}, {10, 13, darkgreen}, {11, 13, darkgreen}, {12, 13, darkgreen}, {13, 13, darkgreen}, {14, 13, darkgreen}, {15, 13, darkgreen}, {8, 14, darkgreen}, {9, 14, darkgreen}, {10, 14, darkgreen}, {11, 14, darkgreen}, {12, 14, darkgreen}, {13, 14, darkgreen}, {14, 14, darkgreen}, {15, 14, darkgreen}, {9, 15, darkgreen}, {10, 15, darkgreen}, {11, 15, darkgreen}, {12, 15, darkgreen}, {13, 15, darkgreen}, {14, 15, darkgreen}, {15, 15, darkgreen}};

  Pixel snow[] = {
      {0, 0, white}, {11, 0, white}, {3, 1, white}, {9, 1, white}, {15, 1, white}, {1, 2, white}, {7, 2, white}, {13, 2, white}, {4, 3, white}, {10, 3, white}, {2, 4, white}, {8, 4, white}, {14, 4, white}, {5, 5, white}, {11, 5, white}, {0, 6, white}, {7, 6, white}, {13, 6, white}, {3, 7, white}, {10, 7, white}, {1, 8, white}, {7, 8, white}, {14, 8, white}, {4, 9, white}, {12, 9, white}, {0, 10, white}, {10, 10, white}, {2, 11, white}, {6, 11, white}, {13, 11, white}, {4, 12, white}, {11, 12, white}, {0, 13, white}, {7, 13, white}, {15, 13, white}, {2, 14, white}, {9, 14, white}, {5, 15, white}, {13, 15, white}};

  for (int cur_frame = 0; cur_frame < total_frame; cur_frame++)
  {
    matrix.fillScreen(0);

    // Draw the trees
    set_up_matrix(&matrix, frame0, sizeof(frame0) / sizeof(Pixel));

    // Add the snow
    int snow_size = sizeof(snow) / sizeof(Pixel);
    Pixel final_snow[snow_size];
    // Populate final_snow with transition
    for (int cur_pixel = 0; cur_pixel < snow_size; cur_pixel++)
    {
      final_snow[cur_pixel] = snow[cur_pixel];
      final_snow[cur_pixel].y = (final_snow[cur_pixel].y + cur_frame) % ROW_LEN;
    }
    set_up_matrix(&matrix, final_snow, sizeof(final_snow) / sizeof(Pixel));

    matrix.show();
    delay(250);
  }
}

void holly()
{
  int cur_frame = 0;
  int total_frame = DEFAULT_TOTAL_FRAME;

  uint16_t green = matrix.Color(78, 176, 19);
  uint16_t darkgreen = matrix.Color(2, 93, 77);
  uint16_t red = matrix.Color(255, 0, 0);
  uint16_t darkred = matrix.Color(152, 0, 0);
  uint16_t white = matrix.Color(255, 255, 255);
  uint16_t yellow = matrix.Color(249, 199, 47);
  uint16_t gold = matrix.Color(191, 144, 0);

  Pixel frame0[] = {
      {1, 0, green}, {2, 0, green}, {4, 0, green}, {0, 1, green}, {2, 1, green}, {3, 1, green}, {4, 1, green}, {6, 1, green}, {0, 2, green}, {1, 2, green}, {3, 2, green}, {4, 2, green}, {5, 2, green}, {6, 2, green}, {1, 3, green}, {2, 3, green}, {4, 3, green}, {5, 3, green}, {6, 3, green}, {0, 4, green}, {1, 4, green}, {2, 4, green}, {3, 4, green}, {5, 4, green}, {2, 5, green}, {3, 5, green}, {4, 5, green}, {1, 6, green}, {2, 6, green}, {3, 6, green}, {13, 9, green}, {14, 9, green}, {1, 10, green}, {2, 10, green}, {3, 10, green}, {4, 10, green}, {14, 10, green}, {15, 10, green}, {2, 11, green}, {3, 11, green}, {5, 11, green}, {13, 11, green}, {15, 11, green}, {1, 12, green}, {2, 12, green}, {4, 12, green}, {5, 12, green}, {6, 12, green}, {13, 12, green}, {14, 12, green}, {0, 13, green}, {1, 13, green}, {3, 13, green}, {4, 13, green}, {5, 13, green}, {7, 13, green}, {13, 13, green}, {15, 13, green}, {0, 14, green}, {2, 14, green}, {3, 14, green}, {5, 14, green}, {1, 15, green}, {2, 15, green}, {0, 0, darkgreen}, {1, 1, darkgreen}, {2, 2, darkgreen}, {3, 3, darkgreen}, {8, 3, darkgreen}, {4, 4, darkgreen}, {6, 4, darkgreen}, {7, 4, darkgreen}, {8, 4, darkgreen}, {5, 5, darkgreen}, {8, 5, darkgreen}, {4, 6, darkgreen}, {3, 7, darkgreen}, {4, 7, darkgreen}, {12, 8, darkgreen}, {13, 8, darkgreen}, {14, 8, darkgreen}, {15, 8, darkgreen}, {3, 9, darkgreen}, {4, 9, darkgreen}, {5, 9, darkgreen}, {6, 9, darkgreen}, {11, 9, darkgreen}, {12, 9, darkgreen}, {5, 10, darkgreen}, {6, 10, darkgreen}, {11, 10, darkgreen}, {12, 10, darkgreen}, {13, 10, darkgreen}, {4, 11, darkgreen}, {6, 11, darkgreen}, {7, 11, darkgreen}, {11, 11, darkgreen}, {12, 11, darkgreen}, {14, 11, darkgreen}, {3, 12, darkgreen}, {7, 12, darkgreen}, {12, 12, darkgreen}, {15, 12, darkgreen}, {2, 13, darkgreen}, {1, 14, darkgreen}, {0, 15, darkgreen}, {6, 6, red}, {10, 6, red}, {6, 5, red}, {7, 5, red}, {10, 5, red}, {11, 5, red}, {5, 6, red}, {7, 6, red}, {9, 6, red}, {11, 6, red}, {5, 7, red}, {6, 7, red}, {7, 7, red}, {9, 7, red}, {10, 7, red}, {11, 7, red}, {8, 8, red}, {7, 9, red}, {8, 9, red}, {9, 9, red}, {8, 6, darkred}, {12, 6, darkred}, {8, 7, darkred}, {12, 7, darkred}, {6, 8, darkred}, {7, 8, darkred}, {9, 8, darkred}, {10, 8, darkred}, {11, 8, darkred}, {10, 9, darkred}, {7, 10, red}, {8, 10, red}, {9, 10, red}, {8, 11, darkred}, {9, 11, darkred}};

  Pixel frame1[] = {
      {6, 6, white}, {10, 6, white}, {13, 1, yellow}, {12, 2, yellow}, {14, 2, yellow}, {13, 3, yellow}, {13, 2, gold}};

  for (int cur_frame = 0; cur_frame < total_frame; cur_frame++)
  {
    matrix.fillScreen(0);

    // Draw the holly
    set_up_matrix(&matrix, frame0, sizeof(frame0) / sizeof(Pixel));

    // Make it shine
    if (cur_frame % 2 == 1)
    {
      set_up_matrix(&matrix, frame1, sizeof(frame1) / sizeof(Pixel));
    }

    matrix.show();
    delay(DEFAULT_DELAY);
  }
}

void sleigh()
{
  int cur_frame = 0;
  int total_frame = 33;

  uint16_t red = matrix.Color(255, 0, 0);
  uint16_t yellow = matrix.Color(249, 199, 47);
  uint16_t green = matrix.Color(78, 176, 19);
  uint16_t darkgreen = matrix.Color(2, 93, 77);
  uint16_t brown = matrix.Color(140, 82, 39);
  uint16_t blue = matrix.Color(0, 0, 255);

  Pixel frame0[] = {
      {0, 13, brown}, {1, 14, brown}, {6, 14, brown}, {10, 14, brown}, {2, 15, brown}, {3, 15, brown}, {4, 15, brown}, {5, 15, brown}, {6, 15, brown}, {7, 15, brown}, {8, 15, brown}, {9, 15, brown}, {10, 15, brown}, {11, 15, brown}, {12, 15, brown}, {13, 15, brown}, {14, 15, brown}, {1, 7, red}, {15, 7, red}, {1, 8, red}, {2, 8, red}, {15, 8, red}, {1, 9, red}, {2, 9, red}, {14, 9, red}, {15, 9, red}, {1, 10, red}, {2, 10, red}, {3, 10, red}, {4, 10, red}, {5, 10, red}, {6, 10, red}, {7, 10, red}, {8, 10, red}, {9, 10, red}, {10, 10, red}, {11, 10, red}, {12, 10, red}, {13, 10, red}, {14, 10, red}, {15, 10, red}, {1, 11, red}, {2, 11, red}, {3, 11, red}, {4, 11, red}, {5, 11, red}, {6, 11, red}, {7, 11, red}, {8, 11, red}, {9, 11, red}, {10, 11, red}, {11, 11, red}, {12, 11, red}, {13, 11, red}, {14, 11, red}, {15, 11, red}, {2, 12, red}, {3, 12, red}, {4, 12, red}, {5, 12, red}, {6, 12, red}, {7, 12, red}, {8, 12, red}, {9, 12, red}, {10, 12, red}, {11, 12, red}, {12, 12, red}, {13, 12, red}, {14, 12, red}, {15, 12, red}, {3, 13, red}, {4, 13, red}, {5, 13, red}, {6, 13, red}, {7, 13, red}, {8, 13, red}, {9, 13, red}, {10, 13, red}, {11, 13, red}, {12, 13, red}, {13, 13, red}, {14, 13, red}, {3, 5, blue}, {4, 5, blue}, {6, 5, blue}, {7, 5, blue}, {3, 6, blue}, {4, 6, blue}, {6, 6, blue}, {7, 6, blue}, {3, 8, blue}, {4, 8, blue}, {6, 8, blue}, {7, 8, blue}, {3, 9, blue}, {4, 9, blue}, {6, 9, blue}, {7, 9, blue}, {7, 3, green}, {8, 3, green}, {9, 3, green}, {11, 3, green}, {12, 3, green}, {13, 3, green}, {7, 4, green}, {8, 4, green}, {9, 4, green}, {11, 4, green}, {12, 4, green}, {13, 4, green}, {8, 6, green}, {9, 6, green}, {11, 6, green}, {12, 6, green}, {13, 6, green}, {8, 7, green}, {9, 7, green}, {11, 7, green}, {12, 7, green}, {13, 7, green}, {8, 8, green}, {9, 8, green}, {11, 8, green}, {12, 8, green}, {13, 8, green}, {8, 9, green}, {9, 9, green}, {11, 9, green}, {12, 9, green}, {13, 9, green}, {8, 1, darkgreen}, {9, 1, darkgreen}, {11, 1, darkgreen}, {12, 1, darkgreen}, {9, 2, darkgreen}, {10, 2, darkgreen}, {11, 2, darkgreen}, {10, 3, darkgreen}, {10, 4, darkgreen}, {8, 5, darkgreen}, {9, 5, darkgreen}, {10, 5, darkgreen}, {11, 5, darkgreen}, {12, 5, darkgreen}, {13, 5, darkgreen}, {10, 6, darkgreen}, {10, 7, darkgreen}, {10, 8, darkgreen}, {10, 9, darkgreen}, {5, 5, yellow}, {5, 6, yellow}, {5, 8, yellow}, {5, 9, yellow}, {3, 7, yellow}, {4, 7, yellow}, {5, 7, yellow}, {6, 7, yellow}, {7, 7, yellow}};

  for (int cur_frame = 0; cur_frame < total_frame; cur_frame++)
  {
    matrix.fillScreen(0);

    // Calculate the sleigh
    int frame0_size = sizeof(frame0) / sizeof(Pixel);
    Pixel final_sleigh[frame0_size];
    // Populate final_sleigh with transition
    for (int cur_pixel = 0; cur_pixel < frame0_size; cur_pixel++)
    {
      final_sleigh[cur_pixel] = frame0[cur_pixel];
      if ((cur_frame / ROW_LEN) % 2 == 0)
      {
        final_sleigh[cur_pixel].x = final_sleigh[cur_pixel].x - (cur_frame % ROW_LEN);
        if (final_sleigh[cur_pixel].x < 0)
        {
          final_sleigh[cur_pixel].x = 0;
          final_sleigh[cur_pixel].y = 0;
          final_sleigh[cur_pixel].color = 0;
        }
      }
      else
      {
        final_sleigh[cur_pixel].x = final_sleigh[cur_pixel].x + ROW_LEN - (cur_frame % ROW_LEN);
        if (final_sleigh[cur_pixel].x >= ROW_LEN)
        {
          final_sleigh[cur_pixel].x = 0;
          final_sleigh[cur_pixel].y = 0;
          final_sleigh[cur_pixel].color = 0;
        }
      }
    }
    set_up_matrix(&matrix, final_sleigh, sizeof(final_sleigh) / sizeof(Pixel));

    matrix.show();
    delay(DEFAULT_DELAY / 2);
  }
}

void poinsettia()
{
  int cur_frame = 0;
  int total_frame = DEFAULT_TOTAL_FRAME;

  uint16_t darkgreen = matrix.Color(2, 93, 77);
  uint16_t green = matrix.Color(78, 176, 19);
  uint16_t red = matrix.Color(255, 0, 0);
  uint16_t white = matrix.Color(255, 255, 255);
  uint16_t darkred = matrix.Color(152, 0, 0);

  Pixel frame0[] = {
      {0, 0, darkgreen}, {4, 0, green}, {11, 0, green}, {15, 0, darkgreen}, {1, 1, darkgreen}, {4, 1, green}, {5, 1, green}, {10, 1, green}, {11, 1, green}, {14, 1, darkgreen}, {2, 2, darkgreen}, {4, 2, green}, {5, 2, green}, {6, 2, green}, {9, 2, green}, {10, 2, green}, {11, 2, green}, {13, 2, darkgreen}, {3, 3, darkgreen}, {4, 3, green}, {5, 3, green}, {6, 3, green}, {9, 3, green}, {10, 3, green}, {11, 3, green}, {12, 3, darkgreen}, {0, 4, green}, {1, 4, green}, {2, 4, green}, {3, 4, green}, {5, 4, green}, {6, 4, green}, {9, 4, green}, {10, 4, green}, {12, 4, green}, {13, 4, green}, {14, 4, green}, {15, 4, green}, {1, 5, green}, {2, 5, green}, {3, 5, green}, {4, 5, green}, {6, 5, green}, {9, 5, green}, {11, 5, green}, {12, 5, green}, {13, 5, green}, {14, 5, green}, {2, 6, green}, {3, 6, green}, {4, 6, green}, {5, 6, green}, {10, 6, green}, {11, 6, green}, {12, 6, green}, {13, 6, green}, {2, 9, green}, {3, 9, green}, {4, 9, green}, {5, 9, green}, {10, 9, green}, {11, 9, green}, {12, 9, green}, {13, 9, green}, {1, 10, green}, {2, 10, green}, {3, 10, green}, {4, 10, green}, {6, 10, green}, {9, 10, green}, {11, 10, green}, {12, 10, green}, {13, 10, green}, {14, 10, green}, {0, 11, green}, {1, 11, green}, {2, 11, green}, {3, 11, green}, {5, 11, green}, {6, 11, green}, {9, 11, green}, {10, 11, green}, {12, 11, green}, {13, 11, green}, {14, 11, green}, {15, 11, green}, {3, 12, darkgreen}, {4, 12, green}, {5, 12, green}, {6, 12, green}, {9, 12, green}, {10, 12, green}, {11, 12, green}, {12, 12, darkgreen}, {2, 13, darkgreen}, {4, 13, green}, {5, 13, green}, {6, 13, green}, {9, 13, green}, {10, 13, green}, {11, 13, green}, {13, 13, darkgreen}, {1, 14, darkgreen}, {4, 14, green}, {5, 14, green}, {10, 14, green}, {11, 14, green}, {14, 14, darkgreen}, {0, 15, darkgreen}, {4, 15, green}, {11, 15, green}, {15, 15, darkgreen}, {11, 11, darkgreen}, {4, 11, darkgreen}, {4, 4, darkgreen}, {11, 4, darkgreen}, {8, 6, red}, {7, 7, red}, {8, 7, red}, {9, 7, red}, {7, 8, red}, {8, 8, red}, {9, 8, red}};

  Pixel frame1[] = {
      {7, 6, white}, {6, 7, red}, {6, 8, red}, {7, 9, red}, {8, 9, red}};

  Pixel frame2[] = {
      {7, 6, red}, {6, 7, darkred}, {6, 8, darkred}, {7, 9, darkred}, {8, 9, darkred}};

  for (int cur_frame = 0; cur_frame < total_frame; cur_frame++)
  {
    matrix.fillScreen(0);

    // Draw the common parts
    set_up_matrix(&matrix, frame0, sizeof(frame0) / sizeof(Pixel));

    // Make it shine
    if (cur_frame % 2 == 0)
    {
      set_up_matrix(&matrix, frame1, sizeof(frame1) / sizeof(Pixel));
    }
    else
    {
      set_up_matrix(&matrix, frame2, sizeof(frame2) / sizeof(Pixel));
    }

    matrix.show();
    delay(DEFAULT_DELAY);
  }
}

void snowflake()
{
  int cur_frame = 0;
  int total_frame = DEFAULT_TOTAL_FRAME;
  // Make the total number of frames even
  if (total_frame % 2 == 1)
  {
    total_frame++;
  }

  uint16_t white = matrix.Color(255, 255, 255);
  uint16_t lightblue = matrix.Color(140, 239, 255);

  Pixel frame0[] = {
      {7, 1, white}, {5, 2, white}, {9, 2, white}, {6, 3, white}, {7, 3, white}, {8, 3, white}, {7, 4, white}, {2, 5, white}, {12, 5, white}, {3, 6, white}, {7, 6, white}, {11, 6, white}, {1, 7, white}, {4, 7, white}, {3, 7, white}, {6, 7, white}, {7, 7, white}, {8, 7, white}, {10, 7, white}, {11, 7, white}, {13, 7, white}, {3, 8, white}, {7, 8, white}, {11, 8, white}, {2, 9, white}, {12, 9, white}, {7, 10, white}, {6, 11, white}, {7, 11, white}, {8, 11, white}, {5, 12, white}, {9, 12, white}, {7, 13, white}, {7, 2, lightblue}, {4, 4, lightblue}, {10, 4, lightblue}, {5, 5, lightblue}, {7, 5, lightblue}, {9, 5, lightblue}, {6, 6, lightblue}, {8, 6, lightblue}, {2, 7, lightblue}, {5, 7, lightblue}, {7, 7, lightblue}, {9, 7, lightblue}, {12, 7, lightblue}, {6, 8, lightblue}, {8, 8, lightblue}, {5, 9, lightblue}, {7, 9, lightblue}, {9, 9, lightblue}, {4, 10, lightblue}, {10, 10, lightblue}, {7, 12, lightblue}};

  for (int cur_frame = 0; cur_frame < total_frame; cur_frame++)
  {
    matrix.fillScreen(0);

    if (cur_frame % 2 == 0)
    {
      // Draw the image
      set_up_matrix(&matrix, frame0, sizeof(frame0) / sizeof(Pixel));
    }
    else
    {
      // Flip colors
      int frame0_size = sizeof(frame0) / sizeof(Pixel);
      Pixel frame1[frame0_size];
      for (int cur_pixel = 0; cur_pixel < frame0_size; cur_pixel++)
      {
        frame1[cur_pixel] = frame0[cur_pixel];
        if (frame1[cur_pixel].color == lightblue)
        {
          frame1[cur_pixel].color = white;
        }
        else
        {
          frame1[cur_pixel].color = lightblue;
        }
      }
      set_up_matrix(&matrix, frame1, sizeof(frame0) / sizeof(Pixel));
    }

    matrix.show();
    delay(DEFAULT_DELAY);
  }
}

void star()
{
  int cur_frame = 0;
  int total_frame = DEFAULT_TOTAL_FRAME;
  // Make the total number of frames even
  if (total_frame % 2 == 1)
  {
    total_frame++;
  }

  uint16_t yellow = matrix.Color(251, 188, 4);
  uint16_t gold = matrix.Color(255, 227, 0);

  Pixel frame0[] = {
      {8, 2, yellow}, {7, 3, yellow}, {8, 3, yellow}, {7, 4, yellow}, {8, 4, yellow}, {6, 5, yellow}, {7, 5, yellow}, {7, 6, yellow}, {9, 6, yellow}, {10, 6, yellow}, {11, 6, yellow}, {12, 6, yellow}, {13, 6, yellow}, {3, 7, yellow}, {4, 7, yellow}, {7, 7, yellow}, {9, 7, yellow}, {10, 7, yellow}, {11, 7, yellow}, {4, 8, yellow}, {5, 8, yellow}, {6, 8, yellow}, {5, 9, yellow}, {7, 9, yellow}, {9, 9, yellow}, {10, 9, yellow}, {11, 9, yellow}, {6, 10, yellow}, {7, 10, yellow}, {10, 10, yellow}, {11, 10, yellow}, {6, 11, yellow}, {7, 11, yellow}, {11, 11, yellow}, {12, 11, yellow}, {5, 12, yellow}, {6, 12, yellow}, {12, 12, yellow}, {4, 13, yellow}, {5, 13, yellow}, {9, 3, gold}, {9, 4, gold}, {8, 5, gold}, {9, 5, gold}, {10, 5, gold}, {2, 6, gold}, {3, 6, gold}, {4, 6, gold}, {5, 6, gold}, {6, 6, gold}, {8, 6, gold}, {14, 6, gold}, {5, 7, gold}, {6, 7, gold}, {8, 7, gold}, {12, 7, gold}, {13, 7, gold}, {7, 8, gold}, {8, 8, gold}, {9, 8, gold}, {10, 8, gold}, {11, 8, gold}, {12, 8, gold}, {6, 9, gold}, {8, 9, gold}, {5, 10, gold}, {8, 10, gold}, {9, 10, gold}, {4, 11, gold}, {5, 11, gold}, {9, 11, gold}, {10, 11, gold}, {4, 12, gold}, {10, 12, gold}, {11, 12, gold}, {11, 13, gold}, {12, 13, gold}};

  for (int cur_frame = 0; cur_frame < total_frame; cur_frame++)
  {
    matrix.fillScreen(0);

    if (cur_frame % 2 == 0)
    {
      // Draw image
      set_up_matrix(&matrix, frame0, sizeof(frame0) / sizeof(Pixel));
    }
    else
    {
      // Flip colors
      int frame0_size = sizeof(frame0) / sizeof(Pixel);
      Pixel frame1[frame0_size];
      for (int cur_pixel = 0; cur_pixel < frame0_size; cur_pixel++)
      {
        frame1[cur_pixel] = frame0[cur_pixel];
        if (frame1[cur_pixel].color == yellow)
        {
          frame1[cur_pixel].color = gold;
        }
        else
        {
          frame1[cur_pixel].color = yellow;
        }
      }
      set_up_matrix(&matrix, frame1, sizeof(frame0) / sizeof(Pixel));
    }

    matrix.show();
    delay(DEFAULT_DELAY);
  }
}

void gingerbread_man()
{
  int cur_frame = 0;
  int total_frame = DEFAULT_TOTAL_FRAME;

  uint16_t brown = matrix.Color(140, 82, 39);
  uint16_t blue = matrix.Color(4, 43, 105);
  uint16_t red = matrix.Color(255, 0, 0);
  uint16_t darkgreen = matrix.Color(2, 93, 77);
  uint16_t darkred = matrix.Color(152, 0, 0);
  uint16_t lightblue = matrix.Color(140, 239, 255);
  uint16_t green = matrix.Color(78, 176, 19);
  uint16_t white = matrix.Color(255, 255, 255);

  Pixel frame0[] = {
      {6, 0, brown}, {7, 0, brown}, {8, 0, brown}, {9, 0, brown}, {5, 1, brown}, {6, 1, brown}, {7, 1, brown}, {8, 1, brown}, {9, 1, brown}, {10, 1, brown}, {4, 2, brown}, {5, 2, brown}, {7, 2, brown}, {8, 2, brown}, {10, 2, brown}, {11, 2, brown}, {4, 3, brown}, {5, 3, brown}, {6, 3, brown}, {7, 3, brown}, {8, 3, brown}, {9, 3, brown}, {10, 3, brown}, {11, 3, brown}, {4, 4, brown}, {5, 4, brown}, {7, 4, brown}, {8, 4, brown}, {10, 4, brown}, {11, 4, brown}, {5, 5, brown}, {6, 5, brown}, {9, 5, brown}, {10, 5, brown}, {6, 6, brown}, {7, 6, brown}, {8, 6, brown}, {9, 6, brown}, {1, 7, brown}, {2, 7, brown}, {3, 7, brown}, {5, 7, brown}, {6, 7, brown}, {7, 7, brown}, {8, 7, brown}, {9, 7, brown}, {10, 7, brown}, {12, 7, brown}, {13, 7, brown}, {14, 7, brown}, {0, 8, brown}, {1, 8, brown}, {2, 8, brown}, {3, 8, brown}, {5, 8, brown}, {6, 8, brown}, {9, 8, brown}, {10, 8, brown}, {12, 8, brown}, {13, 8, brown}, {14, 8, brown}, {15, 8, brown}, {1, 9, brown}, {2, 9, brown}, {3, 9, brown}, {5, 9, brown}, {6, 9, brown}, {7, 9, brown}, {8, 9, brown}, {9, 9, brown}, {10, 9, brown}, {12, 9, brown}, {13, 9, brown}, {14, 9, brown}, {4, 10, brown}, {5, 10, brown}, {6, 10, brown}, {9, 10, brown}, {10, 10, brown}, {11, 10, brown}, {3, 11, brown}, {4, 11, brown}, {5, 11, brown}, {6, 11, brown}, {7, 11, brown}, {8, 11, brown}, {9, 11, brown}, {10, 11, brown}, {11, 11, brown}, {12, 11, brown}, {4, 12, brown}, {5, 12, brown}, {6, 12, brown}, {9, 12, brown}, {10, 12, brown}, {11, 12, brown}, {2, 13, brown}, {3, 13, brown}, {5, 13, brown}, {6, 13, brown}, {7, 13, brown}, {8, 13, brown}, {9, 13, brown}, {10, 13, brown}, {12, 13, brown}, {13, 13, brown}, {2, 14, brown}, {3, 14, brown}, {4, 14, brown}, {11, 14, brown}, {12, 14, brown}, {13, 14, brown}, {2, 15, brown}, {3, 15, brown}, {4, 15, brown}, {5, 15, brown}, {10, 15, brown}, {11, 15, brown}, {12, 15, brown}, {13, 15, brown}, {6, 2, blue}, {9, 2, blue}, {7, 5, red}, {8, 5, red}};

  Pixel frame1[] = {
      {7, 8, darkgreen}, {8, 8, darkgreen}, {7, 12, darkgreen}, {8, 12, darkgreen}, {7, 10, darkred}, {8, 10, darkred}, {6, 4, brown}, {9, 4, brown}, {4, 7, lightblue}, {11, 7, lightblue}, {4, 8, lightblue}, {11, 8, lightblue}, {4, 9, lightblue}, {11, 9, lightblue}, {3, 12, lightblue}, {12, 12, lightblue}, {4, 13, lightblue}, {11, 13, lightblue}, {5, 14, lightblue}, {10, 14, lightblue}};

  Pixel frame2[] = {
      {7, 8, green}, {8, 8, green}, {7, 12, green}, {8, 12, green}, {7, 10, red}, {8, 10, red}, {6, 4, red}, {9, 4, red}, {4, 7, white}, {11, 7, white}, {4, 8, white}, {11, 8, white}, {4, 9, white}, {11, 9, white}, {3, 12, white}, {12, 12, white}, {4, 13, white}, {11, 13, white}, {5, 14, white}, {10, 14, white}};

  for (int cur_frame = 0; cur_frame < total_frame; cur_frame++)
  {
    matrix.fillScreen(0);

    // Draw the gingerbread man
    set_up_matrix(&matrix, frame0, sizeof(frame0) / sizeof(Pixel));

    // Make it shine
    if (cur_frame % 2 == 0)
    {
      set_up_matrix(&matrix, frame1, sizeof(frame1) / sizeof(Pixel));
    }
    else
    {
      set_up_matrix(&matrix, frame2, sizeof(frame2) / sizeof(Pixel));
    }

    matrix.show();
    delay(DEFAULT_DELAY);
  }
}

void elf()
{
  int cur_frame = 0;
  int total_frame = 18;

  uint16_t lightgreen = matrix.Color(164, 214, 32);
  uint16_t darkgreen = matrix.Color(2, 93, 77);
  uint16_t red = matrix.Color(255, 0, 0);
  uint16_t pinkface = matrix.Color(249, 203, 203);
  uint16_t blue = matrix.Color(4, 43, 105);
  uint16_t yellow = matrix.Color(249, 199, 47);

  Pixel frame0[] = {
      {6, 0, lightgreen}, {7, 0, lightgreen}, {8, 0, lightgreen}, {5, 1, lightgreen}, {6, 1, lightgreen}, {7, 1, lightgreen}, {8, 1, lightgreen}, {9, 1, lightgreen}, {4, 2, lightgreen}, {5, 2, lightgreen}, {6, 2, lightgreen}, {7, 2, lightgreen}, {8, 2, lightgreen}, {9, 2, lightgreen}, {10, 2, lightgreen}, {2, 7, lightgreen}, {3, 7, lightgreen}, {11, 7, lightgreen}, {12, 7, lightgreen}, {5, 8, lightgreen}, {7, 8, lightgreen}, {9, 8, lightgreen}, {5, 9, lightgreen}, {7, 9, lightgreen}, {9, 9, lightgreen}, {5, 10, lightgreen}, {9, 10, lightgreen}, {4, 14, lightgreen}, {10, 14, lightgreen}, {5, 15, lightgreen}, {6, 15, lightgreen}, {8, 15, lightgreen}, {9, 15, lightgreen}, {6, 14, darkgreen}, {8, 14, darkgreen}, {7, 5, red}, {4, 7, red}, {5, 7, red}, {6, 7, red}, {7, 7, red}, {8, 7, red}, {9, 7, red}, {10, 7, red}, {6, 8, red}, {8, 8, red}, {6, 9, red}, {8, 9, red}, {6, 10, red}, {7, 10, red}, {8, 10, red}, {5, 11, red}, {6, 11, red}, {7, 11, red}, {8, 11, red}, {9, 11, red}, {5, 12, red}, {6, 12, red}, {8, 12, red}, {9, 12, red}, {6, 13, red}, {8, 13, red}, {4, 3, pinkface}, {5, 3, pinkface}, {7, 3, pinkface}, {9, 3, pinkface}, {10, 3, pinkface}, {4, 4, pinkface}, {5, 4, pinkface}, {6, 4, pinkface}, {7, 4, pinkface}, {8, 4, pinkface}, {9, 4, pinkface}, {10, 4, pinkface}, {5, 5, pinkface}, {9, 5, pinkface}, {6, 6, pinkface}, {7, 6, pinkface}, {8, 6, pinkface}, {6, 3, blue}, {8, 3, blue}};

  Pixel frame1[] = {
      {0, 1, red}, {1, 1, red}, {0, 2, red}, {1, 2, red}, {3, 0, lightgreen}, {4, 0, lightgreen}, {5, 0, lightgreen}, {2, 1, lightgreen}, {6, 5, red}, {8, 5, red}, {13, 6, red}, {1, 8, red}, {14, 4, yellow}, {14, 5, yellow}, {15, 5, yellow}};

  Pixel frame2[] = {
      {13, 1, red}, {14, 1, red}, {13, 2, red}, {14, 2, red}, {9, 0, lightgreen}, {10, 0, lightgreen}, {11, 0, lightgreen}, {12, 1, lightgreen}, {6, 5, pinkface}, {8, 5, pinkface}, {13, 8, red}, {1, 6, red}, {14, 10, yellow}, {14, 9, yellow}, {15, 9, yellow}};

  for (int cur_frame = 0; cur_frame < total_frame; cur_frame++)
  {
    matrix.fillScreen(0);

    // Draw the elf
    set_up_matrix(&matrix, frame0, sizeof(frame0) / sizeof(Pixel));

    // Make their arms move
    if (cur_frame % 2 == 1)
    {
      set_up_matrix(&matrix, frame1, sizeof(frame1) / sizeof(Pixel));
    }
    else
    {
      set_up_matrix(&matrix, frame2, sizeof(frame2) / sizeof(Pixel));
    }

    matrix.show();
    delay(DEFAULT_DELAY);
  }
}

void jumping_reindeer()
{
  int cur_frame = 0;
  int total_frame = 18;

  uint16_t gold = matrix.Color(249, 199, 47);
  uint16_t brown = matrix.Color(140, 82, 39);
  uint16_t darkbrown = matrix.Color(67, 36, 13);
  uint16_t red = matrix.Color(255, 0, 0);
  uint16_t darkred = matrix.Color(152, 0, 0);
  uint16_t blue = matrix.Color(4, 43, 105);
  uint16_t cheek = matrix.Color(244, 99, 166);
  uint16_t yellow = matrix.Color(255, 238, 0);
  uint16_t white = matrix.Color(255, 255, 255);

  Pixel frame0[] = {
      {6, 2, gold}, {7, 2, gold}, {7, 3, gold}, {8, 3, gold}, {8, 4, gold}, {6, 11, gold}, {5, 12, gold}, {9, 4, brown}, {10, 4, brown}, {8, 5, brown}, {9, 5, brown}, {10, 5, brown}, {11, 5, brown}, {7, 6, brown}, {8, 6, brown}, {9, 6, brown}, {11, 6, brown}, {12, 6, brown}, {8, 7, brown}, {10, 7, brown}, {11, 7, brown}, {12, 7, brown}, {8, 8, brown}, {9, 8, brown}, {10, 8, brown}, {11, 8, brown}, {5, 10, brown}, {6, 10, brown}, {7, 10, brown}, {8, 10, brown}, {9, 10, brown}, {10, 10, brown}, {4, 11, brown}, {5, 11, brown}, {7, 11, brown}, {8, 11, brown}, {9, 11, brown}, {10, 11, brown}, {3, 12, brown}, {4, 12, brown}, {6, 12, brown}, {7, 12, brown}, {8, 12, brown}, {9, 12, brown}, {10, 12, brown}, {4, 13, brown}, {5, 13, brown}, {6, 13, brown}, {9, 13, brown}, {10, 13, brown}, {4, 14, brown}, {5, 14, brown}, {9, 14, brown}, {10, 14, brown}, {4, 15, darkbrown}, {5, 15, darkbrown}, {9, 15, darkbrown}, {10, 15, darkbrown}, {8, 9, red}, {9, 9, red}, {10, 9, red}, {13, 6, darkred}, {10, 6, blue}, {9, 7, cheek}, {11, 10, yellow}};

  Pixel frame1[] = {
      {6, 0, gold}, {7, 0, gold}, {7, 1, gold}, {8, 1, gold}, {8, 2, gold}, {6, 9, gold}, {5, 10, gold}, {9, 2, brown}, {10, 2, brown}, {8, 3, brown}, {9, 3, brown}, {10, 3, brown}, {11, 3, brown}, {7, 4, brown}, {8, 4, brown}, {9, 4, brown}, {11, 4, brown}, {12, 4, brown}, {8, 5, brown}, {10, 5, brown}, {11, 5, brown}, {12, 5, brown}, {8, 6, brown}, {9, 6, brown}, {10, 6, brown}, {11, 6, brown}, {5, 8, brown}, {6, 8, brown}, {7, 8, brown}, {8, 8, brown}, {9, 8, brown}, {10, 8, brown}, {4, 9, brown}, {5, 9, brown}, {7, 9, brown}, {8, 9, brown}, {9, 9, brown}, {10, 9, brown}, {3, 10, brown}, {4, 10, brown}, {6, 10, brown}, {7, 10, brown}, {8, 10, brown}, {9, 10, brown}, {10, 10, brown}, {4, 11, brown}, {5, 11, brown}, {6, 11, brown}, {9, 11, brown}, {10, 11, brown}, {3, 12, brown}, {4, 12, brown}, {10, 12, brown}, {11, 12, brown}, {2, 13, darkbrown}, {3, 13, darkbrown}, {11, 13, darkbrown}, {12, 13, darkbrown}, {8, 7, red}, {9, 7, red}, {10, 7, red}, {13, 4, red}, {10, 4, blue}, {9, 5, cheek}, {11, 8, yellow}};

  Pixel snow[] = {
      {4, 0, white}, {9, 0, white}, {1, 1, white}, {13, 2, white}, {5, 3, white}, {10, 3, white}, {2, 4, white}, {15, 5, white}, {4, 6, white}, {0, 7, white}, {6, 8, white}, {0, 12, white}, {1, 12, white}, {2, 12, white}, {3, 12, white}, {4, 12, white}, {5, 12, white}, {6, 12, white}, {7, 12, white}, {8, 12, white}, {9, 12, white}, {10, 12, white}, {11, 12, white}, {12, 12, white}, {13, 12, white}, {14, 12, white}, {15, 12, white}, {0, 13, white}, {1, 13, white}, {2, 13, white}, {3, 13, white}, {4, 13, white}, {5, 13, white}, {6, 13, white}, {7, 13, white}, {8, 13, white}, {9, 13, white}, {10, 13, white}, {11, 13, white}, {12, 13, white}, {13, 13, white}, {14, 13, white}, {15, 13, white}, {0, 14, white}, {1, 14, white}, {2, 14, white}, {3, 14, white}, {4, 14, white}, {5, 14, white}, {6, 14, white}, {7, 14, white}, {8, 14, white}, {9, 14, white}, {10, 14, white}, {11, 14, white}, {12, 14, white}, {13, 14, white}, {14, 14, white}, {15, 14, white}, {0, 15, white}, {1, 15, white}, {2, 15, white}, {3, 15, white}, {4, 15, white}, {5, 15, white}, {6, 15, white}, {7, 15, white}, {8, 15, white}, {9, 15, white}, {10, 15, white}, {11, 15, white}, {12, 15, white}, {13, 15, white}, {14, 15, white}, {15, 15, white}};

  Pixel snow_0[] = {
      {0, 10, white}, {7, 10, white}, {8, 10, white}, {15, 10, white}, {0, 11, white}, {1, 11, white}, {2, 11, white}, {5, 11, white}, {6, 11, white}, {7, 11, white}, {8, 11, white}, {9, 11, white}, {10, 11, white}, {13, 11, white}, {14, 11, white}, {15, 11, white}};

  Pixel snow_1[] = {
      {3, 10, white}, {4, 10, white}, {11, 10, white}, {12, 10, white}, {1, 11, white}, {2, 11, white}, {3, 11, white}, {4, 11, white}, {5, 11, white}, {6, 11, white}, {9, 11, white}, {10, 11, white}, {11, 11, white}, {12, 11, white}, {13, 11, white}, {14, 11, white}};

  for (int cur_frame = 0; cur_frame < total_frame; cur_frame++)
  {
    matrix.fillScreen(0);

    // Draw the common snow
    set_up_matrix(&matrix, snow, sizeof(snow) / sizeof(Pixel));

    // Make reindeer run and add snow
    if (cur_frame % 2 == 0)
    {
      set_up_matrix(&matrix, snow_0, sizeof(snow_0) / sizeof(Pixel));
      set_up_matrix(&matrix, frame0, sizeof(frame0) / sizeof(Pixel));
    }
    else
    {
      set_up_matrix(&matrix, snow_1, sizeof(snow_1) / sizeof(Pixel));
      set_up_matrix(&matrix, frame1, sizeof(frame1) / sizeof(Pixel));
    }

    matrix.show();
    delay(DEFAULT_DELAY);
  }
}

void candy_cane()
{
  int cur_frame = 0;
  int total_frame = DEFAULT_TOTAL_FRAME;
  // Make the total number of frames even
  if (total_frame % 2 == 1)
  {
    total_frame++;
  }

  uint16_t white = matrix.Color(255, 255, 255);
  uint16_t red = matrix.Color(255, 0, 0);
  uint16_t green = matrix.Color(78, 176, 19);
  uint16_t darkgreen = matrix.Color(2, 93, 77);

  Pixel frame0[] = {
      {11, 0, white}, {12, 0, white}, {11, 1, white}, {12, 1, white}, {14, 1, white}, {11, 2, white}, {14, 2, white}, {15, 2, white}, {13, 3, white}, {14, 3, white}, {12, 5, white}, {13, 5, white}, {14, 5, white}, {11, 6, white}, {12, 6, white}, {13, 6, white}, {8, 9, white}, {9, 9, white}, {10, 9, white}, {7, 10, white}, {8, 10, white}, {9, 10, white}, {4, 13, white}, {5, 13, white}, {6, 13, white}, {3, 14, white}, {4, 14, white}, {5, 14, white}, {13, 0, red}, {10, 1, red}, {13, 1, red}, {9, 2, red}, {10, 2, red}, {13, 2, red}, {9, 3, red}, {10, 3, red}, {15, 3, red}, {13, 4, red}, {14, 4, red}, {15, 4, red}, {10, 7, red}, {11, 7, red}, {12, 7, red}, {9, 8, red}, {10, 8, red}, {11, 8, red}, {6, 11, red}, {7, 11, red}, {8, 11, red}, {5, 12, red}, {6, 12, red}, {7, 12, red}, {2, 15, red}, {3, 15, red}, {4, 15, red}, {3, 0, darkgreen}, {4, 0, darkgreen}, {1, 1, darkgreen}, {3, 1, darkgreen}, {4, 1, darkgreen}, {0, 2, darkgreen}, {1, 2, darkgreen}, {4, 2, darkgreen}, {1, 3, darkgreen}, {2, 3, darkgreen}, {1, 5, darkgreen}, {2, 5, darkgreen}, {3, 5, darkgreen}, {2, 6, darkgreen}, {3, 6, darkgreen}, {4, 6, darkgreen}, {5, 9, darkgreen}, {6, 9, darkgreen}, {7, 9, darkgreen}, {6, 10, darkgreen}, {9, 13, darkgreen}, {10, 13, darkgreen}, {11, 13, darkgreen}, {10, 14, darkgreen}, {11, 14, darkgreen}, {12, 14, darkgreen}, {2, 0, green}, {2, 1, green}, {5, 1, green}, {2, 2, green}, {5, 2, green}, {6, 2, green}, {0, 3, green}, {5, 3, green}, {6, 3, green}, {0, 4, green}, {1, 4, green}, {2, 4, green}, {3, 7, green}, {4, 7, green}, {5, 7, green}, {4, 8, green}, {5, 8, green}, {6, 8, green}, {9, 11, green}, {8, 12, green}, {9, 12, green}, {10, 12, green}, {11, 15, green}, {12, 15, green}, {13, 15, green}};

  Pixel frame1[] = {
      {11, 0, red}, {12, 0, red}, {11, 1, red}, {12, 1, red}, {14, 1, red}, {11, 2, red}, {14, 2, red}, {15, 2, red}, {13, 3, red}, {14, 3, red}, {12, 5, red}, {13, 5, red}, {14, 5, red}, {11, 6, red}, {12, 6, red}, {13, 6, red}, {8, 9, red}, {9, 9, red}, {10, 9, red}, {7, 10, red}, {8, 10, red}, {9, 10, red}, {4, 13, red}, {5, 13, red}, {6, 13, red}, {3, 14, red}, {4, 14, red}, {5, 14, red}, {13, 0, white}, {10, 1, white}, {13, 1, white}, {9, 2, white}, {10, 2, white}, {13, 2, white}, {9, 3, white}, {10, 3, white}, {15, 3, white}, {13, 4, white}, {14, 4, white}, {15, 4, white}, {10, 7, white}, {11, 7, white}, {12, 7, white}, {9, 8, white}, {10, 8, white}, {11, 8, white}, {6, 11, white}, {7, 11, white}, {8, 11, white}, {5, 12, white}, {6, 12, white}, {7, 12, white}, {2, 15, white}, {3, 15, white}, {4, 15, white}, {3, 0, green}, {4, 0, green}, {1, 1, green}, {3, 1, green}, {4, 1, green}, {0, 2, green}, {1, 2, green}, {4, 2, green}, {1, 3, green}, {2, 3, green}, {1, 5, green}, {2, 5, green}, {3, 5, green}, {2, 6, green}, {3, 6, green}, {4, 6, green}, {5, 9, green}, {6, 9, green}, {7, 9, green}, {6, 10, green}, {9, 13, green}, {10, 13, green}, {11, 13, green}, {10, 14, green}, {11, 14, green}, {12, 14, green}, {2, 0, darkgreen}, {2, 1, darkgreen}, {5, 1, darkgreen}, {2, 2, darkgreen}, {5, 2, darkgreen}, {6, 2, darkgreen}, {0, 3, darkgreen}, {5, 3, darkgreen}, {6, 3, darkgreen}, {0, 4, darkgreen}, {1, 4, darkgreen}, {2, 4, darkgreen}, {3, 7, darkgreen}, {4, 7, darkgreen}, {5, 7, darkgreen}, {4, 8, darkgreen}, {5, 8, darkgreen}, {6, 8, darkgreen}, {9, 11, darkgreen}, {8, 12, darkgreen}, {9, 12, darkgreen}, {10, 12, darkgreen}, {11, 15, darkgreen}, {12, 15, darkgreen}, {13, 15, darkgreen}};

  for (int cur_frame = 0; cur_frame < total_frame; cur_frame++)
  {
    matrix.fillScreen(0);

    // Draw candy canes and flip the colors
    if (cur_frame % 2 == 1)
    {
      set_up_matrix(&matrix, frame0, sizeof(frame0) / sizeof(Pixel));
    }
    else
    {
      set_up_matrix(&matrix, frame1, sizeof(frame1) / sizeof(Pixel));
    }

    matrix.show();
    delay(DEFAULT_DELAY);
  }
}

void steaming_mug()
{
  int cur_frame = 0;
  int total_frame = 10;

  uint16_t red = matrix.Color(255, 0, 0);
  uint16_t darkred = matrix.Color(152, 0, 0);
  uint16_t brown = matrix.Color(67, 36, 13);
  uint16_t white = matrix.Color(255, 255, 255);

  Pixel frame0[] = {
      {4, 6, red}, {5, 6, red}, {6, 6, red}, {7, 6, red}, {8, 6, red}, {9, 6, red}, {10, 6, red}, {11, 6, red}, {12, 6, red}, {13, 6, red}, {14, 6, red}, {2, 7, red}, {3, 7, red}, {4, 7, red}, {5, 7, red}, {6, 7, red}, {8, 7, red}, {10, 7, red}, {12, 7, red}, {13, 7, red}, {14, 7, red}, {1, 8, red}, {4, 8, red}, {5, 8, red}, {8, 8, red}, {9, 8, red}, {10, 8, red}, {13, 8, red}, {14, 8, red}, {1, 9, red}, {4, 9, red}, {5, 9, red}, {6, 9, red}, {7, 9, red}, {8, 9, red}, {10, 9, red}, {11, 9, red}, {12, 9, red}, {13, 9, red}, {14, 9, red}, {1, 10, red}, {4, 10, red}, {5, 10, red}, {7, 10, red}, {11, 10, red}, {13, 10, red}, {14, 10, red}, {1, 11, red}, {4, 11, red}, {5, 11, red}, {6, 11, red}, {7, 11, red}, {8, 11, red}, {10, 11, red}, {11, 11, red}, {12, 11, red}, {13, 11, red}, {14, 11, red}, {1, 12, red}, {4, 12, red}, {5, 12, red}, {8, 12, red}, {9, 12, red}, {10, 12, red}, {13, 12, red}, {14, 12, red}, {2, 13, red}, {3, 13, red}, {4, 13, red}, {5, 13, red}, {6, 13, red}, {8, 13, red}, {10, 13, red}, {12, 13, red}, {13, 13, red}, {14, 13, red}, {4, 14, red}, {5, 14, red}, {6, 14, red}, {7, 14, red}, {8, 14, red}, {9, 14, red}, {10, 14, red}, {11, 14, red}, {12, 14, red}, {13, 14, red}, {14, 14, red}, {5, 15, red}, {6, 15, red}, {7, 15, red}, {8, 15, red}, {9, 15, red}, {10, 15, red}, {11, 15, red}, {12, 15, red}, {13, 15, red}, {4, 5, darkred}, {5, 5, darkred}, {6, 5, darkred}, {7, 5, darkred}, {8, 5, darkred}, {9, 5, darkred}, {10, 5, darkred}, {11, 5, darkred}, {12, 5, darkred}, {13, 5, darkred}, {14, 5, darkred}, {4, 3, darkred}, {5, 3, darkred}, {8, 3, darkred}, {11, 3, darkred}, {14, 3, darkred}, {3, 4, darkred}, {15, 4, darkred}, {4, 4, brown}, {5, 4, brown}, {8, 4, brown}, {11, 4, brown}, {14, 4, brown}, {7, 7, white}, {9, 7, white}, {11, 7, white}, {6, 8, white}, {7, 8, white}, {11, 8, white}, {12, 8, white}, {9, 9, white}, {6, 10, white}, {8, 10, white}, {9, 10, white}, {10, 10, white}, {12, 10, white}, {9, 11, white}, {6, 12, white}, {7, 12, white}, {11, 12, white}, {12, 12, white}, {7, 13, white}, {9, 13, white}, {11, 13, white}};

  Pixel frame1[] = {
      {6, 3, darkred}, {9, 3, darkred}, {12, 3, darkred}, {6, 4, brown}, {9, 4, brown}, {12, 4, brown}, {7, 0, white}, {10, 0, white}, {13, 0, white}, {7, 3, white}, {10, 3, white}, {13, 3, white}, {7, 4, white}, {10, 4, white}, {13, 4, white}, {6, 1, white}, {9, 1, white}, {12, 1, white}, {6, 2, white}, {9, 2, white}, {12, 2, white}};

  Pixel frame2[] = {
      {7, 3, darkred}, {10, 3, darkred}, {13, 3, darkred}, {7, 4, brown}, {10, 4, brown}, {13, 4, brown}, {7, 1, white}, {10, 1, white}, {13, 1, white}, {7, 2, white}, {10, 2, white}, {13, 2, white}, {6, 0, white}, {9, 0, white}, {12, 0, white}, {6, 3, white}, {9, 3, white}, {12, 3, white}, {6, 4, white}, {9, 4, white}, {12, 4, white}};

  for (int cur_frame = 0; cur_frame < total_frame; cur_frame++)
  {
    matrix.fillScreen(0);

    // Draw the mug
    set_up_matrix(&matrix, frame0, sizeof(frame0) / sizeof(Pixel));

    // Make the steam move
    if (cur_frame % 2 == 1)
    {
      set_up_matrix(&matrix, frame1, sizeof(frame1) / sizeof(Pixel));
    }
    else
    {
      set_up_matrix(&matrix, frame2, sizeof(frame2) / sizeof(Pixel));
    }

    matrix.show();
    delay(DEFAULT_DELAY);
  }
}

void snow_globe()
{
  int cur_frame = 0;
  int total_frame = DEFAULT_TOTAL_FRAME;

  uint16_t red = matrix.Color(255, 0, 0);
  uint16_t darkred = matrix.Color(152, 0, 0);
  uint16_t blue = matrix.Color(4, 43, 105);
  uint16_t orange = matrix.Color(255, 153, 0);
  uint16_t brown = matrix.Color(140, 82, 39);
  uint16_t white = matrix.Color(255, 255, 255);
  uint16_t lightblue = matrix.Color(76, 208, 252);
  uint16_t grey = matrix.Color(165, 165, 165);
  uint16_t darkbrown = matrix.Color(67, 36, 13);
  uint16_t yellow = matrix.Color(255, 255, 0);
  uint16_t green = matrix.Color(78, 176, 19);
  uint16_t darkgreen = matrix.Color(2, 93, 77);

  Pixel frame0[] = {
      {3, 13, red}, {4, 13, red}, {5, 13, red}, {6, 13, red}, {7, 13, red}, {8, 13, red}, {9, 13, red}, {10, 13, red}, {11, 13, red}, {12, 13, red}, {1, 15, red}, {2, 15, red}, {3, 15, red}, {4, 15, red}, {5, 15, red}, {6, 15, red}, {7, 15, red}, {8, 15, red}, {9, 15, red}, {10, 15, red}, {11, 15, red}, {12, 15, red}, {13, 15, red}, {14, 15, red}, {1, 14, darkred}, {2, 14, darkred}, {3, 14, darkred}, {4, 14, darkred}, {5, 14, darkred}, {6, 14, darkred}, {7, 14, darkred}, {8, 14, darkred}, {9, 14, darkred}, {10, 14, darkred}, {11, 14, darkred}, {12, 14, darkred}, {13, 14, darkred}, {14, 14, darkred}};

  Pixel frame1[] = {
      {5, 0, blue}, {6, 0, blue}, {7, 0, blue}, {8, 0, blue}, {9, 0, blue}, {4, 2, blue}, {5, 2, blue}, {6, 2, blue}, {7, 2, blue}, {8, 2, blue}, {9, 2, blue}, {10, 2, blue}, {6, 4, blue}, {8, 4, blue}, {7, 9, blue}, {7, 11, blue}, {5, 1, red}, {6, 1, red}, {7, 1, red}, {8, 1, red}, {9, 1, red}, {4, 7, red}, {6, 7, red}, {8, 7, red}, {4, 8, red}, {5, 8, red}, {4, 10, red}, {5, 10, red}, {7, 5, orange}, {5, 7, green}, {7, 7, green}, {4, 9, green}, {5, 9, green}, {11, 8, brown}, {12, 7, brown}, {12, 6, brown}, {5, 3, white}, {6, 3, white}, {7, 3, white}, {8, 3, white}, {9, 3, white}, {4, 4, white}, {5, 4, white}, {7, 4, white}, {9, 4, white}, {10, 4, white}, {4, 5, white}, {5, 5, white}, {6, 5, white}, {8, 5, white}, {9, 5, white}, {10, 5, white}, {5, 6, white}, {6, 6, white}, {7, 6, white}, {8, 6, white}, {9, 6, white}, {6, 8, white}, {7, 8, white}, {8, 8, white}, {9, 8, white}, {10, 8, white}, {3, 9, white}, {6, 9, white}, {8, 9, white}, {9, 9, white}, {10, 9, white}, {11, 9, white}, {3, 10, white}, {6, 10, white}, {7, 10, white}, {8, 10, white}, {9, 10, white}, {10, 10, white}, {11, 10, white}, {3, 11, white}, {4, 11, white}, {5, 11, white}, {6, 11, white}, {8, 11, white}, {9, 11, white}, {10, 11, white}, {11, 11, white}, {4, 12, white}, {5, 12, white}, {6, 12, white}, {7, 12, white}, {8, 12, white}, {9, 12, white}, {10, 12, white}, {4, 0, lightblue}, {10, 0, lightblue}, {11, 0, lightblue}, {3, 1, lightblue}, {4, 1, lightblue}, {10, 1, lightblue}, {11, 1, lightblue}, {12, 1, lightblue}, {2, 2, lightblue}, {3, 2, lightblue}, {11, 2, lightblue}, {12, 2, lightblue}, {13, 2, lightblue}, {1, 3, lightblue}, {2, 3, lightblue}, {3, 3, lightblue}, {4, 3, lightblue}, {10, 3, lightblue}, {11, 3, lightblue}, {12, 3, lightblue}, {13, 3, lightblue}, {14, 3, lightblue}, {1, 4, lightblue}, {2, 4, lightblue}, {3, 4, lightblue}, {11, 4, lightblue}, {12, 4, lightblue}, {13, 4, lightblue}, {14, 4, lightblue}, {0, 5, lightblue}, {1, 5, lightblue}, {2, 5, lightblue}, {3, 5, lightblue}, {11, 5, lightblue}, {12, 5, lightblue}, {13, 5, lightblue}, {14, 5, lightblue}, {15, 5, lightblue}, {0, 6, lightblue}, {1, 6, lightblue}, {2, 6, lightblue}, {3, 6, lightblue}, {4, 6, lightblue}, {10, 6, lightblue}, {11, 6, lightblue}, {13, 6, lightblue}, {14, 6, lightblue}, {15, 6, lightblue}, {0, 7, lightblue}, {1, 7, lightblue}, {2, 7, lightblue}, {3, 7, lightblue}, {9, 7, lightblue}, {10, 7, lightblue}, {11, 7, lightblue}, {13, 7, lightblue}, {14, 7, lightblue}, {15, 7, lightblue}, {0, 8, lightblue}, {1, 8, lightblue}, {2, 8, lightblue}, {3, 8, lightblue}, {12, 8, lightblue}, {13, 8, lightblue}, {14, 8, lightblue}, {15, 8, lightblue}, {1, 9, lightblue}, {2, 9, lightblue}, {12, 9, lightblue}, {13, 9, lightblue}, {14, 9, lightblue}, {1, 10, lightblue}, {2, 10, lightblue}, {12, 10, lightblue}, {13, 10, lightblue}, {14, 10, lightblue}, {2, 11, lightblue}, {12, 11, lightblue}, {13, 11, lightblue}, {3, 12, lightblue}, {11, 12, lightblue}, {12, 12, lightblue}};

  Pixel frame2[] = {
      {5, 0, white}, {8, 1, white}, {12, 1, white}, {3, 3, white}, {7, 3, white}, {8, 3, white}, {11, 3, white}, {1, 5, white}, {6, 5, white}, {7, 5, white}, {8, 5, white}, {9, 5, white}, {15, 5, white}, {12, 6, white}, {3, 7, white}, {5, 7, white}, {6, 7, white}, {7, 7, white}, {8, 7, white}, {9, 7, white}, {10, 7, white}, {4, 9, white}, {5, 9, white}, {6, 9, white}, {7, 9, white}, {8, 9, white}, {9, 9, white}, {10, 9, white}, {11, 9, white}, {1, 9, white}, {13, 9, white}, {2, 11, white}, {3, 11, white}, {4, 11, white}, {11, 11, white}, {12, 11, white}, {13, 11, white}, {3, 12, white}, {4, 12, white}, {5, 12, white}, {6, 12, white}, {7, 12, white}, {8, 12, white}, {9, 12, white}, {10, 12, white}, {11, 12, white}, {12, 12, white}, {7, 4, green}, {8, 4, green}, {6, 6, darkgreen}, {7, 6, darkgreen}, {8, 6, darkgreen}, {9, 6, darkgreen}, {5, 8, green}, {6, 8, green}, {7, 8, green}, {8, 8, green}, {9, 8, green}, {10, 8, green}, {4, 10, darkgreen}, {5, 10, darkgreen}, {6, 10, darkgreen}, {7, 10, darkgreen}, {8, 10, darkgreen}, {9, 10, darkgreen}, {10, 10, darkgreen}, {11, 10, darkgreen}, {7, 11, brown}, {8, 11, brown}, {4, 0, lightblue}, {6, 0, lightblue}, {7, 0, lightblue}, {8, 0, lightblue}, {9, 0, lightblue}, {10, 0, lightblue}, {11, 0, lightblue}, {3, 1, lightblue}, {4, 1, lightblue}, {5, 1, lightblue}, {6, 1, lightblue}, {7, 1, lightblue}, {9, 1, lightblue}, {10, 1, lightblue}, {11, 1, lightblue}, {2, 2, lightblue}, {3, 2, lightblue}, {4, 2, lightblue}, {5, 2, lightblue}, {6, 2, lightblue}, {7, 2, lightblue}, {8, 2, lightblue}, {9, 2, lightblue}, {10, 2, lightblue}, {11, 2, lightblue}, {12, 2, lightblue}, {13, 2, lightblue}, {1, 3, lightblue}, {2, 3, lightblue}, {4, 3, lightblue}, {5, 3, lightblue}, {6, 3, lightblue}, {9, 3, lightblue}, {10, 3, lightblue}, {12, 3, lightblue}, {13, 3, lightblue}, {14, 3, lightblue}, {1, 4, lightblue}, {2, 4, lightblue}, {3, 4, lightblue}, {4, 4, lightblue}, {5, 4, lightblue}, {6, 4, lightblue}, {9, 4, lightblue}, {10, 4, lightblue}, {11, 4, lightblue}, {12, 4, lightblue}, {13, 4, lightblue}, {14, 4, lightblue}, {0, 5, lightblue}, {2, 5, lightblue}, {3, 5, lightblue}, {4, 5, lightblue}, {5, 5, lightblue}, {10, 5, lightblue}, {11, 5, lightblue}, {12, 5, lightblue}, {13, 5, lightblue}, {14, 5, lightblue}, {0, 6, lightblue}, {1, 6, lightblue}, {2, 6, lightblue}, {3, 6, lightblue}, {4, 6, lightblue}, {5, 6, lightblue}, {10, 6, lightblue}, {11, 6, lightblue}, {13, 6, lightblue}, {14, 6, lightblue}, {15, 6, lightblue}, {0, 7, lightblue}, {1, 7, lightblue}, {2, 7, lightblue}, {4, 7, lightblue}, {11, 7, lightblue}, {12, 7, lightblue}, {13, 7, lightblue}, {14, 7, lightblue}, {15, 7, lightblue}, {0, 8, lightblue}, {1, 8, lightblue}, {2, 8, lightblue}, {3, 8, lightblue}, {4, 8, lightblue}, {11, 8, lightblue}, {12, 8, lightblue}, {13, 8, lightblue}, {14, 8, lightblue}, {15, 8, lightblue}, {2, 9, lightblue}, {3, 9, lightblue}, {12, 9, lightblue}, {14, 9, lightblue}, {1, 10, lightblue}, {2, 10, lightblue}, {3, 10, lightblue}, {12, 10, lightblue}, {13, 10, lightblue}, {14, 10, lightblue}, {5, 11, lightblue}, {6, 11, lightblue}, {9, 11, lightblue}, {10, 11, lightblue}};

  Pixel frame3[] = {
      {4, 0, lightblue}, {5, 0, lightblue}, {6, 0, lightblue}, {7, 0, lightblue}, {8, 0, lightblue}, {9, 0, lightblue}, {10, 0, lightblue}, {11, 0, lightblue}, {3, 1, lightblue}, {4, 1, lightblue}, {5, 1, lightblue}, {6, 1, lightblue}, {7, 1, lightblue}, {8, 1, lightblue}, {9, 1, lightblue}, {10, 1, lightblue}, {11, 1, lightblue}, {12, 1, lightblue}, {2, 2, lightblue}, {4, 2, lightblue}, {5, 2, lightblue}, {10, 2, lightblue}, {11, 2, lightblue}, {12, 2, lightblue}, {13, 2, lightblue}, {1, 3, lightblue}, {2, 3, lightblue}, {4, 3, lightblue}, {11, 3, lightblue}, {12, 3, lightblue}, {13, 3, lightblue}, {14, 3, lightblue}, {1, 4, lightblue}, {12, 4, lightblue}, {13, 4, lightblue}, {0, 5, lightblue}, {1, 5, lightblue}, {15, 5, lightblue}, {0, 6, lightblue}, {15, 6, lightblue}, {0, 7, lightblue}, {2, 9, lightblue}, {3, 12, white}, {4, 12, white}, {5, 12, white}, {6, 12, white}, {7, 12, white}, {8, 12, white}, {9, 12, white}, {10, 12, white}, {11, 12, white}, {12, 12, white}, {6, 2, white}, {7, 2, white}, {8, 2, white}, {9, 2, white}, {5, 3, white}, {6, 3, white}, {7, 3, white}, {8, 3, white}, {9, 3, white}, {10, 3, white}, {4, 4, white}, {5, 4, white}, {6, 4, white}, {7, 4, white}, {8, 4, white}, {9, 4, white}, {3, 5, white}, {5, 5, white}, {6, 5, white}, {1, 10, white}, {2, 10, white}, {13, 10, white}, {14, 10, white}, {2, 11, white}, {13, 11, white}, {10, 4, red}, {11, 4, red}, {4, 5, red}, {7, 5, red}, {8, 5, red}, {9, 5, red}, {10, 5, red}, {11, 5, red}, {12, 5, red}, {2, 6, red}, {3, 6, red}, {4, 6, red}, {5, 6, red}, {6, 6, red}, {7, 6, red}, {8, 6, red}, {9, 6, red}, {10, 6, red}, {11, 6, red}, {12, 6, red}, {13, 6, red}, {3, 7, grey}, {4, 7, grey}, {5, 7, grey}, {6, 7, grey}, {7, 7, grey}, {8, 7, grey}, {9, 7, grey}, {10, 7, grey}, {11, 7, grey}, {12, 7, grey}, {3, 8, grey}, {7, 8, grey}, {8, 8, grey}, {9, 8, grey}, {10, 8, grey}, {11, 8, grey}, {12, 8, grey}, {3, 9, grey}, {7, 9, grey}, {8, 9, grey}, {12, 9, grey}, {3, 10, grey}, {7, 10, grey}, {8, 10, grey}, {12, 10, grey}, {3, 11, grey}, {4, 11, grey}, {5, 11, grey}, {6, 11, grey}, {7, 11, grey}, {8, 11, grey}, {12, 11, grey}, {5, 9, yellow}, {3, 2, green}, {3, 3, green}, {2, 4, green}, {3, 4, green}, {14, 4, green}, {2, 5, green}, {13, 5, green}, {14, 5, green}, {1, 6, green}, {14, 6, green}, {1, 7, green}, {14, 7, green}, {15, 7, green}, {2, 7, darkgreen}, {13, 7, darkgreen}, {0, 8, darkgreen}, {1, 8, darkgreen}, {2, 8, darkgreen}, {13, 8, darkgreen}, {14, 8, darkgreen}, {15, 8, darkgreen}, {1, 9, darkgreen}, {2, 9, darkgreen}, {14, 9, darkgreen}, {13, 9, darkgreen}, {4, 8, brown}, {5, 8, brown}, {6, 8, brown}, {4, 9, brown}, {6, 9, brown}, {9, 9, brown}, {10, 9, brown}, {11, 9, brown}, {4, 10, brown}, {5, 10, brown}, {6, 10, brown}, {10, 10, brown}, {11, 10, brown}, {9, 11, brown}, {10, 11, brown}, {11, 11, brown}, {9, 10, darkbrown}};

  for (int cur_frame = 0; cur_frame < total_frame; cur_frame++)
  {
    matrix.fillScreen(0);

    // Draw the globe stand
    set_up_matrix(&matrix, frame0, sizeof(frame0) / sizeof(Pixel));

    // Change the scene inside the globe
    if (cur_frame < (total_frame / 3))
    {
      set_up_matrix(&matrix, frame1, sizeof(frame1) / sizeof(Pixel));
    }
    else if (cur_frame < 2 * (total_frame / 3))
    {
      set_up_matrix(&matrix, frame2, sizeof(frame2) / sizeof(Pixel));
    }
    else
    {
      set_up_matrix(&matrix, frame3, sizeof(frame3) / sizeof(Pixel));
    }

    matrix.show();
    delay(DEFAULT_DELAY);
  }
}

void open_gift()
{
  int cur_frame = 0;
  int total_frame = 12;

  uint16_t darkteal = matrix.Color(2, 93, 77);
  uint16_t yellow = matrix.Color(255, 255, 0);
  uint16_t red = matrix.Color(255, 0, 0);
  uint16_t darkred = matrix.Color(152, 0, 0);
  uint16_t blue = matrix.Color(4, 43, 105);
  uint16_t darkbrown = matrix.Color(67, 36, 13);
  uint16_t white = matrix.Color(255, 255, 255);
  uint16_t lightblue = matrix.Color(76, 208, 252);
  uint16_t pinkface = matrix.Color(249, 203, 203);

  Pixel frame0[] = {
      {0, 7, yellow}, {1, 7, yellow}, {2, 7, yellow}, {4, 7, yellow}, {5, 7, yellow}, {10, 7, yellow}, {11, 7, yellow}, {13, 7, yellow}, {14, 7, yellow}, {15, 7, yellow}, {0, 8, yellow}, {1, 8, yellow}, {2, 8, yellow}, {3, 8, yellow}, {12, 8, yellow}, {13, 8, yellow}, {14, 8, yellow}, {15, 8, yellow}, {7, 0, yellow}, {7, 1, yellow}, {7, 2, yellow}, {7, 3, yellow}, {7, 4, yellow}, {7, 5, yellow}, {7, 6, yellow}, {7, 9, yellow}, {7, 10, yellow}, {7, 11, yellow}, {7, 12, yellow}, {7, 13, yellow}, {7, 14, yellow}, {7, 15, yellow}, {8, 0, yellow}, {8, 1, yellow}, {8, 2, yellow}, {8, 3, yellow}, {8, 4, yellow}, {8, 5, yellow}, {8, 6, yellow}, {8, 9, yellow}, {8, 10, yellow}, {8, 11, yellow}, {8, 12, yellow}, {8, 13, yellow}, {8, 14, yellow}, {8, 15, yellow}, {7, 7, darkred}, {8, 7, darkred}, {7, 8, darkred}, {8, 8, darkred}, {3, 5, red}, {4, 5, red}, {5, 5, red}, {10, 5, red}, {11, 5, red}, {12, 5, red}, {3, 6, red}, {6, 6, red}, {9, 6, red}, {12, 6, red}, {3, 7, red}, {6, 7, red}, {9, 7, red}, {12, 7, red}, {4, 8, red}, {5, 8, red}, {6, 8, red}, {9, 8, red}, {10, 8, red}, {11, 8, red}, {6, 9, red}, {9, 9, red}, {5, 10, red}, {10, 10, red}, {3, 11, red}, {4, 11, red}, {11, 11, red}, {12, 11, red}};

  Pixel frame1[] = {
      {0, 7, yellow}, {1, 7, yellow}, {2, 7, yellow}, {3, 7, yellow}, {4, 7, yellow}, {5, 7, yellow}, {6, 7, yellow}, {7, 7, yellow}, {8, 7, yellow}, {9, 7, yellow}, {10, 7, yellow}, {11, 7, yellow}, {12, 7, yellow}, {13, 7, yellow}, {14, 7, yellow}, {15, 7, yellow}, {0, 8, yellow}, {1, 8, yellow}, {2, 8, yellow}, {3, 8, yellow}, {4, 8, yellow}, {5, 8, yellow}, {6, 8, yellow}, {7, 8, yellow}, {8, 8, yellow}, {9, 8, yellow}, {10, 8, yellow}, {11, 8, yellow}, {12, 8, yellow}, {13, 8, yellow}, {14, 8, yellow}, {15, 8, yellow}, {7, 0, yellow}, {7, 1, yellow}, {7, 2, yellow}, {7, 3, yellow}, {7, 4, yellow}, {7, 5, yellow}, {7, 6, yellow}, {7, 9, yellow}, {7, 10, yellow}, {7, 11, yellow}, {7, 12, yellow}, {7, 13, yellow}, {7, 14, yellow}, {7, 15, yellow}, {8, 0, yellow}, {8, 1, yellow}, {8, 2, yellow}, {8, 3, yellow}, {8, 4, yellow}, {8, 5, yellow}, {8, 6, yellow}, {8, 9, yellow}, {8, 10, yellow}, {8, 11, yellow}, {8, 12, yellow}, {8, 13, yellow}, {8, 14, yellow}, {8, 15, yellow}};

  Pixel frame2[] = {
      {5, 0, darkbrown}, {6, 0, darkbrown}, {7, 0, darkbrown}, {8, 0, darkbrown}, {9, 0, darkbrown}, {10, 0, darkbrown}, {1, 1, darkbrown}, {2, 1, darkbrown}, {3, 1, darkbrown}, {12, 1, darkbrown}, {1, 2, darkbrown}, {2, 2, darkbrown}, {3, 2, darkbrown}, {12, 2, darkbrown}, {1, 3, darkbrown}, {2, 3, darkbrown}, {3, 3, darkbrown}, {12, 3, darkbrown}, {13, 3, darkbrown}, {14, 3, darkbrown}, {6, 2, blue}, {9, 2, blue}, {4, 1, red}, {11, 1, red}, {7, 4, red}, {8, 4, red}, {3, 8, red}, {4, 8, red}, {5, 8, red}, {6, 8, red}, {7, 8, red}, {8, 8, red}, {9, 8, red}, {10, 8, red}, {11, 8, red}, {12, 8, red}, {3, 9, red}, {4, 9, red}, {5, 9, red}, {6, 9, red}, {7, 9, red}, {8, 9, red}, {9, 9, red}, {10, 9, red}, {11, 9, red}, {12, 9, red}, {5, 10, red}, {6, 10, red}, {7, 10, red}, {8, 10, red}, {9, 10, red}, {10, 10, red}, {5, 12, red}, {6, 12, red}, {9, 12, red}, {10, 12, red}, {5, 13, red}, {6, 13, red}, {9, 13, red}, {10, 13, red}, {6, 14, red}, {9, 14, red}, {10, 14, red}, {6, 7, white}, {7, 7, white}, {8, 7, white}, {9, 7, white}, {2, 8, white}, {13, 8, white}, {2, 9, white}, {13, 9, white}, {5, 11, white}, {6, 11, white}, {7, 11, white}, {8, 11, white}, {9, 11, white}, {10, 11, white}, {6, 15, white}, {9, 15, white}, {10, 15, white}, {0, 0, lightblue}, {1, 0, lightblue}, {2, 0, lightblue}, {3, 0, lightblue}, {4, 0, lightblue}, {11, 0, lightblue}, {0, 1, lightblue}, {0, 2, lightblue}, {4, 2, lightblue}, {11, 2, lightblue}, {0, 3, lightblue}, {4, 3, lightblue}, {11, 3, lightblue}, {0, 4, lightblue}, {1, 4, lightblue}, {2, 4, lightblue}, {3, 4, lightblue}, {4, 4, lightblue}, {11, 4, lightblue}, {12, 4, lightblue}, {13, 4, lightblue}, {14, 4, lightblue}, {0, 5, lightblue}, {1, 5, lightblue}, {2, 5, lightblue}, {3, 5, lightblue}, {4, 5, lightblue}, {5, 5, lightblue}, {10, 5, lightblue}, {11, 5, lightblue}, {12, 5, lightblue}, {13, 5, lightblue}, {14, 5, lightblue}, {15, 5, lightblue}, {0, 6, lightblue}, {1, 6, lightblue}, {2, 6, lightblue}, {3, 6, lightblue}, {4, 6, lightblue}, {5, 6, lightblue}, {6, 6, lightblue}, {9, 6, lightblue}, {10, 6, lightblue}, {11, 6, lightblue}, {12, 6, lightblue}, {13, 6, lightblue}, {14, 6, lightblue}, {15, 6, lightblue}, {0, 7, lightblue}, {1, 7, lightblue}, {2, 7, lightblue}, {3, 7, lightblue}, {4, 7, lightblue}, {5, 7, lightblue}, {10, 7, lightblue}, {11, 7, lightblue}, {12, 7, lightblue}, {13, 7, lightblue}, {14, 7, lightblue}, {15, 7, lightblue}, {0, 8, lightblue}, {15, 8, lightblue}, {0, 9, lightblue}, {1, 9, lightblue}, {14, 9, lightblue}, {15, 9, lightblue}, {0, 10, lightblue}, {1, 10, lightblue}, {2, 10, lightblue}, {3, 10, lightblue}, {4, 10, lightblue}, {11, 10, lightblue}, {12, 10, lightblue}, {13, 10, lightblue}, {14, 10, lightblue}, {15, 10, lightblue}, {0, 11, lightblue}, {1, 11, lightblue}, {2, 11, lightblue}, {3, 11, lightblue}, {4, 11, lightblue}, {11, 11, lightblue}, {12, 11, lightblue}, {13, 11, lightblue}, {15, 11, lightblue}, {4, 12, lightblue}, {7, 12, lightblue}, {8, 12, lightblue}, {11, 12, lightblue}, {12, 12, lightblue}, {7, 13, lightblue}, {8, 13, lightblue}, {11, 13, lightblue}, {12, 13, lightblue}, {7, 14, lightblue}, {8, 14, lightblue}, {11, 14, lightblue}, {12, 14, lightblue}, {7, 15, lightblue}, {8, 15, lightblue}, {11, 15, lightblue}, {5, 1, pinkface}, {6, 1, pinkface}, {7, 1, pinkface}, {8, 1, pinkface}, {9, 1, pinkface}, {10, 1, pinkface}, {5, 2, pinkface}, {7, 2, pinkface}, {8, 2, pinkface}, {10, 2, pinkface}, {5, 3, pinkface}, {6, 3, pinkface}, {7, 3, pinkface}, {8, 3, pinkface}, {9, 3, pinkface}, {10, 3, pinkface}, {5, 4, pinkface}, {6, 4, pinkface}, {9, 4, pinkface}, {10, 4, pinkface}, {6, 5, pinkface}, {7, 5, pinkface}, {8, 5, pinkface}, {9, 5, pinkface}, {7, 6, pinkface}, {8, 6, pinkface}, {1, 8, pinkface}, {14, 8, pinkface}};

  for (int cur_frame = 0; cur_frame < total_frame; cur_frame++)
  {
    // Draw the wrapping paper
    matrix.fillScreen(darkteal);

    if (cur_frame <= (total_frame / 8))
    {
      set_up_matrix(&matrix, frame0, sizeof(frame0) / sizeof(Pixel));
    }
    else if (cur_frame <= (2 * total_frame / 8))
    {
      set_up_matrix(&matrix, frame1, sizeof(frame1) / sizeof(Pixel));
    }
    else if (cur_frame >= (5 * total_frame / 8))
    {
      set_up_matrix(&matrix, frame2, sizeof(frame2) / sizeof(Pixel));
    }

    matrix.show();
    delay(DEFAULT_DELAY);
  }
}

void santa_hat()
{
  int cur_frame = 0;
  int total_frame = DEFAULT_TOTAL_FRAME;

  uint16_t red = matrix.Color(255, 0, 0);
  uint16_t darkred = matrix.Color(152, 0, 0);
  uint16_t white = matrix.Color(255, 255, 255);

  Pixel frame0[] = {
      {8, 0, darkred}, {9, 0, darkred}, {10, 0, darkred}, {11, 0, darkred}, {6, 1, darkred}, {7, 1, darkred}, {8, 1, darkred}, {9, 1, darkred}, {10, 1, darkred}, {11, 1, darkred}, {12, 1, darkred}, {13, 1, darkred}, {6, 2, darkred}, {7, 2, darkred}, {8, 2, darkred}, {9, 2, darkred}, {10, 2, darkred}, {11, 2, darkred}, {12, 2, darkred}, {13, 2, darkred}, {14, 2, darkred}, {5, 3, darkred}, {6, 3, darkred}, {7, 3, darkred}, {8, 3, darkred}, {9, 3, darkred}, {10, 3, darkred}, {11, 3, darkred}, {12, 3, darkred}, {13, 3, darkred}, {14, 3, darkred}, {15, 3, darkred}, {5, 4, darkred}, {6, 4, darkred}, {7, 4, darkred}, {8, 4, darkred}, {9, 4, darkred}, {10, 4, darkred}, {11, 4, darkred}, {12, 4, darkred}, {13, 4, darkred}, {14, 4, darkred}, {15, 4, darkred}, {4, 5, darkred}, {5, 5, darkred}, {6, 5, darkred}, {7, 5, darkred}, {8, 5, darkred}, {9, 5, darkred}, {10, 5, darkred}, {11, 5, darkred}, {14, 5, darkred}, {15, 5, darkred}, {4, 6, darkred}, {5, 6, darkred}, {6, 6, darkred}, {7, 6, darkred}, {8, 6, darkred}, {9, 6, darkred}, {10, 6, darkred}, {11, 6, darkred}, {3, 7, darkred}, {4, 7, darkred}, {5, 7, darkred}, {6, 7, darkred}, {7, 7, darkred}, {8, 7, darkred}, {9, 7, darkred}, {10, 7, darkred}, {11, 7, darkred}, {3, 8, darkred}, {4, 8, darkred}, {5, 8, darkred}, {6, 8, darkred}, {7, 8, darkred}, {8, 8, darkred}, {9, 8, darkred}, {10, 8, darkred}, {11, 8, darkred}, {2, 9, darkred}, {3, 9, darkred}, {4, 9, darkred}, {5, 9, darkred}, {6, 9, darkred}, {7, 9, darkred}, {8, 9, darkred}, {9, 9, darkred}, {10, 9, darkred}, {11, 9, darkred}, {12, 9, darkred}, {2, 10, darkred}, {3, 10, darkred}, {4, 10, darkred}, {5, 10, darkred}, {6, 10, darkred}, {7, 10, darkred}, {8, 10, darkred}, {9, 10, darkred}, {10, 10, darkred}, {11, 10, darkred}, {12, 10, darkred}, {1, 11, darkred}, {2, 11, darkred}, {3, 11, darkred}, {4, 11, darkred}, {5, 11, darkred}, {6, 11, darkred}, {7, 11, darkred}, {8, 11, darkred}, {9, 11, darkred}, {10, 11, darkred}, {11, 11, darkred}, {12, 11, darkred}, {13, 11, darkred}, {1, 12, darkred}, {2, 12, darkred}, {3, 12, darkred}, {4, 12, darkred}, {5, 12, darkred}, {6, 12, darkred}, {7, 12, darkred}, {8, 12, darkred}, {9, 12, darkred}, {10, 12, darkred}, {11, 12, darkred}, {12, 12, darkred}, {13, 12, darkred}, {14, 6, white}, {15, 6, white}, {14, 7, white}, {15, 7, white}, {0, 13, white}, {1, 13, white}, {2, 13, white}, {3, 13, white}, {4, 13, white}, {5, 13, white}, {6, 13, white}, {7, 13, white}, {8, 13, white}, {9, 13, white}, {10, 13, white}, {11, 13, white}, {12, 13, white}, {13, 13, white}, {14, 13, white}, {0, 14, white}, {1, 14, white}, {2, 14, white}, {3, 14, white}, {4, 14, white}, {5, 14, white}, {6, 14, white}, {7, 14, white}, {8, 14, white}, {9, 14, white}, {10, 14, white}, {11, 14, white}, {12, 14, white}, {13, 14, white}, {14, 14, white}, {0, 15, white}, {1, 15, white}, {2, 15, white}, {3, 15, white}, {4, 15, white}, {5, 15, white}, {6, 15, white}, {7, 15, white}, {8, 15, white}, {9, 15, white}, {10, 15, white}, {11, 15, white}, {12, 15, white}, {13, 15, white}, {14, 15, white}};

  Pixel frame1[] = {
      {12, 1, red}, {11, 2, red}, {11, 3, red}, {5, 4, red}, {12, 4, red}, {6, 5, red}, {7, 5, red}, {8, 6, red}, {9, 6, red}, {10, 7, red}, {11, 7, red}, {3, 8, red}, {4, 9, red}, {5, 9, red}, {6, 10, red}, {7, 10, red}, {8, 11, red}, {9, 11, red}, {10, 11, red}, {11, 12, red}, {12, 12, red}, {13, 12, red}, {1, 14, red}, {3, 14, red}, {5, 14, red}, {7, 14, red}, {9, 14, red}, {11, 14, red}, {13, 14, red}, {13, 6, white}, {13, 7, white}, {13, 8, white}, {14, 8, white}, {15, 8, white}};

  for (int cur_frame = 0; cur_frame < total_frame; cur_frame++)
  {
    matrix.fillScreen(0);

    // Draw the hat
    set_up_matrix(&matrix, frame0, sizeof(frame0) / sizeof(Pixel));

    // Add light
    if (cur_frame % 2 == 1)
    {
      set_up_matrix(&matrix, frame1, sizeof(frame1) / sizeof(Pixel));
    }

    matrix.show();
    delay(DEFAULT_DELAY);
  }
}

void teddy_bear()
{
  int cur_frame = 0;
  int total_frame = DEFAULT_TOTAL_FRAME;

  uint16_t red = matrix.Color(255, 0, 0);
  uint16_t white = matrix.Color(255, 255, 255);
  uint16_t darkbrown = matrix.Color(93, 41, 3);
  uint16_t darkdarkbrown = matrix.Color(67, 36, 13);
  uint16_t pink = matrix.Color(235, 179, 205);
  uint16_t blue = matrix.Color(4, 43, 105);
  uint16_t gold = matrix.Color(249, 199, 47);
  uint16_t brown = matrix.Color(140, 82, 39);

  Pixel frame0[] = {
      {3, 0, brown}, {4, 0, brown}, {10, 0, brown}, {11, 0, brown}, {2, 1, brown}, {5, 1, brown}, {6, 1, brown}, {7, 1, brown}, {8, 1, brown}, {9, 1, brown}, {12, 1, brown}, {2, 2, brown}, {3, 2, brown}, {4, 2, brown}, {5, 2, brown}, {6, 2, brown}, {7, 2, brown}, {8, 2, brown}, {9, 2, brown}, {10, 2, brown}, {12, 2, brown}, {2, 3, brown}, {3, 3, brown}, {4, 3, brown}, {6, 3, brown}, {7, 3, brown}, {8, 3, brown}, {10, 3, brown}, {11, 3, brown}, {12, 3, brown}, {3, 4, brown}, {4, 4, brown}, {5, 4, brown}, {9, 4, brown}, {10, 4, brown}, {11, 4, brown}, {3, 5, brown}, {4, 5, brown}, {10, 5, brown}, {11, 5, brown}, {4, 6, brown}, {5, 6, brown}, {9, 6, brown}, {10, 6, brown}, {3, 1, pink}, {4, 1, pink}, {10, 1, pink}, {11, 1, pink}, {3, 2, pink}, {11, 2, pink}, {5, 3, blue}, {9, 3, blue}, {7, 4, darkdarkbrown}, {6, 4, gold}, {8, 4, gold}, {5, 5, gold}, {6, 5, gold}, {7, 5, gold}, {8, 5, gold}, {9, 5, gold}, {6, 6, gold}, {7, 6, gold}, {8, 6, gold}, {3, 12, gold}, {4, 12, gold}, {5, 12, gold}, {9, 12, gold}, {10, 12, gold}, {11, 12, gold}, {3, 13, gold}, {4, 13, gold}, {5, 13, gold}, {9, 13, gold}, {10, 13, gold}, {11, 13, gold}, {3, 14, gold}, {4, 14, gold}, {5, 14, gold}, {9, 14, gold}, {10, 14, gold}, {11, 14, gold}, {3, 11, darkbrown}, {4, 11, darkbrown}, {5, 11, darkbrown}, {9, 11, darkbrown}, {10, 11, darkbrown}, {11, 11, darkbrown}, {2, 12, darkbrown}, {6, 12, darkbrown}, {8, 12, darkbrown}, {12, 12, darkbrown}, {2, 13, darkbrown}, {6, 13, darkbrown}, {8, 13, darkbrown}, {12, 13, darkbrown}, {2, 14, darkbrown}, {6, 14, darkbrown}, {8, 14, darkbrown}, {12, 14, darkbrown}, {3, 15, darkbrown}, {4, 15, darkbrown}, {5, 15, darkbrown}, {9, 15, darkbrown}, {10, 15, darkbrown}, {11, 15, darkbrown}};

  Pixel frame1[] = {
      {4, 7, brown}, {5, 7, brown}, {6, 7, brown}, {7, 7, brown}, {8, 7, brown}, {9, 7, brown}, {10, 7, brown}, {5, 8, brown}, {6, 8, brown}, {7, 8, brown}, {8, 8, brown}, {9, 8, brown}, {5, 9, brown}, {6, 9, brown}, {7, 9, brown}, {8, 9, brown}, {9, 9, brown}, {4, 10, brown}, {5, 10, brown}, {6, 10, brown}, {8, 10, brown}, {9, 10, brown}, {10, 10, brown}, {6, 11, brown}, {7, 11, brown}, {8, 11, brown}, {7, 10, darkdarkbrown}, {3, 8, gold}, {11, 8, gold}, {3, 9, gold}, {11, 9, gold}, {3, 7, darkbrown}, {11, 7, darkbrown}, {2, 8, darkbrown}, {4, 8, darkbrown}, {10, 8, darkbrown}, {12, 8, darkbrown}, {2, 9, darkbrown}, {4, 9, darkbrown}, {10, 9, darkbrown}, {12, 9, darkbrown}, {3, 10, darkbrown}, {11, 10, darkbrown}};

  Pixel frame2[] = {
      {5, 7, white}, {5, 6, red}, {9, 6, red}, {4, 7, red}, {6, 7, red}, {8, 7, red}, {9, 7, red}, {10, 7, red}, {3, 8, red}, {4, 8, red}, {5, 8, red}, {6, 8, red}, {7, 8, red}, {8, 8, red}, {9, 8, red}, {10, 8, red}, {11, 8, red}, {4, 9, red}, {5, 9, red}, {6, 9, red}, {7, 9, red}, {8, 9, red}, {9, 9, red}, {10, 9, red}, {5, 10, red}, {6, 10, red}, {7, 10, red}, {8, 10, red}, {9, 10, red}, {6, 11, red}, {7, 11, red}, {8, 11, red}, {7, 12, red}, {2, 7, brown}, {3, 7, brown}, {7, 7, brown}, {11, 7, brown}, {12, 7, brown}, {3, 9, brown}, {11, 9, brown}, {2, 10, brown}, {3, 10, brown}, {4, 10, brown}, {10, 10, brown}, {11, 10, brown}, {12, 10, brown}, {1, 8, gold}, {13, 8, gold}, {1, 9, gold}, {13, 9, gold}, {1, 7, darkbrown}, {13, 7, darkbrown}, {0, 8, darkbrown}, {2, 8, darkbrown}, {12, 8, darkbrown}, {14, 8, darkbrown}, {0, 9, darkbrown}, {2, 9, darkbrown}, {12, 9, darkbrown}, {14, 9, darkbrown}, {1, 10, darkbrown}, {13, 10, darkbrown}};

  for (int cur_frame = 0; cur_frame < total_frame; cur_frame++)
  {
    matrix.fillScreen(0);

    // Draw the bear
    set_up_matrix(&matrix, frame0, sizeof(frame0) / sizeof(Pixel));

    // Move its arms and add the heart
    if (cur_frame % 2 == 0)
    {
      set_up_matrix(&matrix, frame1, sizeof(frame1) / sizeof(Pixel));
    }
    else
    {
      set_up_matrix(&matrix, frame2, sizeof(frame2) / sizeof(Pixel));
    }

    matrix.show();
    delay(DEFAULT_DELAY);
  }
}

void bell()
{
  int cur_frame = 0;
  int total_frame = DEFAULT_TOTAL_FRAME;

  uint16_t red = matrix.Color(255, 0, 0);
  uint16_t white = matrix.Color(255, 255, 255);
  uint16_t gold = matrix.Color(249, 199, 47);
  uint16_t brown = matrix.Color(140, 82, 39);
  uint16_t yellow = matrix.Color(249, 199, 47);
  uint16_t darkred = matrix.Color(152, 0, 0);

  Pixel frame0[] = {
      {4, 1, red}, {5, 1, red}, {10, 1, red}, {11, 1, red}, {3, 2, red}, {4, 2, red}, {5, 2, red}, {6, 2, red}, {9, 2, red}, {10, 2, red}, {11, 2, red}, {12, 2, red}, {2, 3, red}, {3, 3, red}, {4, 3, red}, {5, 3, red}, {6, 3, red}, {9, 3, red}, {10, 3, red}, {11, 3, red}, {12, 3, red}, {13, 3, red}, {3, 4, red}, {4, 4, red}, {5, 4, red}, {6, 4, red}, {9, 4, red}, {10, 4, red}, {11, 4, red}, {12, 4, red}, {5, 5, red}, {10, 5, red}, {4, 6, red}, {11, 6, red}, {3, 7, red}, {4, 7, red}, {11, 7, red}, {12, 7, red}, {7, 3, darkred}, {8, 3, darkred}, {7, 4, darkred}, {8, 4, darkred}, {6, 5, yellow}, {7, 5, yellow}, {8, 5, yellow}, {5, 6, yellow}, {6, 6, yellow}, {7, 6, yellow}, {5, 7, yellow}, {6, 7, yellow}, {7, 7, yellow}, {4, 8, yellow}, {5, 8, yellow}, {6, 8, yellow}, {7, 8, yellow}, {4, 9, yellow}, {5, 9, yellow}, {6, 9, yellow}, {7, 9, yellow}, {4, 10, yellow}, {5, 10, yellow}, {6, 10, yellow}, {7, 10, yellow}, {4, 11, yellow}, {5, 11, yellow}, {6, 11, yellow}, {7, 11, yellow}, {3, 12, yellow}, {4, 12, yellow}, {5, 12, yellow}, {6, 12, yellow}, {2, 13, yellow}, {3, 13, yellow}, {4, 13, yellow}, {5, 13, yellow}, {9, 5, gold}, {8, 6, gold}, {9, 6, gold}, {10, 6, gold}, {8, 7, gold}, {9, 7, gold}, {10, 7, gold}, {8, 8, gold}, {9, 8, gold}, {10, 8, gold}, {11, 8, gold}, {8, 9, gold}, {9, 9, gold}, {10, 9, gold}, {11, 9, gold}, {8, 10, gold}, {9, 10, gold}, {10, 10, gold}, {11, 10, gold}, {8, 11, gold}, {9, 11, gold}, {10, 11, gold}, {11, 11, gold}, {7, 12, gold}, {8, 12, gold}, {9, 12, gold}, {10, 12, gold}, {11, 12, gold}, {12, 12, gold}, {6, 13, gold}, {7, 13, gold}, {8, 13, gold}, {9, 13, gold}, {10, 13, gold}, {11, 13, gold}, {12, 13, gold}, {13, 13, gold}};

  Pixel frame1[] = {
      {8, 14, brown}, {9, 14, brown}};

  Pixel frame2[] = {
      {6, 14, brown}, {7, 14, brown}, {6, 6, white}, {5, 7, white}, {5, 8, white}};

  for (int cur_frame = 0; cur_frame < total_frame; cur_frame++)
  {
    matrix.fillScreen(0);

    // Draw the bell
    set_up_matrix(&matrix, frame0, sizeof(frame0) / sizeof(Pixel));

    // Move the clapper
    if (cur_frame % 2 == 0)
    {
      set_up_matrix(&matrix, frame1, sizeof(frame1) / sizeof(Pixel));
    }
    else
    {
      set_up_matrix(&matrix, frame2, sizeof(frame2) / sizeof(Pixel));
    }

    matrix.show();
    delay(DEFAULT_DELAY);
  }
}

void fireplace()
{
  int cur_frame = 0;
  int total_frame = 32;

  uint16_t red = matrix.Color(255, 0, 0);
  uint16_t white = matrix.Color(255, 255, 255);
  uint16_t brown = matrix.Color(140, 82, 39);
  uint16_t yellow = matrix.Color(249, 199, 47);
  uint16_t grey = matrix.Color(165, 165, 165);
  uint16_t darkbrown = matrix.Color(67, 36, 13);
  uint16_t orange = matrix.Color(255, 109, 1);

  Pixel frame0[] = {
      {0, 0, grey}, {1, 0, grey}, {2, 0, grey}, {3, 0, grey}, {4, 0, grey}, {5, 0, grey}, {6, 0, grey}, {7, 0, grey}, {8, 0, grey}, {9, 0, grey}, {10, 0, grey}, {11, 0, grey}, {12, 0, grey}, {13, 0, grey}, {14, 0, grey}, {15, 0, grey}, {1, 1, grey}, {1, 2, grey}, {2, 2, grey}, {3, 2, grey}, {4, 2, grey}, {5, 2, grey}, {6, 2, grey}, {7, 2, grey}, {8, 2, grey}, {9, 2, grey}, {10, 2, grey}, {11, 2, grey}, {12, 2, grey}, {13, 2, grey}, {14, 2, grey}, {1, 13, grey}, {2, 13, grey}, {3, 13, grey}, {4, 13, grey}, {5, 13, grey}, {6, 13, grey}, {7, 13, grey}, {8, 13, grey}, {9, 13, grey}, {10, 13, grey}, {11, 13, grey}, {12, 13, grey}, {13, 13, grey}, {14, 13, grey}, {0, 15, grey}, {1, 15, grey}, {2, 15, grey}, {3, 15, grey}, {4, 15, grey}, {5, 15, grey}, {6, 15, grey}, {7, 15, grey}, {8, 15, grey}, {9, 15, grey}, {10, 15, grey}, {11, 15, grey}, {12, 15, grey}, {13, 15, grey}, {14, 15, grey}, {15, 15, grey}, {1, 2, grey}, {1, 3, grey}, {1, 4, grey}, {1, 5, grey}, {1, 6, grey}, {1, 7, grey}, {1, 8, grey}, {1, 9, grey}, {1, 10, grey}, {1, 11, grey}, {1, 12, grey}, {1, 13, grey}, {14, 2, grey}, {14, 3, grey}, {14, 4, grey}, {14, 5, grey}, {14, 6, grey}, {14, 7, grey}, {14, 8, grey}, {14, 9, grey}, {14, 10, grey}, {14, 11, grey}, {14, 12, grey}, {14, 13, grey}, {0, 1, darkbrown}, {1, 1, darkbrown}, {2, 1, darkbrown}, {3, 1, darkbrown}, {4, 1, darkbrown}, {5, 1, darkbrown}, {6, 1, darkbrown}, {7, 1, darkbrown}, {8, 1, darkbrown}, {9, 1, darkbrown}, {10, 1, darkbrown}, {11, 1, darkbrown}, {12, 1, darkbrown}, {13, 1, darkbrown}, {14, 1, darkbrown}, {15, 1, darkbrown}, {0, 14, darkbrown}, {1, 14, darkbrown}, {2, 14, darkbrown}, {3, 14, darkbrown}, {4, 14, darkbrown}, {5, 14, darkbrown}, {6, 14, darkbrown}, {7, 14, darkbrown}, {8, 14, darkbrown}, {9, 14, darkbrown}, {10, 14, darkbrown}, {11, 14, darkbrown}, {12, 14, darkbrown}, {13, 14, darkbrown}, {14, 14, darkbrown}, {15, 14, darkbrown}, {0, 2, darkbrown}, {0, 3, darkbrown}, {0, 4, darkbrown}, {0, 5, darkbrown}, {0, 6, darkbrown}, {0, 7, darkbrown}, {0, 8, darkbrown}, {0, 9, darkbrown}, {0, 10, darkbrown}, {0, 11, darkbrown}, {0, 12, darkbrown}, {0, 13, darkbrown}, {15, 2, darkbrown}, {15, 3, darkbrown}, {15, 4, darkbrown}, {15, 5, darkbrown}, {15, 6, darkbrown}, {15, 7, darkbrown}, {15, 8, darkbrown}, {15, 9, darkbrown}, {15, 10, darkbrown}, {15, 11, darkbrown}, {15, 12, darkbrown}, {15, 13, darkbrown}, {4, 11, brown}, {5, 11, brown}, {6, 11, brown}, {7, 11, brown}, {8, 11, brown}, {9, 11, brown}, {10, 11, brown}, {11, 11, brown}, {3, 12, brown}, {4, 12, brown}, {5, 12, brown}, {6, 12, brown}, {7, 12, brown}, {8, 12, brown}, {9, 12, brown}, {10, 12, brown}, {11, 12, brown}, {12, 12, brown}};

  Pixel frame1[] = {
      {8, 3, yellow}, {7, 4, yellow}, {8, 4, yellow}, {9, 4, yellow}, {7, 5, yellow}, {8, 5, yellow}, {9, 5, yellow}, {6, 6, yellow}, {7, 6, yellow}, {8, 6, yellow}, {9, 6, yellow}, {10, 6, yellow}, {5, 7, yellow}, {6, 7, yellow}, {7, 7, yellow}, {9, 7, yellow}, {10, 7, yellow}, {5, 8, yellow}, {6, 8, yellow}, {9, 8, yellow}, {10, 8, yellow}, {11, 8, yellow}, {4, 9, yellow}, {5, 9, yellow}, {6, 9, yellow}, {10, 9, yellow}, {11, 9, yellow}, {5, 10, yellow}, {10, 10, yellow}, {8, 7, orange}, {7, 8, orange}, {8, 8, orange}, {7, 9, orange}, {8, 9, orange}, {9, 9, orange}, {6, 10, orange}, {7, 10, orange}, {8, 10, orange}, {9, 10, orange}};

  Pixel frame2[] = {
      {7, 3, yellow}, {6, 4, yellow}, {7, 4, yellow}, {8, 4, yellow}, {6, 5, yellow}, {7, 5, yellow}, {8, 5, yellow}, {5, 6, yellow}, {6, 6, yellow}, {7, 6, yellow}, {8, 6, yellow}, {9, 6, yellow}, {5, 7, yellow}, {6, 7, yellow}, {8, 7, yellow}, {9, 7, yellow}, {10, 7, yellow}, {4, 8, yellow}, {5, 8, yellow}, {6, 8, yellow}, {9, 8, yellow}, {10, 8, yellow}, {4, 9, yellow}, {5, 9, yellow}, {9, 9, yellow}, {10, 9, yellow}, {11, 9, yellow}, {5, 10, yellow}, {10, 10, yellow}, {7, 7, orange}, {7, 8, orange}, {8, 8, orange}, {6, 9, orange}, {7, 9, orange}, {8, 9, orange}, {6, 10, orange}, {7, 10, orange}, {8, 10, orange}, {9, 10, orange}};

  Pixel frame3[] = {
      {7, 5, yellow}, {7, 6, yellow}, {6, 7, yellow}, {7, 7, yellow}, {8, 7, yellow}, {6, 8, yellow}, {7, 8, yellow}, {8, 8, yellow}, {9, 8, yellow}, {5, 9, yellow}, {6, 9, yellow}, {8, 9, yellow}, {9, 9, yellow}, {5, 10, yellow}, {9, 10, yellow}, {7, 9, orange}, {6, 10, orange}, {7, 10, orange}, {8, 10, orange}};

  Pixel frame4[] = {
      {8, 5, yellow}, {8, 6, yellow}, {7, 7, yellow}, {8, 7, yellow}, {9, 7, yellow}, {6, 8, yellow}, {7, 8, yellow}, {8, 8, yellow}, {9, 8, yellow}, {6, 9, yellow}, {7, 9, yellow}, {9, 9, yellow}, {10, 9, yellow}, {6, 10, yellow}, {10, 10, yellow}, {8, 9, orange}, {7, 10, orange}, {8, 10, orange}, {9, 10, orange}};

  Pixel frame6[] = {
      {4, 11, darkbrown}, {5, 11, darkbrown}, {6, 11, darkbrown}, {7, 11, darkbrown}, {8, 11, darkbrown}, {9, 11, darkbrown}, {10, 11, darkbrown}, {11, 11, darkbrown}, {3, 12, darkbrown}, {4, 12, darkbrown}, {5, 12, darkbrown}, {6, 12, darkbrown}, {7, 12, darkbrown}, {8, 12, darkbrown}, {9, 12, darkbrown}, {10, 12, darkbrown}, {11, 12, darkbrown}, {12, 12, darkbrown}};

  Pixel frame7[] = {
      {4, 11, darkbrown}, {5, 11, darkbrown}, {6, 11, darkbrown}, {7, 11, darkbrown}, {8, 11, darkbrown}, {9, 11, darkbrown}, {10, 11, darkbrown}, {11, 11, darkbrown}, {3, 12, darkbrown}, {4, 12, darkbrown}, {5, 12, darkbrown}, {6, 12, darkbrown}, {7, 12, darkbrown}, {8, 12, darkbrown}, {9, 12, darkbrown}, {10, 12, darkbrown}, {11, 12, darkbrown}, {12, 12, darkbrown}, {5, 5, white}, {6, 5, white}, {9, 5, white}, {10, 5, white}, {5, 3, red}, {6, 3, red}, {9, 3, red}, {10, 3, red}, {5, 4, red}, {6, 4, red}, {9, 4, red}, {10, 4, red}, {5, 6, brown}, {6, 6, brown}, {9, 6, brown}, {10, 6, brown}, {4, 7, brown}, {5, 7, brown}, {6, 7, brown}, {9, 7, brown}, {10, 7, brown}, {11, 7, brown}};

  for (int cur_frame = 0; cur_frame < total_frame; cur_frame++)
  {
    matrix.fillScreen(0);

    // Draw the fireplace
    set_up_matrix(&matrix, frame0, sizeof(frame0) / sizeof(Pixel));

    if (cur_frame < (2 * total_frame / 8))
    {
      // Draw big fire
      if (cur_frame % 2 == 0)
      {
        set_up_matrix(&matrix, frame1, sizeof(frame1) / sizeof(Pixel));
      }
      else
      {
        set_up_matrix(&matrix, frame2, sizeof(frame2) / sizeof(Pixel));
      }
    }
    else if (cur_frame < (4 * total_frame / 8))
    {
      // Draw small fire
      if (cur_frame % 2 == 0)
      {
        set_up_matrix(&matrix, frame3, sizeof(frame3) / sizeof(Pixel));
      }
      else
      {
        set_up_matrix(&matrix, frame4, sizeof(frame4) / sizeof(Pixel));
      }
    }
    else if (cur_frame >= (5 * total_frame / 8) && cur_frame < (6 * total_frame / 8))
    {
      // Draw the fireplace without fire
      set_up_matrix(&matrix, frame6, sizeof(frame6) / sizeof(Pixel));
    }
    else if (cur_frame >= (6 * total_frame / 8))
    {
      // Draw Santa's legs
      set_up_matrix(&matrix, frame7, sizeof(frame7) / sizeof(Pixel));
    }

    matrix.show();
    delay(DEFAULT_DELAY / 2);
  }
}

void panettone()
{
  int cur_frame = 0;
  int total_frame = DEFAULT_TOTAL_FRAME;

  uint16_t lightblue = matrix.Color(140, 239, 255);
  uint16_t orange = matrix.Color(255, 109, 1);
  uint16_t brown = matrix.Color(140, 82, 39);
  uint16_t darkbrown = matrix.Color(67, 36, 13);
  uint16_t gold = matrix.Color(211, 159, 6);
  uint16_t darkred = matrix.Color(152, 0, 0);

  Pixel frame0[] = {
      {0, 13, lightblue}, {15, 13, lightblue}, {0, 14, lightblue}, {1, 14, lightblue}, {14, 14, lightblue}, {15, 14, lightblue}, {1, 15, lightblue}, {2, 15, lightblue}, {3, 15, lightblue}, {4, 15, lightblue}, {5, 15, lightblue}, {6, 15, lightblue}, {7, 15, lightblue}, {8, 15, lightblue}, {9, 15, lightblue}, {10, 15, lightblue}, {11, 15, lightblue}, {12, 15, lightblue}, {13, 15, lightblue}, {14, 15, lightblue}};

  Pixel frame1[] = {
      {2, 8, darkbrown}, {3, 8, darkbrown}, {4, 8, darkbrown}, {5, 8, darkbrown}, {6, 8, darkbrown}, {7, 8, darkbrown}, {8, 8, darkbrown}, {9, 8, darkbrown}, {10, 8, darkbrown}, {11, 8, darkbrown}, {12, 8, darkbrown}, {13, 8, darkbrown}, {2, 9, darkbrown}, {3, 9, darkbrown}, {4, 9, darkbrown}, {5, 9, darkbrown}, {6, 9, darkbrown}, {7, 9, darkbrown}, {8, 9, darkbrown}, {9, 9, darkbrown}, {10, 9, darkbrown}, {11, 9, darkbrown}, {12, 9, darkbrown}, {13, 9, darkbrown}, {2, 10, darkbrown}, {3, 10, darkbrown}, {4, 10, darkbrown}, {5, 10, darkbrown}, {6, 10, darkbrown}, {7, 10, darkbrown}, {8, 10, darkbrown}, {9, 10, darkbrown}, {10, 10, darkbrown}, {11, 10, darkbrown}, {12, 10, darkbrown}, {13, 10, darkbrown}, {2, 11, darkbrown}, {3, 11, darkbrown}, {4, 11, darkbrown}, {5, 11, darkbrown}, {6, 11, darkbrown}, {7, 11, darkbrown}, {8, 11, darkbrown}, {9, 11, darkbrown}, {10, 11, darkbrown}, {11, 11, darkbrown}, {12, 11, darkbrown}, {13, 11, darkbrown}, {2, 12, darkbrown}, {3, 12, darkbrown}, {4, 12, darkbrown}, {5, 12, darkbrown}, {6, 12, darkbrown}, {7, 12, darkbrown}, {8, 12, darkbrown}, {9, 12, darkbrown}, {10, 12, darkbrown}, {11, 12, darkbrown}, {12, 12, darkbrown}, {13, 12, darkbrown}, {2, 13, darkbrown}, {3, 13, darkbrown}, {4, 13, darkbrown}, {5, 13, darkbrown}, {6, 13, darkbrown}, {7, 13, darkbrown}, {8, 13, darkbrown}, {9, 13, darkbrown}, {10, 13, darkbrown}, {11, 13, darkbrown}, {12, 13, darkbrown}, {13, 13, darkbrown}, {2, 14, darkbrown}, {3, 14, darkbrown}, {4, 14, darkbrown}, {5, 14, darkbrown}, {6, 14, darkbrown}, {7, 14, darkbrown}, {8, 14, darkbrown}, {9, 14, darkbrown}, {10, 14, darkbrown}, {11, 14, darkbrown}, {12, 14, darkbrown}, {13, 14, darkbrown}, {4, 0, brown}, {5, 0, brown}, {6, 0, brown}, {7, 0, brown}, {8, 0, brown}, {9, 0, brown}, {10, 0, brown}, {11, 0, brown}, {2, 1, brown}, {3, 1, brown}, {4, 1, brown}, {5, 1, brown}, {6, 1, brown}, {7, 1, brown}, {8, 1, brown}, {9, 1, brown}, {10, 1, brown}, {11, 1, brown}, {12, 1, brown}, {13, 1, brown}, {1, 2, brown}, {2, 2, brown}, {3, 2, brown}, {4, 2, brown}, {5, 2, brown}, {6, 2, brown}, {7, 2, brown}, {8, 2, brown}, {9, 2, brown}, {10, 2, brown}, {11, 2, brown}, {12, 2, brown}, {13, 2, brown}, {14, 2, brown}, {0, 3, brown}, {1, 3, brown}, {2, 3, brown}, {3, 3, brown}, {4, 3, brown}, {5, 3, brown}, {6, 3, brown}, {7, 3, brown}, {8, 3, brown}, {9, 3, brown}, {10, 3, brown}, {11, 3, brown}, {12, 3, brown}, {13, 3, brown}, {14, 3, brown}, {15, 3, brown}, {0, 4, brown}, {1, 4, brown}, {2, 4, brown}, {3, 4, brown}, {4, 4, brown}, {5, 4, brown}, {6, 4, brown}, {7, 4, brown}, {8, 4, brown}, {9, 4, brown}, {10, 4, brown}, {11, 4, brown}, {12, 4, brown}, {13, 4, brown}, {14, 4, brown}, {15, 4, brown}, {0, 5, brown}, {1, 5, brown}, {2, 5, brown}, {3, 5, brown}, {4, 5, brown}, {5, 5, brown}, {6, 5, brown}, {7, 5, brown}, {8, 5, brown}, {9, 5, brown}, {10, 5, brown}, {11, 5, brown}, {12, 5, brown}, {13, 5, brown}, {14, 5, brown}, {15, 5, brown}, {0, 6, brown}, {1, 6, brown}, {2, 6, brown}, {3, 6, brown}, {4, 6, brown}, {5, 6, brown}, {6, 6, brown}, {7, 6, brown}, {8, 6, brown}, {9, 6, brown}, {10, 6, brown}, {11, 6, brown}, {12, 6, brown}, {13, 6, brown}, {14, 6, brown}, {15, 6, brown}, {1, 7, brown}, {2, 7, brown}, {3, 7, brown}, {4, 7, brown}, {5, 7, brown}, {6, 7, brown}, {7, 7, brown}, {8, 7, brown}, {9, 7, brown}, {10, 7, brown}, {11, 7, brown}, {12, 7, brown}, {13, 7, brown}, {14, 7, brown}, {10, 1, orange}, {5, 3, orange}, {13, 4, orange}, {4, 6, orange}, {9, 6, orange}, {5, 1, darkred}, {2, 3, darkred}, {10, 3, darkred}, {6, 5, darkred}, {2, 6, darkred}, {13, 6, darkred}};

  Pixel frame2[] = {
      {8, 0, brown}, {9, 0, brown}, {10, 0, brown}, {11, 0, brown}, {12, 0, brown}, {6, 1, brown}, {7, 1, brown}, {5, 2, brown}, {6, 2, brown}, {4, 3, brown}, {4, 4, brown}, {3, 5, brown}, {3, 6, brown}, {3, 7, brown}, {3, 8, brown}, {3, 9, brown}, {3, 10, brown}, {3, 11, brown}, {3, 12, brown}, {3, 13, brown}, {3, 14, brown}, {11, 2, orange}, {7, 5, orange}, {11, 7, orange}, {5, 8, orange}, {8, 11, orange}, {5, 13, orange}, {11, 13, orange}, {9, 3, darkred}, {5, 6, darkred}, {8, 8, darkred}, {5, 10, darkred}, {11, 10, darkred}, {8, 13, darkred}, {8, 1, gold}, {9, 1, gold}, {10, 1, gold}, {11, 1, gold}, {12, 1, gold}, {7, 2, gold}, {8, 2, gold}, {9, 2, gold}, {10, 2, gold}, {12, 2, gold}, {5, 3, gold}, {6, 3, gold}, {7, 3, gold}, {8, 3, gold}, {10, 3, gold}, {11, 3, gold}, {12, 3, gold}, {5, 4, gold}, {6, 4, gold}, {7, 4, gold}, {8, 4, gold}, {9, 4, gold}, {10, 4, gold}, {11, 4, gold}, {12, 4, gold}, {4, 5, gold}, {5, 5, gold}, {6, 5, gold}, {8, 5, gold}, {9, 5, gold}, {10, 5, gold}, {11, 5, gold}, {12, 5, gold}, {4, 6, gold}, {6, 6, gold}, {7, 6, gold}, {8, 6, gold}, {9, 6, gold}, {10, 6, gold}, {11, 6, gold}, {12, 6, gold}, {4, 7, gold}, {5, 7, gold}, {6, 7, gold}, {7, 7, gold}, {8, 7, gold}, {9, 7, gold}, {10, 7, gold}, {12, 7, gold}, {4, 8, gold}, {6, 8, gold}, {7, 8, gold}, {9, 8, gold}, {10, 8, gold}, {11, 8, gold}, {12, 8, gold}, {4, 9, gold}, {5, 9, gold}, {6, 9, gold}, {7, 9, gold}, {8, 9, gold}, {9, 9, gold}, {10, 9, gold}, {11, 9, gold}, {12, 9, gold}, {4, 10, gold}, {6, 10, gold}, {7, 10, gold}, {8, 10, gold}, {9, 10, gold}, {10, 10, gold}, {12, 10, gold}, {4, 11, gold}, {5, 11, gold}, {6, 11, gold}, {7, 11, gold}, {9, 11, gold}, {10, 11, gold}, {11, 11, gold}, {12, 11, gold}, {4, 12, gold}, {5, 12, gold}, {6, 12, gold}, {7, 12, gold}, {8, 12, gold}, {9, 12, gold}, {10, 12, gold}, {11, 12, gold}, {12, 12, gold}, {4, 13, gold}, {6, 13, gold}, {7, 13, gold}, {9, 13, gold}, {10, 13, gold}, {12, 13, gold}, {4, 14, gold}, {5, 14, gold}, {6, 14, gold}, {7, 14, gold}, {8, 14, gold}, {9, 14, gold}, {10, 14, gold}, {11, 14, gold}, {12, 14, gold}};

  Pixel frame3[] = {
      {3, 13, gold}, {10, 13, gold}, {3, 14, gold}, {4, 14, gold}, {7, 14, gold}, {10, 14, gold}, {6, 13, orange}, {12, 14, darkred}};

  for (int cur_frame = 0; cur_frame < total_frame; cur_frame++)
  {
    matrix.fillScreen(0);

    set_up_matrix(&matrix, frame0, sizeof(frame0) / sizeof(Pixel));

    if (cur_frame <= (total_frame / 3))
    {
      set_up_matrix(&matrix, frame1, sizeof(frame1) / sizeof(Pixel));
    }
    else if (cur_frame <= 2 * (total_frame / 3))
    {
      set_up_matrix(&matrix, frame2, sizeof(frame2) / sizeof(Pixel));
    }
    else
    {
      set_up_matrix(&matrix, frame3, sizeof(frame3) / sizeof(Pixel));
    }

    matrix.show();
    delay(DEFAULT_DELAY);
  }
}

void candle()
{
  int cur_frame = 0;
  int total_frame = DEFAULT_TOTAL_FRAME;

  uint16_t red = matrix.Color(255, 0, 0);
  uint16_t yellow = matrix.Color(249, 199, 47);
  uint16_t darkbrown = matrix.Color(112, 66, 32);
  uint16_t orange = matrix.Color(255, 109, 1);
  uint16_t green = matrix.Color(78, 176, 19);
  uint16_t darkgreen = matrix.Color(2, 93, 77);

  Pixel frame0[] = {
      {8, 2, orange}, {8, 3, orange}, {8, 4, darkbrown}, {7, 5, red}, {8, 5, red}, {9, 5, red}, {7, 6, red}, {8, 6, red}, {9, 6, red}, {7, 7, red}, {8, 7, red}, {9, 7, red}, {7, 8, red}, {8, 8, red}, {9, 8, red}, {7, 9, red}, {8, 9, red}, {9, 9, red}, {7, 10, red}, {8, 10, red}, {9, 10, red}, {7, 11, red}, {8, 11, red}, {9, 11, red}, {7, 12, red}, {9, 12, red}, {3, 10, darkgreen}, {4, 10, darkgreen}, {5, 10, darkgreen}, {11, 10, darkgreen}, {12, 10, darkgreen}, {6, 11, darkgreen}, {10, 11, darkgreen}, {13, 11, darkgreen}, {6, 12, darkgreen}, {8, 12, darkgreen}, {11, 12, darkgreen}, {5, 13, darkgreen}, {7, 13, darkgreen}, {9, 13, darkgreen}, {10, 13, darkgreen}, {12, 13, darkgreen}, {13, 13, darkgreen}, {7, 14, darkgreen}, {11, 14, darkgreen}, {8, 15, darkgreen}, {9, 15, darkgreen}, {10, 15, darkgreen}, {11, 15, darkgreen}, {3, 11, green}, {4, 11, green}, {5, 11, green}, {11, 11, green}, {12, 11, green}, {5, 12, green}, {12, 12, green}, {8, 13, green}, {8, 14, green}, {9, 14, green}, {10, 14, green}, {2, 10, darkgreen}, {1, 11, darkgreen}, {2, 11, green}, {14, 11, darkgreen}, {2, 12, darkgreen}, {3, 12, green}, {4, 12, green}, {3, 13, darkgreen}, {4, 13, darkgreen}, {13, 12, green}, {14, 12, darkgreen}, {14, 13, darkgreen}};

  Pixel frame1[] = {
      {6, 0, yellow}, {7, 0, yellow}, {6, 1, yellow}, {7, 1, yellow}, {8, 1, yellow}, {6, 2, yellow}, {7, 2, yellow}, {7, 3, yellow}, {9, 2, yellow}, {9, 3, yellow}};

  Pixel frame2[] = {
      {9, 0, yellow}, {10, 0, yellow}, {8, 1, yellow}, {9, 1, yellow}, {10, 1, yellow}, {9, 2, yellow}, {10, 2, yellow}, {9, 3, yellow}, {7, 2, yellow}, {7, 3, yellow}};

  for (int cur_frame = 0; cur_frame < total_frame; cur_frame++)
  {
    matrix.fillScreen(0);

    // Draw the hat
    set_up_matrix(&matrix, frame0, sizeof(frame0) / sizeof(Pixel));

    // Add light
    if (cur_frame % 2 == 0)
    {
      set_up_matrix(&matrix, frame1, sizeof(frame1) / sizeof(Pixel));
    }
    else
    {
      set_up_matrix(&matrix, frame2, sizeof(frame2) / sizeof(Pixel));
    }

    matrix.show();
    delay(DEFAULT_DELAY);
  }
}

void christmas_lights()
{
  int cur_frame = 0;
  int total_frame = DEFAULT_TOTAL_FRAME;
  // Make the total number of frames even
  if (total_frame % 2 == 1)
  {
    total_frame++;
  }

  uint16_t grey = matrix.Color(153, 153, 153);
  uint16_t darkgrey = matrix.Color(102, 102, 102);
  uint16_t red = matrix.Color(255, 0, 0);
  uint16_t darkred = matrix.Color(152, 0, 0);
  uint16_t lightred = matrix.Color(234, 92, 92);
  uint16_t yellow = matrix.Color(249, 199, 47);
  uint16_t darkyellow = matrix.Color(161, 121, 5);
  uint16_t lightyellow = matrix.Color(255, 255, 0);
  uint16_t blue = matrix.Color(61, 133, 198);
  uint16_t darkblue = matrix.Color(10, 54, 94);
  uint16_t lightblue = matrix.Color(159, 197, 232);
  uint16_t green = matrix.Color(78, 176, 19);
  uint16_t darkgreen = matrix.Color(2, 93, 77);
  uint16_t lightgreen = matrix.Color(149, 247, 91);

  Pixel frame0[] = {
      {0, 7, grey}, {1, 7, grey}, {2, 7, grey}, {3, 7, grey}, {4, 7, grey}, {5, 7, grey}, {13, 7, grey}, {14, 7, grey}, {15, 7, grey}, {5, 5, grey}, {6, 5, grey}, {7, 5, grey}, {7, 10, grey}, {8, 10, grey}, {9, 10, grey}, {9, 9, grey}, {10, 9, grey}, {11, 9, grey}, {12, 9, grey}, {13, 9, grey}, {5, 6, grey}, {7, 6, grey}, {7, 7, grey}, {7, 8, grey}, {7, 9, grey}, {13, 8, grey}, {1, 6, darkgrey}, {6, 4, darkgrey}, {14, 6, darkgrey}, {3, 8, darkgrey}, {10, 8, darkgrey}, {12, 10, darkgrey}, {7, 11, darkgrey}};

  Pixel frame1[] = {
      {1, 2, darkred}, {0, 3, darkred}, {1, 3, darkred}, {2, 3, darkred}, {0, 4, darkred}, {1, 4, darkred}, {2, 4, darkred}, {0, 5, darkred}, {1, 5, darkred}, {2, 5, darkred}, {6, 12, darkred}, {7, 12, darkred}, {8, 12, darkred}, {6, 13, darkred}, {7, 13, darkred}, {8, 13, darkred}, {6, 14, darkred}, {7, 14, darkred}, {8, 14, darkred}, {7, 15, darkred}, {6, 0, darkyellow}, {5, 1, darkyellow}, {6, 1, darkyellow}, {7, 1, darkyellow}, {5, 2, darkyellow}, {6, 2, darkyellow}, {7, 2, darkyellow}, {5, 3, darkyellow}, {6, 3, darkyellow}, {7, 3, darkyellow}, {11, 11, darkyellow}, {12, 11, darkyellow}, {13, 11, darkyellow}, {11, 12, darkyellow}, {12, 12, darkyellow}, {13, 12, darkyellow}, {11, 13, darkyellow}, {12, 13, darkyellow}, {13, 13, darkyellow}, {12, 14, darkyellow}, {10, 4, darkblue}, {9, 5, darkblue}, {10, 5, darkblue}, {11, 5, darkblue}, {9, 6, darkblue}, {10, 6, darkblue}, {11, 6, darkblue}, {9, 7, darkblue}, {10, 7, darkblue}, {11, 7, darkblue}, {14, 2, darkgreen}, {13, 3, darkgreen}, {14, 3, darkgreen}, {15, 3, darkgreen}, {13, 4, darkgreen}, {14, 4, darkgreen}, {15, 4, darkgreen}, {13, 5, darkgreen}, {14, 5, darkgreen}, {15, 5, darkgreen}, {2, 9, darkgreen}, {3, 9, darkgreen}, {4, 9, darkgreen}, {2, 10, darkgreen}, {3, 10, darkgreen}, {4, 10, darkgreen}, {2, 11, darkgreen}, {3, 11, darkgreen}, {4, 11, darkgreen}, {3, 12, darkgreen}};

  Pixel frame2[] = {
      {1, 2, lightred}, {0, 3, red}, {1, 3, lightred}, {2, 3, red}, {0, 4, red}, {1, 4, lightred}, {2, 4, red}, {0, 5, red}, {1, 5, lightred}, {2, 5, red}, {6, 12, red}, {7, 12, lightred}, {8, 12, red}, {6, 13, red}, {7, 13, lightred}, {8, 13, red}, {6, 14, red}, {7, 14, lightred}, {8, 14, red}, {7, 15, lightred}, {6, 0, lightyellow}, {5, 1, yellow}, {6, 1, lightyellow}, {7, 1, yellow}, {5, 2, yellow}, {6, 2, lightyellow}, {7, 2, yellow}, {5, 3, yellow}, {6, 3, lightyellow}, {7, 3, yellow}, {11, 11, yellow}, {12, 11, lightyellow}, {13, 11, yellow}, {11, 12, yellow}, {12, 12, lightyellow}, {13, 12, yellow}, {11, 13, yellow}, {12, 13, lightyellow}, {13, 13, yellow}, {12, 14, lightyellow}, {10, 4, lightblue}, {9, 5, blue}, {10, 5, lightblue}, {11, 5, blue}, {9, 6, blue}, {10, 6, lightblue}, {11, 6, blue}, {9, 7, blue}, {10, 7, lightblue}, {11, 7, blue}, {14, 2, lightgreen}, {13, 3, green}, {14, 3, lightgreen}, {15, 3, green}, {13, 4, green}, {14, 4, lightgreen}, {15, 4, green}, {13, 5, green}, {14, 5, lightgreen}, {15, 5, green}, {2, 9, green}, {3, 9, lightgreen}, {4, 9, green}, {2, 10, green}, {3, 10, lightgreen}, {4, 10, green}, {2, 11, green}, {3, 11, lightgreen}, {4, 11, green}, {3, 12, lightgreen}};

  for (int cur_frame = 0; cur_frame < total_frame; cur_frame++)
  {
    matrix.fillScreen(0);

    // Draw the lights
    set_up_matrix(&matrix, frame0, sizeof(frame0) / sizeof(Pixel));

    // Switch them on
    if (cur_frame % 2 == 0)
    {
      set_up_matrix(&matrix, frame1, sizeof(frame1) / sizeof(Pixel));
    }
    else
    {
      set_up_matrix(&matrix, frame2, sizeof(frame2) / sizeof(Pixel));
    }

    matrix.show();
    delay(DEFAULT_DELAY);
  }
}

void santa_bag()
{
  int cur_frame = 0;
  int total_frame = DEFAULT_TOTAL_FRAME / 2;
  // Make the total number of frames even
  if (total_frame % 2 == 1)
  {
    total_frame++;
  }

  uint16_t red = matrix.Color(255, 0, 0);
  uint16_t white = matrix.Color(255, 255, 255);
  uint16_t yellow = matrix.Color(249, 199, 47);
  uint16_t darkred = matrix.Color(152, 0, 0);
  uint16_t darkpink = matrix.Color(244, 99, 166);
  uint16_t pinkface = matrix.Color(249, 203, 203);
  uint16_t blue = matrix.Color(4, 43, 105);
  uint16_t brown = matrix.Color(140, 82, 39);

  Pixel frame0[] = {
      {2, 0, red}, {3, 0, red}, {4, 0, red}, {5, 0, red}, {1, 1, red}, {2, 1, red}, {3, 1, red}, {4, 1, red}, {5, 1, red}, {6, 1, red}, {0, 2, red}, {1, 2, red}, {2, 2, red}, {3, 2, red}, {4, 2, red}, {5, 2, red}, {6, 2, red}, {7, 2, red}, {1, 8, red}, {5, 8, red}, {0, 9, red}, {1, 9, red}, {2, 9, red}, {4, 9, red}, {5, 9, red}, {6, 9, red}, {0, 10, red}, {1, 10, red}, {2, 10, red}, {3, 10, red}, {4, 10, red}, {5, 10, red}, {0, 11, red}, {1, 12, red}, {2, 12, red}, {3, 12, red}, {4, 12, red}, {5, 12, red}, {1, 13, red}, {2, 13, red}, {4, 13, red}, {5, 13, red}, {0, 3, white}, {1, 3, white}, {2, 3, white}, {3, 3, white}, {4, 3, white}, {5, 3, white}, {6, 3, white}, {8, 3, white}, {9, 3, white}, {0, 4, white}, {6, 4, white}, {8, 4, white}, {9, 4, white}, {0, 6, white}, {1, 6, white}, {2, 6, white}, {3, 6, white}, {4, 6, white}, {5, 6, white}, {6, 6, white}, {1, 7, white}, {2, 7, white}, {3, 7, white}, {4, 7, white}, {5, 7, white}, {2, 8, white}, {3, 8, white}, {4, 8, white}, {3, 9, white}, {3, 11, yellow}, {1, 11, brown}, {2, 11, brown}, {4, 11, brown}, {5, 11, brown}, {1, 14, brown}, {2, 14, brown}, {4, 14, brown}, {5, 14, brown}, {0, 15, brown}, {1, 15, brown}, {2, 15, brown}, {4, 15, brown}, {5, 15, brown}, {6, 15, brown}, {2, 5, blue}, {4, 5, blue}, {1, 4, pinkface}, {2, 4, pinkface}, {3, 4, pinkface}, {4, 4, pinkface}, {5, 4, pinkface}, {0, 5, pinkface}, {1, 5, pinkface}, {3, 5, pinkface}, {5, 5, pinkface}, {6, 5, pinkface}, {0, 12, pinkface}};

  Pixel frame1[] = {
      {6, 12, pinkface}, {6, 10, red}, {6, 11, red}};

  Pixel frame2[] = {
      {9, 9, pinkface}, {7, 9, red}, {8, 9, red}, {3, 7, pinkface}, {9, 7, darkred}, {10, 7, darkred}, {11, 7, darkred}, {12, 7, darkred}, {13, 7, darkred}, {14, 7, darkred}, {10, 8, darkred}, {11, 8, darkred}, {12, 8, darkred}, {13, 8, darkred}, {10, 10, darkred}, {11, 10, darkred}, {13, 10, darkred}, {9, 11, darkred}, {10, 11, darkred}, {12, 11, darkred}, {14, 11, darkred}, {8, 12, darkred}, {9, 12, darkred}, {10, 12, darkred}, {11, 12, darkred}, {12, 12, darkred}, {13, 12, darkred}, {14, 12, darkred}, {15, 12, darkred}, {8, 13, darkred}, {9, 13, darkred}, {10, 13, darkred}, {11, 13, darkred}, {12, 13, darkred}, {13, 13, darkred}, {14, 13, darkred}, {15, 13, darkred}, {8, 14, darkred}, {9, 14, darkred}, {10, 14, darkred}, {11, 14, darkred}, {12, 14, darkred}, {13, 14, darkred}, {14, 14, darkred}, {15, 14, darkred}, {9, 15, darkred}, {10, 15, darkred}, {11, 15, darkred}, {12, 15, darkred}, {13, 15, darkred}, {14, 15, darkred}, {10, 9, yellow}, {11, 9, yellow}, {12, 9, yellow}, {13, 9, yellow}, {12, 10, yellow}, {11, 11, yellow}, {13, 11, yellow}, {3, 7, darkpink}};

  for (int cur_frame = 0; cur_frame < total_frame; cur_frame++)
  {
    matrix.fillScreen(0);

    // Draw the Santa
    set_up_matrix(&matrix, frame0, sizeof(frame0) / sizeof(Pixel));

    // Add Santa's bag
    if (cur_frame % 2 == 0)
    {
      set_up_matrix(&matrix, frame1, sizeof(frame1) / sizeof(Pixel));
    }
    else
    {
      set_up_matrix(&matrix, frame2, sizeof(frame2) / sizeof(Pixel));
    }

    matrix.show();
    delay(DEFAULT_DELAY * 2);
  }
}

void pine_ball()
{
  int cur_frame = 0;
  int total_frame = DEFAULT_TOTAL_FRAME;
  // Make the total number of frames even
  if (total_frame % 2 == 1)
  {
    total_frame++;
  }

  uint16_t green = matrix.Color(78, 176, 19);
  uint16_t darkgreen = matrix.Color(2, 93, 77);
  uint16_t red = matrix.Color(255, 0, 0);
  uint16_t brown = matrix.Color(140, 82, 39);
  uint16_t gold = matrix.Color(211, 159, 6);
  uint16_t white = matrix.Color(255, 255, 255);

  Pixel frame0[] = {
      {0, 5, brown}, {1, 6, brown}, {0, 12, brown}, {1, 13, brown}, {4, 0, green}, {6, 0, green}, {11, 0, green}, {13, 0, green}, {4, 1, green}, {11, 1, green}, {2, 2, green}, {4, 2, green}, {5, 2, green}, {6, 2, green}, {9, 2, green}, {11, 2, green}, {12, 2, green}, {13, 2, green}, {2, 3, green}, {9, 3, green}, {2, 4, green}, {3, 4, green}, {4, 4, green}, {7, 4, green}, {9, 4, green}, {10, 4, green}, {11, 4, green}, {7, 5, green}, {5, 6, green}, {7, 6, green}, {8, 6, green}, {9, 6, green}, {5, 7, green}, {3, 8, green}, {5, 8, green}, {6, 8, green}, {7, 8, green}, {3, 9, green}, {1, 10, green}, {3, 10, green}, {4, 10, green}, {5, 10, green}, {1, 11, green}, {1, 12, green}, {2, 12, green}, {3, 12, green}, {5, 0, darkgreen}, {6, 0, darkgreen}, {11, 0, darkgreen}, {13, 0, darkgreen}, {5, 1, darkgreen}, {6, 1, darkgreen}, {10, 1, darkgreen}, {11, 1, darkgreen}, {12, 1, darkgreen}, {3, 1, darkgreen}, {3, 2, darkgreen}, {10, 2, darkgreen}, {1, 3, darkgreen}, {3, 3, darkgreen}, {4, 3, darkgreen}, {5, 3, darkgreen}, {8, 3, darkgreen}, {10, 3, darkgreen}, {11, 3, darkgreen}, {12, 3, darkgreen}, {1, 4, darkgreen}, {8, 4, darkgreen}, {1, 5, darkgreen}, {2, 5, darkgreen}, {3, 5, darkgreen}, {6, 5, darkgreen}, {8, 5, darkgreen}, {9, 5, darkgreen}, {10, 5, darkgreen}, {6, 6, darkgreen}, {4, 7, darkgreen}, {6, 7, darkgreen}, {7, 7, darkgreen}, {8, 7, darkgreen}, {4, 8, darkgreen}, {2, 9, darkgreen}, {4, 9, darkgreen}, {5, 9, darkgreen}, {6, 9, darkgreen}, {2, 10, darkgreen}, {2, 11, darkgreen}, {3, 11, darkgreen}, {4, 11, darkgreen}};

  Pixel frame1[] = {
      {11, 2, gold}, {11, 5, gold}, {11, 6, gold}, {11, 7, gold}, {11, 8, gold}, {10, 10, white}, {9, 11, white}, {9, 12, white}, {10, 9, red}, {11, 9, red}, {12, 9, red}, {9, 10, red}, {11, 10, red}, {12, 10, red}, {13, 10, red}, {8, 11, red}, {10, 11, red}, {11, 11, red}, {12, 11, red}, {13, 11, red}, {14, 11, red}, {8, 12, red}, {10, 12, red}, {11, 12, red}, {12, 12, red}, {13, 12, red}, {14, 12, red}, {8, 13, red}, {9, 13, red}, {10, 13, red}, {11, 13, red}, {12, 13, red}, {13, 13, red}, {14, 13, red}, {9, 14, red}, {10, 14, red}, {11, 14, red}, {12, 14, red}, {13, 14, red}, {10, 15, red}, {11, 15, red}, {12, 15, red}};

  for (int cur_frame = 0; cur_frame < total_frame; cur_frame++)
  {
    matrix.fillScreen(0);

    // Draw the pine branches
    set_up_matrix(&matrix, frame0, sizeof(frame0) / sizeof(Pixel));

    // Add ball
    if (cur_frame % 2 == 1)
    {
      set_up_matrix(&matrix, frame1, sizeof(frame1) / sizeof(Pixel));
    }

    matrix.show();
    delay(DEFAULT_DELAY);
  }
}

void bear()
{
  int cur_frame = 0;
  int total_frame = DEFAULT_TOTAL_FRAME;
  // Make the total number of frames even
  if (total_frame % 2 == 1)
  {
    total_frame++;
  }

  uint16_t red = matrix.Color(255, 0, 0);
  uint16_t white = matrix.Color(255, 255, 255);
  uint16_t lightblue = matrix.Color(140, 239, 255);
  uint16_t blue = matrix.Color(4, 43, 105);
  uint16_t darkgrey = matrix.Color(102, 102, 102);
  uint16_t pink = matrix.Color(244, 99, 166);

  Pixel frame0[] = {
      {3, 5, lightblue}, {4, 5, lightblue}, {5, 5, lightblue}, {6, 5, lightblue}, {7, 5, lightblue}, {8, 5, lightblue}, {9, 5, lightblue}, {10, 5, lightblue}, {11, 5, lightblue}, {1, 6, lightblue}, {2, 6, lightblue}, {3, 6, lightblue}, {11, 6, lightblue}, {12, 6, lightblue}, {13, 6, lightblue}, {0, 7, lightblue}, {2, 7, lightblue}, {12, 7, lightblue}, {14, 7, lightblue}, {0, 8, lightblue}, {14, 8, lightblue}, {1, 9, lightblue}, {13, 9, lightblue}, {1, 10, lightblue}, {13, 10, lightblue}, {0, 11, lightblue}, {14, 11, lightblue}, {0, 12, lightblue}, {14, 12, lightblue}, {0, 13, lightblue}, {14, 13, lightblue}, {1, 14, lightblue}, {2, 14, lightblue}, {3, 14, lightblue}, {11, 14, lightblue}, {12, 14, lightblue}, {13, 14, lightblue}, {3, 15, lightblue}, {4, 15, lightblue}, {5, 15, lightblue}, {6, 15, lightblue}, {7, 15, lightblue}, {8, 15, lightblue}, {9, 15, lightblue}, {10, 15, lightblue}, {11, 15, lightblue}, {4, 10, blue}, {10, 10, blue}, {6, 10, darkgrey}, {7, 10, darkgrey}, {8, 10, darkgrey}, {7, 11, darkgrey}, {7, 12, darkgrey}, {3, 11, pink}, {11, 11, pink}, {4, 6, white}, {5, 6, white}, {6, 6, white}, {7, 6, white}, {8, 6, white}, {9, 6, white}, {10, 6, white}, {1, 7, white}, {3, 7, white}, {4, 7, white}, {5, 7, white}, {6, 7, white}, {7, 7, white}, {8, 7, white}, {9, 7, white}, {10, 7, white}, {11, 7, white}, {13, 7, white}, {1, 8, white}, {2, 8, white}, {3, 8, white}, {4, 8, white}, {5, 8, white}, {6, 8, white}, {7, 8, white}, {8, 8, white}, {9, 8, white}, {10, 8, white}, {11, 8, white}, {12, 8, white}, {13, 8, white}, {2, 9, white}, {3, 9, white}, {4, 9, white}, {5, 9, white}, {6, 9, white}, {7, 9, white}, {8, 9, white}, {9, 9, white}, {10, 9, white}, {11, 9, white}, {12, 9, white}, {2, 10, white}, {3, 10, white}, {5, 10, white}, {9, 10, white}, {11, 10, white}, {12, 10, white}, {1, 11, white}, {2, 11, white}, {4, 11, white}, {5, 11, white}, {6, 11, white}, {8, 11, white}, {9, 11, white}, {10, 11, white}, {12, 11, white}, {13, 11, white}, {1, 12, white}, {2, 12, white}, {3, 12, white}, {4, 12, white}, {5, 12, white}, {6, 12, white}, {8, 12, white}, {9, 12, white}, {10, 12, white}, {11, 12, white}, {12, 12, white}, {13, 12, white}, {1, 13, white}, {2, 13, white}, {3, 13, white}, {4, 13, white}, {5, 13, white}, {6, 13, white}, {7, 13, white}, {8, 13, white}, {9, 13, white}, {10, 13, white}, {11, 13, white}, {12, 13, white}, {13, 13, white}, {4, 14, white}, {5, 14, white}, {6, 14, white}, {7, 14, white}, {8, 14, white}, {9, 14, white}, {10, 14, white}};

  Pixel frame1[] = {
      {14, 2, white}, {15, 2, white}, {14, 3, white}, {15, 3, white}, {3, 4, white}, {4, 4, white}, {5, 4, white}, {6, 4, white}, {7, 4, white}, {8, 4, white}, {9, 4, white}, {10, 4, white}, {11, 4, white}, {2, 11, pink}, {2, 12, pink}, {3, 12, pink}, {12, 11, pink}, {11, 12, pink}, {12, 12, pink}, {5, 0, red}, {6, 0, red}, {7, 0, red}, {8, 0, red}, {9, 0, red}, {10, 0, red}, {11, 0, red}, {12, 0, red}, {4, 1, red}, {5, 1, red}, {6, 1, red}, {7, 1, red}, {8, 1, red}, {9, 1, red}, {10, 1, red}, {13, 1, red}, {4, 2, red}, {5, 2, red}, {6, 2, red}, {7, 2, red}, {8, 2, red}, {9, 2, red}, {10, 2, red}, {3, 3, red}, {4, 3, red}, {5, 3, red}, {6, 3, red}, {7, 3, red}, {8, 3, red}, {9, 3, red}, {10, 3, red}, {11, 3, red}};

  for (int cur_frame = 0; cur_frame < total_frame; cur_frame++)
  {
    matrix.fillScreen(0);

    // Draw the bear
    set_up_matrix(&matrix, frame0, sizeof(frame0) / sizeof(Pixel));

    // Add Christmas hat
    if (cur_frame % 2 == 1)
    {
      set_up_matrix(&matrix, frame1, sizeof(frame1) / sizeof(Pixel));
    }

    matrix.show();
    delay(DEFAULT_DELAY);
  }
}

void set_up_matrix(Adafruit_NeoMatrix *mat, Pixel *pixels, int size)
{
  for (int p = 0; p < size; p++)
  {
    mat->drawPixel(pixels[p].x, pixels[p].y, pixels[p].color);
  }
}
