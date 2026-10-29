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
#include "wifi_credentials.h"
#include "ws_server.h"

#include <ESPmDNS.h>
#include <Preferences.h>
#include <WiFi.h>
#include <esp_mac.h>
#include <nvs.h>

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
const char *KEY_CREDENTIALS = "credentials_v1";
// Kept for older firmware after an OTA rollback. New firmware reads the record first.
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
  uint32_t sequence;   // WiFi events only: orders a queue overflow against later events
  uint32_t generation; // ignores events from credentials replaced by Provision or Forget
};

Mailbox<Message, 8> inbox;
portMUX_TYPE event_lock = portMUX_INITIALIZER_UNLOCKED;
Message overflow_event = {};
bool overflow_pending = false;
uint32_t event_sequence = 0;
uint32_t wifi_generation = 0;
uint32_t last_handled_event = 0; // network task only

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
bool credentials_erase_pending = false;
uint32_t next_erase_attempt_ms = 0;
bool credentials_legacy_retry_pending = false;
uint32_t next_legacy_attempt_ms = 0;
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
  portENTER_CRITICAL(&event_lock);
  m.sequence = ++event_sequence;
  if (!m.sequence)
    m.sequence = ++event_sequence;
  m.generation = wifi_generation;
  portEXIT_CRITICAL(&event_lock);
  // The event task cannot wait for a scan or update to finish. Keep its latest
  // event when the inbox is full, then apply it after the queued messages.
  if (!inbox.send(m))
  {
    portENTER_CRITICAL(&event_lock);
    if (!overflow_pending || (uint32_t)(m.sequence - overflow_event.sequence) < 0x80000000u)
    {
      overflow_event = m;
      overflow_pending = true;
    }
    portEXIT_CRITICAL(&event_lock);
  }
}

bool take_overflow_event(Message &out)
{
  portENTER_CRITICAL(&event_lock);
  const bool pending = overflow_pending;
  if (pending)
  {
    out = overflow_event;
    overflow_pending = false;
  }
  portEXIT_CRITICAL(&event_lock);
  return pending;
}

