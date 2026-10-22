// WebSocket transport (RFC 6455) for the command protocol: a small server on
// non-blocking POSIX sockets, polled from the simulator's waits. One client at
// a time, bound to 127.0.0.1, text messages only, one protocol line per
// message. See docs/protocol/protocol-v1.md#websocket-simulator.

#include <arpa/inet.h>
#include <algorithm>
#include <cerrno>
#include <chrono>
#include <cstring>
#include <thread>
#include <vector>
#include <fcntl.h>
#include <netinet/in.h>
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>

#include <pixel_codec.h>

#include "sim_internal.h"

namespace sim
{
namespace
{

using Clock = std::chrono::steady_clock;

constexpr size_t MAX_MESSAGE = 1024; // the protocol's line limit
constexpr size_t MAX_CONTROL = 125;
constexpr size_t MAX_HEADER = 8192;
constexpr size_t MAX_INPUT_BUFFER = 4096;
constexpr size_t MAX_OUTPUT_BUFFER = 256 * 1024;
// Bytes queued for Serial.read() above which the socket is not read, so a
// flooding client waits in TCP instead of growing the queue.
constexpr size_t MAX_PENDING_INPUT = 4096;
constexpr size_t MAX_REFUSED = 8;
constexpr auto HANDSHAKE_TIMEOUT = std::chrono::milliseconds(PIXELART_WS_HANDSHAKE_MS);
constexpr auto CLOSE_TIMEOUT = std::chrono::milliseconds(PIXELART_WS_CLOSE_MS);
const char *GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

const char *DEFAULT_ORIGIN = "https://monska85.github.io";

#if defined(MSG_NOSIGNAL)
constexpr int SEND_FLAGS = MSG_NOSIGNAL;
#else
constexpr int SEND_FLAGS = 0; // SO_NOSIGPIPE is set on each socket instead
#endif

// ---- SHA-1 (FIPS 180-4), only for the handshake ----

std::string sha1(const std::string &data)
{
  uint32_t h[5] = {0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0};
  std::string msg = data;
  msg += (char)0x80;
  while (msg.size() % 64 != 56)
    msg += (char)0;
  uint64_t bits = (uint64_t)data.size() * 8;
  for (int i = 7; i >= 0; i--)
    msg += (char)(bits >> (i * 8));

  auto rotl = [](uint32_t v, int n)
  {
    return (v << n) | (v >> (32 - n));
  };
  for (size_t off = 0; off < msg.size(); off += 64)
  {
    uint32_t w[80];
    for (int i = 0; i < 16; i++)
      w[i] = (uint32_t)(uint8_t)msg[off + i * 4] << 24 | (uint32_t)(uint8_t)msg[off + i * 4 + 1] << 16 |
             (uint32_t)(uint8_t)msg[off + i * 4 + 2] << 8 | (uint32_t)(uint8_t)msg[off + i * 4 + 3];
    for (int i = 16; i < 80; i++)
      w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    uint32_t a = h[0], b = h[1], c = h[2], d = h[3], e = h[4];
    for (int i = 0; i < 80; i++)
    {
      uint32_t f, k;
      if (i < 20)
      {
        f = (b & c) | (~b & d);
        k = 0x5A827999;
      }
      else if (i < 40)
      {
        f = b ^ c ^ d;
        k = 0x6ED9EBA1;
      }
      else if (i < 60)
      {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8F1BBCDC;
      }
      else
      {
        f = b ^ c ^ d;
        k = 0xCA62C1D6;
      }
      uint32_t t = rotl(a, 5) + f + e + k + w[i];
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = t;
    }
    h[0] += a;
    h[1] += b;
    h[2] += c;
    h[3] += d;
    h[4] += e;
  }
  std::string out;
  for (uint32_t v : h)
    for (int i = 3; i >= 0; i--)
      out += (char)(v >> (i * 8));
  return out;
}

std::string accept_key(const std::string &key)
{
  std::string digest = sha1(key + GUID);
  return pixelart::base64_encode(digest.data(), digest.size());
}

// ---- Text helpers ----

std::string lower(std::string s)
{
  for (char &c : s)
    if (c >= 'A' && c <= 'Z')
      c = (char)(c - 'A' + 'a');
  return s;
}

std::string trim(const std::string &s)
{
  size_t a = 0, b = s.size();
  while (a < b && (s[a] == ' ' || s[a] == '\t'))
    a++;
  while (b > a && (s[b - 1] == ' ' || s[b - 1] == '\t'))
    b--;
  return s.substr(a, b - a);
}

// True when a comma separated header value holds `token` (case-insensitive).
bool has_token(const std::string &value, const std::string &token)
{
  size_t pos = 0;
  while (pos <= value.size())
  {
    size_t comma = value.find(',', pos);
    if (comma == std::string::npos)
      comma = value.size();
    if (lower(trim(value.substr(pos, comma - pos))) == token)
      return true;
    pos = comma + 1;
  }
  return false;
}

// Strict UTF-8: a text with any ill-formed byte is rejected.
bool valid_utf8(const std::string &s)
{
  for (size_t i = 0; i < s.size();)
  {
    size_t length = pixelart::utf8_sequence_length(s.data(), s.size(), i);
    if (length == 0)
      return false;
    i += length;
  }
  return true;
}

bool all_digits(const std::string &s, size_t max_len)
{
  if (s.empty() || s.size() > max_len)
    return false;
  for (char c : s)
    if (c < '0' || c > '9')
      return false;
  return true;
}

// ---- Sockets ----

void configure(int fd)
{
  fcntl(fd, F_SETFL, fcntl(fd, F_GETFL, 0) | O_NONBLOCK);
  fcntl(fd, F_SETFD, fcntl(fd, F_GETFD, 0) | FD_CLOEXEC);
#if defined(SO_NOSIGPIPE)
  int on = 1;
  setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &on, sizeof(on));
#endif
}

enum class Phase
{
  Handshake,
  Open,
  Closing
};

struct Client
{
  int fd = -1;
  Phase phase = Phase::Handshake;
  std::string in, out;
  std::string message;      // text message being reassembled
  bool fragmenting = false; // a text message started and has no final frame yet
  bool drop_when_sent = false;
  bool shut_write = false;
  bool input_blocked = false; // process() stopped because the sketch has too much unread input
  Clock::time_point deadline;
};

struct Refused
{
  int fd;
  Clock::time_point deadline;
};

struct Server
{
  int listen_fd = -1;
  unsigned port = 0;
  std::vector<std::string> extra_origins;
  bool has_client = false;
  Client client;
  std::vector<Refused> refused;
};

Server &server()
{
  static Server s;
  return s;
}

void drop_client(Server &s)
{
  if (s.has_client && s.client.fd >= 0)
    close(s.client.fd);
  s.client = Client();
  s.has_client = false;
}

size_t input_capacity(const Client &c) { return c.phase == Phase::Handshake ? MAX_HEADER : MAX_INPUT_BUFFER; }

// Whether the sketch has as much unread input as it is given.
bool sketch_input_full() { return serial_input_size() >= MAX_PENDING_INPUT; }

// Whether the socket should be read now: service_client() reads on this rule
// and ws_wait() polls for readability on it.
bool wants_input(const Client &c)
{
  if (c.drop_when_sent || c.in.size() >= input_capacity(c))
    return false;
  return !(c.phase == Phase::Open && sketch_input_full());
}

// Whether bytes wait to be written: flush() sends on this rule and ws_wait()
// polls for writability on it.
bool wants_output(const Client &c) { return !c.out.empty(); }

// Sends as much of `out` as the socket takes. Returns false when the
// connection is broken.
bool flush(Client &c)
{
  while (wants_output(c))
  {
    ssize_t n = send(c.fd, c.out.data(), c.out.size(), SEND_FLAGS);
    if (n > 0)
    {
      c.out.erase(0, (size_t)n);
      continue;
    }
    if (n < 0 && errno == EINTR)
      continue;
    if (n < 0 && (errno == EAGAIN || errno == EWOULDBLOCK))
      return true;
    return false;
  }
  return true;
}

std::string frame(uint8_t opcode, const std::string &payload)
{
  std::string f;
  f += (char)(0x80 | opcode);
  if (payload.size() < 126)
    f += (char)payload.size();
  else if (payload.size() <= 0xFFFF)
  {
    f += (char)126;
    f += (char)(payload.size() >> 8);
    f += (char)payload.size();
  }
  else
  {
    f += (char)127;
    for (int i = 7; i >= 0; i--)
      f += (char)((uint64_t)payload.size() >> (i * 8));
  }
  return f + payload;
}

std::string close_payload(uint16_t code)
{
  std::string p;
  p += (char)(code >> 8);
  p += (char)code;
  return p;
}

// Our side starts the closing handshake: send the status, then wait a moment
// for the client's close frame before the connection ends.
void start_close(Server &s, uint16_t code)
{
  Client &c = s.client;
  if (c.phase == Phase::Closing)
    return;
  c.out += frame(0x8, close_payload(code));
  c.phase = Phase::Closing;
  c.in.clear();
  c.message.clear();
  c.deadline = Clock::now() + CLOSE_TIMEOUT;
}

// ---- Handshake ----

bool origin_allowed(const Server &s, const std::string &origin)
{
  if (origin == DEFAULT_ORIGIN)
    return true;
  for (const std::string &extra : s.extra_origins)
    if (origin == extra)
      return true;
  for (const char *base : {"http://localhost", "http://127.0.0.1"})
  {
    size_t n = strlen(base);
    if (origin.compare(0, n, base) != 0)
      continue;
    if (origin.size() == n)
      return true;
    if (origin[n] == ':' && all_digits(origin.substr(n + 1), 5))
      return true;
  }
  return false;
}

struct HttpReply
{
  int status = 101;
  std::string text;
  std::string extra;
};

std::string http_response(const HttpReply &r)
{
  std::string body = r.status == 101 ? "" : r.text + "\n";
  std::string out =
      "HTTP/1.1 " + std::to_string(r.status) + " " + (r.status == 101 ? "Switching Protocols" : r.text) + "\r\n";
  out += r.extra;
  if (r.status != 101)
    out += "Connection: close\r\nContent-Type: text/plain\r\nContent-Length: " + std::to_string(body.size()) + "\r\n";
  return out + "\r\n" + body;
}

// Checks the opening request and builds the answer.
HttpReply handshake(const Server &s, const std::string &head)
{
  std::vector<std::pair<std::string, std::string>> headers;
  size_t line_end = head.find("\r\n");
  std::string request_line = head.substr(0, line_end);
  size_t pos = line_end == std::string::npos ? head.size() : line_end + 2;
  while (pos < head.size())
  {
    size_t end = head.find("\r\n", pos);
    if (end == std::string::npos)
      end = head.size();
    std::string line = head.substr(pos, end - pos);
    pos = end + 2;
    size_t colon = line.find(':');
    if (line.empty() || line[0] == ' ' || line[0] == '\t' || colon == std::string::npos || colon == 0)
      return {400, "Bad Request"};
    headers.push_back({lower(line.substr(0, colon)), trim(line.substr(colon + 1))});
  }

  auto count = [&](const char *name)
  {
    size_t n = 0;
    for (const auto &h : headers)
      n += h.first == name;
    return n;
  };
  auto get = [&](const char *name)
  {
    std::string joined;
    for (const auto &h : headers)
      if (h.first == name)
        joined += (joined.empty() ? "" : ",") + h.second;
    return joined;
  };

  if (request_line.compare(0, 4, "GET ") != 0 || request_line.size() < 14 ||
      request_line.compare(request_line.size() - 9, 9, " HTTP/1.1") != 0 || request_line[4] != '/')
    return {400, "Bad Request"};
  if (count("origin") > 1)
    return {400, "Bad Request"};
  if (count("origin") == 1 && !origin_allowed(s, get("origin")))
    return {403, "Forbidden"};
  if (count("host") != 1 || !has_token(get("connection"), "upgrade") || lower(get("upgrade")) != "websocket")
    return {400, "Bad Request"};
  std::string key = get("sec-websocket-key");
  std::string raw_key;
  if (count("sec-websocket-key") != 1 || !pixelart::base64_decode(key.data(), key.size(), 16, raw_key) ||
      raw_key.size() != 16)
    return {400, "Bad Request"};
  if (count("sec-websocket-version") != 1 || get("sec-websocket-version") != "13")
    return {426, "Upgrade Required", "Sec-WebSocket-Version: 13\r\n"};

  return {101, "", "Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept_key(key) + "\r\n"};
}

// Sends an HTTP error and closes the connection once it is written.
void refuse_and_close(Client &c, const HttpReply &reply)
{
  c.out = http_response(reply);
  c.phase = Phase::Closing;
  c.drop_when_sent = true;
}

// Answers the opening request once it is complete, within the header limit.
void process_handshake(Server &s)
{
  Client &c = s.client;
  const HttpReply too_large = {431, "Request Header Fields Too Large"};
  size_t end = c.in.find("\r\n\r\n");
  if (end == std::string::npos)
  {
    if (c.in.size() >= MAX_HEADER)
      refuse_and_close(c, too_large);
    return;
  }
  if (end + 4 > MAX_HEADER)
  {
    refuse_and_close(c, too_large);
    return;
  }
  HttpReply reply = handshake(s, c.in.substr(0, end));
  c.in.erase(0, end + 4);
  if (reply.status != 101)
  {
    refuse_and_close(c, reply);
    return;
  }
  c.out = http_response(reply);
  c.phase = Phase::Open;
}

// ---- Frames ----

enum class Step
{
  NeedMore,
  Consumed,
  Stop
};

void deliver(Server &s)
{
  Client &c = s.client;
  std::string message = std::move(c.message);
  c.message.clear();
  c.fragmenting = false;
  if (!valid_utf8(message))
    return start_close(s, 1007);
  if (message.find('\n') != std::string::npos)
    return start_close(s, 1008); // one message is one line
  serial_input(message + "\n");
}

Step read_frame(Server &s)
{
  Client &c = s.client;
  if (c.in.size() < 2)
    return Step::NeedMore;
  const uint8_t b0 = (uint8_t)c.in[0], b1 = (uint8_t)c.in[1];
  const bool fin = b0 & 0x80;
  const int op = b0 & 0x0F;
  const bool control = op & 0x8;
  auto fail = [&](uint16_t code)
  {
    start_close(s, code);
    return Step::Stop;
  };

  if ((b0 & 0x70) || !(op <= 2 || (op >= 8 && op <= 10)))
    return fail(1002);
  if (!(b1 & 0x80))
    return fail(1002); // client frames must be masked
  if (op == 2)
    return fail(1003);
  if (control && !fin)
    return fail(1002);

  uint64_t length = b1 & 0x7F;
  size_t pos = 2;
  if (length == 126)
  {
    if (c.in.size() < 4)
      return Step::NeedMore;
    length = (uint64_t)(uint8_t)c.in[2] << 8 | (uint8_t)c.in[3];
    pos = 4;
    if (length < 126)
      return fail(1002);
  }
  else if (length == 127)
  {
    if (c.in.size() < 10)
      return Step::NeedMore;
    length = 0;
    for (int i = 0; i < 8; i++)
      length = length << 8 | (uint8_t)c.in[2 + i];
    pos = 10;
    if (length >> 63 || length <= 0xFFFF)
      return fail(1002);
  }
  if (control && length > MAX_CONTROL)
    return fail(1002);
  if (!control && c.message.size() + length > MAX_MESSAGE)
    return fail(1009);

  if (c.in.size() < pos + 4 + length)
    return Step::NeedMore;
  uint8_t mask[4];
  memcpy(mask, c.in.data() + pos, 4);
  std::string payload = c.in.substr(pos + 4, (size_t)length);
  for (size_t i = 0; i < payload.size(); i++)
    payload[i] = (char)((uint8_t)payload[i] ^ mask[i % 4]);
  c.in.erase(0, pos + 4 + (size_t)length);

  switch (op)
  {
  case 0:
  case 1:
    if ((op == 1) == c.fragmenting) // a new message inside one, or a continuation of none
      return fail(1002);
    c.message += payload;
    c.fragmenting = !fin;
    if (fin)
      deliver(s);
    return c.phase == Phase::Closing ? Step::Stop : Step::Consumed;
  case 9:
    c.out += frame(0xA, payload);
    return Step::Consumed;
  case 10:
    return Step::Consumed;
  default: // 8, close
  {
    uint16_t code = 1005;
    if (payload.size() == 1)
      return fail(1002);
    if (payload.size() >= 2)
    {
      code = (uint16_t)((uint8_t)payload[0] << 8 | (uint8_t)payload[1]);
      bool valid = (code >= 1000 && code <= 1003) || (code >= 1007 && code <= 1011) || (code >= 3000 && code <= 4999);
      if (!valid || !valid_utf8(payload.substr(2)))
        return fail(1002);
    }
    // Echo the status and end the connection once the echo is sent.
    c.out += frame(0x8, code == 1005 ? std::string() : close_payload(code));
    c.phase = Phase::Closing;
    c.drop_when_sent = true;
    c.in.clear();
    return Step::Stop;
  }
  }
}

// In the closing phase only the client's close frame matters: it ends the wait.
void process_closing(Server &s)
{
  Client &c = s.client;
  while (c.in.size() >= 2)
  {
    if ((uint8_t)c.in[0] & 0x08 && ((uint8_t)c.in[0] & 0x0F) == 0x8)
    {
      s.client.drop_when_sent = true;
      return;
    }
    // Skip any other frame whole, or give up on a frame that is too big to wait for.
    size_t pos = 2;
    uint64_t length = (uint8_t)c.in[1] & 0x7F;
    if (length == 126)
    {
      if (c.in.size() < 4)
        return;
      length = (uint64_t)(uint8_t)c.in[2] << 8 | (uint8_t)c.in[3];
      pos = 4;
    }
    else if (length == 127)
    {
      s.client.drop_when_sent = true;
      return;
    }
    size_t total = pos + ((uint8_t)c.in[1] & 0x80 ? 4 : 0) + (size_t)length;
    if (total > MAX_INPUT_BUFFER)
    {
      s.client.drop_when_sent = true;
      return;
    }
    if (c.in.size() < total)
      return;
    c.in.erase(0, total);
  }
}

void process(Server &s)
{
  Client &c = s.client;
  if (c.phase == Phase::Handshake)
    process_handshake(s);
  c.input_blocked = false;
  if (c.phase == Phase::Open)
  {
    while (c.phase == Phase::Open)
    {
      if (sketch_input_full())
      {
        c.input_blocked = true;
        break;
      }
      if (read_frame(s) != Step::Consumed)
        break;
    }
  }
  else if (c.phase == Phase::Closing && !c.drop_when_sent)
    process_closing(s);
}

// ---- Connections ----

void accept_connections(Server &s)
{
  for (int i = 0; i < 4; i++)
  {
    int fd = accept(s.listen_fd, nullptr, nullptr);
    if (fd < 0)
      return;
    configure(fd);
    if (!s.has_client)
    {
      s.client = Client();
      s.client.fd = fd;
      s.client.deadline = Clock::now() + HANDSHAKE_TIMEOUT;
      s.has_client = true;
      continue;
    }
    // One client at a time: answer the others with 503, then let them finish reading.
    if (s.refused.size() >= MAX_REFUSED)
    {
      close(fd);
      continue;
    }
    std::string answer = http_response({503, "Service Unavailable"});
    send(fd, answer.data(), answer.size(), SEND_FLAGS);
    shutdown(fd, SHUT_WR);
    s.refused.push_back({fd, Clock::now() + CLOSE_TIMEOUT});
  }
}

void service_refused(Server &s)
{
  char scratch[512];
  for (size_t i = 0; i < s.refused.size();)
  {
    ssize_t n = recv(s.refused[i].fd, scratch, sizeof(scratch), 0);
    bool done = n == 0 || (n < 0 && errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR) ||
                Clock::now() >= s.refused[i].deadline;
    if (done)
    {
      close(s.refused[i].fd);
      s.refused.erase(s.refused.begin() + (long)i);
    }
    else
      i++;
  }
}

void service_client(Server &s)
{
  Client &c = s.client;
  if (Clock::now() >= c.deadline && c.phase != Phase::Open)
    return drop_client(s);

  if (wants_input(c))
  {
    char buf[2048];
    size_t room = std::min(sizeof(buf), input_capacity(c) - c.in.size());
    ssize_t n = recv(c.fd, buf, room, 0);
    if (n > 0)
      c.in.append(buf, (size_t)n);
    else if (n == 0 || (errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR))
      return drop_client(s);
  }

  process(s);
  // Pongs and close echoes queue up like replies: a client that pings and never reads is dropped
  if (!flush(c) || c.out.size() > MAX_OUTPUT_BUFFER)
    return drop_client(s);
  if (c.out.empty() && c.phase == Phase::Closing)
  {
    if (c.drop_when_sent)
      return drop_client(s);
    if (!c.shut_write)
    {
      shutdown(c.fd, SHUT_WR);
      c.shut_write = true;
    }
  }
}

} // namespace

namespace detail
{

void ws_send_line(const std::string &line)
{
  Server &s = server();
  if (!s.has_client || s.client.phase != Phase::Open)
    return;
  s.client.out += frame(0x1, line);
  if (s.client.out.size() > MAX_OUTPUT_BUFFER || !flush(s.client))
    drop_client(s); // the client does not read its replies
}

} // namespace detail

bool ws_listen(unsigned port, const std::vector<std::string> &extra_origins, std::string &error)
{
  Server &s = server();
  ws_stop();
  int fd = socket(AF_INET, SOCK_STREAM, 0);
  if (fd < 0)
  {
    error = std::string("cannot create the socket: ") + strerror(errno);
    return false;
  }
  int on = 1;
  setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &on, sizeof(on));
  sockaddr_in addr;
  memset(&addr, 0, sizeof(addr));
  addr.sin_family = AF_INET;
  addr.sin_port = htons((uint16_t)port);
  addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK); // never reachable from another computer
  if (bind(fd, reinterpret_cast<sockaddr *>(&addr), sizeof(addr)) != 0 || listen(fd, 4) != 0)
  {
    error = "cannot listen on 127.0.0.1:" + std::to_string(port) + ": " + strerror(errno);
    close(fd);
    return false;
  }
  configure(fd);
  socklen_t len = sizeof(addr);
  getsockname(fd, reinterpret_cast<sockaddr *>(&addr), &len);
  s.listen_fd = fd;
  s.port = ntohs(addr.sin_port);
  s.extra_origins = extra_origins;
  return true;
}

