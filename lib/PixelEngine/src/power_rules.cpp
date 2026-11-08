// SPDX-License-Identifier: GPL-3.0-or-later

// Power protection rules, docs/board/power-protection-v1.md.

#include "power_rules.h"

#include <cstring>

namespace pixelart
{

// Walks the frame items of an animation's timeline in file order, each loop's steps once.
class FrameIndex
{
public:
  // Calls visit(item, count) for every frame item, in file order, until it returns false. Iterative, with one
  // level per loop nesting, so the stack use is fixed.
  template <typename Visit> static void each(const Animation &a, Visit &&visit)
  {
    if (!a.loaded_)
      return;
    struct Level
    {
      uint32_t first, size, pos;
    };
    Level stack[MAX_LOOP_DEPTH + 1];
    int depth = 0;
    stack[0] = {a.root_first_, a.root_size_, 0};
    while (depth >= 0)
    {
      Level &level = stack[depth];
      if (level.pos >= level.size)
      {
        depth--;
        continue;
      }
      const uint32_t index = a.children_[level.first + level.pos++];
      const Animation::Item &item = a.items_[index];
      if (item.is_loop)
      {
        if (depth + 1 <= MAX_LOOP_DEPTH) // the loader refuses deeper nesting
          stack[++depth] = {item.first, item.size, 0};
      }
      else if (!visit(index, (uint32_t)item.count))
        return;
    }
  }

