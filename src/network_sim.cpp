// SPDX-License-Identifier: GPL-3.0-or-later

// The simulator's network: fixed WiFi values and hooks for the tests. See include/network.h.

#ifdef PIXELART_SIM

#include "network.h"

#include <Arduino.h>

#include <algorithm>
#include <cstdio>
#include <cstring>

#include "platform.h"
#include "updates.h"
#include "ws_server.h"

namespace network
{

namespace
{

void copy_text(char *out, size_t size, const char *text) { snprintf(out, size, "%s", text); }

Snapshot sim_snapshot;
std::vector<Network> sim_networks;
ScanState sim_scan = ScanState::Idle;
bool sim_connects = true;
wifi_logic::PowerPolicy sim_power;
unsigned sim_closes = 0;

Snapshot fixed_snapshot()
{
  Snapshot s;
  s.state = wifi_logic::State::Connected;
  s.has_ip = true;
  copy_text(s.ip, sizeof(s.ip), "127.0.0.1");
  s.has_rssi = true;
  s.rssi = -50;
  copy_text(s.hostname, sizeof(s.hostname), "pixelart-sim");
  s.has_ssid = true;
  copy_text(s.ssid, sizeof(s.ssid), "PixelArt Simulator");
  copy_text(s.power, sizeof(s.power), sim_power.label());
  return s;
}

} // namespace

void begin(const std::string &wifi_power_setting)
{
  sim_power.set_setting(wifi_power_setting);
  sim_networks.clear();
  sim_scan = ScanState::Idle;
  sim_connects = true;
  sim_closes = 0;
  sim_snapshot = fixed_snapshot();
}

Snapshot snapshot() { return sim_snapshot; }

void set_power(const std::string &wifi_power_setting)
{
  sim_power.set_setting(wifi_power_setting);
  copy_text(sim_snapshot.power, sizeof(sim_snapshot.power), sim_power.label());
}

bool provision(const char *ssid, const char *password)
{
  if (!ssid || !password || strlen(ssid) == 0 || strlen(ssid) > MAX_SSID || strlen(password) > MAX_PASSWORD)
    return false;
  sim_snapshot.state = sim_connects ? wifi_logic::State::Connected : wifi_logic::State::Connecting;
  return true;
}

// The simulator always reports the fixed WiFi values of the protocol specification.
void forget() {}

bool request_scan()
{
  if (sim_scan == ScanState::Running)
    return false;
  sim_scan = ScanState::Done;
  return true;
}

ScanState scan_state() { return sim_scan; }

std::vector<Network> take_scan()
{
  sim_scan = ScanState::Idle;
  return sim_networks;
}

void wake() {}

void close_client()
{
  sim_closes++;
  ws_server::close_client();
}

unsigned sim_close_requests() { return sim_closes; }

void sim_set_snapshot(const Snapshot &snapshot) { sim_snapshot = snapshot; }
void sim_set_networks(const std::vector<Network> &networks) { sim_networks = networks; }
void sim_provision_connects(bool connects) { sim_connects = connects; }

} // namespace network

#endif
