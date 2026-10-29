// SPDX-License-Identifier: GPL-3.0-or-later

#include "wifi_credentials.h"

#include <cstring>

namespace wifi_credentials
{

bool encode(const char *ssid, const char *password, uint8_t (&record)[MAX_RECORD_BYTES], size_t &length)
{
  if (!ssid || !password)
    return false;
  const size_t ssid_size = strnlen(ssid, network::MAX_SSID + 1);
  const size_t password_size = strnlen(password, network::MAX_PASSWORD + 1);
  if (ssid_size == 0 || ssid_size > network::MAX_SSID || password_size > network::MAX_PASSWORD)
    return false;
  record[0] = VERSION;
  record[1] = (uint8_t)ssid_size;
  record[2] = (uint8_t)password_size;
  memcpy(record + 3, ssid, ssid_size);
  memcpy(record + 3 + ssid_size, password, password_size);
  length = 3 + ssid_size + password_size;
  return true;
}

bool decode(const uint8_t *record, size_t length, char (&ssid)[network::MAX_SSID + 1],
            char (&password)[network::MAX_PASSWORD + 1])
{
  if (!record || length < 3 || record[0] != VERSION)
    return false;
  const size_t ssid_size = record[1];
  const size_t password_size = record[2];
  if (ssid_size == 0 || ssid_size > network::MAX_SSID || password_size > network::MAX_PASSWORD ||
      length != 3 + ssid_size + password_size || memchr(record + 3, 0, ssid_size + password_size))
    return false;
  memcpy(ssid, record + 3, ssid_size);
  ssid[ssid_size] = 0;
  memcpy(password, record + 3 + ssid_size, password_size);
  password[password_size] = 0;
  return true;
}

} // namespace wifi_credentials
