// SPDX-License-Identifier: GPL-3.0-or-later

#pragma once

#include <cstddef>
#include <cstdint>

#include "network.h"

namespace wifi_credentials
{

constexpr uint8_t VERSION = 1;
constexpr size_t MAX_RECORD_BYTES = 3 + network::MAX_SSID + network::MAX_PASSWORD;

// One NVS value holds both fields. The lengths count bytes, including non-UTF-8 SSID bytes.
bool encode(const char *ssid, const char *password, uint8_t (&record)[MAX_RECORD_BYTES], size_t &length);
bool decode(const uint8_t *record, size_t length, char (&ssid)[network::MAX_SSID + 1],
            char (&password)[network::MAX_PASSWORD + 1]);

} // namespace wifi_credentials