void ws_stop()
{
  Server &s = server();
  drop_client(s);
  for (const Refused &r : s.refused)
    close(r.fd);
  s.refused.clear();
  if (s.listen_fd >= 0)
    close(s.listen_fd);
  s.listen_fd = -1;
  s.port = 0;
}

bool ws_active() { return server().listen_fd >= 0; }

unsigned ws_port() { return server().port; }

void ws_poll()
{
  Server &s = server();
  if (s.listen_fd < 0)
    return;
  accept_connections(s);
  service_refused(s);
  if (s.has_client)
    service_client(s);
}

namespace
{

// When ws_wait() must wake for a deadline: the client's while it is not open, and every refused socket's.
Clock::time_point wake_deadline(const Server &s, Clock::time_point wake)
{
  if (s.has_client && s.client.phase != Phase::Open)
    wake = std::min(wake, s.client.deadline);
  for (const Refused &r : s.refused)
    wake = std::min(wake, r.deadline);
  return wake;
}

// The sockets ws_wait() polls: the listener, then each refused socket (slots 1..refused.size()), then the
// client when it wants to read or write. client_slot is 0 when the client is not polled.
struct Pollset
{
  std::vector<pollfd> fds;
  size_t client_slot = 0;
};

Pollset build_pollset(const Server &s)
{
  Pollset p;
  p.fds.push_back({s.listen_fd, POLLIN, 0});
  for (const Refused &r : s.refused)
    p.fds.push_back({r.fd, POLLIN, 0});
  if (s.has_client)
  {
    short events = 0;
    if (wants_input(s.client))
      events |= POLLIN;
    if (wants_output(s.client))
      events |= POLLOUT;
    if (events)
    {
      p.client_slot = p.fds.size();
      p.fds.push_back({s.client.fd, events, 0});
    }
  }
  return p;
}

} // namespace

