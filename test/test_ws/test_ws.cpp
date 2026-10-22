// Tests the simulator's WebSocket transport with a raw socket client that
// speaks RFC 6455 by hand, against the real protocol core.
// Run with: pio test -e native_test (or make test)

#include <ArduinoJson.h>
#include <arpa/inet.h>
#include <cerrno>
#include <fcntl.h>
#include <netinet/in.h>
#include <pixel_codec.h>
#include <sim.h>
#include <sys/socket.h>
#include <unistd.h>
#include <unity.h>

#include <chrono>
#include <filesystem>
#include <functional>
#include <string>
#include <thread>
#include <vector>

#include "app.h"
#include "protocol.h"
#include "storage.h"
#include "pixelart_test.h"

namespace fs = std::filesystem;
using pixelart_test::protocol_frame;
using pixelart_test::TempData;

static const char *RFC_KEY = "dGhlIHNhbXBsZSBub25jZQ==";
static const char *RFC_ACCEPT = "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=";

class TestClient;
static std::vector<TestClient *> live_clients;

// Runs the server and the protocol, and reads every test client's socket,
// until `done` holds or two seconds pass.
static bool pump(const std::function<bool()> &done);

class TestClient
{
public:
  TestClient()
  {
    fd_ = socket(AF_INET, SOCK_STREAM, 0);
    sockaddr_in addr = {};
    addr.sin_family = AF_INET;
    addr.sin_port = htons((uint16_t)sim::ws_port());
    inet_pton(AF_INET, "127.0.0.1", &addr.sin_addr);
    TEST_ASSERT_EQUAL(0, connect(fd_, reinterpret_cast<sockaddr *>(&addr), sizeof(addr)));
    fcntl(fd_, F_SETFL, fcntl(fd_, F_GETFL, 0) | O_NONBLOCK);
    live_clients.push_back(this);
  }
  ~TestClient() { disconnect(); }

  void disconnect()
  {
    if (fd_ < 0)
      return;
    close(fd_);
    fd_ = -1;
    for (size_t i = 0; i < live_clients.size(); i++)
      if (live_clients[i] == this)
        live_clients.erase(live_clients.begin() + (long)i);
    sim::ws_poll(); // the server notices the end of the connection
  }

