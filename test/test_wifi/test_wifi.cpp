// SPDX-License-Identifier: GPL-3.0-or-later

// Improv Wi-Fi Serial (the frame parser, the line reader's routing and the
// handler) and the WiFi connection logic, on the simulator.
// Run with: pio test -e native_test (or make test)

#include <Arduino.h>
#include <ArduinoJson.h>
#include <sim.h>
#include <unity.h>

#include <cstring>
#include <string>
#include <vector>

#include "improv.h"
#include "network.h"
#include "platform.h"
#include "protocol.h"
#include "settings.h"
#include "wifi_logic.h"
#include "wifi_credentials.h"
#include "pixelart_test.h"

using pixelart_test::protocol_frame;
using pixelart_test::request;
using pixelart_test::TempData;
using Event = protocol::LineReader::Event;
using wifi_logic::State;

void setUp() {}
void tearDown() {}

// ---- Frames written out byte by byte, with their own checksum ----

static std::string bytes(std::initializer_list<int> values)
{
  std::string out;
  for (int v : values)
    out += (char)v;
  return out;
}

static std::vector<uint8_t> record_bytes(const std::string &hex)
{
  std::vector<uint8_t> out;
  for (size_t i = 0; i + 1 < hex.size(); i += 2)
    out.push_back((uint8_t)std::stoi(hex.substr(i, 2), nullptr, 16));
  return out;
}

static void test_credential_record_conformance()
{
  JsonDocument cases;
  const auto path = std::string(PIXELART_PROJECT_DIR) + "/conformance/wifi-credentials.json";
  TEST_ASSERT_FALSE(deserializeJson(cases, pixelart_test::read_file(path)));
  for (JsonObjectConst row : cases["encoded"].as<JsonArrayConst>())
  {
    const std::string ssid = row["ssid"].as<std::string>();
    const std::string password = row["password"].as<std::string>();
    const auto expected = record_bytes(row["hex"].as<std::string>());
    uint8_t record[wifi_credentials::MAX_RECORD_BYTES] = {};
    size_t length = 0;
    TEST_ASSERT_TRUE(wifi_credentials::encode(ssid.c_str(), password.c_str(), record, length));
    TEST_ASSERT_EQUAL(expected.size(), length);
    TEST_ASSERT_EQUAL_UINT8_ARRAY(expected.data(), record, length);
    char decoded_ssid[network::MAX_SSID + 1] = {};
    char decoded_password[network::MAX_PASSWORD + 1] = {};
    TEST_ASSERT_TRUE(wifi_credentials::decode(expected.data(), expected.size(), decoded_ssid, decoded_password));
    TEST_ASSERT_EQUAL_STRING(ssid.c_str(), decoded_ssid);
    TEST_ASSERT_EQUAL_STRING(password.c_str(), decoded_password);
  }
  for (const char *hex : cases["invalid"].as<JsonArrayConst>())
  {
    const auto record = record_bytes(hex);
    char decoded_ssid[network::MAX_SSID + 1] = {};
    char decoded_password[network::MAX_PASSWORD + 1] = {};
    TEST_ASSERT_FALSE(wifi_credentials::decode(record.data(), record.size(), decoded_ssid, decoded_password));
  }
}

static void test_credential_record_length_limits()
{
  uint8_t record[wifi_credentials::MAX_RECORD_BYTES] = {};
  size_t length = 0;
  const std::string longest_ssid(network::MAX_SSID, 'a');
  const std::string longest_password(network::MAX_PASSWORD, 'b');
  TEST_ASSERT_TRUE(wifi_credentials::encode(longest_ssid.c_str(), longest_password.c_str(), record, length));
  TEST_ASSERT_EQUAL(wifi_credentials::MAX_RECORD_BYTES, length);
  char decoded_ssid[network::MAX_SSID + 1] = {};
  char decoded_password[network::MAX_PASSWORD + 1] = {};
  TEST_ASSERT_TRUE(wifi_credentials::decode(record, length, decoded_ssid, decoded_password));
  TEST_ASSERT_EQUAL_STRING(longest_ssid.c_str(), decoded_ssid);
  TEST_ASSERT_EQUAL_STRING(longest_password.c_str(), decoded_password);
  TEST_ASSERT_FALSE(wifi_credentials::encode("", "", record, length));
  TEST_ASSERT_FALSE(wifi_credentials::encode((longest_ssid + "a").c_str(), "", record, length));
  TEST_ASSERT_FALSE(wifi_credentials::encode("a", (longest_password + "b").c_str(), record, length));
}

// A frame as a client builds it: IMPROV, version 1, the type, the data length, the data, the checksum.
static std::string frame_of(int type, const std::string &data)
{
  std::string out = std::string("IMPROV") + bytes({1, type, (int)data.size()}) + data;
  unsigned sum = 0;
  for (unsigned char c : out)
    sum += c;
  return out + (char)(sum & 0xFF);
}

// An RPC command frame: command, length of its data, its data.
static std::string rpc_frame(int command, const std::string &args = "")
{
  return frame_of(3, bytes({command, (int)args.size()}) + args);
}

static std::string wifi_settings_args(const std::string &ssid, const std::string &password)
{
  return bytes({(int)ssid.size()}) + ssid + bytes({(int)password.size()}) + password;
}

