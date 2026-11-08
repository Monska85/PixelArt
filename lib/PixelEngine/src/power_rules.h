// SPDX-License-Identifier: GPL-3.0-or-later

// Power protection rules of docs/board/power-protection-v1.md: the current estimate of a frame, the heaviest
// frame of an animation, the power scale, and the history and limit a board keeps across its starts. Plain
// C++, shared by the firmware, the simulator and the tests.

#pragma once

#include <cstddef>
#include <cstdint>

#include "pixelart_engine.h"

namespace pixelart
{

// Estimate model 1. A change of the formula or of a constant raises the version.
constexpr uint8_t POWER_MODEL_VERSION = 1;
constexpr uint32_t POWER_IDLE_UA_PER_LED = 1000;
constexpr uint32_t POWER_UA_PER_UNIT = 60;

constexpr size_t POWER_HISTORY = 10;
constexpr uint8_t POWER_TRIGGER_BROWNOUTS = 3;
constexpr uint16_t POWER_FIRST_LIMIT_WITHOUT_ESTIMATE_MA = 1000;
constexpr uint16_t POWER_FIRST_LIMIT_PERCENT = 80;
constexpr uint16_t POWER_STEP_PERCENT = 90;
constexpr uint16_t POWER_FLOOR_MA = 300;
constexpr uint32_t POWER_MAX_SCANNED_FRAMES = 1024;
// Points drawn by all the scanned frames together, counting every part of composites: bounds the scan's time.
constexpr uint64_t POWER_MAX_SCANNED_POINTS = 262144;
constexpr uint8_t POWER_FULL_SCALE = 100;

// The gamma tables of the matrix library, which turn a 5-bit (red, blue) or 6-bit (green) channel into the
// level the LED receives at full brightness.
struct LedGamma
{
  const uint8_t *five; // 32 entries
  const uint8_t *six;  // 64 entries
};

// Estimated current of `frame`, in mA, when the LEDs receive `brightness` (0 to 255).
uint32_t frame_estimate_ma(const Frame &frame, uint8_t brightness, const LedGamma &gamma);

// Estimated current of a frame with every LED white, in mA. Needs no table: white is 255 on every channel.
uint32_t white_frame_estimate_ma(uint8_t brightness);

// The brightness the LEDs receive for an animation brightness `e1` (already lowered by the animation's
// percentage) and a power scale from 1 to 100.
constexpr uint8_t power_brightness(uint8_t e1, uint8_t scale)
{
  if (scale >= POWER_FULL_SCALE || e1 == 0)
    return e1;
  const unsigned value = (e1 * (unsigned)scale + 50) / 100;
  return value == 0 ? 1 : (uint8_t)value;
}

// The heaviest frame of an animation, at the brightness `e1`.
struct HeaviestFrame
{
  bool white = false;  // more frames or points than the scan renders: the heaviest frame counts as full white
  uint32_t number = 0; // its frame number, when not `white`
  uint32_t estimate = 0;
};

// Scans the distinct frames of `animation` in frame number order, rendering into `scratch`, and returns the one
// with the highest estimate at `e1` (the first on a tie). Unless the result is `white`, `scratch` holds that
// frame afterwards.
HeaviestFrame heaviest_frame(const Animation &animation, uint8_t e1, const LedGamma &gamma, Frame &scratch);

// The power scale of an animation whose heaviest frame is `heaviest` (null: a full white frame) for the
// brightness `e1` and `limit_ma`: 100 when it fits, else the largest percentage from 1 to 99 that fits, else 1.
uint8_t power_scale(const Frame *heaviest, uint8_t e1, uint32_t limit_ma, const LedGamma &gamma);

// Frame numbers: the distinct frames of an animation in timeline order, counting each repetition and the frames
// inside a loop once. A position is a timeline item that is a frame and a repetition of it.
uint32_t frame_count(const Animation &animation);
// The points the distinct frames draw together, counting every part of composite sprites.
uint64_t drawn_points(const Animation &animation);
bool frame_number(const Animation &animation, uint32_t item, uint32_t repetition, uint32_t &number);
bool frame_position(const Animation &animation, uint32_t number, uint32_t &item, uint32_t &repetition);

enum class ResetReason : uint8_t
{
  Brownout,
  PowerOn,
  Software,
  Panic,
  Watchdog,
  DeepSleep,
  Other,
};
constexpr uint8_t RESET_REASON_COUNT = 7;

// `brownout`, `power_on`, `software`, `panic`, `watchdog`, `deep_sleep` or `other`.
const char *reset_reason_name(ResetReason reason);
bool reset_reason_from_name(const char *name, ResetReason &reason);

// What a board learned about its supply: the reasons of its last starts, oldest first, with the estimate of
// each brownout's frame (0: none), the limit, and the last brownout since the record was cleared.
struct PowerRecord
{
  uint8_t count = 0;
  ResetReason reasons[POWER_HISTORY] = {};
  uint16_t estimates[POWER_HISTORY] = {};
  bool limit_active = false;
  uint16_t limit_ma = 0;

  bool has_last = false;
  bool last_frame_known = false; // the animation and the frame are known
  char last_animation[33] = {};
  uint32_t last_frame = 0;
  bool last_date_known = false;
  LocalDate last_date;

  uint8_t brownouts() const;
  bool at_floor() const { return limit_active && limit_ma <= POWER_FLOOR_MA; }
};

// Appends a start to the history and applies the trigger and the limit steps. `estimate_ma` is the estimate
// of a brownout's frame, 0 when unknown, and is ignored for other reasons.
void power_apply_start(PowerRecord &record, ResetReason reason, uint32_t estimate_ma);

// The record as stored in NVS (layout 1): fixed size, little endian.
constexpr size_t POWER_RECORD_BYTES = 77;
constexpr uint8_t POWER_RECORD_LAYOUT = 1;
void power_record_encode(const PowerRecord &record, uint8_t model, uint8_t out[POWER_RECORD_BYTES]);
// False when the bytes are not a valid record of layout 1. `model` receives the model version it holds.
bool power_record_decode(const uint8_t *bytes, size_t size, PowerRecord &record, uint8_t &model);

} // namespace pixelart