  void send_raw(const std::string &bytes)
  {
    size_t sent = 0;
    while (sent < bytes.size())
    {
      ssize_t n = send(fd_, bytes.data() + sent, bytes.size() - sent, MSG_NOSIGNAL);
      if (n > 0)
        sent += (size_t)n;
      else
        std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
  }

  // One send that never waits. False once the connection is gone.
  bool try_send(const std::string &bytes)
  {
    ssize_t n = send(fd_, bytes.data(), bytes.size(), MSG_NOSIGNAL);
    return n >= 0 || errno == EAGAIN || errno == EWOULDBLOCK;
  }

  // Reads what has arrived. Returns false once the server ended the connection.
  bool read_available()
  {
    char buf[4096];
    for (;;)
    {
      ssize_t n = recv(fd_, buf, sizeof(buf), 0);
      if (n > 0)
        rx_.append(buf, (size_t)n);
      else if (n == 0)
      {
        eof_ = true;
        return false;
      }
      else
        return true;
    }
  }

  std::string &rx() { return rx_; }
  bool eof() const { return eof_; }

  // Sends the opening request. `extra` is added to the headers; returns the response head.
  std::string handshake(const std::string &origin = "", const std::string &extra = "", const char *key = RFC_KEY,
                        const char *version = "13")
  {
    std::string req = "GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n";
    if (key)
      req += std::string("Sec-WebSocket-Key: ") + key + "\r\n";
    if (version)
      req += std::string("Sec-WebSocket-Version: ") + version + "\r\n";
    if (!origin.empty())
      req += "Origin: " + origin + "\r\n";
    send_raw(req + extra + "\r\n");
    return read_head();
  }

  std::string read_head()
  {
    TEST_ASSERT_TRUE_MESSAGE(wait(
                                 [&]
                                 {
                                   return rx_.find("\r\n\r\n") != std::string::npos;
                                 }),
                             "no HTTP response");
    size_t end = rx_.find("\r\n\r\n") + 4;
    std::string head = rx_.substr(0, end);
    rx_.erase(0, end);
    return head;
  }

  // A masked client frame.
  static std::string frame(uint8_t opcode, const std::string &payload, bool fin = true, bool mask = true)
  {
    std::string f;
    f += (char)((fin ? 0x80 : 0) | opcode);
    uint8_t m = mask ? 0x80 : 0;
    if (payload.size() < 126)
      f += (char)(m | payload.size());
    else
    {
      f += (char)(m | 126);
      f += (char)(payload.size() >> 8);
      f += (char)payload.size();
    }
    const uint8_t key[4] = {0x37, 0xfa, 0x21, 0x3d};
    if (mask)
      f.append((const char *)key, 4);
    for (size_t i = 0; i < payload.size(); i++)
      f += (char)(mask ? (uint8_t)payload[i] ^ key[i % 4] : (uint8_t)payload[i]);
    return f;
  }

  // The next server frame (unmasked). Fails the test when none arrives.
  void read_frame(uint8_t &opcode, std::string &payload)
  {
    TEST_ASSERT_TRUE_MESSAGE(wait(
                                 [&]
                                 {
                                   return frame_size() > 0;
                                 }),
                             "no WebSocket frame");
    size_t total = frame_size();
    opcode = (uint8_t)rx_[0] & 0x0F;
    size_t header = 2;
    size_t len = (uint8_t)rx_[1] & 0x7F;
    if (len == 126)
      header = 4;
    payload = rx_.substr(header, total - header);
    rx_.erase(0, total);
  }

  // Status code of the server's close frame; fails the test when the next frame is not one.
  unsigned read_close()
  {
    uint8_t op;
    std::string payload;
    read_frame(op, payload);
    TEST_ASSERT_EQUAL(8, op);
    TEST_ASSERT_TRUE(payload.size() >= 2);
    return (unsigned)((uint8_t)payload[0] << 8 | (uint8_t)payload[1]);
  }

  bool wait(const std::function<bool()> &done) { return ::pump(done); }
  bool wait_for_end()
  {
    return wait(
        [&]
        {
          return eof_;
        });
  }

private:
  size_t frame_size() const
  {
    if (rx_.size() < 2)
      return 0;
    size_t len = (uint8_t)rx_[1] & 0x7F, header = 2;
    if (len == 126)
    {
      if (rx_.size() < 4)
        return 0;
      len = (uint8_t)rx_[2] << 8 | (uint8_t)rx_[3];
      header = 4;
    }
    return rx_.size() >= header + len ? header + len : 0;
  }

  int fd_ = -1;
  std::string rx_;
  bool eof_ = false;
};

static bool pump(const std::function<bool()> &done)
{
  auto end = std::chrono::steady_clock::now() + std::chrono::seconds(2);
  while (std::chrono::steady_clock::now() < end)
  {
    sim::ws_poll();
    protocol::poll();
    for (TestClient *c : live_clients)
      c->read_available();
    if (done())
      return true;
    std::this_thread::sleep_for(std::chrono::milliseconds(1));
  }
  return false;
}

// A short pump that never expects anything: lets the server work.
static void settle()
{
  auto end = std::chrono::steady_clock::now() + std::chrono::milliseconds(30);
  while (std::chrono::steady_clock::now() < end)
  {
    sim::ws_poll();
    protocol::poll();
    for (TestClient *c : live_clients)
      c->read_available();
    std::this_thread::sleep_for(std::chrono::milliseconds(1));
  }
}

static std::string status_line(const std::string &head) { return head.substr(0, head.find("\r\n")); }

// The server under test, with a data folder and the protocol started.
struct Fixture
{
  TempData data{"ws"};
  explicit Fixture(const std::vector<std::string> &origins = {})
  {
    sim::reset();
    setup();
    std::string error;
    TEST_ASSERT_TRUE_MESSAGE(sim::ws_listen(0, origins, error), error.c_str());
  }
  ~Fixture() { sim::ws_stop(); }
};

// Opens a connection that has finished the handshake.
static void open(TestClient &c)
{
  std::string head = c.handshake();
  TEST_ASSERT_EQUAL_STRING("HTTP/1.1 101 Switching Protocols", status_line(head).c_str());
}

static void test_handshake_is_accepted()
{
  Fixture f;
  TestClient c;
  std::string head = c.handshake();
  TEST_ASSERT_EQUAL_STRING("HTTP/1.1 101 Switching Protocols", status_line(head).c_str());
  TEST_ASSERT_TRUE(head.find(std::string("Sec-WebSocket-Accept: ") + RFC_ACCEPT + "\r\n") != std::string::npos);
  TEST_ASSERT_TRUE(head.find("Upgrade: websocket\r\n") != std::string::npos);
}

static void test_allowed_origins()
{
  Fixture f({"https://example.org"});
  for (const char *origin : {"", "http://localhost", "http://localhost:5173", "http://127.0.0.1",
                             "http://127.0.0.1:8080", "https://monska85.github.io", "https://example.org"})
  {
    TestClient c;
    std::string head = c.handshake(origin);
    TEST_ASSERT_EQUAL_STRING_MESSAGE("HTTP/1.1 101 Switching Protocols", status_line(head).c_str(), origin);
    c.disconnect();
  }
}

static void test_other_origins_get_403()
{
  Fixture f;
  for (const char *origin : {"https://evil.example", "http://localhost.evil.example", "http://localhostx",
                             "http://localhost:", "http://localhost:80a", "http://127.0.0.1.evil.example",
                             "https://monska85.github.io.evil.example", "http://monska85.github.io", "null", "file://",
                             "https://example.org"})
  {
    TestClient c;
    std::string head = c.handshake(origin);
    TEST_ASSERT_EQUAL_STRING_MESSAGE("HTTP/1.1 403 Forbidden", status_line(head).c_str(), origin);
    TEST_ASSERT_TRUE_MESSAGE(c.wait_for_end(), origin);
    c.disconnect();
  }
  // An empty Origin header is present, so it is not "no origin".
  TestClient c;
  std::string head = c.handshake("", "Origin:\r\n");
  TEST_ASSERT_EQUAL_STRING("HTTP/1.1 403 Forbidden", status_line(head).c_str());
}

static void test_bad_handshakes_are_refused()
{
  Fixture f;
  {
    TestClient c;
    TEST_ASSERT_EQUAL_STRING("HTTP/1.1 426 Upgrade Required", status_line(c.handshake("", "", RFC_KEY, "8")).c_str());
  }
  settle();
  {
    TestClient c;
    TEST_ASSERT_EQUAL_STRING("HTTP/1.1 400 Bad Request", status_line(c.handshake("", "", nullptr)).c_str());
  }
  settle();
  {
    TestClient c;
    TEST_ASSERT_EQUAL_STRING("HTTP/1.1 400 Bad Request", status_line(c.handshake("", "", "not-a-key")).c_str());
  }
  settle();
  {
    TestClient c;
    c.send_raw("POST / HTTP/1.1\r\nHost: x\r\n\r\n");
    TEST_ASSERT_EQUAL_STRING("HTTP/1.1 400 Bad Request", status_line(c.read_head()).c_str());
  }
  settle();
  {
    // A request header that never ends is cut off at the size limit.
    TestClient c;
    c.send_raw("GET / HTTP/1.1\r\nX-Padding: " + std::string(9000, 'a'));
    TEST_ASSERT_EQUAL_STRING("HTTP/1.1 431 Request Header Fields Too Large", status_line(c.read_head()).c_str());
  }
}

static void test_request_and_reply_over_the_socket()
{
  Fixture f;
  TestClient c;
  open(c);
  c.send_raw(TestClient::frame(1, protocol_frame(R"({"seq":7,"cmd":"info"})")));
  uint8_t op;
  std::string reply;
  c.read_frame(op, reply);
  TEST_ASSERT_EQUAL(1, op);
  TEST_ASSERT_EQUAL(0, reply.find("@PR "));
  std::string json = reply.substr(13);
  char want[16];
  snprintf(want, sizeof(want), "%08x", (unsigned)pixelart::crc32(json.data(), json.size()));
  TEST_ASSERT_EQUAL_STRING(want, reply.substr(4, 8).c_str());
  JsonDocument doc;
  TEST_ASSERT_TRUE(!deserializeJson(doc, json));
  TEST_ASSERT_EQUAL(7, doc["seq"].as<int>());
  TEST_ASSERT_TRUE(doc["ok"].as<bool>());
  TEST_ASSERT_EQUAL(1, doc["protocol"].as<int>());
  TEST_ASSERT_EQUAL_STRING("simulator", doc["board"].as<const char *>());
}

static void test_upload_writes_the_data_folder()
{
  Fixture f;
  TestClient c;
  open(c);
  const std::string dot = R"({"format":"pixelart/1","name":"Dot","canvas":{"width":16,"height":16},)"
                          R"("sprites":{"dot":{"points":[[7,7,"#ff0000"]]}},"timeline":[{"show":["dot"]}]})";
  std::string sha;
  {
    pixelart::Sha256 h;
    h.update(dot.data(), dot.size());
    sha = h.hex_digest();
  }
  auto exchange = [&](const std::string &json)
  {
    c.send_raw(TestClient::frame(1, protocol_frame(json)));
    uint8_t op;
    std::string reply;
    c.read_frame(op, reply);
    return reply;
  };
  exchange(R"({"seq":1,"cmd":"put_begin","kind":"animation","id":"dot","size":)" + std::to_string(dot.size()) +
           R"(,"sha256":")" + sha + "\"}");
  exchange(R"({"seq":2,"cmd":"put_chunk","offset":0,"data":")" + pixelart::base64_encode(dot.data(), dot.size()) +
           "\"}");
  std::string end = exchange(R"({"seq":3,"cmd":"put_end"})");
  TEST_ASSERT_TRUE_MESSAGE(end.find("\"ok\":true") != std::string::npos, end.c_str());
  TEST_ASSERT_TRUE(fs::exists(f.data.root / "animations" / "dot.json"));
}