// What the handler wrote, packet by packet.
struct Capture
{
  std::vector<std::string> packets;
  Capture()
  {
    improv::set_sink(
        [this](const std::string &p)
        {
          packets.push_back(p);
        });
  }
  ~Capture() { improv::set_sink(nullptr); }
};

// A packet the board sent: its type and data, after the checks every packet must pass.
struct Decoded
{
  int type;
  std::string data;
};

static Decoded decode(const std::string &packet)
{
  TEST_ASSERT_TRUE(packet.size() >= 10);
  TEST_ASSERT_EQUAL_MEMORY("IMPROV", packet.data(), 6);
  TEST_ASSERT_EQUAL(1, (unsigned char)packet[6]);
  const size_t length = (unsigned char)packet[8];
  TEST_ASSERT_EQUAL(10 + length, packet.size());
  unsigned sum = 0;
  for (size_t i = 0; i + 1 < packet.size(); i++)
    sum += (unsigned char)packet[i];
  TEST_ASSERT_EQUAL((unsigned)(sum & 0xFF), (unsigned)(unsigned char)packet.back());
  return {(unsigned char)packet[7], packet.substr(9, length)};
}

static void expect_state(const std::string &packet, int state)
{
  Decoded d = decode(packet);
  TEST_ASSERT_EQUAL(1, d.type);
  TEST_ASSERT_EQUAL_MESSAGE(1, d.data.size(), "state packet");
  TEST_ASSERT_EQUAL(state, (unsigned char)d.data[0]);
}

static void expect_error(const std::string &packet, int error)
{
  Decoded d = decode(packet);
  TEST_ASSERT_EQUAL(2, d.type);
  TEST_ASSERT_EQUAL(1, d.data.size());
  TEST_ASSERT_EQUAL(error, (unsigned char)d.data[0]);
}

// An RPC result: the command, then the strings.
static std::vector<std::string> expect_result(const std::string &packet, int command)
{
  Decoded d = decode(packet);
  TEST_ASSERT_EQUAL(4, d.type);
  TEST_ASSERT_TRUE(d.data.size() >= 2);
  TEST_ASSERT_EQUAL(command, (unsigned char)d.data[0]);
  TEST_ASSERT_EQUAL(d.data.size() - 2, (unsigned char)d.data[1]);
  std::vector<std::string> strings;
  for (size_t at = 2; at < d.data.size();)
  {
    size_t size = (unsigned char)d.data[at++];
    TEST_ASSERT_TRUE(at + size <= d.data.size());
    strings.push_back(d.data.substr(at, size));
    at += size;
  }
  return strings;
}

// ---- The frame parser ----

// Feeds a whole frame after its header and version byte, as the line reader does.
static improv::FrameParser::Result parse(improv::FrameParser &parser, const std::string &frame)
{
  parser.start();
  improv::FrameParser::Result last = improv::FrameParser::Result::More;
  for (size_t i = improv::HEADER_SIZE; i < frame.size(); i++)
    last = parser.feed((uint8_t)frame[i]);
  return last;
}

static void test_a_hand_written_frame_is_read()
{
  // "Request current state": IMPROV, 01, type 03, length 02, command 02, data length 00.
  // The sum of IMPROV is 477, and 477 + 1 + 3 + 2 + 2 + 0 = 485, which is 0xE5.
  const std::string frame = bytes({0x49, 0x4D, 0x50, 0x52, 0x4F, 0x56, 0x01, 0x03, 0x02, 0x02, 0x00, 0xE5});
  improv::FrameParser parser;
  TEST_ASSERT_TRUE(parse(parser, frame) == improv::FrameParser::Result::Frame);
  TEST_ASSERT_EQUAL(3, parser.type());
  TEST_ASSERT_EQUAL(2, parser.data().size());
  TEST_ASSERT_EQUAL(2, (unsigned char)parser.data()[0]);
  TEST_ASSERT_EQUAL(3, (int)improv::Type::RpcCommand);
  // The helper that builds frames in the tests agrees with the bytes above.
  TEST_ASSERT_TRUE(rpc_frame(2) == frame);
}

static void test_packets_the_board_sends_match_hand_computed_bytes()
{
  // Ready: 477 + 1 + 1 + 1 + 2 = 482 -> 0xE2. Invalid RPC packet: 477 + 1 + 2 + 1 + 1 = 482 -> 0xE2.
  TEST_ASSERT_TRUE(improv::state_packet(improv::State::Ready) ==
                   bytes({0x49, 0x4D, 0x50, 0x52, 0x4F, 0x56, 1, 1, 1, 2, 0xE2}));
  TEST_ASSERT_TRUE(improv::error_packet(improv::Error::InvalidRpc) ==
                   bytes({0x49, 0x4D, 0x50, 0x52, 0x4F, 0x56, 1, 2, 1, 1, 0xE2}));
  // An RPC result with no strings: command 1, length 0: 477 + 1 + 4 + 2 + 1 + 0 = 485 -> 0xE5.
  TEST_ASSERT_TRUE(improv::result_packet(improv::Command::WifiSettings, {}) ==
                   bytes({0x49, 0x4D, 0x50, 0x52, 0x4F, 0x56, 1, 4, 2, 1, 0, 0xE5}));
  // One string "a": command 3, length 2, string length 1, 'a': 477 + 1 + 4 + 4 + 3 + 2 + 1 + 97 = 589 -> 0x4D.
  TEST_ASSERT_TRUE(improv::result_packet(improv::Command::DeviceInfo, {"a"}) ==
                   bytes({0x49, 0x4D, 0x50, 0x52, 0x4F, 0x56, 1, 4, 4, 3, 2, 1, 'a', 0x4D}));
}