  // Points one repetition of the frame item `index` draws, counting every part of composites.
  static uint64_t points(const Animation &a, uint32_t index)
  {
    const Animation::Item &item = a.items_[index];
    uint64_t total = 0;
    for (uint32_t i = 0; i < item.size; i++)
      total += a.sprites_[a.refs_[item.first + i].sprite].drawn_points;
    return total;
  }
};

namespace
{

constexpr uint32_t LEDS = (uint32_t)CANVAS_WIDTH * CANVAS_HEIGHT;

uint32_t estimate_from_units(uint32_t units)
{
  return (LEDS * POWER_IDLE_UA_PER_LED + POWER_UA_PER_UNIT * units + 500) / 1000;
}

const char *const REASON_NAMES[RESET_REASON_COUNT] = {"brownout", "power_on",   "software", "panic",
                                                      "watchdog", "deep_sleep", "other"};

void put16(uint8_t *p, uint16_t v)
{
  p[0] = (uint8_t)v;
  p[1] = (uint8_t)(v >> 8);
}
void put32(uint8_t *p, uint32_t v)
{
  for (int i = 0; i < 4; i++)
    p[i] = (uint8_t)(v >> (8 * i));
}
uint16_t get16(const uint8_t *p) { return (uint16_t)(p[0] | (p[1] << 8)); }
uint32_t get32(const uint8_t *p) { return p[0] | (p[1] << 8) | (p[2] << 16) | ((uint32_t)p[3] << 24); }

// Byte offsets of layout 1.
constexpr size_t AT_LAYOUT = 0, AT_MODEL = 1, AT_COUNT = 2, AT_REASONS = 3, AT_ESTIMATES = 13, AT_FLAGS = 33,
                 AT_LIMIT = 34, AT_FRAME = 36, AT_YEAR = 40, AT_MONTH = 42, AT_DAY = 43, AT_ANIMATION = 44;
constexpr uint8_t FLAG_LIMIT = 1, FLAG_LAST = 2, FLAG_FRAME = 4, FLAG_DATE = 8;
static_assert(AT_ANIMATION + 33 == POWER_RECORD_BYTES, "layout 1 is 77 bytes");

} // namespace

uint32_t frame_estimate_ma(const Frame &frame, uint8_t brightness, const LedGamma &gamma)
{
  const uint32_t scale = (uint32_t)brightness + 1;
  uint32_t units = 0;
  for (int y = 0; y < CANVAS_HEIGHT; y++)
    for (int x = 0; x < CANVAS_WIDTH; x++)
    {
      const Rgb c = frame.pixels[y][x];
      if (!c)
        continue;
      units += (gamma.five[(c >> 19) & 31] * scale) >> 8;
      units += (gamma.six[(c >> 10) & 63] * scale) >> 8;
      units += (gamma.five[(c >> 3) & 31] * scale) >> 8;
    }
  return estimate_from_units(units);
}

uint32_t white_frame_estimate_ma(uint8_t brightness)
{
  return estimate_from_units(LEDS * 3 * ((255u * ((uint32_t)brightness + 1)) >> 8));
}

uint32_t frame_count(const Animation &animation)
{
  uint32_t total = 0;
  FrameIndex::each(animation,
                   [&](uint32_t, uint32_t count)
                   {
                     total += count;
                     return true;
                   });
  return total;
}

uint64_t drawn_points(const Animation &animation)
{
  uint64_t total = 0;
  FrameIndex::each(animation,
                   [&](uint32_t item, uint32_t count)
                   {
                     total += FrameIndex::points(animation, item) * count;
                     return true;
                   });
  return total;
}

bool frame_number(const Animation &animation, uint32_t item, uint32_t repetition, uint32_t &number)
{
  uint32_t before = 0;
  bool found = false;
  FrameIndex::each(animation,
                   [&](uint32_t index, uint32_t count)
                   {
                     if (index == item)
                     {
                       found = repetition < count;
                       return false;
                     }
                     before += count;
                     return true;
                   });
  if (found)
    number = before + repetition;
  return found;
}

bool frame_position(const Animation &animation, uint32_t number, uint32_t &item, uint32_t &repetition)
{
  bool found = false;
  FrameIndex::each(animation,
                   [&](uint32_t index, uint32_t count)
                   {
                     if (number < count)
                     {
                       item = index;
                       repetition = number;
                       found = true;
                       return false;
                     }
                     number -= count;
                     return true;
                   });
  return found;
}

HeaviestFrame heaviest_frame(const Animation &animation, uint8_t e1, const LedGamma &gamma, Frame &scratch)
{
  HeaviestFrame best;
  if (frame_count(animation) > POWER_MAX_SCANNED_FRAMES || drawn_points(animation) > POWER_MAX_SCANNED_POINTS)
  {
    best.white = true;
    best.estimate = white_frame_estimate_ma(e1);
    return best;
  }
  const Player player(animation);
  uint32_t number = 0, best_item = 0, best_repetition = 0;
  bool any = false;
  FrameIndex::each(animation,
                   [&](uint32_t item, uint32_t count)
                   {
                     for (uint32_t k = 0; k < count; k++, number++)
                     {
                       player.render_at(item, k, scratch);
                       const uint32_t estimate = frame_estimate_ma(scratch, e1, gamma);
                       if (!any || estimate > best.estimate)
                       {
                         any = true;
                         best.estimate = estimate;
                         best.number = number;
                         best_item = item;
                         best_repetition = k;
                       }
                     }
                     return true;
                   });
  if (any)
    player.render_at(best_item, best_repetition, scratch);
  return best;
}

uint8_t power_scale(const Frame *heaviest, uint8_t e1, uint32_t limit_ma, const LedGamma &gamma)
{
  auto estimate = [&](uint8_t brightness)
  {
    return heaviest ? frame_estimate_ma(*heaviest, brightness, gamma) : white_frame_estimate_ma(brightness);
  };
  if (estimate(e1) <= limit_ma)
    return POWER_FULL_SCALE;
  for (uint8_t scale = POWER_FULL_SCALE - 1; scale > 1; scale--)
    if (estimate(power_brightness(e1, scale)) <= limit_ma)
      return scale;
  return 1;
}

const char *reset_reason_name(ResetReason reason)
{
  const unsigned index = (unsigned)reason;
  return index < RESET_REASON_COUNT ? REASON_NAMES[index] : "other";
}

bool reset_reason_from_name(const char *name, ResetReason &reason)
{
  for (uint8_t i = 0; i < RESET_REASON_COUNT; i++)
    if (strcmp(name, REASON_NAMES[i]) == 0)
    {
      reason = (ResetReason)i;
      return true;
    }
  return false;
}

uint8_t PowerRecord::brownouts() const
{
  uint8_t n = 0;
  for (uint8_t i = 0; i < count; i++)
    n += reasons[i] == ResetReason::Brownout;
  return n;
}

void power_apply_start(PowerRecord &record, ResetReason reason, uint32_t estimate_ma)
{
  if (record.count == POWER_HISTORY)
  {
    memmove(record.reasons, record.reasons + 1, (POWER_HISTORY - 1) * sizeof(record.reasons[0]));
    memmove(record.estimates, record.estimates + 1, (POWER_HISTORY - 1) * sizeof(record.estimates[0]));
    record.count--;
  }
  const bool brownout = reason == ResetReason::Brownout;
  record.reasons[record.count] = reason;
  record.estimates[record.count] = brownout && estimate_ma <= UINT16_MAX ? (uint16_t)estimate_ma : 0;
  record.count++;
  if (!brownout)
    return;

  uint32_t limit;
  if (record.limit_active)
    limit = (uint32_t)record.limit_ma * POWER_STEP_PERCENT / 100;
  else if (record.brownouts() >= POWER_TRIGGER_BROWNOUTS)
  {
    uint32_t lowest = 0;
    for (uint8_t i = 0; i < record.count; i++)
      if (record.reasons[i] == ResetReason::Brownout && record.estimates[i] &&
          (!lowest || record.estimates[i] < lowest))
        lowest = record.estimates[i];
    limit = lowest ? lowest * POWER_FIRST_LIMIT_PERCENT / 100 : POWER_FIRST_LIMIT_WITHOUT_ESTIMATE_MA;
  }
  else
    return;
  record.limit_active = true;
  record.limit_ma = (uint16_t)(limit < POWER_FLOOR_MA ? POWER_FLOOR_MA : limit);
}

void power_record_encode(const PowerRecord &record, uint8_t model, uint8_t out[POWER_RECORD_BYTES])
{
  memset(out, 0, POWER_RECORD_BYTES);
  out[AT_LAYOUT] = POWER_RECORD_LAYOUT;
  out[AT_MODEL] = model;
  out[AT_COUNT] = record.count;
  for (uint8_t i = 0; i < record.count; i++)
  {
    out[AT_REASONS + i] = (uint8_t)record.reasons[i];
    put16(out + AT_ESTIMATES + 2 * i, record.estimates[i]);
  }
  out[AT_FLAGS] = (record.limit_active ? FLAG_LIMIT : 0) | (record.has_last ? FLAG_LAST : 0) |
                  (record.has_last && record.last_frame_known ? FLAG_FRAME : 0) |
                  (record.has_last && record.last_date_known ? FLAG_DATE : 0);
  put16(out + AT_LIMIT, record.limit_active ? record.limit_ma : 0);
  if (record.has_last && record.last_frame_known)
  {
    put32(out + AT_FRAME, record.last_frame);
    memcpy(out + AT_ANIMATION, record.last_animation, strnlen(record.last_animation, 32));
  }
  if (record.has_last && record.last_date_known)
  {
    put16(out + AT_YEAR, record.last_date.year);
    out[AT_MONTH] = record.last_date.month;
    out[AT_DAY] = record.last_date.day;
  }
}

bool power_record_decode(const uint8_t *bytes, size_t size, PowerRecord &record, uint8_t &model)
{
  if (size != POWER_RECORD_BYTES || bytes[AT_LAYOUT] != POWER_RECORD_LAYOUT || bytes[AT_COUNT] > POWER_HISTORY)
    return false;
  PowerRecord r;
  r.count = bytes[AT_COUNT];
  for (uint8_t i = 0; i < r.count; i++)
  {
    if (bytes[AT_REASONS + i] >= RESET_REASON_COUNT)
      return false;
    r.reasons[i] = (ResetReason)bytes[AT_REASONS + i];
    r.estimates[i] = r.reasons[i] == ResetReason::Brownout ? get16(bytes + AT_ESTIMATES + 2 * i) : 0;
  }
  const uint8_t flags = bytes[AT_FLAGS];
  if (flags & ~(FLAG_LIMIT | FLAG_LAST | FLAG_FRAME | FLAG_DATE))
    return false;
  r.limit_active = flags & FLAG_LIMIT;
  r.limit_ma = r.limit_active ? get16(bytes + AT_LIMIT) : 0;
  if (r.limit_active && r.limit_ma < POWER_FLOOR_MA)
    return false;
  r.has_last = flags & FLAG_LAST;
  if (!r.has_last && (flags & (FLAG_FRAME | FLAG_DATE)))
    return false;
  if (flags & FLAG_FRAME)
  {
    if (bytes[AT_ANIMATION + 32] != 0)
      return false;
    memcpy(r.last_animation, bytes + AT_ANIMATION, 33);
    if (!is_valid_id(r.last_animation))
      return false;
    r.last_frame_known = true;
    r.last_frame = get32(bytes + AT_FRAME);
  }
  if (flags & FLAG_DATE)
  {
    r.last_date = {get16(bytes + AT_YEAR), bytes[AT_MONTH], bytes[AT_DAY]};
    if (!is_schedule_date(r.last_date))
      return false;
    r.last_date_known = true;
  }
  model = bytes[AT_MODEL];
  record = r;
  return true;
}

} // namespace pixelart