static void test_fragments_are_reassembled()
{
  Fixture f;
  TestClient c;
  open(c);
  std::string line = protocol_frame(R"({"seq":3,"cmd":"settings_get"})");
  size_t a = line.size() / 3, b = 2 * line.size() / 3;
  c.send_raw(TestClient::frame(1, line.substr(0, a), false));
  c.send_raw(TestClient::frame(9, "mid")); // a ping between fragments is allowed
  c.send_raw(TestClient::frame(0, line.substr(a, b - a), false));
  c.send_raw(TestClient::frame(0, line.substr(b), true));
  uint8_t op;
  std::string payload;
  c.read_frame(op, payload);
  TEST_ASSERT_EQUAL(10, op);
  TEST_ASSERT_EQUAL_STRING("mid", payload.c_str());
  c.read_frame(op, payload);
  TEST_ASSERT_EQUAL(1, op);
  TEST_ASSERT_TRUE_MESSAGE(payload.find("\"seq\":3,\"ok\":true") != std::string::npos, payload.c_str());
}

static void test_ping_gets_pong()
{
  Fixture f;
  TestClient c;
  open(c);
  c.send_raw(TestClient::frame(9, "hello"));
  uint8_t op;
  std::string payload;
  c.read_frame(op, payload);
  TEST_ASSERT_EQUAL(10, op);
  TEST_ASSERT_EQUAL_STRING("hello", payload.c_str());
  c.send_raw(TestClient::frame(10, "unsolicited")); // a pong needs no answer
  settle();
  TEST_ASSERT_TRUE(c.rx().empty());
}