static void test_parser_reports_a_bad_checksum()
{
  std::string frame = rpc_frame(3);
  frame.back() = (char)(frame.back() + 1);
  improv::FrameParser parser;
  TEST_ASSERT_TRUE(parse(parser, frame) == improv::FrameParser::Result::BadChecksum);
  TEST_ASSERT_FALSE(parser.active());
  TEST_ASSERT_EQUAL(0, parser.data().size());
}

static void test_parser_reads_the_longest_frame_and_data_with_every_byte_value()
{
  std::string data;
  for (int i = 0; i < 255; i++)
    data += (char)i; // includes 0x0A and 0x0D
  improv::FrameParser parser;
  TEST_ASSERT_TRUE(parse(parser, frame_of(3, data)) == improv::FrameParser::Result::Frame);
  TEST_ASSERT_TRUE(parser.data() == data);
  TEST_ASSERT_TRUE(parse(parser, frame_of(3, "")) == improv::FrameParser::Result::Frame);
  TEST_ASSERT_EQUAL(0, parser.data().size());
}

// ---- The line reader ----

struct Seen
{
  std::vector<std::string> lines; // protocol and other lines
  std::vector<std::string> frames;
  int bad_checksums = 0;
  int overflows = 0;
};

static Seen run_reader(protocol::LineReader &reader, const std::string &input)
{
  Seen seen;
  for (unsigned char byte : input)
    switch (reader.feed(byte))
    {
    case Event::None:
      break;
    case Event::Line:
      seen.lines.push_back(reader.line());
      break;
    case Event::Overflow:
      seen.overflows++;
      break;
    case Event::Improv:
      seen.frames.push_back(std::string(1, (char)reader.improv_frame().type()) + reader.improv_frame().data());
      break;
    case Event::ImprovInvalid:
      seen.bad_checksums++;
      break;
    }
  return seen;
}

static void test_reader_finds_a_frame_alone_before_between_and_after_lines()
{
  protocol::LineReader reader;
  const std::string frame = rpc_frame(3);
  const std::string expected = bytes({3, 3, 0});

  Seen alone = run_reader(reader, frame);
  TEST_ASSERT_EQUAL(1, alone.frames.size());
  TEST_ASSERT_TRUE(alone.frames[0] == expected);
  TEST_ASSERT_EQUAL(0, alone.lines.size());

  Seen mixed = run_reader(reader, frame + "@PR one\n" + frame + "@PR two\n" + frame);
  TEST_ASSERT_EQUAL(3, mixed.frames.size());
  TEST_ASSERT_EQUAL(2, mixed.lines.size());
  TEST_ASSERT_EQUAL_STRING("@PR one", mixed.lines[0].c_str());
  TEST_ASSERT_EQUAL_STRING("@PR two", mixed.lines[1].c_str());

  // Without a newline between a protocol line and the frame that follows it, the frame still counts, and the line is
  // not mixed with it.
  Seen glued = run_reader(reader, "@PR three\n" + frame + "@PR four\n");
  TEST_ASSERT_EQUAL(1, glued.frames.size());
  TEST_ASSERT_EQUAL(2, glued.lines.size());
  TEST_ASSERT_EQUAL_STRING("@PR four", glued.lines[1].c_str());
}

static void test_reader_finds_a_frame_after_noise_and_drops_the_noise()
{
  protocol::LineReader reader;
  Seen seen = run_reader(reader, "boot noise" + rpc_frame(3) + "@PR after\n");
  TEST_ASSERT_EQUAL(1, seen.frames.size());
  TEST_ASSERT_EQUAL(1, seen.lines.size());
  TEST_ASSERT_EQUAL_STRING("@PR after", seen.lines[0].c_str());
}

static void test_a_frame_with_a_newline_inside_is_one_frame()
{
  protocol::LineReader reader;
  // The password holds a newline and a carriage return.
  const std::string args = wifi_settings_args("net", "ab\ncd\r\n");
  Seen seen = run_reader(reader, "@PR before\n" + rpc_frame(1, args) + "@PR after\n");
  TEST_ASSERT_EQUAL(1, seen.frames.size());
  TEST_ASSERT_TRUE(seen.frames[0] == bytes({3, 1, (int)args.size()}) + args);
  TEST_ASSERT_EQUAL(2, seen.lines.size());
  TEST_ASSERT_EQUAL_STRING("@PR before", seen.lines[0].c_str());
  TEST_ASSERT_EQUAL_STRING("@PR after", seen.lines[1].c_str());
}

static void test_a_bad_checksum_is_reported_and_the_next_line_still_works()
{
  protocol::LineReader reader;
  std::string frame = rpc_frame(3);
  frame.back() = (char)(frame.back() ^ 0xFF);
  Seen seen = run_reader(reader, frame + "@PR next\n");
  TEST_ASSERT_EQUAL(1, seen.bad_checksums);
  TEST_ASSERT_EQUAL(0, seen.frames.size());
  TEST_ASSERT_EQUAL(1, seen.lines.size());
  TEST_ASSERT_EQUAL_STRING("@PR next", seen.lines[0].c_str());
}

