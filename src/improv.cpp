// SPDX-License-Identifier: GPL-3.0-or-later

#include "improv.h"

#include <Arduino.h>

#include <algorithm>
#include <cctype>
#include <cstring>

#include "network.h"
#include "platform.h"
#include "wifi_logic.h"

namespace improv
{

const char MAGIC[MAGIC_SIZE] = {'I', 'M', 'P', 'R', 'O', 'V'};

namespace
{

constexpr size_t MAX_SSID = 32;
constexpr size_t MAX_PASSWORD = 64;
constexpr size_t MAX_SCAN_RESULTS = 16;

void wipe(std::string &text)
{
  volatile char *p = text.empty() ? nullptr : &text[0];
  for (size_t i = 0; i < text.size(); i++)
    p[i] = 0;
  text.clear();
}

void write_to_serial(const std::string &bytes)
{
  // One write, so the packet never mixes with a log line.
  Serial.write(reinterpret_cast<const uint8_t *>(bytes.data()), bytes.size());
#if ARDUINO_USB_MODE && ARDUINO_USB_CDC_ON_BOOT
  Serial.flush();
#endif
}

Sink sink = write_to_serial;

enum class Pending
{
  None,
  Connect,
  Scan
};

Pending pending = Pending::None;
uint64_t pending_since_us = 0;

void send(const std::string &bytes) { sink(bytes); }

State state_for(network::Snapshot snapshot)
{
  using wifi_logic::State;
  if (pending == Pending::Connect || snapshot.state == State::Connecting)
    return improv::State::Provisioning;
  if (snapshot.state == State::Connected)
    return improv::State::Provisioned;
  return improv::State::Ready;
}

// What a successful provisioning answers: the WiFi settings result, with no URL.
void send_provisioned()
{
  send(state_packet(State::Provisioned));
  send(result_packet(Command::WifiSettings, {}));
}

std::string chip_name()
{
  const std::string board = platform::board_name();
  if (board == "esp32c3")
    return "ESP32-C3";
  if (board == "esp32s3")
    return "ESP32-S3";
  if (board == "esp32")
    return "ESP32";
  return board;
}

void send_scan_results()
{
  std::vector<network::Network> found = network::take_scan();
  std::stable_sort(found.begin(), found.end(),
                   [](const network::Network &a, const network::Network &b)
                   {
                     return a.rssi > b.rssi;
                   });
  if (found.size() > MAX_SCAN_RESULTS)
    found.resize(MAX_SCAN_RESULTS);
  for (const network::Network &n : found)
    send(result_packet(Command::ScanNetworks, {n.ssid, std::to_string(n.rssi), n.secure ? "YES" : "NO"}));
  send(result_packet(Command::ScanNetworks, {}));
}

// The data of "send WiFi settings": SSID length, SSID, password length, password.
bool parse_wifi_settings(const std::string &args, std::string &ssid, std::string &password)
{
  if (args.empty())
    return false;
  const size_t ssid_size = (uint8_t)args[0];
  if (ssid_size < 1 || ssid_size > MAX_SSID || args.size() < 1 + ssid_size + 1)
    return false;
  const size_t password_size = (uint8_t)args[1 + ssid_size];
  if (password_size > MAX_PASSWORD || args.size() != 1 + ssid_size + 1 + password_size)
    return false;
  ssid = args.substr(1, ssid_size);
  password = args.substr(2 + ssid_size, password_size);
  // Both travel as C strings from here on.
  return ssid.find('\0') == std::string::npos && password.find('\0') == std::string::npos;
}

void handle_wifi_settings(const std::string &args)
{
  std::string ssid, password;
  const bool valid = parse_wifi_settings(args, ssid, password);
  if (!valid)
  {
    send(error_packet(Error::InvalidRpc));
    wipe(ssid);
    wipe(password);
    return;
  }
  send(state_packet(State::Provisioning));
  const bool started = network::provision(ssid.c_str(), password.c_str());
  wipe(ssid);
  wipe(password);
  if (!started)
  {
    send(error_packet(Error::UnableToConnect));
    send(state_packet(State::Ready));
    return;
  }
  pending = Pending::Connect;
  pending_since_us = platform::now_us();
}

} // namespace

void FrameParser::start()
{
  active_ = true;
  seen_ = 0;
  type_ = length_ = 0;
  sum_ = VERSION;
  for (size_t i = 0; i < MAGIC_SIZE; i++)
    sum_ += (uint8_t)MAGIC[i];
  data_.clear();
}

void FrameParser::reset()
{
  active_ = false;
  wipe(data_);
}

FrameParser::Result FrameParser::feed(uint8_t byte)
{
  if (!active_)
    return Result::More;
  const size_t at = seen_++;
  if (at == 0)
  {
    type_ = byte;
    sum_ += byte;
  }
  else if (at == 1)
  {
    length_ = byte;
    sum_ += byte;
  }
  else if (at < 2u + length_)
  {
    data_ += (char)byte;
    sum_ += byte;
  }
  else
  {
    active_ = false;
    if (byte == sum_)
      return Result::Frame;
    wipe(data_);
    return Result::BadChecksum;
  }
  return Result::More;
}

std::string packet(Type type, const std::string &data)
{
  std::string out(MAGIC, MAGIC_SIZE);
  out += (char)VERSION;
  out += (char)type;
  out += (char)data.size();
  out += data;
  uint8_t sum = 0;
  for (char c : out)
    sum += (uint8_t)c;
  out += (char)sum;
  return out;
}

std::string state_packet(State state) { return packet(Type::CurrentState, std::string(1, (char)state)); }

std::string error_packet(Error error) { return packet(Type::ErrorState, std::string(1, (char)error)); }

std::string result_packet(Command command, const std::vector<std::string> &strings)
{
  std::string body;
  for (const std::string &s : strings)
  {
    const size_t size = std::min<size_t>(s.size(), 255);
    body += (char)size;
    body.append(s, 0, size);
  }
  std::string data;
  data += (char)command;
  data += (char)std::min<size_t>(body.size(), MAX_DATA - 2);
  data += body;
  return packet(Type::RpcResult, data);
}

void set_sink(Sink replacement) { sink = replacement ? replacement : Sink(write_to_serial); }

void handle_frame(uint8_t type, const std::string &data)
{
  if (type != (uint8_t)Type::RpcCommand || data.size() < 2 || (uint8_t)data[1] != data.size() - 2)
  {
    send(error_packet(Error::InvalidRpc));
    return;
  }
  send(error_packet(Error::None)); // every RPC clears the error first
  const uint8_t command = (uint8_t)data[0];
  std::string args = data.substr(2);
  switch (command)
  {
  case (uint8_t)Command::WifiSettings:
    handle_wifi_settings(args);
    break;
  case (uint8_t)Command::CurrentState:
  {
    const State state = state_for(network::snapshot());
    send(state_packet(state));
    if (state == State::Provisioned)
      send(result_packet(Command::WifiSettings, {}));
    break;
  }
  case (uint8_t)Command::DeviceInfo:
    send(result_packet(Command::DeviceInfo,
                       {"PixelArt", platform::firmware_version(), chip_name(), network::snapshot().hostname}));
    break;
  case (uint8_t)Command::ScanNetworks:
    if (network::request_scan())
    {
      pending = Pending::Scan;
      pending_since_us = platform::now_us();
    }
    else
      send(result_packet(Command::ScanNetworks, {}));
    break;
  default:
    send(error_packet(Error::UnknownRpc));
  }
  wipe(args); // it may hold a password
}

void handle_bad_checksum() { send(error_packet(Error::InvalidRpc)); }

void poll()
{
  if (pending == Pending::None)
    return;
  const uint64_t waited_ms = (platform::now_us() - pending_since_us) / 1000;
  if (pending == Pending::Connect)
  {
    if (network::snapshot().state == wifi_logic::State::Connected)
    {
      pending = Pending::None;
      send_provisioned();
    }
    else if (waited_ms >= CONNECT_TIMEOUT_MS)
    {
      pending = Pending::None;
      send(error_packet(Error::UnableToConnect));
      send(state_packet(State::Ready));
    }
  }
  else if (network::scan_state() == network::ScanState::Done || waited_ms >= SCAN_TIMEOUT_MS)
  {
    pending = Pending::None;
    send_scan_results();
  }
}

void begin() { pending = Pending::None; }

} // namespace improv