static void test_a_client_that_pings_and_never_reads_is_dropped()
{
  Fixture f;
  TestClient c;
  open(c);
  std::string batch;
  for (int i = 0; i < 16; i++)
    batch += TestClient::frame(9, std::string(125, 'p'));
  // About 8 MB of pongs would be owed: far more than the socket buffers and the output cap hold.
  bool dropped = false;
  for (int i = 0; i < 4000 && !dropped; i++)
  {
    dropped = !c.try_send(batch);
    sim::ws_poll();
    sim::ws_poll();
  }
  TEST_ASSERT_TRUE_MESSAGE(dropped, "the server kept buffering pongs for a client that never reads");
}

static void test_oversize_message_closes_with_1009()
{
  Fixture f;
  TestClient c;
  open(c);
  c.send_raw(TestClient::frame(1, std::string(1025, 'a')));
  TEST_ASSERT_EQUAL(1009, c.read_close());
  c.send_raw(TestClient::frame(8, "\x03\xf1")); // the client answers, then the server ends the connection
  TEST_ASSERT_TRUE(c.wait_for_end());
  // The longest line is accepted.
  TestClient d;
  open(d);
  d.send_raw(TestClient::frame(1, std::string(1024, 'a')));
  settle();
  TEST_ASSERT_FALSE(d.eof());
}