static void test_the_header_inside_a_protocol_line_is_not_a_frame()
{
  protocol::LineReader reader;
  const std::string line = std::string("@PR 00000000 {\"x\":\"IMPROV") + (char)1 + "\"}";
  Seen seen = run_reader(reader, line + "\n");
  TEST_ASSERT_EQUAL(0, seen.frames.size());
  TEST_ASSERT_EQUAL(1, seen.lines.size());
  TEST_ASSERT_TRUE(seen.lines[0] == line);
}

static void test_another_version_is_not_a_frame()
{
  protocol::LineReader reader;
  const std::string text = std::string("IMPROV") + (char)2 + "junk\n";
  Seen seen = run_reader(reader, text);
  TEST_ASSERT_EQUAL(0, seen.frames.size());
  TEST_ASSERT_EQUAL(1, seen.lines.size());
}

static void test_a_stopped_frame_is_dropped_and_lines_work_again()
{
  protocol::LineReader reader;
  const std::string frame = rpc_frame(3);
  run_reader(reader, frame.substr(0, frame.size() - 3)); // cut short
  TEST_ASSERT_TRUE(reader.in_frame());
  reader.abort_frame();
  TEST_ASSERT_FALSE(reader.in_frame());
  Seen seen = run_reader(reader, "@PR ok\n");
  TEST_ASSERT_EQUAL(1, seen.lines.size());
  TEST_ASSERT_EQUAL_STRING("@PR ok", seen.lines[0].c_str());
}

static void test_protocol_lines_read_as_before_around_the_header_search()
{
  protocol::LineReader reader;
  // A line with the byte values of the header spread over two lines is not a frame.
  Seen seen = run_reader(reader, "IMPROV\n\x01@PR a\n");
  TEST_ASSERT_EQUAL(0, seen.frames.size());
  TEST_ASSERT_EQUAL(2, seen.lines.size());
  TEST_ASSERT_EQUAL_STRING("IMPROV", seen.lines[0].c_str());
}

// ---- Through the serial port ----

static void run_poll()
{
  for (int i = 0; i < 2000 && sim::serial_input_size() > 0; i++)
    protocol::poll();
}

static void test_frames_and_protocol_requests_share_the_serial_port()
{
  sim::reset();
  TempData data("improv");
  setup();
  Capture capture;
  network::sim_set_snapshot(network::Snapshot()); // not configured

  sim::serial_input(request(1, R"("cmd":"info")") + rpc_frame(2) + request(2, R"("cmd":"info")"));
  run_poll();

  // Two protocol replies on the serial log, and the packets of the state request in the capture.
  int replies = 0;
  for (const sim::SerialLine &l : sim::serial())
    replies += l.text.rfind("@PR ", 0) == 0 && l.text.find("\"ok\":true") != std::string::npos;
  TEST_ASSERT_EQUAL(2, replies);
  TEST_ASSERT_EQUAL(2, capture.packets.size());
  expect_error(capture.packets[0], 0);
  expect_state(capture.packets[1], 2); // ready: no network stored
}

// ---- The handler ----

static void send_frame(const std::string &frame)
{
  sim::serial_input(frame);
  run_poll();
}

static network::Snapshot connected()
{
  network::Snapshot s;
  s.state = State::Connected;
  s.has_ip = true;
  snprintf(s.ip, sizeof(s.ip), "10.0.0.5");
  s.has_rssi = true;
  s.rssi = -60;
  snprintf(s.hostname, sizeof(s.hostname), "pixelart-1a2b");
  return s;
}

static void test_state_request_answers_ready_provisioning_or_provisioned()
{
  sim::reset();
  TempData data("improv");
  setup();
  Capture capture;

  network::Snapshot s;
  network::sim_set_snapshot(s); // not configured
  send_frame(rpc_frame(2));
  TEST_ASSERT_EQUAL(2, capture.packets.size());
  expect_error(capture.packets[0], 0);
  expect_state(capture.packets[1], 2);

  capture.packets.clear();
  s.state = State::Connecting;
  network::sim_set_snapshot(s);
  send_frame(rpc_frame(2));
  expect_state(capture.packets.at(1), 3);

  capture.packets.clear();
  network::sim_set_snapshot(connected());
  send_frame(rpc_frame(2));
  TEST_ASSERT_EQUAL(3, capture.packets.size());
  expect_state(capture.packets[1], 4);
  TEST_ASSERT_EQUAL(0, expect_result(capture.packets[2], 1).size()); // the result of provisioning, with no URL

  // A network that cannot be reached is not provisioned: the client may give another.
  capture.packets.clear();
  s.state = State::WrongPassword;
  network::sim_set_snapshot(s);
  send_frame(rpc_frame(2));
  expect_state(capture.packets.at(1), 2);
}

static void test_device_information_names_the_firmware_chip_and_device()
{
  sim::reset();
  TempData data("improv");
  setup();
  Capture capture;
  network::sim_set_snapshot(connected());
  send_frame(rpc_frame(3));
  TEST_ASSERT_EQUAL(2, capture.packets.size());
  expect_error(capture.packets[0], 0);
  std::vector<std::string> info = expect_result(capture.packets[1], 3);
  TEST_ASSERT_EQUAL(4, info.size());
  TEST_ASSERT_EQUAL_STRING("PixelArt", info[0].c_str());
  TEST_ASSERT_EQUAL_STRING(platform::firmware_version(), info[1].c_str());
  TEST_ASSERT_EQUAL_STRING("pixelart-1a2b", info[3].c_str());
}

