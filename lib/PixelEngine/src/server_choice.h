// SPDX-License-Identifier: GPL-3.0-or-later

// Reading a server choice from JSON, for the manifest's `default` and the command `server_choice_set`
// (docs/format/manifest-v1.md#default).

#pragma once

#include <ArduinoJson.h>

#include "pixelart_engine.h"

namespace pixelart
{

// Reads `{"schedule": "<id>"}` or `{"playlists": ["<id>", ...]}`: an object with exactly one key, a valid ID or 1
// to MAX_SCHEDULE_PLAYLISTS valid IDs with none twice. Returns false for anything else and leaves `out` empty.
bool read_server_choice(JsonVariantConst value, ServerChoice &out);

} // namespace pixelart