static void test_fragments_over_the_limit_close_with_1009()
{
  Fixture f;
  TestClient c;
  open(c);
  c.send_raw(TestClient::frame(1, std::string(600, 'a'), false));
  c.send_raw(TestClient::frame(0, std::string(600, 'a'), true));
  TEST_ASSERT_EQUAL(1009, c.read_close());
}

static void test_binary_message_closes_with_1003()
{
  Fixture f;
  TestClient c;
  open(c);
  c.send_raw(TestClient::frame(2, "\x01\x02"));
  TEST_ASSERT_EQUAL(1003, c.read_close());
}

static void test_protocol_violations_close_with_1002_1007_1008()
{
  Fixture f;
  {
    TestClient c;
    open(c);
    c.send_raw(TestClient::frame(1, "x", true, false)); // not masked
    TEST_ASSERT_EQUAL(1002, c.read_close());
  }
  settle();
  {
    TestClient c;
    open(c);
    c.send_raw(TestClient::frame(0, "x")); // continuation without a message
    TEST_ASSERT_EQUAL(1002, c.read_close());
  }
  settle();
  {
    TestClient c;
    open(c);
    c.send_raw(TestClient::frame(1, "ab", false));
    c.send_raw(TestClient::frame(1, "cd")); // a new message inside one
    TEST_ASSERT_EQUAL(1002, c.read_close());
  }
  settle();
  {
    TestClient c;
    open(c);
    c.send_raw(TestClient::frame(9, "x", false)); // a fragmented control frame
    TEST_ASSERT_EQUAL(1002, c.read_close());
  }
  settle();
  {
    TestClient c;
    open(c);
    c.send_raw(TestClient::frame(3, "x")); // reserved opcode
    TEST_ASSERT_EQUAL(1002, c.read_close());
  }
  settle();
  {
    TestClient c;
    open(c);
    c.send_raw(TestClient::frame(1, "\xff\xfe"));
    TEST_ASSERT_EQUAL(1007, c.read_close());
  }
  settle();
  {
    TestClient c;
    open(c);
    c.send_raw(TestClient::frame(1, "one\ntwo")); // one message is one line
    TEST_ASSERT_EQUAL(1008, c.read_close());
  }
}

static void test_second_client_is_refused_until_the_first_closes()
{
  Fixture f;
  TestClient first;
  open(first);
  TestClient second;
  second.send_raw("GET / HTTP/1.1\r\nHost: x\r\n\r\n");
  TEST_ASSERT_EQUAL_STRING("HTTP/1.1 503 Service Unavailable", status_line(second.read_head()).c_str());
  TEST_ASSERT_TRUE(second.wait_for_end());
  second.disconnect();

  // The first client still works.
  first.send_raw(TestClient::frame(9, "still here"));
  uint8_t op;
  std::string payload;
  first.read_frame(op, payload);
  TEST_ASSERT_EQUAL(10, op);

  // It closes properly; then a new client is served.
  first.send_raw(TestClient::frame(8, "\x03\xe8"));
  TEST_ASSERT_EQUAL(1000, first.read_close());
  TEST_ASSERT_TRUE(first.wait_for_end());
  first.disconnect();
  TestClient third;
  open(third);
}

static void test_dropped_connection_frees_the_slot()
{
  Fixture f;
  {
    TestClient first;
    open(first);
  }
  settle();
  TestClient second;
  open(second);
}