static void test_scan_lists_the_networks_strongest_first_and_ends_with_an_empty_result()
{
  sim::reset();
  TempData data("improv");
  setup();
  Capture capture;
  network::Network weak = {"Weak", -80, true}, strong = {"Strong", -40, false}, middle = {"Middle", -60, true};
  network::sim_set_networks({weak, strong, middle});
  send_frame(rpc_frame(4));
  improv::poll(); // the scan finishes in the background
  TEST_ASSERT_EQUAL(5, capture.packets.size());
  expect_error(capture.packets[0], 0);
  std::vector<std::string> first = expect_result(capture.packets[1], 4);
  TEST_ASSERT_EQUAL(3, first.size());
  TEST_ASSERT_EQUAL_STRING("Strong", first[0].c_str());
  TEST_ASSERT_EQUAL_STRING("-40", first[1].c_str());
  TEST_ASSERT_EQUAL_STRING("NO", first[2].c_str());
  std::vector<std::string> second = expect_result(capture.packets[2], 4);
  TEST_ASSERT_EQUAL_STRING("Middle", second[0].c_str());
  TEST_ASSERT_EQUAL_STRING("YES", second[2].c_str());
  TEST_ASSERT_EQUAL_STRING("Weak", expect_result(capture.packets[3], 4)[0].c_str());
  TEST_ASSERT_EQUAL(0, expect_result(capture.packets[4], 4).size());
}

static void test_scan_with_no_network_gives_only_the_empty_result()
{
  sim::reset();
  TempData data("improv");
  setup();
  Capture capture;
  network::sim_set_networks({});
  send_frame(rpc_frame(4));
  improv::poll();
  TEST_ASSERT_EQUAL(2, capture.packets.size());
  TEST_ASSERT_EQUAL(0, expect_result(capture.packets[1], 4).size());
}

static void test_wifi_settings_connect_and_answer_provisioned_without_a_url()
{
  sim::reset();
  TempData data("improv");
  setup();
  Capture capture;
  network::sim_set_snapshot(network::Snapshot());
  network::sim_provision_connects(true);
  send_frame(rpc_frame(1, wifi_settings_args("HomeNet", "correct horse")));
  // error none, provisioning, then (on the next poll, once connected) provisioned and the result.
  protocol::poll();
  TEST_ASSERT_EQUAL(4, capture.packets.size());
  expect_error(capture.packets[0], 0);
  expect_state(capture.packets[1], 3);
  expect_state(capture.packets[2], 4);
  TEST_ASSERT_EQUAL(0, expect_result(capture.packets[3], 1).size());
}

static void test_wifi_settings_that_do_not_connect_end_with_unable_to_connect_after_30_seconds()
{
  sim::reset();
  TempData data("improv");
  setup();
  Capture capture;
  network::sim_set_snapshot(network::Snapshot());
  network::sim_provision_connects(false);
  send_frame(rpc_frame(1, wifi_settings_args("HomeNet", "wrong")));
  TEST_ASSERT_EQUAL(2, capture.packets.size());

  sim::advance_us((uint64_t)(improv::CONNECT_TIMEOUT_MS - 1) * 1000);
  improv::poll();
  TEST_ASSERT_EQUAL(2, capture.packets.size());
  sim::advance_us(1000);
  improv::poll();
  TEST_ASSERT_EQUAL(4, capture.packets.size());
  expect_error(capture.packets[2], 3);
  expect_state(capture.packets[3], 2);
  improv::poll();
  TEST_ASSERT_EQUAL(4, capture.packets.size()); // said once
}

static void test_wifi_names_and_passwords_never_leave_the_board()
{
  sim::reset();
  TempData data("improv");
  setup();
  Capture capture;
  network::sim_provision_connects(true);
  send_frame(rpc_frame(1, wifi_settings_args("SecretNetworkName", "SecretPassword99")));
  protocol::poll();
  send_frame(rpc_frame(2));
  send_frame(rpc_frame(3));
  sim::serial_input(request(1, R"("cmd":"status")") + request(2, R"("cmd":"settings_get")"));
  run_poll();
  for (const std::string &p : capture.packets)
  {
    TEST_ASSERT_TRUE(p.find("SecretNetworkName") == std::string::npos);
    TEST_ASSERT_TRUE(p.find("SecretPassword99") == std::string::npos);
  }
  for (const sim::SerialLine &l : sim::serial())
  {
    TEST_ASSERT_TRUE(l.text.find("SecretNetworkName") == std::string::npos);
    TEST_ASSERT_TRUE(l.text.find("SecretPassword99") == std::string::npos);
  }
}

static void test_bad_wifi_settings_are_an_invalid_rpc_packet()
{
  sim::reset();
  TempData data("improv");
  setup();
  Capture capture;
  const std::string too_long_ssid(33, 'a');
  const std::string too_long_password(65, 'p');
  const std::vector<std::string> bad_args = {
      "",                                               // no fields
      bytes({0}),                                       // an SSID of no characters, and nothing after it
      wifi_settings_args("", "password"),               // no network name
      wifi_settings_args(too_long_ssid, "password"),    // name over 32 bytes
      wifi_settings_args("net", too_long_password),     // password over 64 bytes
      bytes({3, 'a', 'b', 'c', 5, 'x'}),                // the password is shorter than it says
      wifi_settings_args("net", "pass") + "x",          // data after the password
      wifi_settings_args(std::string("a\0b", 3), "pw"), // a name with a NUL
  };
  for (const std::string &args : bad_args)
  {
    capture.packets.clear();
    send_frame(rpc_frame(1, args));
    TEST_ASSERT_TRUE(capture.packets.size() >= 1);
    expect_error(capture.packets.back(), 1);
  }
}

