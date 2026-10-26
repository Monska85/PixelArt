// SPDX-License-Identifier: GPL-3.0-or-later

// WiFi, as the loop task sees it. On the board, a FreeRTOS task of its own runs
// the connection, the scans and mDNS (docs/board/wifi-and-updates-v1.md#tasks-and-memory);
// it never touches the engine, the player, the settings or the files. The loop
// task asks it for things through a queue and reads its state from a snapshot.
// The simulator has no network task and reports the fixed values the protocol
// specifies for it.

#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "wifi_logic.h"

namespace network
{

constexpr size_t MAX_SSID = 32;
constexpr size_t MAX_PASSWORD = 64;
constexpr size_t HOSTNAME_SIZE = 16; // pixelart-XXXX and the end of the text
constexpr size_t IP_SIZE = 16;       // 255.255.255.255 and the end of the text

// What `status` reports about WiFi. Copied under a lock, so it is always consistent.
struct Snapshot
{
  wifi_logic::State state = wifi_logic::State::NotConfigured;
  bool has_ip = false;
  char ip[IP_SIZE] = "";
  bool has_rssi = false;
  int rssi = 0;
  char power[8] = "19.5"; // the label of the transmit power in use
  bool power_reduced = false;
  char hostname[HOSTNAME_SIZE] = "";
  bool has_ssid = false;        // a network is stored
  char ssid[MAX_SSID + 1] = ""; // its name as stored: up to 32 bytes, not necessarily UTF-8
};

struct Network
{
  char ssid[MAX_SSID + 1];
  int rssi;
  bool secure;
};

enum class ScanState
{
  Idle,
  Running,
  Done
};

// Starts the network task (on the board) with the `wifi_power` setting. Call it once, from setup().
void begin(const std::string &wifi_power_setting);

Snapshot snapshot();

// Wakes the network task to look at what the loop task left for it (an update request or a
// settings change). Does nothing in the simulator.
void wake();

// The `wifi_power` setting changed.
void set_power(const std::string &wifi_power_setting);

// Stores the network and connects to it, at once in the snapshot (state `connecting`) and then in the
// background. False when the request cannot be queued or the names are too long.
bool provision(const char *ssid, const char *password);

// Asks the network task to erase the stored network and disconnect, and the snapshot says
// `not_configured` at once. False when the request cannot be queued: the snapshot is then as it was and
// the network stays stored.
bool forget();

// Closes the connection of the WiFi client of the protocol, if one is open, after the replies already
// given. The login of a closed connection is gone: the client connects again and logs in again.
void close_client();

// Starts a scan of the networks in range. False when it cannot start (one is running, no room).
bool request_scan();
ScanState scan_state();
// The result of the last finished scan, which this call consumes.
std::vector<Network> take_scan();

#ifdef PIXELART_SIM
// Replaces what the simulator's network reports, for tests. `begin()` puts the defaults back.
void sim_set_snapshot(const Snapshot &snapshot);
void sim_set_networks(const std::vector<Network> &networks);
// Makes provision() fail, or leave the state as the test set it.
void sim_provision_connects(bool connects);
// How many times close_client() was called since begin().
unsigned sim_close_requests();
// Makes forget() fail, as a full queue of the network task does. `begin()` puts it back.
void sim_forget_succeeds(bool succeeds);
#endif

} // namespace network