// The spec: a dropped connection does not end an upload; the next client can continue it.
static void test_an_upload_survives_a_dropped_connection()
{
  Fixture f;
  const std::string dot = R"({"format":"pixelart/1","name":"Dot","canvas":{"width":16,"height":16},)"
                          R"("sprites":{"dot":{"points":[[7,7,"#ff0000"]]}},"timeline":[{"show":["dot"]}]})";
  std::string sha;
  {
    pixelart::Sha256 h;
    h.update(dot.data(), dot.size());
    sha = h.hex_digest();
  }
  auto exchange = [](TestClient &c, const std::string &json)
  {
    c.send_raw(TestClient::frame(1, protocol_frame(json)));
    uint8_t op;
    std::string reply;
    c.read_frame(op, reply);
    return reply;
  };
  const size_t half = dot.size() / 2;
  {
    TestClient first;
    open(first);
    exchange(first, R"({"seq":1,"cmd":"put_begin","kind":"animation","id":"dot","size":)" + std::to_string(dot.size()) +
                        R"(,"sha256":")" + sha + "\"}");
    std::string chunk = exchange(first, R"({"seq":2,"cmd":"put_chunk","offset":0,"data":")" +
                                            pixelart::base64_encode(dot.data(), half) + "\"}");
    TEST_ASSERT_TRUE_MESSAGE(chunk.find("\"ok\":true") != std::string::npos, chunk.c_str());
  }
  settle();
  TestClient second;
  open(second);
  std::string rest =
      exchange(second, R"({"seq":3,"cmd":"put_chunk","offset":)" + std::to_string(half) + R"(,"data":")" +
                           pixelart::base64_encode(dot.data() + half, dot.size() - half) + "\"}");
  TEST_ASSERT_TRUE_MESSAGE(rest.find("\"ok\":true") != std::string::npos, rest.c_str());
  std::string end = exchange(second, R"({"seq":4,"cmd":"put_end"})");
  TEST_ASSERT_TRUE_MESSAGE(end.find("\"ok\":true") != std::string::npos, end.c_str());
  TEST_ASSERT_TRUE(fs::exists(f.data.root / "animations" / "dot.json"));
}

static void test_close_handshake_echoes_the_status()
{
  Fixture f;
  TestClient c;
  open(c);
  c.send_raw(TestClient::frame(8, "\x0b\xb8"
                                  "bye")); // 3000
  TEST_ASSERT_EQUAL(3000, c.read_close());
  TEST_ASSERT_TRUE(c.wait_for_end());
}

static void test_logs_and_mirror_lines_are_not_sent()
{
  Fixture f;
  TestClient c;
  open(c);
  Serial.print("pixelart: a log line\n");
  Serial.print("@PX 1 ff0000\n");
  settle();
  TEST_ASSERT_TRUE(c.rx().empty());
}

static long elapsed_ms(std::chrono::steady_clock::time_point since)
{
  return (long)std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - since).count();
}

static void test_wait_returns_early_when_a_request_arrives()
{
  Fixture f;
  TestClient c;
  open(c);
  std::thread sender(
      [&]
      {
        std::this_thread::sleep_for(std::chrono::milliseconds(50));
        c.send_raw(TestClient::frame(1, "hello"));
      });
  auto start = std::chrono::steady_clock::now();
  while (sim::serial_input_size() == 0 && elapsed_ms(start) < 2000)
    sim::ws_wait(std::chrono::seconds(2));
  sender.join();
  TEST_ASSERT_EQUAL(6, sim::serial_input_size());
  TEST_ASSERT_TRUE_MESSAGE(elapsed_ms(start) < 1000, "the wait did not end on the request");
}

static void test_wait_lasts_about_the_limit_when_nothing_happens()
{
  Fixture f;
  TestClient c;
  open(c);
  auto start = std::chrono::steady_clock::now();
  sim::ws_wait(std::chrono::milliseconds(100));
  long took = elapsed_ms(start);
  TEST_ASSERT_TRUE_MESSAGE(took >= 95 && took < 2000, "the wait did not last about its limit");
}

// The limit given to ws_wait() in the deadline tests: far above every deadline, so a wait that
// ignores a deadline runs into it.
static const auto LONG_LIMIT = std::chrono::seconds(10);

static void test_wait_wakes_for_a_handshake_past_its_deadline_and_drops_the_client()
{
  Fixture f;
  TestClient c; // connects and says nothing
  settle();
  auto start = std::chrono::steady_clock::now();
  sim::ws_wait(LONG_LIMIT);
  long took = elapsed_ms(start);
  TEST_ASSERT_TRUE_MESSAGE(took >= PIXELART_WS_HANDSHAKE_MS * 9 / 10 && took < PIXELART_WS_HANDSHAKE_MS + 3000,
                           "the wait did not end at the handshake deadline");
  TEST_ASSERT_FALSE_MESSAGE(c.read_available(), "the stalled client was not dropped");
}