static void test_malformed_and_unknown_commands_are_refused()
{
  sim::reset();
  TempData data("improv");
  setup();
  Capture capture;

  // An RPC whose inner length does not match, and a packet that is not an RPC command.
  send_frame(frame_of(3, bytes({2, 5, 0})));
  expect_error(capture.packets.back(), 1);
  capture.packets.clear();
  send_frame(frame_of(3, bytes({2})));
  expect_error(capture.packets.back(), 1);
  capture.packets.clear();
  send_frame(frame_of(1, bytes({2})));
  expect_error(capture.packets.back(), 1);

  // A command the board does not know.
  capture.packets.clear();
  send_frame(rpc_frame(0x7F));
  TEST_ASSERT_EQUAL(2, capture.packets.size());
  expect_error(capture.packets[0], 0);
  expect_error(capture.packets[1], 2);

  // A frame with a wrong checksum.
  capture.packets.clear();
  std::string frame = rpc_frame(2);
  frame.back() = (char)(frame.back() + 1);
  send_frame(frame);
  TEST_ASSERT_EQUAL(1, capture.packets.size());
  expect_error(capture.packets[0], 1);
}

// ---- The connection logic ----

static void test_disconnect_reasons_map_to_states()
{
  using namespace wifi_logic;
  TEST_ASSERT_TRUE(state_for_disconnect(reason::NO_AP_FOUND) == State::NetworkNotFound);
  TEST_ASSERT_TRUE(state_for_disconnect(reason::NO_AP_FOUND_COMPATIBLE_SECURITY) == State::NetworkNotFound);
  TEST_ASSERT_TRUE(state_for_disconnect(reason::AUTH_FAIL) == State::WrongPassword);
  TEST_ASSERT_TRUE(state_for_disconnect(reason::HANDSHAKE_4WAY_TIMEOUT) == State::WrongPassword);
  TEST_ASSERT_TRUE(state_for_disconnect(reason::HANDSHAKE_TIMEOUT) == State::WrongPassword);
  TEST_ASSERT_TRUE(state_for_disconnect(200) == State::Disconnected); // beacon timeout
  TEST_ASSERT_TRUE(state_for_disconnect(3) == State::Disconnected);
  TEST_ASSERT_EQUAL_STRING("network_not_found", state_name(State::NetworkNotFound));
  TEST_ASSERT_EQUAL_STRING("not_configured", state_name(State::NotConfigured));
  TEST_ASSERT_EQUAL_STRING("no_address", state_name(State::NoAddress));
}

static void test_auto_power_falls_back_after_two_failures_and_a_fixed_power_after_three()
{
  wifi_logic::PowerPolicy power;
  power.set_setting("auto");
  TEST_ASSERT_EQUAL_STRING("19.5", power.label());
  TEST_ASSERT_EQUAL(78, power.quarter_dbm());
  power.on_join_failure();
  TEST_ASSERT_EQUAL_STRING("19.5", power.label());
  power.on_join_failure();
  TEST_ASSERT_EQUAL_STRING("8.5", power.label());
  TEST_ASSERT_EQUAL(34, power.quarter_dbm());
  TEST_ASSERT_TRUE(power.reduced());

  power.set_setting("15");
  TEST_ASSERT_FALSE(power.reduced());
  TEST_ASSERT_EQUAL(60, power.quarter_dbm());
  power.on_join_failure();
  power.on_join_failure();
  TEST_ASSERT_EQUAL_STRING("15", power.label());
  power.on_joined(); // failures must be in a row
  power.on_join_failure();
  power.on_join_failure();
  TEST_ASSERT_EQUAL_STRING("15", power.label());
  power.on_join_failure();
  TEST_ASSERT_EQUAL_STRING("8.5", power.label());
  TEST_ASSERT_TRUE(power.reduced());
  power.on_joined(); // the fallback lasts until a restart or a new setting
  TEST_ASSERT_EQUAL_STRING("8.5", power.label());
}

static void test_every_power_has_its_quarter_dbm_value()
{
  const char *labels[] = {"8.5", "11", "13", "15", "17", "18.5", "19.5"};
  const int quarters[] = {34, 44, 52, 60, 68, 74, 78};
  for (int i = 0; i < 7; i++)
  {
    wifi_logic::PowerPolicy power;
    power.set_setting(labels[i]);
    TEST_ASSERT_EQUAL_STRING(labels[i], power.label());
    TEST_ASSERT_EQUAL(quarters[i], power.quarter_dbm());
    TEST_ASSERT_TRUE(wifi_logic::is_valid_power_setting(labels[i]));
  }
  TEST_ASSERT_FALSE(wifi_logic::is_valid_power_setting("20"));
  TEST_ASSERT_FALSE(wifi_logic::is_valid_power_setting(""));
}

static void test_the_retry_schedule_is_1_2_4_8_16_32_then_60_seconds()
{
  const unsigned expected[] = {1, 2, 4, 8, 16, 32, 60, 60, 60};
  for (unsigned i = 0; i < 9; i++)
    TEST_ASSERT_EQUAL(expected[i] * 1000, wifi_logic::Connection::retry_delay_ms(i));
}