void advance_wifi_generation()
{
  portENTER_CRITICAL(&event_lock);
  ++wifi_generation;
  overflow_pending = false;
  portEXIT_CRITICAL(&event_lock);
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

bool legacy_credentials_match(nvs_handle_t handle)
{
  char old_ssid[MAX_SSID + 1] = {};
  char old_password[MAX_PASSWORD + 1] = {};
  size_t ssid_size = sizeof(old_ssid);
  size_t password_size = sizeof(old_password);
  const bool matches = nvs_get_str(handle, KEY_SSID, old_ssid, &ssid_size) == ESP_OK &&
                       nvs_get_str(handle, KEY_PASSWORD, old_password, &password_size) == ESP_OK &&
                       strcmp(old_ssid, ssid) == 0 && strcmp(old_password, password) == 0;
  wipe(old_ssid, sizeof(old_ssid));
  wipe(old_password, sizeof(old_password));
  return matches;
}

bool store_record(nvs_handle_t handle)
{
  uint8_t record[wifi_credentials::MAX_RECORD_BYTES];
  size_t record_size = 0;
  if (!wifi_credentials::encode(ssid, password, record, record_size))
    return false;
  const bool stored =
      nvs_set_blob(handle, KEY_CREDENTIALS, record, record_size) == ESP_OK && nvs_commit(handle) == ESP_OK;
  wipe(record, sizeof(record));
  return stored;
}

void load_credentials()
{
  have_credentials = false;
  nvs_handle_t handle;
  if (nvs_open(PREFS_NAMESPACE, NVS_READONLY, &handle) != ESP_OK)
    return;
  size_t record_size = 0;
  const esp_err_t record_status = nvs_get_blob(handle, KEY_CREDENTIALS, nullptr, &record_size);
  if (record_status != ESP_ERR_NVS_NOT_FOUND)
  {
    // A present but unreadable record must not revive older or partly updated credentials.
    if (record_status == ESP_OK && record_size >= 3 && record_size <= wifi_credentials::MAX_RECORD_BYTES)
    {
      uint8_t record[wifi_credentials::MAX_RECORD_BYTES];
      if (nvs_get_blob(handle, KEY_CREDENTIALS, record, &record_size) == ESP_OK &&
          wifi_credentials::decode(record, record_size, ssid, password))
      {
        have_credentials = true;
        credentials_legacy_retry_pending = !legacy_credentials_match(handle);
        next_legacy_attempt_ms = now_ms() + IDLE_WAKE_MS;
      }
      wipe(record, sizeof(record));
    }
    if (!have_credentials)
      Serial.println("pixelart: stored network record is unreadable; set up WiFi again over USB");
    nvs_close(handle);
    return;
  }
  nvs_close(handle);
  Preferences prefs;
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
  if (have_credentials)
  {
    nvs_handle_t writable;
    if (nvs_open(PREFS_NAMESPACE, NVS_READWRITE, &writable) == ESP_OK)
    {
      if (!store_record(writable))
        Serial.println("pixelart: stored network could not be migrated to one record");
      nvs_close(writable);
    }
    else
      Serial.println("pixelart: stored network could not be migrated to one record");
  }
}

enum class CredentialsStored
{
  None,
  RecordOnly,
  All
};

bool store_legacy_credentials(nvs_handle_t handle)
{
  return nvs_set_str(handle, KEY_SSID, ssid) == ESP_OK && nvs_set_str(handle, KEY_PASSWORD, password) == ESP_OK &&
         nvs_commit(handle) == ESP_OK;
}

bool retry_legacy_credentials()
{
  nvs_handle_t handle;
  if (nvs_open(PREFS_NAMESPACE, NVS_READWRITE, &handle) != ESP_OK)
    return false;
  const bool stored = store_legacy_credentials(handle);
  nvs_close(handle);
  return stored;
}

CredentialsStored store_credentials()
{
  nvs_handle_t handle;
  if (nvs_open(PREFS_NAMESPACE, NVS_READWRITE, &handle) != ESP_OK)
    return CredentialsStored::None;
  // Commit one record first so this firmware never loads a mixed pair. The two
  // legacy keys remain for a board that rolls back to an older firmware.
  const bool record_stored = store_record(handle);
  if (!record_stored)
  {
    nvs_close(handle);
    return CredentialsStored::None;
  }
  const bool legacy_stored = store_legacy_credentials(handle);
  nvs_close(handle);
  return legacy_stored ? CredentialsStored::All : CredentialsStored::RecordOnly;
}

bool erase_credentials()
{
  Preferences prefs;
  bool erased = false;
  if (prefs.begin(PREFS_NAMESPACE, false))
  {
    erased = prefs.clear();
    prefs.end();
  }
  wipe(ssid, sizeof(ssid));
  wipe(password, sizeof(password));
  have_credentials = false;
  return erased;
}

// One scan, then the list is shared with the loop task. The radio is on only for
// the scan when no network is stored.
void scan()
{
  const bool was_started = wifi_started;
  start_wifi();
  // No result is visible to the loop task until scan_count is published.
  {
    Locked guard;
    scan_count = 0;
  }
  Network *found = scan_results;
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
  bool current_generation = true;
  if (m.sequence)
  {
    portENTER_CRITICAL(&event_lock);
    current_generation = m.generation == wifi_generation;
    portEXIT_CRITICAL(&event_lock);
  }
  // A later event may have entered the queue while an older event was kept in
  // the overflow slot. Never let that older event roll the connection back.
  if (m.sequence && (!current_generation || (uint32_t)(m.sequence - last_handled_event) >= 0x80000000u))
  {
    wipe(&m, sizeof(m));
    return;
  }
  if (m.sequence)
    last_handled_event = m.sequence;
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
    advance_wifi_generation();
    credentials_erase_pending = false; // a later provision supersedes an earlier forget
    credentials_legacy_retry_pending = false;
    copy_text(ssid, sizeof(ssid), m.ssid);
    copy_text(password, sizeof(password), m.password);
    switch (store_credentials())
    {
    case CredentialsStored::None:
      Serial.println("pixelart: the network could not be stored, it is used until the next restart");
      break;
    case CredentialsStored::RecordOnly:
      Serial.println("pixelart: the network was stored, but the older firmware copy could not be updated");
      credentials_legacy_retry_pending = true;
      next_legacy_attempt_ms = now + IDLE_WAKE_MS;
      break;
    case CredentialsStored::All:
      break;
    }
    have_credentials = true;
    connection.power().reset(); // failures at another network say nothing about this one
    connection.set_credentials(true, now);
    break;
  case Message::Type::Forget:
    advance_wifi_generation();
    credentials_legacy_retry_pending = false;
    if (!erase_credentials())
    {
      Serial.printf("pixelart: the stored network could not be erased, retrying\n");
      credentials_erase_pending = true;
      next_erase_attempt_ms = now + IDLE_WAKE_MS;
    }
    else
      credentials_erase_pending = false;
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
    if (credentials_erase_pending)
      wait = std::min(wait, (int32_t)(now - next_erase_attempt_ms) >= 0 ? 0u : next_erase_attempt_ms - now);
    if (credentials_legacy_retry_pending)
      wait = std::min(wait, (int32_t)(now - next_legacy_attempt_ms) >= 0 ? 0u : next_legacy_attempt_ms - now);
    Message m;
    if (inbox.receive(m, pdMS_TO_TICKS(wait)))
    {
      handle(m);
      while (inbox.receive(m, 0))
        handle(m);
    }
    if (take_overflow_event(m))
      handle(m);
    if (credentials_erase_pending && (int32_t)(now_ms() - next_erase_attempt_ms) >= 0)
    {
      if (erase_credentials())
        credentials_erase_pending = false;
      else
        next_erase_attempt_ms = now_ms() + IDLE_WAKE_MS;
    }
    if (credentials_legacy_retry_pending && (int32_t)(now_ms() - next_legacy_attempt_ms) >= 0)
    {
      if (retry_legacy_credentials())
        credentials_legacy_retry_pending = false;
      else
        next_legacy_attempt_ms = now_ms() + IDLE_WAKE_MS;
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
