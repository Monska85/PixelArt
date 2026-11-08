// SPDX-License-Identifier: GPL-3.0-or-later

// Power protection on the board and in the simulator: see include/power.h and docs/board/power-protection-v1.md.

#include "power.h"

#include <Arduino.h>
#include <gamma.h>
#include <pixel_codec.h>

#include <cstring>

#include "app.h"
#include "settings.h"
#include "updates.h"

namespace power
{

namespace
{

constexpr uint32_t MARKER_MAGIC = 0x50574d31;     // "PWM1"
constexpr uint32_t MARKER_FRAME_KEY = 0x9e3779b9; // mixes the fields of a frame into its check
constexpr uint16_t NO_ITEM = 0xffff;

const pixelart::LedGamma GAMMA = {gamma5, gamma6};

pixelart::PowerRecord record;
uint8_t scale = pixelart::POWER_FULL_SCALE;
bool animation_playing = false; // between animation_started() and animation_stopped()
bool date_pending = false;      // this start recorded a brownout whose date is not known yet
bool store_failure_logged = false;

// The scale chosen when an animation last started, reused while the animation, its brightness and the limit stay
// the same, so a playlist that comes back to it does not scan it again.
struct ScaleCache
{
  bool valid = false;
  std::string animation;
  uint8_t e1 = 0;
  uint16_t limit_ma = 0;
  uint8_t scale = pixelart::POWER_FULL_SCALE;
} scale_cache;

uint32_t frame_check(const detail::Marker &m)
{
  return MARKER_FRAME_KEY ^ m.item ^ ((uint32_t)m.repetition << 16) ^ ((uint32_t)m.brightness * 0x01010101u);
}

uint32_t animation_check(const char *id) { return pixelart::crc32(id, strnlen(id, 32)); }

bool marker_valid(const detail::Marker &m)
{
  if (m.magic != MARKER_MAGIC || m.animation[32] != '\0' || m.item == NO_ITEM)
    return false;
  return pixelart::is_valid_id(m.animation) && m.animation_check == animation_check(m.animation) &&
         m.frame_check == frame_check(m);
}

void clear_marker() { detail::marker().magic = 0; }

} // namespace

namespace detail
{

void write_marker_animation(const std::string &id)
{
  detail::Marker &m = detail::marker();
  m.magic = 0;
  memset(m.animation, 0, sizeof(m.animation));
  memcpy(m.animation, id.data(), id.size() < 32 ? id.size() : 32);
  m.animation_check = animation_check(m.animation);
  m.item = NO_ITEM;
  m.magic = MARKER_MAGIC;
}

void write_marker_frame(uint32_t item, uint32_t repetition, uint8_t brightness)
{
  detail::Marker &m = detail::marker();
  m.item = item < NO_ITEM ? (uint16_t)item : NO_ITEM; // out of range: no frame
  m.repetition = (uint16_t)repetition;
  m.brightness = brightness;
  m.frame_check = frame_check(m);
}

} // namespace detail

namespace
{

void store()
{
  uint8_t bytes[pixelart::POWER_RECORD_BYTES];
  pixelart::power_record_encode(record, detail::model_version(), bytes);
  if (detail::store_record(bytes, sizeof(bytes)))
    return;
  if (!store_failure_logged)
    Serial.println("pixelart: power protection: the record cannot be stored");
  store_failure_logged = true;
}

// The record of the last start, or an empty one when there is none, it cannot be read, or it was computed with
// another estimate model.
pixelart::PowerRecord read_record()
{
  uint8_t bytes[pixelart::POWER_RECORD_BYTES + 1];
  size_t size = 0;
  pixelart::PowerRecord stored;
  uint8_t model = 0;
  const detail::Load load = detail::load_record(bytes, sizeof(bytes), size);
  if (load == detail::Load::Missing)
    return {};
  if (load == detail::Load::Failed || !pixelart::power_record_decode(bytes, size, stored, model))
  {
    Serial.println("pixelart: power protection: the record cannot be read, a new one starts");
    return {};
  }
  return model == detail::model_version() ? stored : pixelart::PowerRecord();
}

// The frame the marker holds, as the start after a brownout finds it.
struct MarkedFrame
{
  bool known = false; // the marker is valid and its animation and frame exist
  char animation[33] = {};
  uint32_t number = 0;
  uint32_t estimate = 0;
};

// Reads the marker and estimates its frame. Changes nothing but the shared frame buffer.
MarkedFrame marked_frame()
{
  MarkedFrame found;
  const detail::Marker &m = detail::marker();
  if (!marker_valid(m))
    return found;
  pixelart::Animation animation;
  std::vector<pixelart::Diagnostic> diagnostics;
  if (!load_stored_animation(m.animation, animation, diagnostics))
    return found;
  pixelart::Frame &frame = frame_buffer();
  if (!pixelart::frame_number(animation, m.item, m.repetition, found.number) ||
      !pixelart::Player(animation).render_at(m.item, m.repetition, frame))
    return found;
  found.known = true;
  memcpy(found.animation, m.animation, sizeof(found.animation));
  found.estimate = pixelart::frame_estimate_ma(frame, m.brightness, GAMMA);
  return found;
}

void notice_date()
{
  pixelart::LocalDate date;
  uint16_t minute = 0;
  if (!updates::local_datetime(date, minute))
    return;
  date_pending = false;
  record.last_date_known = true;
  record.last_date = date;
  store();
}

// One start: its reason, and for a brownout the frame the marker holds.
void record_start(pixelart::ResetReason reason)
{
  uint32_t estimate = 0;
  if (reason == pixelart::ResetReason::Brownout)
  {
    // The last brownout is this one: its frame when the marker holds one, its date once the time is known.
    const MarkedFrame frame = marked_frame();
    record.has_last = true;
    record.last_frame_known = frame.known;
    memcpy(record.last_animation, frame.animation, sizeof(record.last_animation));
    record.last_frame = frame.number;
    record.last_date_known = false;
    estimate = frame.estimate;
    date_pending = true;
  }
  clear_marker();
  pixelart::power_apply_start(record, reason, estimate);
}

} // namespace

void begin()
{
  record = read_record();
  scale = pixelart::POWER_FULL_SCALE;
  animation_playing = false;
  date_pending = false;
  store_failure_logged = false;
  scale_cache = ScaleCache();
#ifdef PIXELART_SIM
  // The starts queued with --boot run first, each as a start of its own; the last one is this start.
  const std::vector<SimBoot> boots = sim_take_queued_boots();
  for (size_t i = 0; i < boots.size(); i++)
  {
    if (boots[i].animation.empty() || !sim_set_marker(boots[i].animation, boots[i].frame))
      sim_clear_marker(); // the simulator checked the animation and the frame when it read --boot
    if (i + 1 < boots.size())
      record_start(boots[i].reason);
    else
      sim_set_next_reason(boots[i].reason);
  }
#endif
  record_start(detail::boot_reason());
  store();
  if (date_pending)
    notice_date();
}

bool limit_active() { return record.limit_active; }

uint8_t scale_for(const std::string &id, const pixelart::Animation &animation, uint8_t e1, pixelart::Frame &scratch)
{
  if (scale_cache.valid && scale_cache.animation == id && scale_cache.e1 == e1 &&
      scale_cache.limit_ma == record.limit_ma)
    return scale_cache.scale;
  const pixelart::HeaviestFrame heaviest = pixelart::heaviest_frame(animation, e1, GAMMA, scratch);
  const uint8_t chosen = heaviest.estimate <= record.limit_ma
                             ? pixelart::POWER_FULL_SCALE
                             : pixelart::power_scale(heaviest.white ? nullptr : &scratch, e1, record.limit_ma, GAMMA);
  scale_cache = {true, id, e1, record.limit_ma, chosen};
  return chosen;
}

void animations_changed() { scale_cache = ScaleCache(); }

void animation_started(const std::string &id, uint8_t animation_scale)
{
  detail::write_marker_animation(id);
  animation_playing = true;
  scale = animation_scale;
}

void frame_shown(uint32_t item, uint32_t repetition, uint8_t brightness)
{
  detail::write_marker_frame(item, repetition, brightness);
  if (date_pending)
    notice_date();
}

void animation_stopped()
{
  clear_marker();
  animation_playing = false;
  scale = pixelart::POWER_FULL_SCALE;
}

void icon_started() { clear_marker(); }

void icon_ended()
{
  if (animation_playing)
  {
    // Its ID is still there, but no frame of it is on the matrix until the next one writes it.
    detail::marker().item = NO_ITEM;
    detail::marker().magic = MARKER_MAGIC;
  }
}

uint8_t current_scale() { return scale; }

Status status()
{
  Status s;
  s.brownouts = record.brownouts();
  s.limit_active = record.limit_active;
  s.limit_ma = record.limit_ma;
  s.at_floor = record.at_floor();
  s.scale = scale;
  s.has_last = record.has_last;
  s.last_frame_known = record.has_last && record.last_frame_known;
  if (s.last_frame_known)
  {
    s.last_animation = record.last_animation;
    s.last_frame = record.last_frame;
  }
  s.last_date_known = record.has_last && record.last_date_known;
  s.last_date = record.last_date;
  for (uint8_t i = 0; i < record.count; i++)
    s.resets.push_back(pixelart::reset_reason_name(record.reasons[i]));
  return s;
}

bool clear()
{
  uint8_t bytes[pixelart::POWER_RECORD_BYTES];
  pixelart::power_record_encode(pixelart::PowerRecord(), detail::model_version(), bytes);
  if (!detail::store_record(bytes, sizeof(bytes)))
    return false;
  record = pixelart::PowerRecord();
  scale_cache = ScaleCache();
  scale = pixelart::POWER_FULL_SCALE; // the animation playing goes back to its full brightness at its next frame
  date_pending = false;
  return true;
}

} // namespace power