static void test_wait_wakes_for_a_refused_socket_past_its_deadline_and_closes_it()
{
  Fixture f;
  TestClient first;
  open(first);
  TestClient second; // refused with 503, then never closes its side
  settle();
  auto start = std::chrono::steady_clock::now();
  sim::ws_wait(LONG_LIMIT);
  long took = elapsed_ms(start);
  TEST_ASSERT_TRUE_MESSAGE(took >= PIXELART_WS_CLOSE_MS * 7 / 10 && took < PIXELART_WS_CLOSE_MS + 3000,
                           "the wait did not end at the refused socket's deadline");
  std::this_thread::sleep_for(std::chrono::milliseconds(50));
  second.try_send("y"); // the first send after the close draws a reset
  std::this_thread::sleep_for(std::chrono::milliseconds(50));
  TEST_ASSERT_FALSE_MESSAGE(second.try_send("z"), "the refused socket was not closed");
}

static void test_wait_serves_input_held_back_once_the_sketch_drains_its_queue()
{
  Fixture f;
  TestClient c;
  open(c);
  sim::serial_input(std::string(4089, 'x')); // 7 bytes short of full
  // Three messages in one segment: the first two fill the queue, the third waits in the connection's buffer.
  c.send_raw(TestClient::frame(1, "hello") + TestClient::frame(1, "hi") + TestClient::frame(1, "tail"));
  auto end = std::chrono::steady_clock::now() + std::chrono::seconds(2);
  while (sim::serial_input_size() < 4096 && std::chrono::steady_clock::now() < end)
  {
    sim::ws_poll();
    std::this_thread::sleep_for(std::chrono::milliseconds(1));
  }
  TEST_ASSERT_EQUAL(4089 + 6 + 3, sim::serial_input_size());
  while (sim::serial_input_size() > 0) // the sketch reads everything
    sim::serial_input_read();
  auto start = std::chrono::steady_clock::now();
  sim::ws_wait(LONG_LIMIT);
  TEST_ASSERT_TRUE_MESSAGE(elapsed_ms(start) < 1000, "the wait did not end for the buffered input");
  TEST_ASSERT_EQUAL(5, sim::serial_input_size());
}

static void test_ws_off_changes_nothing()
{
  sim::reset();
  TEST_ASSERT_FALSE(sim::ws_active());
  Serial.print("@PR 00000000 {}\n"); // no client and no server: dropped quietly
  TEST_ASSERT_EQUAL(1, sim::serial().size());
}

void setUp() {}
void tearDown() { sim::ws_stop(); }

int main(int, char **)
{
  UNITY_BEGIN();
  RUN_TEST(test_handshake_is_accepted);
  RUN_TEST(test_allowed_origins);
  RUN_TEST(test_other_origins_get_403);
  RUN_TEST(test_bad_handshakes_are_refused);
  RUN_TEST(test_request_and_reply_over_the_socket);
  RUN_TEST(test_upload_writes_the_data_folder);
  RUN_TEST(test_fragments_are_reassembled);
  RUN_TEST(test_ping_gets_pong);
  RUN_TEST(test_a_client_that_pings_and_never_reads_is_dropped);
  RUN_TEST(test_oversize_message_closes_with_1009);
  RUN_TEST(test_fragments_over_the_limit_close_with_1009);
  RUN_TEST(test_binary_message_closes_with_1003);
  RUN_TEST(test_protocol_violations_close_with_1002_1007_1008);
  RUN_TEST(test_second_client_is_refused_until_the_first_closes);
  RUN_TEST(test_dropped_connection_frees_the_slot);
  RUN_TEST(test_an_upload_survives_a_dropped_connection);
  RUN_TEST(test_close_handshake_echoes_the_status);
  RUN_TEST(test_logs_and_mirror_lines_are_not_sent);
  RUN_TEST(test_wait_returns_early_when_a_request_arrives);
  RUN_TEST(test_wait_lasts_about_the_limit_when_nothing_happens);
  RUN_TEST(test_wait_wakes_for_a_handshake_past_its_deadline_and_drops_the_client);
  RUN_TEST(test_wait_wakes_for_a_refused_socket_past_its_deadline_and_closes_it);
  RUN_TEST(test_wait_serves_input_held_back_once_the_sketch_drains_its_queue);
  RUN_TEST(test_ws_off_changes_nothing);
  return UNITY_END();
}
