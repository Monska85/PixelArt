// SPDX-License-Identifier: GPL-3.0-or-later

// The decisions of the WiFi connection, without any WiFi call, so the board and
// the host tests share them: transmit power fallback, the states and the
// reconnection schedule of docs/board/wifi-and-updates-v1.md#connection.
// Times are milliseconds from any monotonic origin.

#pragma once

#include <cstddef>
#include <cstdint>
#include <string>

namespace wifi_logic
{

enum class State : uint8_t
{
  NotConfigured,
  Connecting,
  Connected,
  NetworkNotFound,
  WrongPassword,
  NoAddress,
  Disconnected
};

// The name `status` reports.
const char *state_name(State state);

// Reason codes of the WiFi stack's disconnect event (esp_wifi_types_generic.h).
namespace reason
{
constexpr int AUTH_EXPIRE = 2;
constexpr int ASSOC_LEAVE = 8;
constexpr int MIC_FAILURE = 14;
constexpr int HANDSHAKE_4WAY_TIMEOUT = 15;
constexpr int AUTH_FAILED_802_1X = 23;
constexpr int NO_AP_FOUND = 201;
constexpr int AUTH_FAIL = 202;
constexpr int ASSOC_FAIL = 203;
constexpr int HANDSHAKE_TIMEOUT = 204;
constexpr int CONNECTION_FAIL = 205;
constexpr int NO_AP_FOUND_COMPATIBLE_SECURITY = 210;
constexpr int NO_AP_FOUND_AUTHMODE_THRESHOLD = 211;
constexpr int NO_AP_FOUND_RSSI_THRESHOLD = 212;
} // namespace reason

// The state a disconnect reason stands for.
State state_for_disconnect(int reason);

// Whether a disconnect while joining counts as a failure at the WiFi level for
// the power fallback: not found, refused, or no answer from the access point.
bool is_join_failure(int reason);

// Transmit powers, from 8.5 to 19.5 dBm, as the `wifi_power` setting spells them
// (without `auto`).
struct Power
{
  const char *label;
  int8_t quarter_dbm; // the unit of wifi_power_t in Arduino-ESP32
};
extern const Power POWERS[];
extern const size_t POWER_COUNT;

constexpr const char *POWER_AUTO = "auto";
constexpr const char *POWER_LOWEST = "8.5";
constexpr const char *POWER_HIGHEST = "19.5";

// Whether `value` is `auto` or one of POWERS.
bool is_valid_power_setting(const std::string &value);

// The power in use for a `wifi_power` setting, with the fallback rules.
class PowerPolicy
{
public:
  static constexpr int AUTO_FAILURES = 2;
  static constexpr int FIXED_FAILURES = 3;

  // A new setting forgets earlier failures and the fallback. A value that is
  // not valid counts as `auto`.
  void set_setting(const std::string &setting);
  // Forgets earlier failures and the fallback, keeping the setting.
  void reset();
  void on_join_failure();
  void on_joined();

  // The label of the power in use, one of POWERS.
  const char *label() const;
  int quarter_dbm() const;
  // The board fell back to 8.5 dBm.
  bool reduced() const { return reduced_; }

private:
  std::string setting_ = POWER_AUTO;
  int failures_ = 0;
  bool reduced_ = false;
};

// States and timing of one WiFi connection. The caller reports what the WiFi
// stack did and carries out the actions poll() returns.
class Connection
{
public:
  static constexpr uint32_t ADDRESS_TIMEOUT_MS = 30000;
  // How long a disconnect with the "left" reason is taken as the board's own.
  static constexpr uint32_t OWN_DISCONNECT_MS = 2000;
  // Waits before each new try: 1, 2, 4, 8, 16, 32, then 60 seconds.
  static uint32_t retry_delay_ms(unsigned failed_attempts);

  struct Actions
  {
    bool connect = false;
    bool disconnect = false;
  };

  // A network is stored (or not): the start of the board, a new network, a forgotten one.
  void set_credentials(bool present, uint32_t now);
  void on_joined(uint32_t now);
  void on_got_ip(uint32_t now);
  void on_disconnected(int reason, uint32_t now);
  Actions poll(uint32_t now);

  State state() const { return state_; }
  PowerPolicy &power() { return power_; }
  const PowerPolicy &power() const { return power_; }
  // Milliseconds until poll() has something to do, or UINT32_MAX when it waits for an event.
  uint32_t next_wake_ms(uint32_t now) const;

private:
  void schedule_retry(uint32_t now);

  State state_ = State::NotConfigured;
  PowerPolicy power_;
  bool present_ = false;
  bool joined_ = false;
  bool connect_due_ = false;
  bool disconnect_due_ = false;
  bool retry_pending_ = false;
  uint32_t retry_at_ = 0;
  bool address_armed_ = false;
  uint32_t address_deadline_ = 0;
  bool own_disconnect_armed_ = false;
  uint32_t own_disconnect_until_ = 0;
  unsigned failed_attempts_ = 0;
};

// `pixelart-` and the last two bytes of the MAC address as four lowercase hex digits.
std::string hostname_for_mac(const uint8_t mac[6]);

} // namespace wifi_logic
