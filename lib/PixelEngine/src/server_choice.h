// SPDX-License-Identifier: GPL-3.0-or-later

// Reading the server choice from a pixelart-play/1 document (docs/format/play-v1.md). Structural rules mirror
// schema/play-1.schema.json.

#pragma once

#include <ArduinoJson.h>

#include <cstddef>
#include <vector>

#include "pixelart_engine.h"

namespace pixelart
{

// Reads `{"schedule": "<id>"}` or `{"playlists": ["<id>", ...]}`: an object with exactly one key, a valid ID or 1
// to MAX_SCHEDULE_PLAYLISTS valid IDs with none twice. Returns false for anything else and leaves `out` empty.
bool read_server_choice(JsonVariantConst value, ServerChoice &out);

// Parses and validates a play file. Returns false on any error, with `diagnostics` holding it, and leaves `out`
// empty; on success `out` is the `default` of the file. Whether the schedule or the playlists exist is not checked.
bool load_play_file(const char *json, size_t length, ServerChoice &out, std::vector<Diagnostic> &diagnostics);

} // namespace pixelart
