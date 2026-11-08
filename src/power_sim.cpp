// SPDX-License-Identifier: GPL-3.0-or-later

// Power protection in the simulator: the reset reason, the marker and the record live in memory, which outlives
// setup() as RTC memory and NVS outlive a restart on the board. Seams for the tests. See include/power.h.

#ifdef PIXELART_SIM

#include <cstring>
#include <deque>

#include "app.h"
#include "power.h"
#include "settings.h"

namespace power
{

namespace
{

pixelart::ResetReason next_reason = pixelart::ResetReason::PowerOn;
detail::Marker sim_marker = {};
uint8_t model = pixelart::POWER_MODEL_VERSION;
bool stores_fail = false;
bool has_record = false;
uint8_t stored[pixelart::POWER_RECORD_BYTES];
std::deque<SimBoot> queued;

} // namespace

namespace detail
{

pixelart::ResetReason boot_reason()
{
  const pixelart::ResetReason reason = next_reason;
  next_reason = pixelart::ResetReason::Software; // a later restart of the simulator is the firmware's own
  return reason;
}

Marker &marker() { return sim_marker; }

uint8_t model_version() { return model; }

Load load_record(uint8_t *bytes, size_t capacity, size_t &size)
{
  if (!has_record)
    return Load::Missing;
  if (capacity < sizeof(stored))
    return Load::Failed;
  memcpy(bytes, stored, sizeof(stored));
  size = sizeof(stored);
  return Load::Ok;
}

bool store_record(const uint8_t *bytes, size_t size)
{
  if (stores_fail || size != sizeof(stored))
    return false;
  memcpy(stored, bytes, size);
  has_record = true;
  return true;
}

} // namespace detail

void sim_reset()
{
  next_reason = pixelart::ResetReason::PowerOn;
  sim_marker = {};
  model = pixelart::POWER_MODEL_VERSION;
  stores_fail = false;
  has_record = false;
  queued.clear();
}

void sim_set_next_reason(pixelart::ResetReason reason) { next_reason = reason; }

bool sim_set_marker(const std::string &animation_id, uint32_t frame)
{
  sim_clear_marker();
  pixelart::Animation animation;
  std::vector<pixelart::Diagnostic> diagnostics;
  uint32_t item = 0, repetition = 0;
  if (!load_stored_animation(animation_id, animation, diagnostics) ||
      !pixelart::frame_position(animation, frame, item, repetition))
    return false;
  // The brightness the player would use for it now, the power scale included.
  const uint8_t e1 = pixelart::effective_brightness(settings::brightness(), animation.brightness());
  const uint8_t animation_scale =
      limit_active() ? scale_for(animation_id, animation, e1, frame_buffer()) : pixelart::POWER_FULL_SCALE;
  detail::write_marker_animation(animation_id);
  detail::write_marker_frame(item, repetition, pixelart::power_brightness(e1, animation_scale));
  return true;
}

void sim_clear_marker() { sim_marker.magic = 0; }

void sim_set_model(uint8_t version) { model = version; }

void sim_fail_stores(bool fail) { stores_fail = fail; }

void sim_queue_boot(pixelart::ResetReason reason, const std::string &animation, uint32_t frame)
{
  queued.push_back({reason, animation, frame});
}

std::vector<SimBoot> sim_take_queued_boots()
{
  std::vector<SimBoot> boots(queued.begin(), queued.end());
  queued.clear();
  return boots;
}

} // namespace power

#endif