// Drives a Connection the way the network task does.
struct Driver
{
  wifi_logic::Connection connection;
  uint32_t now = 1000;
  int connects = 0, disconnects = 0;

  void advance(uint32_t ms)
  {
    // In steps, so every deadline is seen at its time.
    for (uint32_t done = 0; done < ms; done += 100)
    {
      now += 100;
      act();
    }
  }
  void act()
  {
    wifi_logic::Connection::Actions a = connection.poll(now);
    connects += a.connect;
    disconnects += a.disconnect;
  }
};

static void test_a_wrong_password_retries_on_the_schedule_and_keeps_its_state()
{
  Driver d;
  d.connection.set_credentials(true, d.now);
  d.act();
  TEST_ASSERT_EQUAL(1, d.connects);
  TEST_ASSERT_TRUE(d.connection.state() == State::Connecting);

  const unsigned waits[] = {1, 2, 4, 8, 16, 32, 60, 60};
  for (unsigned wait : waits)
  {
    d.connection.on_disconnected(wifi_logic::reason::AUTH_FAIL, d.now);
    TEST_ASSERT_TRUE(d.connection.state() == State::WrongPassword);
    const int before = d.connects;
    d.advance(wait * 1000 - 100);
    TEST_ASSERT_EQUAL(before, d.connects);
    d.advance(100);
    TEST_ASSERT_EQUAL(before + 1, d.connects);
    TEST_ASSERT_TRUE(d.connection.state() == State::WrongPassword); // stays while it tries again
  }
}

static void test_a_network_that_is_not_there_is_reported_and_power_falls_back()
{
  Driver d;
  d.connection.set_credentials(true, d.now);
  d.act();
  d.connection.on_disconnected(wifi_logic::reason::NO_AP_FOUND, d.now);
  TEST_ASSERT_TRUE(d.connection.state() == State::NetworkNotFound);
  TEST_ASSERT_FALSE(d.connection.power().reduced());
  d.advance(1000);
  d.connection.on_disconnected(wifi_logic::reason::NO_AP_FOUND, d.now);
  TEST_ASSERT_TRUE(d.connection.power().reduced());
  TEST_ASSERT_EQUAL_STRING("8.5", d.connection.power().label());
}

static void test_a_connection_that_drops_starts_again_at_one_second()
{
  Driver d;
  d.connection.set_credentials(true, d.now);
  d.act();
  d.connection.on_joined(d.now);
  d.connection.on_got_ip(d.now);
  TEST_ASSERT_TRUE(d.connection.state() == State::Connected);

  d.connection.on_disconnected(200, d.now); // beacon timeout
  TEST_ASSERT_TRUE(d.connection.state() == State::Disconnected);
  TEST_ASSERT_FALSE(d.connection.power().reduced()); // a drop is not a failure to join
  const int before = d.connects;
  d.advance(900);
  TEST_ASSERT_EQUAL(before, d.connects);
  d.advance(100);
  TEST_ASSERT_EQUAL(before + 1, d.connects);

  // Connected again resets the schedule.
  d.connection.on_joined(d.now);
  d.connection.on_got_ip(d.now);
  d.connection.on_disconnected(200, d.now);
  const int again = d.connects;
  d.advance(1000);
  TEST_ASSERT_EQUAL(again + 1, d.connects);
}

static void test_no_address_after_30_seconds_disconnects_and_retries_on_the_schedule()
{
  Driver d;
  d.connection.set_credentials(true, d.now);
  d.act();
  d.connection.on_joined(d.now);
  TEST_ASSERT_TRUE(d.connection.state() == State::Connecting);
  d.advance(29900);
  TEST_ASSERT_TRUE(d.connection.state() == State::Connecting);
  TEST_ASSERT_EQUAL(0, d.disconnects);
  d.advance(100);
  TEST_ASSERT_TRUE(d.connection.state() == State::NoAddress);
  TEST_ASSERT_EQUAL(1, d.disconnects);
  TEST_ASSERT_FALSE(d.connection.power().reduced()); // DHCP is not the WiFi level

  // The stack's own "left" disconnect that follows does not change the state.
  d.connection.on_disconnected(wifi_logic::reason::ASSOC_LEAVE, d.now);
  TEST_ASSERT_TRUE(d.connection.state() == State::NoAddress);
  const int before = d.connects;
  d.advance(900);
  TEST_ASSERT_EQUAL(before, d.connects);
  d.advance(100);
  TEST_ASSERT_EQUAL(before + 1, d.connects);
  TEST_ASSERT_TRUE(d.connection.state() == State::NoAddress);

  // The next try also finds no address: the wait doubles.
  d.connection.on_joined(d.now);
  d.advance(30000);
  TEST_ASSERT_EQUAL(2, d.disconnects);
  const int second = d.connects;
  d.advance(1900);
  TEST_ASSERT_EQUAL(second, d.connects);
  d.advance(100);
  TEST_ASSERT_EQUAL(second + 1, d.connects);
}

static void test_an_address_in_time_means_connected()
{
  Driver d;
  d.connection.set_credentials(true, d.now);
  d.act();
  d.connection.on_joined(d.now);
  d.advance(20000);
  d.connection.on_got_ip(d.now);
  d.advance(60000);
  TEST_ASSERT_TRUE(d.connection.state() == State::Connected);
  TEST_ASSERT_EQUAL(0, d.disconnects);
}

