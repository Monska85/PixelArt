// SPDX-License-Identifier: GPL-3.0-or-later

#include "wifi_logic.h"

#include <cstdio>
#include <cstring>

namespace wifi_logic
{

namespace
{

// Wrap-safe: true when `now` has reached `deadline`.
bool reached(uint32_t now, uint32_t deadline) { return (int32_t)(now - deadline) >= 0; }

} // namespace

const Power POWERS[] = {{"8.5", 34}, {"11", 44}, {"13", 52}, {"15", 60}, {"17", 68}, {"18.5", 74}, {"19.5", 78}};
const size_t POWER_COUNT = sizeof(POWERS) / sizeof(POWERS[0]);

const char *state_name(State state)
{
  switch (state)
  {
  case State::NotConfigured:
    return "not_configured";
  case State::Connecting:
    return "connecting";
  case State::Connected:
    return "connected";
  case State::NetworkNotFound:
    return "network_not_found";
  case State::WrongPassword:
    return "wrong_password";
  case State::NoAddress:
    return "no_address";
  case State::Disconnected:
    return "disconnected";
  }
  return "disconnected";
}

State state_for_disconnect(int code)
{
  switch (code)
  {
  case reason::NO_AP_FOUND:
  case reason::NO_AP_FOUND_COMPATIBLE_SECURITY:
  case reason::NO_AP_FOUND_AUTHMODE_THRESHOLD:
  case reason::NO_AP_FOUND_RSSI_THRESHOLD:
    return State::NetworkNotFound;
  case reason::AUTH_FAIL:
  case reason::HANDSHAKE_4WAY_TIMEOUT:
  case reason::HANDSHAKE_TIMEOUT:
  case reason::MIC_FAILURE:
  case reason::AUTH_FAILED_802_1X:
    return State::WrongPassword;
  default:
    return State::Disconnected;
  }
}

bool is_join_failure(int code)
{
  switch (code)
  {
  case reason::AUTH_EXPIRE:
  case reason::ASSOC_FAIL:
  case reason::CONNECTION_FAIL:
    return true; // no answer, or the access point refused the join
  default:
    return state_for_disconnect(code) != State::Disconnected;
  }
}

bool is_valid_power_setting(const std::string &value)
{
  if (value == POWER_AUTO)
    return true;
  for (size_t i = 0; i < POWER_COUNT; i++)
    if (value == POWERS[i].label)
      return true;
  return false;
}

void PowerPolicy::set_setting(const std::string &setting)
{
  setting_ = is_valid_power_setting(setting) ? setting : POWER_AUTO;
  reset();
}

void PowerPolicy::reset()
{
  failures_ = 0;
  reduced_ = false;
}

void PowerPolicy::on_join_failure()
{
  if (reduced_)
    return;
  const int limit = setting_ == POWER_AUTO ? AUTO_FAILURES : FIXED_FAILURES;
  if (++failures_ >= limit)
    reduced_ = true;
}

void PowerPolicy::on_joined() { failures_ = 0; }

const char *PowerPolicy::label() const
{
  if (reduced_)
    return POWER_LOWEST;
  return setting_ == POWER_AUTO ? POWER_HIGHEST : setting_.c_str();
}

int PowerPolicy::quarter_dbm() const
{
  const char *wanted = label();
  for (size_t i = 0; i < POWER_COUNT; i++)
    if (!strcmp(wanted, POWERS[i].label))
      return POWERS[i].quarter_dbm;
  return POWERS[POWER_COUNT - 1].quarter_dbm;
}

uint32_t Connection::retry_delay_ms(unsigned failed_attempts)
{
  static const uint32_t SECONDS[] = {1, 2, 4, 8, 16, 32, 60};
  const unsigned last = sizeof(SECONDS) / sizeof(SECONDS[0]) - 1;
  return SECONDS[failed_attempts < last ? failed_attempts : last] * 1000;
}

void Connection::schedule_retry(uint32_t now)
{
  retry_pending_ = true;
  retry_at_ = now + retry_delay_ms(failed_attempts_);
  failed_attempts_++;
}

void Connection::set_credentials(bool present, uint32_t now)
{
  const bool was_joined = joined_;
  present_ = present;
  joined_ = false;
  retry_pending_ = false;
  address_armed_ = false;
  failed_attempts_ = 0;
  if (was_joined)
  {
    own_disconnect_armed_ = true;
    own_disconnect_until_ = now + OWN_DISCONNECT_MS;
  }
  if (present)
  {
    state_ = State::Connecting;
    connect_due_ = true;
    disconnect_due_ = false;
  }
  else
  {
    state_ = State::NotConfigured;
    connect_due_ = false;
    disconnect_due_ = true;
  }
}

void Connection::on_joined(uint32_t now)
{
  if (!present_)
    return;
  joined_ = true;
  state_ = State::Connecting; // waiting for an address
  address_armed_ = true;
  address_deadline_ = now + ADDRESS_TIMEOUT_MS;
  power_.on_joined();
}

void Connection::on_got_ip(uint32_t)
{
  if (!present_)
    return;
  joined_ = true;
  address_armed_ = false;
  state_ = State::Connected;
  failed_attempts_ = 0;
}

void Connection::on_disconnected(int code, uint32_t now)
{
  if (!present_)
    return;
  if (own_disconnect_armed_ && code == reason::ASSOC_LEAVE && !reached(now, own_disconnect_until_))
  {
    own_disconnect_armed_ = false;
    return;
  }
  const bool was_joined = joined_;
  joined_ = false;
  address_armed_ = false;
  state_ = state_for_disconnect(code);
  if (!was_joined && is_join_failure(code))
    power_.on_join_failure();
  if (was_joined)
    failed_attempts_ = 0; // a drop starts the schedule again, at one second
  schedule_retry(now);
}

Connection::Actions Connection::poll(uint32_t now)
{
  Actions actions;
  if (!present_)
  {
    actions.disconnect = disconnect_due_;
    disconnect_due_ = false;
    return actions;
  }
  if (address_armed_ && reached(now, address_deadline_))
  {
    address_armed_ = false;
    state_ = State::NoAddress;
    joined_ = false;
    own_disconnect_armed_ = true;
    own_disconnect_until_ = now + OWN_DISCONNECT_MS;
    actions.disconnect = true;
    schedule_retry(now);
  }
  if (retry_pending_ && reached(now, retry_at_))
  {
    retry_pending_ = false;
    connect_due_ = true;
  }
  actions.connect = connect_due_;
  connect_due_ = false;
  return actions;
}

uint32_t Connection::next_wake_ms(uint32_t now) const
{
  uint32_t wake = UINT32_MAX;
  auto consider = [&](bool armed, uint32_t at)
  {
    if (!armed)
      return;
    const uint32_t wait = reached(now, at) ? 0 : at - now;
    if (wait < wake)
      wake = wait;
  };
  if (!present_)
    return disconnect_due_ ? 0 : wake;
  if (connect_due_)
    return 0;
  consider(address_armed_, address_deadline_);
  consider(retry_pending_, retry_at_);
  return wake;
}

std::string hostname_for_mac(const uint8_t mac[6])
{
  char name[16];
  snprintf(name, sizeof(name), "pixelart-%02x%02x", mac[4], mac[5]);
  return name;
}

} // namespace wifi_logic
