// SPDX-License-Identifier: GPL-3.0-or-later

// The network task on the board: the WiFi connection, scans and mDNS, and the start of the WebSocket server and of the
// updates. See include/network.h.

#ifndef PIXELART_SIM

#include "network.h"

#include <Arduino.h>

#include <algorithm>
#include <cstdio>
#include <cstring>

#include "platform.h"
#include "updates.h"
#include "ws_server.h"

#include <ESPmDNS.h>
#include <Preferences.h>
#include <WiFi.h>
#include <esp_mac.h>

#include "mailbox.h"

namespace network
{

namespace
{

void copy_text(char *out, size_t size, const char *text) { snprintf(out, size, "%s", text); }

using wifi_logic::Connection;
using wifi_logic::State;

// Room for a TLS handshake and the updater's lists on top of the WiFi work.
constexpr uint32_t TASK_STACK_BYTES = 16384;
constexpr UBaseType_t TASK_PRIORITY = 1;
constexpr uint32_t RSSI_REFRESH_MS = 2000;
constexpr uint32_t IDLE_WAKE_MS = 10000;
constexpr size_t MAX_SCAN_RESULTS = 16;
constexpr uint16_t MDNS_PORT = 80; // the WebSocket of the protocol over WiFi
constexpr TickType_t SEND_WAIT = pdMS_TO_TICKS(100);

const char *PREFS_NAMESPACE = "pixelart_wifi";
const char *KEY_SSID = "ssid";
const char *KEY_PASSWORD = "password";

// What the loop task and the WiFi event handler ask of the network task.
struct Message
{
  enum class Type : uint8_t
  {
    Joined,       // WiFi event: joined the access point
    GotIp,        // WiFi event: got an address
    Disconnected, // WiFi event: `reason`
    Provision,    // store and use `ssid` and `password`
    Forget,
    SetPower, // `power` is the new wifi_power setting
    Scan,
    Wake // the loop task left something for the updates: nothing to do here, the loop below looks
  };
  Type type;
  int reason;
  char ssid[MAX_SSID + 1];
  char password[MAX_PASSWORD + 1];
  char power[8];
};

Mailbox<Message, 8> inbox;

SemaphoreHandle_t lock;
StaticSemaphore_t lock_storage;
Snapshot shared;
ScanState shared_scan = ScanState::Idle;
Network scan_results[MAX_SCAN_RESULTS];
size_t scan_count = 0;

struct Locked
{
  Locked() { xSemaphoreTake(lock, portMAX_DELAY); }
  ~Locked() { xSemaphoreGive(lock); }
};

void wipe(void *data, size_t size)
{
  volatile uint8_t *p = static_cast<volatile uint8_t *>(data);
  for (size_t i = 0; i < size; i++)
    p[i] = 0;
}

// ---- Owned by the network task from here on ----

Connection connection;
char ssid[MAX_SSID + 1];
char password[MAX_PASSWORD + 1];
bool have_credentials = false;
bool wifi_started = false;
bool mdns_started = false;
char hostname[HOSTNAME_SIZE];

uint32_t now_ms() { return (uint32_t)(platform::now_us() / 1000); }

void publish()
{
  Snapshot next;
  next.state = connection.state();
  next.has_ip = next.state == State::Connected;
  if (next.has_ip)
  {
    copy_text(next.ip, sizeof(next.ip), WiFi.localIP().toString().c_str());
    next.has_rssi = true;
    next.rssi = WiFi.RSSI();
  }
  copy_text(next.power, sizeof(next.power), connection.power().label());
  next.power_reduced = connection.power().reduced();
  copy_text(next.hostname, sizeof(next.hostname), hostname);
  next.has_ssid = have_credentials;
  if (have_credentials)
    copy_text(next.ssid, sizeof(next.ssid), ssid);
  Locked guard;
  shared = next;
}

void on_wifi_event(arduino_event_id_t event, arduino_event_info_t info)
{
  Message m = {};
  switch (event)
  {
  case ARDUINO_EVENT_WIFI_STA_CONNECTED:
    m.type = Message::Type::Joined;
    break;
  case ARDUINO_EVENT_WIFI_STA_GOT_IP:
    m.type = Message::Type::GotIp;
    break;
  case ARDUINO_EVENT_WIFI_STA_DISCONNECTED:
    m.type = Message::Type::Disconnected;
    m.reason = info.wifi_sta_disconnected.reason;
    break;
  default:
    return;
  }
  inbox.send(m); // runs on the WiFi event task: never blocks, and a full queue drops the event
}

void start_wifi()
{
  if (wifi_started)
    return;
  WiFi.persistent(false);       // credentials live in our own namespace, not in the WiFi stack's
  WiFi.setAutoReconnect(false); // Connection decides when to try again
  WiFi.setHostname(hostname);   // before the interface exists
  platform::RadioLock radio;
  WiFi.mode(WIFI_STA);
  radio.set_running(true);
  wifi_started = true;
}

void stop_wifi()
{
  if (mdns_started)
    MDNS.end();
  mdns_started = false;
  if (wifi_started)
  {
    platform::RadioLock radio;
    WiFi.mode(WIFI_OFF);
    radio.set_running(false);
  }
  wifi_started = false;
}

void apply_power() { WiFi.setTxPower((wifi_power_t)connection.power().quarter_dbm()); }

void connect()
{
  start_wifi();
  WiFi.begin(ssid, password);
  apply_power(); // after begin(), as the stack takes the power only then
  WiFi.setSleep(false);
}

void start_mdns()
{
  if (mdns_started)
    return;
  mdns_started = MDNS.begin(hostname);
  if (mdns_started)
    MDNS.addService("pixelart", "tcp", MDNS_PORT);
}

void load_credentials()
{
  Preferences prefs;
  have_credentials = false;
  if (!prefs.begin(PREFS_NAMESPACE, true))
    return;
  if (prefs.isKey(KEY_SSID))
  {
    String stored_ssid = prefs.getString(KEY_SSID, "");
    String stored_password = prefs.isKey(KEY_PASSWORD) ? prefs.getString(KEY_PASSWORD, "") : String();
    if (stored_ssid.length() > 0 && stored_ssid.length() <= MAX_SSID && stored_password.length() <= MAX_PASSWORD)
    {
      copy_text(ssid, sizeof(ssid), stored_ssid.c_str());
      copy_text(password, sizeof(password), stored_password.c_str());
      have_credentials = true;
    }
  }
  prefs.end();
}

bool store_credentials()
{
  Preferences prefs;
  if (!prefs.begin(PREFS_NAMESPACE, false))
    return false;
  const bool stored =
      prefs.putString(KEY_SSID, ssid) == strlen(ssid) && prefs.putString(KEY_PASSWORD, password) == strlen(password);
  prefs.end();
  return stored;
}

void erase_credentials()
{
  Preferences prefs;
  if (prefs.begin(PREFS_NAMESPACE, false))
  {
    prefs.clear();
    prefs.end();
  }
  wipe(ssid, sizeof(ssid));
  wipe(password, sizeof(password));
  have_credentials = false;
}

// One scan, then the list is shared with the loop task. The radio is on only for
// the scan when no network is stored.
void scan()
{
  const bool was_started = wifi_started;
  start_wifi();
  Network found[MAX_SCAN_RESULTS];
  size_t count = 0;
  const int16_t n = WiFi.scanNetworks();
  for (int i = 0; i < n; i++)
  {
    String name = WiFi.SSID(i);
    if (name.length() == 0 || name.length() > MAX_SSID)
      continue; // hidden, or not a valid name
    size_t at = count;
    for (size_t k = 0; k < count; k++)
      if (!strcmp(found[k].ssid, name.c_str()))
        at = k;
    if (at == count && count == MAX_SCAN_RESULTS)
      continue;
    const int rssi = WiFi.RSSI(i);
    if (at < count && found[at].rssi >= rssi)
      continue; // the same network seen on another channel, weaker
    copy_text(found[at].ssid, sizeof(found[at].ssid), name.c_str());
    found[at].rssi = rssi;
    found[at].secure = WiFi.encryptionType(i) != WIFI_AUTH_OPEN;
    if (at == count)
      count++;
  }
  WiFi.scanDelete();
  if (!was_started && !have_credentials)
    stop_wifi();
  Locked guard;
  memcpy(scan_results, found, sizeof(found));
  scan_count = count;
  shared_scan = ScanState::Done;
}

void run(const Connection::Actions &actions)
{
  if (actions.disconnect)
  {
    if (have_credentials)
      WiFi.disconnect(false, false);
    else
      stop_wifi();
  }
  if (actions.connect && have_credentials)
    connect();
}

void handle(Message &m)
{
  const uint32_t now = now_ms();
  switch (m.type)
  {
  case Message::Type::Joined:
    connection.on_joined(now);
    break;
  case Message::Type::GotIp:
    connection.on_got_ip(now);
    start_mdns();
    break;
  case Message::Type::Disconnected:
    connection.on_disconnected(m.reason, now);
    break;
  case Message::Type::Provision:
    copy_text(ssid, sizeof(ssid), m.ssid);
    copy_text(password, sizeof(password), m.password);
    if (!store_credentials())
      Serial.printf("pixelart: the network could not be stored, it is used until the next restart\n");
    have_credentials = true;
    connection.power().reset(); // failures at another network say nothing about this one
    connection.set_credentials(true, now);
    break;
  case Message::Type::Forget:
    erase_credentials();
    connection.set_credentials(false, now);
    break;
  case Message::Type::SetPower:
    connection.power().set_setting(m.power);
    if (wifi_started)
      apply_power();
    break;
  case Message::Type::Scan:
    scan();
    break;
  case Message::Type::Wake:
    break;
  }
  wipe(&m, sizeof(m));
}

void task_main(void *)
{
  load_credentials();
  connection.set_credentials(have_credentials, now_ms());
  publish();
  uint32_t update_wait = 0;
  for (;;)
  {
    const uint32_t now = now_ms();
    uint32_t wait = connection.next_wake_ms(now);
    const bool online = connection.state() == State::Connected;
    wait = std::min(wait, online ? RSSI_REFRESH_MS : IDLE_WAKE_MS);
    wait = std::min(wait, update_wait);
    Message m;
    if (inbox.receive(m, pdMS_TO_TICKS(wait)))
    {
      handle(m);
      while (inbox.receive(m, 0))
        handle(m);
    }
    run(connection.poll(now_ms()));
    publish();
    // The protocol over WiFi is served while the board has an address, and only then.
    if (connection.state() == State::Connected)
    {
      ws_server::start();
      ws_server::reap();
    }
    else
      ws_server::stop();
    update_wait = updates::net_tick();
  }
}

} // namespace

void begin(const std::string &wifi_power_setting)
{
  lock = xSemaphoreCreateMutexStatic(&lock_storage);
  uint8_t mac[6];
  esp_read_mac(mac, ESP_MAC_WIFI_STA);
  copy_text(hostname, sizeof(hostname), wifi_logic::hostname_for_mac(mac).c_str());
  connection.power().set_setting(wifi_power_setting);
  ws_server::begin();
  shared.state = State::NotConfigured;
  copy_text(shared.hostname, sizeof(shared.hostname), hostname);
  copy_text(shared.power, sizeof(shared.power), connection.power().label());
  WiFi.onEvent(on_wifi_event);
  if (xTaskCreate(task_main, "network", TASK_STACK_BYTES, nullptr, TASK_PRIORITY, nullptr) != pdPASS)
    Serial.printf("pixelart: the network task could not be created\n");
}

Snapshot snapshot()
{
  Locked guard;
  return shared;
}

void set_power(const std::string &wifi_power_setting)
{
  Message m = {};
  m.type = Message::Type::SetPower;
  copy_text(m.power, sizeof(m.power), wifi_power_setting.c_str());
  if (!inbox.send(m, SEND_WAIT))
    Serial.printf("pixelart: the transmit power could not be queued\n");
}

bool provision(const char *new_ssid, const char *new_password)
{
  const size_t ssid_size = new_ssid ? strlen(new_ssid) : 0, password_size = new_password ? strlen(new_password) : 0;
  if (ssid_size < 1 || ssid_size > MAX_SSID || password_size > MAX_PASSWORD)
    return false;
  Message m = {};
  m.type = Message::Type::Provision;
  copy_text(m.ssid, sizeof(m.ssid), new_ssid);
  copy_text(m.password, sizeof(m.password), new_password);
  Snapshot before;
  {
    Locked guard;
    before = shared;
    shared.state = State::Connecting;
    shared.has_ip = false;
    shared.has_rssi = false;
    shared.has_ssid = true;
    copy_text(shared.ssid, sizeof(shared.ssid), new_ssid);
  }
  const bool queued = inbox.send(m, SEND_WAIT);
  wipe(&m, sizeof(m));
  if (!queued)
  {
    Locked guard;
    shared = before;
  }
  return queued;
}

bool forget()
{
  Snapshot before;
  {
    Locked guard;
    before = shared;
    shared.state = State::NotConfigured;
    shared.has_ip = false;
    shared.has_rssi = false;
    shared.has_ssid = false;
    wipe(shared.ssid, sizeof(shared.ssid));
  }
  Message m = {};
  m.type = Message::Type::Forget;
  const bool queued = inbox.send(m, SEND_WAIT);
  if (!queued)
  {
    Serial.printf("pixelart: the network could not be forgotten\n");
    Locked guard;
    shared = before;
    wipe(&before, sizeof(before));
  }
  return queued;
}

void wake()
{
  Message m = {};
  m.type = Message::Type::Wake;
  inbox.send(m); // a full queue already has the network task awake
}

void close_client() { ws_server::close_client(); }

bool request_scan()
{
  {
    Locked guard;
    if (shared_scan == ScanState::Running)
      return false;
    shared_scan = ScanState::Running;
  }
  Message m = {};
  m.type = Message::Type::Scan;
  if (inbox.send(m, SEND_WAIT))
    return true;
  Locked guard;
  shared_scan = ScanState::Idle;
  return false;
}

ScanState scan_state()
{
  Locked guard;
  return shared_scan;
}

std::vector<Network> take_scan()
{
  Locked guard;
  std::vector<Network> out(scan_results, scan_results + scan_count);
  scan_count = 0;
  if (shared_scan == ScanState::Done)
    shared_scan = ScanState::Idle;
  return out;
}

} // namespace network

#endif
