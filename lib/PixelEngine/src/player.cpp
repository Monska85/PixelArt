// SPDX-License-Identifier: GPL-3.0-or-later

// Playback: walks the timeline and renders frames, applying the effects in
// the order of docs/format/pixelart-v1.md#effects.

#include "pixelart_engine.h"

namespace pixelart
{
namespace
{

// Division and modulo rounding toward negative infinity.
int floor_div(int a, int b) { return (a >= 0) ? a / b : -((-a + b - 1) / b); }
long floor_mod(long a, long b) { return ((a % b) + b) % b; }

} // namespace

// Where one sprite reference puts each pixel in repetition k: flip, rotation
// around the pivot, position and motion, then wrap or clip
// (docs/format/pixelart-v1.md#effects).
struct Player::Transform
{
  Transform(const Animation &a, const Animation::Ref &ref, uint32_t k)
      : sprite(a.sprites_[ref.sprite]), ref(ref),
        quarter_turns((int)(floor_mod(ref.rotate + (long)k * ref.spin, 360) / 90))
  {
    if (ref.has_pivot || sprite.has_pivot)
    {
      const Animation::Pos &pivot = ref.has_pivot ? ref.pivot : sprite.pivot;
      pivot_x = pivot.x;
      pivot_y = pivot.y;
    }
    else
    {
      // Center of the bounding box, rounded toward the top-left.
      pivot_x = floor_div(sprite.min_x + sprite.max_x, 2);
      pivot_y = floor_div(sprite.min_y + sprite.max_y, 2);
    }
    const Animation::Pos base = ref.has_at ? ref.at : sprite.at;
    offset_x = base.x + (long)k * ref.move.x;
    offset_y = base.y + (long)k * ref.move.y;
  }

  // Moves (x, y) from sprite coordinates to the canvas. Returns false when
  // the pixel falls outside the canvas and wrap is off.
  bool apply(int &x, int &y) const
  {
    if (ref.flip & Animation::FLIP_X)
      x = sprite.min_x + sprite.max_x - x;
    if (ref.flip & Animation::FLIP_Y)
      y = sprite.min_y + sprite.max_y - y;
    for (int q = 0; q < quarter_turns; q++)
    {
      int turned_x = pivot_x - (y - pivot_y);
      int turned_y = pivot_y + (x - pivot_x);
      x = turned_x;
      y = turned_y;
    }
    long px = x + offset_x, py = y + offset_y;
    if (ref.wrap)
    {
      px = floor_mod(px, CANVAS_WIDTH);
      py = floor_mod(py, CANVAS_HEIGHT);
    }
    else if (px < 0 || py < 0 || px >= CANVAS_WIDTH || py >= CANVAS_HEIGHT)
    {
      return false;
    }
    x = (int)px;
    y = (int)py;
    return true;
  }

  const Animation::Sprite &sprite;
  const Animation::Ref &ref;
  const int quarter_turns;
  int pivot_x = 0, pivot_y = 0;
  long offset_x = 0, offset_y = 0;
};

Player::Player(const Animation &animation) : animation_(animation) { restart(); }

void Player::restart()
{
  stack_.clear();
  frame_ = nullptr;
  repetition_ = 0;
  if (animation_.loaded_)
    stack_.push_back({animation_.root_first_, animation_.root_size_, 0, 0, 1});
}

bool Player::next(Frame &frame)
{
  for (;;)
  {
    if (frame_ && repetition_ < frame_->count)
    {
      render(*frame_, repetition_++, frame);
      return true;
    }
    frame_ = nullptr;
    if (stack_.empty())
      return false;

    Level &level = stack_.back();
    if (level.pos < level.size)
    {
      const Animation::Item &item = animation_.items_[animation_.children_[level.first + level.pos++]];
      if (item.is_loop)
        stack_.push_back({item.first, item.size, 0, 0, item.count});
      else
      {
        frame_ = &item;
        repetition_ = 0;
      }
      continue;
    }
    if (++level.done < level.total)
    {
      level.pos = 0;
      continue;
    }
    stack_.pop_back();
  }
}

void Player::render(const Animation::Item &item, uint32_t k, Frame &frame) const
{
  const Animation &a = animation_;
  const Rgb background = a.has_background_ ? a.colors_[a.background_] : 0;
  for (int y = 0; y < CANVAS_HEIGHT; y++)
    for (int x = 0; x < CANVAS_WIDTH; x++)
      frame.pixels[y][x] = background;
  frame.ms = item.ms;

  // Recolor: every substitution reads the original color, so colors can swap.
  uint8_t recolor[256];
  if (item.recolor_size)
  {
    for (int i = 0; i < 256; i++)
      recolor[i] = (uint8_t)i;
    for (uint32_t i = 0; i < item.recolor_size; i++)
    {
      const Animation::Recolor &r = a.recolors_[item.recolor_first + i];
      recolor[r.from] = r.to;
    }
  }

  for (uint32_t i = 0; i < item.size; i++)
  {
    const Animation::Ref &ref = a.refs_[item.first + i];
    const Transform transform(a, ref, k);
    walk(a, a.sprites_[ref.sprite], 0, 0,
         [&](int x, int y, uint8_t color)
         {
           if (transform.apply(x, y))
             frame.pixels[y][x] = a.colors_[item.recolor_size ? recolor[color] : color];
         });
  }
}

} // namespace pixelart
