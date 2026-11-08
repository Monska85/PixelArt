// SPDX-License-Identifier: GPL-3.0-or-later

// Power protection (docs/board/power-protection-v1.md): the history of the board's starts, the current limit
// learned from its brownouts, the frame marker that survives a reset, and the power scale of the animation
// playing. The rules are in lib/PixelEngine/src/power_rules.h; this module keeps the state, the NVS record and the
// marker. On the board the record is in NVS and the marker in RTC memory; the simulator keeps both in memory
// across its restarts, with seams for the tests.

#pragma once

#include <power_rules.h>

#include <cstdint>
#include <string>
#include <vector>

namespace power
{

// Records the reason of this start, estimates the frame of a brownout, applies the trigger and the limit and
// stores the record. Call it once from setup(), as early as it can run: after the file system is mounted and
// task_sync::begin(), before the player starts.
void begin();

// updates::begin() has run: stores the date of a brownout this start recorded, when the time is already known.
// Call it once from setup(), after begin().
void updates_started();

// Whether the current limit is on. The only check an animation costs while it is off.
bool limit_active();

// The power scale of the animation `id`, loaded in `animation`, for the brightness `e1`, with the limit on. Scans
// it into `scratch`, unless the same animation was scanned last with the same brightness and limit.
uint8_t scale_for(const std::string &id, const pixelart::Animation &animation, uint8_t e1, pixelart::Frame &scratch);

// An animation file was stored, replaced or removed: the next start of every animation scans it again.
void animations_changed();

// The animation `id` starts, at the power scale `scale`: the marker takes its ID.
void animation_started(const std::string &id, uint8_t scale);

// A frame of the animation is on the matrix: repetition `repetition` of item `item`, with the LEDs at
// `brightness`. Also stores the date of a brownout once the time is known.
void frame_shown(uint32_t item, uint32_t repetition, uint8_t brightness);

// No animation plays any more: the marker is cleared and the scale is 100.
void animation_stopped();

// The update icon replaces the animation on the matrix: the marker is cleared, the scale stays.
void icon_started();
// The update icon is gone: when an animation is still playing, the marker takes its ID again, with no frame until
// the next one is shown. Nothing happens otherwise.
void icon_ended();

// The power scale the animation playing now uses: 100 when none plays or the limit is off.
uint8_t current_scale();

// What `status.power` reports.
struct Status
{
  uint8_t brownouts = 0;
  bool limit_active = false;
  uint16_t limit_ma = 0;
  bool at_floor = false;
  uint8_t scale = pixelart::POWER_FULL_SCALE;
  bool has_last = false;
  bool last_frame_known = false;
  std::string last_animation;
  uint32_t last_frame = 0;
  bool last_date_known = false;
  pixelart::LocalDate last_date;
  std::vector<const char *> resets; // oldest first
};
Status status();

// Clears the history, the estimates, the last brownout and the limit, and stores the empty record. False, with
// nothing changed, when the record cannot be stored.
bool clear();

namespace detail
{

// The frame marker. On the board it lives in RTC memory that a reset keeps and a power cut does not.
struct Marker
{
  uint32_t magic;
  char animation[33];
  uint32_t animation_check;
  uint16_t item;
  uint16_t repetition;
  uint8_t brightness;
  uint32_t frame_check;
};

pixelart::ResetReason boot_reason();
Marker &marker();
uint8_t model_version();

enum class Load
{
  Ok,
  Missing, // no record stored
  Failed,
};
Load load_record(uint8_t *bytes, size_t capacity, size_t &size);
bool store_record(const uint8_t *bytes, size_t size);

// Writes the marker: the animation that starts (no frame yet), then each frame of it, the check last.
void write_marker_animation(const std::string &id);
void write_marker_frame(uint32_t item, uint32_t repetition, uint8_t brightness);

} // namespace detail

#ifdef PIXELART_SIM
// Seams for the simulator and the tests (docs/board/power-protection-v1.md#simulator-and-tests).

struct SimBoot
{
  pixelart::ResetReason reason;
  std::string animation; // empty: no marker
  uint32_t frame;
};
// The starts queued with sim_queue_boot(), oldest first. Empties the queue.
std::vector<SimBoot> sim_take_queued_boots();

// Forgets the record and the marker, and makes the next start a power on with model 1.
void sim_reset();
// The reason of the next start. After each start it goes back to `software`.
void sim_set_next_reason(pixelart::ResetReason reason);
// Fills the marker as the player would for frame `frame` of the stored animation `animation`, with the
// brightness and power scale of now. False, with the marker cleared, when the animation or frame does not exist.
bool sim_set_marker(const std::string &animation, uint32_t frame);
void sim_clear_marker();
// The estimate model version of the simulated firmware.
void sim_set_model(uint8_t model);
// Makes every store of the record fail, or work again.
void sim_fail_stores(bool fail);
// Every record stored since sim_reset(), oldest first, as the bytes written to NVS.
std::vector<std::vector<uint8_t>> sim_stores();
// Queues a start for the next begin(), which runs the queued starts oldest first, each with its own recording,
// trigger and limit; the last queued one is the reason of that begin()'s own start. `animation` empty: no marker.
void sim_queue_boot(pixelart::ResetReason reason, const std::string &animation, uint32_t frame);
#endif

} // namespace power