void ws_wait(std::chrono::microseconds limit)
{
  Server &s = server();
  if (s.listen_fd < 0)
    return;
  const auto start = Clock::now();
  const auto wake = wake_deadline(s, start + limit);
  // Input held back while the sketch was full may be processable now, with no new byte to wake poll()
  const bool backlog = s.has_client && s.client.input_blocked && !sketch_input_full();

  const size_t refused_count = s.refused.size();
  Pollset p = build_pollset(s);

  // Whole milliseconds, rounded up: the wake-up may overshoot by under 1 ms, which the
  // caller absorbs because its target is absolute. A signal or an error only cuts the wait short.
  int timeout_ms = 0;
  if (!backlog && wake > start)
    timeout_ms = (int)std::chrono::ceil<std::chrono::milliseconds>(wake - start).count();
  poll(p.fds.data(), p.fds.size(), timeout_ms);

  const auto now = Clock::now();
  bool refused_due = false;
  for (size_t i = 0; i < refused_count; i++)
    refused_due = refused_due || p.fds[1 + i].revents != 0 || now >= s.refused[i].deadline;
  if (p.fds[0].revents)
    accept_connections(s);
  if (refused_due)
    service_refused(s);
  if (s.has_client && (backlog || (p.client_slot && p.fds[p.client_slot].revents) ||
                       (s.client.phase != Phase::Open && now >= s.client.deadline)))
    service_client(s);
}

} // namespace sim