static void test_forgetting_and_a_new_network_reset_the_state()
{
  Driver d;
  d.connection.set_credentials(true, d.now);
  d.act();
  d.connection.on_joined(d.now);
  d.connection.on_got_ip(d.now);
  d.connection.set_credentials(false, d.now);
  d.act();
  TEST_ASSERT_TRUE(d.connection.state() == State::NotConfigured);
  TEST_ASSERT_EQUAL(1, d.disconnects);
  // Events that arrive after the network was forgotten change nothing.
  d.connection.on_disconnected(wifi_logic::reason::ASSOC_LEAVE, d.now);
  d.advance(120000);
  TEST_ASSERT_TRUE(d.connection.state() == State::NotConfigured);
  TEST_ASSERT_EQUAL(1, d.connects);

  d.connection.set_credentials(true, d.now);
  d.act();
  TEST_ASSERT_EQUAL(2, d.connects);
  TEST_ASSERT_TRUE(d.connection.state() == State::Connecting);
}

static void test_a_new_network_while_connected_ignores_the_old_connections_own_disconnect()
{
  Driver d;
  d.connection.set_credentials(true, d.now);
  d.act();
  d.connection.on_joined(d.now);
  d.connection.on_got_ip(d.now);
  d.connection.set_credentials(true, d.now); // a new network
  d.act();
  d.connection.on_disconnected(wifi_logic::reason::ASSOC_LEAVE, d.now); // the old connection ends
  TEST_ASSERT_TRUE(d.connection.state() == State::Connecting);
  d.advance(500);
  TEST_ASSERT_EQUAL(2, d.connects); // no extra try
}

static void test_the_hostname_is_the_last_two_mac_bytes_in_lowercase_hex()
{
  const uint8_t mac[6] = {0x24, 0x6F, 0x28, 0xAB, 0x11, 0x8C};
  TEST_ASSERT_EQUAL_STRING("pixelart-118c", wifi_logic::hostname_for_mac(mac).c_str());
  const uint8_t low[6] = {0, 0, 0, 0, 0x00, 0x0A};
  TEST_ASSERT_EQUAL_STRING("pixelart-000a", wifi_logic::hostname_for_mac(low).c_str());
}

int main()
{
  UNITY_BEGIN();
  RUN_TEST(test_credential_record_conformance);
  RUN_TEST(test_credential_record_length_limits);
  RUN_TEST(test_a_hand_written_frame_is_read);
  RUN_TEST(test_packets_the_board_sends_match_hand_computed_bytes);
  RUN_TEST(test_parser_reports_a_bad_checksum);
  RUN_TEST(test_parser_reads_the_longest_frame_and_data_with_every_byte_value);
  RUN_TEST(test_reader_finds_a_frame_alone_before_between_and_after_lines);
  RUN_TEST(test_reader_finds_a_frame_after_noise_and_drops_the_noise);
  RUN_TEST(test_a_frame_with_a_newline_inside_is_one_frame);
  RUN_TEST(test_a_bad_checksum_is_reported_and_the_next_line_still_works);
  RUN_TEST(test_the_header_inside_a_protocol_line_is_not_a_frame);
  RUN_TEST(test_another_version_is_not_a_frame);
  RUN_TEST(test_a_stopped_frame_is_dropped_and_lines_work_again);
  RUN_TEST(test_protocol_lines_read_as_before_around_the_header_search);
  RUN_TEST(test_frames_and_protocol_requests_share_the_serial_port);
  RUN_TEST(test_state_request_answers_ready_provisioning_or_provisioned);
  RUN_TEST(test_device_information_names_the_firmware_chip_and_device);
  RUN_TEST(test_scan_lists_the_networks_strongest_first_and_ends_with_an_empty_result);
  RUN_TEST(test_scan_with_no_network_gives_only_the_empty_result);
  RUN_TEST(test_wifi_settings_connect_and_answer_provisioned_without_a_url);
  RUN_TEST(test_wifi_settings_that_do_not_connect_end_with_unable_to_connect_after_30_seconds);
  RUN_TEST(test_wifi_names_and_passwords_never_leave_the_board);
  RUN_TEST(test_bad_wifi_settings_are_an_invalid_rpc_packet);
  RUN_TEST(test_malformed_and_unknown_commands_are_refused);
  RUN_TEST(test_disconnect_reasons_map_to_states);
  RUN_TEST(test_auto_power_falls_back_after_two_failures_and_a_fixed_power_after_three);
  RUN_TEST(test_every_power_has_its_quarter_dbm_value);
  RUN_TEST(test_the_retry_schedule_is_1_2_4_8_16_32_then_60_seconds);
  RUN_TEST(test_a_wrong_password_retries_on_the_schedule_and_keeps_its_state);
  RUN_TEST(test_a_network_that_is_not_there_is_reported_and_power_falls_back);
  RUN_TEST(test_a_connection_that_drops_starts_again_at_one_second);
  RUN_TEST(test_no_address_after_30_seconds_disconnects_and_retries_on_the_schedule);
  RUN_TEST(test_an_address_in_time_means_connected);
  RUN_TEST(test_forgetting_and_a_new_network_reset_the_state);
  RUN_TEST(test_a_new_network_while_connected_ignores_the_old_connections_own_disconnect);
  RUN_TEST(test_the_hostname_is_the_last_two_mac_bytes_in_lowercase_hex);
  return UNITY_END();
}
