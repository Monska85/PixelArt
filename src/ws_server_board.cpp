// SPDX-License-Identifier: GPL-3.0-or-later

// The protocol over WiFi on the board: the WebSocket server of esp_http_server. See include/ws_server.h.

#ifndef PIXELART_SIM

#include "ws_server.h"

#include <net_ws.h>

#include <string>

#include "network.h"
#include "protocol.h"
#include "site.h"

#include <Arduino.h>
#include <esp_http_server.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#include <lwip/sockets.h>
#include <net_handshake.h>
#include <net_holder.h>
#include <net_origin.h>
#include <net_page.h>
#include <net_watch.h>

#include <atomic>
#include <cerrno>
#include <cstring>

#include "mailbox.h"
#include "task_sync.h"

namespace ws_server
{

namespace
{

using pixelart_net::MessageAssembler;

constexpr uint16_t PORT = 80;
// The client, one more that is refused at once, and room for the handshake of the next.
constexpr size_t MAX_SOCKETS = 4;
// A request is answered within a frame and a validation, a deletion of many files within seconds.
constexpr uint32_t REPLY_WAIT_MS = 20000;
constexpr TickType_t EVENT_WAIT = pdMS_TO_TICKS(1000);
constexpr size_t SERVER_STACK_BYTES = 5120;
// A control frame carries at most this many bytes (RFC 6455).
constexpr size_t MAX_CONTROL_PAYLOAD = 125;
// A client that vanished without closing (WiFi lost) frees the slot after about this long.
constexpr int KEEP_ALIVE_IDLE_S = 15;
constexpr int KEEP_ALIVE_INTERVAL_S = 5;
constexpr int KEEP_ALIVE_COUNT = 3;
const char BUSY_RESPONSE[] = "HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n";

// The page at `/` is made once, when the server starts: the texts and headers are in lib/PixelNet, so a
// request allocates nothing.
char page[pixelart_net::PAGE_CAPACITY];
size_t page_size = 0;
std::string site_origin;

// What the server task tells the loop task. A line is at most one message long.
struct Event
{
  enum class Type : uint8_t
  {
    Open,
    Line,
    Close
  };
  Type type;
  uint16_t size;
  uint32_t id; // of a Line: the reply carries it back
  char text[pixelart_net::MAX_MESSAGE];
};

Mailbox<Event, 3> to_loop;

// The reply to the line `reply_id`, handed from the loop task to the server task through the semaphore.
StaticSemaphore_t reply_semaphore_storage;
SemaphoreHandle_t reply_ready = nullptr;
std::string reply_text;
std::atomic<uint32_t> reply_id{0};

// The network task starts and stops the server; the loop task and the server's own task read the handle.
std::atomic<httpd_handle_t> server{nullptr};
// The socket of the client that holds the single slot, from its handshake until its session ends.
std::atomic<int> client_fd{-1};
// Which client holds the slot: it changes with every claim, as lwIP gives a new client the lowest free
// socket number, which is usually the one of the client before. The server task writes it before it
// publishes the socket in client_fd.
std::atomic<uint32_t> client_generation{0};

// Whether the network login is on and the client has not logged in: the loop task publishes it for the
// network task, which closes a client that stays in that state too long.
std::atomic<bool> login_pending{false};
pixelart_net::ConnectionWatch watch; // the network task only

// Only the server task touches these.
MessageAssembler assembler;
pixelart_net::HolderCheck holder_check;
uint8_t payload[pixelart_net::MAX_MESSAGE];
uint32_t next_id = 1;

// The close frame another task sends: the status is the same for every such close.
uint8_t close_payload[2] = {pixelart_net::CLOSE_POLICY >> 8, pixelart_net::CLOSE_POLICY & 0xFF};

// The request head of each socket that has not finished its handshake. The server answers a handshake
// without calling the URI handler, so the board reads the head as it is received and acts when the
// answer is sent. The server task only.
struct Handshake
{
  int fd = -1;
  pixelart_net::HeadScanner head;
};
Handshake handshakes[MAX_SOCKETS];

// The socket on_open has just refused. The server ends its session, which calls on_close, and then closes the
// socket itself, so on_close must not close it too: a second close could hit a socket another task has opened
// with the same number in between. The server task only.
int refused_fd = -1;

Handshake *handshake_of(int fd)
{
  for (Handshake &h : handshakes)
    if (h.fd == fd)
      return &h;
  return nullptr;
}

// The result of a socket call as the server expects it from its own send and receive functions.
int socket_result(int result)
{
  if (result >= 0)
    return result;
  if (errno == EAGAIN || errno == EINTR)
    return HTTPD_SOCK_ERR_TIMEOUT;
  return errno == EINVAL ? HTTPD_SOCK_ERR_INVALID : HTTPD_SOCK_ERR_FAIL;
}

// Closes a socket whose handshake has just been answered, before any of its messages is read.
void close_after_handshake(int fd, uint16_t code)
{
  const uint8_t frame[4] = {0x88, 2, (uint8_t)(code >> 8), (uint8_t)(code & 0xFF)}; // FIN, close, status
  lwip_send(fd, frame, sizeof(frame), 0);
  if (httpd_handle_t handle = server.load())
    httpd_sess_trigger_close(handle, fd);
}

void send_close(httpd_req_t *req, uint16_t code)
{
  uint8_t status[2] = {(uint8_t)(code >> 8), (uint8_t)(code & 0xFF)};
  httpd_ws_frame_t frame = {};
  frame.type = HTTPD_WS_TYPE_CLOSE;
  frame.payload = status;
  frame.len = sizeof(status);
  httpd_ws_send_frame(req, &frame);
}

// Ends the connection after a close frame. Returning an error from the handler makes the server close
// the socket.
esp_err_t refuse(httpd_req_t *req, uint16_t code)
{
  send_close(req, code);
  return ESP_FAIL;
}

// Runs once the server has answered the handshake of `fd`, so a connection that is not allowed has been
// accepted by then: it is closed before any of its messages is read or run.
void on_handshake(int fd, const pixelart_net::HeadScanner &head)
{
  if (!head.origin_allowed(site_origin.c_str()))
    return close_after_handshake(fd, pixelart_net::CLOSE_POLICY);

  // Only the server task claims the slot, so a slot seen free stays free until the store below.
  if (client_fd.load() >= 0)
    return close_after_handshake(fd, pixelart_net::CLOSE_TRY_LATER);
  client_generation.store(client_generation.load() + 1);
  client_fd = fd;

  holder_check.reset();
  assembler.reset();
  xSemaphoreTake(reply_ready, 0); // an answer to a line of an earlier connection
  Event open = {};
  open.type = Event::Type::Open;
  if (!to_loop.send(open, EVENT_WAIT))
    close_after_handshake(fd, pixelart_net::CLOSE_INTERNAL_ERROR);
}

// The socket functions of every session: they pass every byte through and, until the handshake is
// answered, show the head and the answer to the handshake.
int receive_head(httpd_handle_t, int fd, char *buf, size_t size, int flags)
{
  const int received = socket_result(lwip_recv(fd, buf, size, flags));
  Handshake *h = handshake_of(fd);
  if (h && received > 0 && !(flags & MSG_PEEK))
    h->head.feed(buf, received);
  return received;
}

int send_head(httpd_handle_t, int fd, const char *buf, size_t size, int flags)
{
  const int sent = socket_result(lwip_send(fd, buf, size, flags));
  Handshake *h = handshake_of(fd);
  if (h && sent == (int)size && pixelart_net::is_handshake_answer(buf, size))
  {
    h->fd = -1;
    on_handshake(fd, h->head);
  }
  return sent;
}

// Hands a line to the loop task and sends back its reply. False when the connection cannot go on.
bool run_line(httpd_req_t *req)
{
  static Event event;
  event.type = Event::Type::Line;
  event.size = (uint16_t)assembler.line_size();
  event.id = next_id++;
  memcpy(event.text, assembler.line(), event.size);
  if (!to_loop.send(event, EVENT_WAIT))
    return false;

  const TickType_t start = xTaskGetTickCount();
  for (;;)
  {
    const TickType_t elapsed = xTaskGetTickCount() - start;
    if (elapsed >= pdMS_TO_TICKS(REPLY_WAIT_MS) ||
        xSemaphoreTake(reply_ready, pdMS_TO_TICKS(REPLY_WAIT_MS) - elapsed) != pdTRUE)
      return false;
    if (reply_id.load() == event.id)
      break; // another id is the late answer to a line of a connection that is gone
  }
  if (reply_text.empty())
    return true; // not a protocol line: nothing to answer
  httpd_ws_frame_t frame = {};
  frame.type = HTTPD_WS_TYPE_TEXT;
  frame.payload = reinterpret_cast<uint8_t *>(&reply_text[0]);
  frame.len = reply_text.size();
  const bool sent = httpd_ws_send_frame(req, &frame) == ESP_OK;
  reply_text.clear();
  return sent;
}

esp_err_t on_frame(httpd_req_t *req)
{
  holder_check.heard(); // any frame shows the client is alive
  httpd_ws_frame_t frame = {};
  if (httpd_ws_recv_frame(req, &frame, 0) != ESP_OK)
    return refuse(req, pixelart_net::CLOSE_PROTOCOL_ERROR); // also a frame the client did not mask
  if (frame.type == HTTPD_WS_TYPE_PONG)
  {
    // The server passes pongs on (ping and close it answers itself). An unsolicited pong is allowed, so it is
    // read whole and ignored, without touching a message that is in progress.
    if (frame.len > MAX_CONTROL_PAYLOAD)
      return refuse(req, pixelart_net::CLOSE_PROTOCOL_ERROR);
    frame.payload = payload;
    if (frame.len > 0 && httpd_ws_recv_frame(req, &frame, sizeof(payload)) != ESP_OK)
      return ESP_FAIL;
    return ESP_OK;
  }
  if (frame.type > HTTPD_WS_TYPE_BINARY)
    return refuse(req, pixelart_net::CLOSE_PROTOCOL_ERROR); // a reserved data opcode

  using Kind = pixelart_net::FrameKind;
  if (assembler.begin_frame((Kind)frame.type, frame.len) == MessageAssembler::Result::Close)
    return refuse(req, assembler.code()); // nothing of a too long payload is read
  frame.payload = payload;
  if (frame.len > 0 && httpd_ws_recv_frame(req, &frame, sizeof(payload)) != ESP_OK)
    return ESP_FAIL;

  switch (assembler.end_frame(frame.final, payload, frame.len))
  {
  case MessageAssembler::Result::More:
    return ESP_OK;
  case MessageAssembler::Result::Close:
    return refuse(req, assembler.code());
  case MessageAssembler::Result::Line:
    return run_line(req) ? ESP_OK : refuse(req, pixelart_net::CLOSE_INTERNAL_ERROR);
  }
  return ESP_FAIL;
}

// The server calls it for the frames of a WebSocket, and for a request that is not a handshake.
esp_err_t handle_ws(httpd_req_t *req)
{
  if (httpd_ws_get_fd_info(server.load(), httpd_req_to_sockfd(req)) != HTTPD_WS_CLIENT_WEBSOCKET)
  {
    httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "WebSocket only");
    return ESP_FAIL;
  }
  if (httpd_req_to_sockfd(req) != client_fd.load())
    return ESP_FAIL;
  return on_frame(req);
}

// Sends one of the answers of lib/PixelNet with its headers. The connection is closed afterwards: the
// handler returns ESP_FAIL, which makes the server close the socket.
esp_err_t send_answer(httpd_req_t *req, pixelart_net::Answer answer, const char *body, size_t body_size)
{
  const pixelart_net::Response &response = pixelart_net::response_for(answer);
  httpd_resp_set_status(req, response.status);
  httpd_resp_set_type(req, response.content_type);
  for (const pixelart_net::Header &header : pixelart_net::INERT_HEADERS)
    httpd_resp_set_hdr(req, header.name, header.value);
  if (response.allow)
    httpd_resp_set_hdr(req, "Allow", response.allow);
  httpd_resp_send(req, body, body_size);
  return ESP_FAIL;
}

// GET /: the page.
esp_err_t handle_page(httpd_req_t *req) { return send_answer(req, pixelart_net::Answer::Page, page, page_size); }

// Any other unknown path: a short plain text instead of the server's default message.
esp_err_t handle_not_found(httpd_req_t *req, httpd_err_code_t)
{
  const char *body = pixelart_net::response_for(pixelart_net::Answer::NotFound).body;
  return send_answer(req, pixelart_net::Answer::NotFound, body, strlen(body));
}

// A method other than GET on `/` or `/ws`.
esp_err_t handle_method_not_allowed(httpd_req_t *req, httpd_err_code_t)
{
  const char *body = pixelart_net::response_for(pixelart_net::Answer::MethodNotAllowed).body;
  return send_answer(req, pixelart_net::Answer::MethodNotAllowed, body, strlen(body));
}

// A client that holds the slot can stall without the board noticing, and then it keeps out every other client.
// Each refusal on its account moves a check on: a ping to the holder, and a close if nothing came back within
// PONG_WAIT_MS by the next refusal. The refused client is not let in at once, its next try is.
void check_holder(httpd_handle_t handle, int holder_fd)
{
  using Action = pixelart_net::HolderCheck::Action;
  switch (holder_check.refused((uint32_t)millis()))
  {
  case Action::Ping:
  {
    // The server's ping, already framed: FIN and ping opcode, an empty payload, no mask. It is written without
    // blocking, so a holder that does not read cannot stall the server task for the send timeout: a send that does
    // not take the whole frame means the holder is not reading.
    const auto &ping = pixelart_net::PING_FRAME;
    if (lwip_send(holder_fd, ping, sizeof(ping), MSG_DONTWAIT) != (int)sizeof(ping))
      httpd_sess_trigger_close(handle, holder_fd);
    break;
  }
  case Action::Wait:
    break;
  case Action::Close:
    httpd_sess_trigger_close(handle, holder_fd);
    break;
  }
}

// A new connection is refused with 503 while a client holds the slot and while a TLS connection is open,
// which leaves no memory to spare. It runs on a socket that has just been accepted, before any byte is read.
esp_err_t on_open(httpd_handle_t handle, int fd)
{
  Handshake *h = handshake_of(-1);
  const int holder_fd = client_fd.load();
  if (holder_fd >= 0 || task_sync::network_holds_lock() || !h)
  {
    if (holder_fd >= 0)
      check_holder(handle, holder_fd);
    lwip_send(fd, BUSY_RESPONSE, sizeof(BUSY_RESPONSE) - 1, MSG_DONTWAIT);
    refused_fd = fd;
    return ESP_FAIL;
  }
  h->fd = fd;
  h->head.reset();
  httpd_sess_set_recv_override(handle, fd, receive_head);
  httpd_sess_set_send_override(handle, fd, send_head);
  return ESP_OK;
}

// Runs for every session that ends, whoever ended it. The server leaves closing the socket to this function,
// except for a socket on_open refused.
void on_close(httpd_handle_t, int fd)
{
  if (fd == refused_fd)
  {
    refused_fd = -1;
    return;
  }
  if (Handshake *h = handshake_of(fd))
    h->fd = -1;
  if (client_fd.load() == fd)
  {
    Event closed = {};
    closed.type = Event::Type::Close;
    to_loop.send(closed, EVENT_WAIT); // the next Open resets the login too, should this one be lost
    client_fd = -1;
    holder_check.reset();
  }
  lwip_close(fd);
}

void after_close_frame(esp_err_t, int fd, void *)
{
  if (httpd_handle_t handle = server.load())
    httpd_sess_trigger_close(handle, fd);
}

} // namespace

void begin()
{
  reply_ready = xSemaphoreCreateBinaryStatic(&reply_semaphore_storage);
  page_size = pixelart_net::render_page(page, sizeof(page), site::URL);
  site_origin = pixelart_net::site_origin_of(site::URL);
}

void start()
{
  if (server.load())
    return;
  httpd_config_t config = HTTPD_DEFAULT_CONFIG();
  config.server_port = PORT;
  config.stack_size = SERVER_STACK_BYTES;
  config.max_open_sockets = MAX_SOCKETS;
  config.max_uri_handlers = 2;     // /ws and /
  config.lru_purge_enable = false; // a flood of connections never evicts the client
  config.recv_wait_timeout = 5;    // a request that stays incomplete is dropped after this many seconds
  config.send_wait_timeout = 5;
  config.keep_alive_enable = true;
  config.keep_alive_idle = KEEP_ALIVE_IDLE_S;
  config.keep_alive_interval = KEEP_ALIVE_INTERVAL_S;
  config.keep_alive_count = KEEP_ALIVE_COUNT;
  config.open_fn = on_open;
  config.close_fn = on_close;
  httpd_handle_t started = nullptr;
  if (httpd_start(&started, &config) != ESP_OK)
  {
    Serial.printf("pixelart: the WebSocket server did not start\n");
    return;
  }
  server = started;
  httpd_uri_t uri = {};
  uri.uri = "/ws";
  uri.method = HTTP_GET;
  uri.handler = handle_ws;
  uri.is_websocket = true;
  httpd_uri_t page_uri = {};
  page_uri.uri = "/";
  page_uri.method = HTTP_GET;
  page_uri.handler = handle_page;
  if (httpd_register_uri_handler(started, &uri) != ESP_OK || httpd_register_uri_handler(started, &page_uri) != ESP_OK ||
      httpd_register_err_handler(started, HTTPD_404_NOT_FOUND, handle_not_found) != ESP_OK ||
      httpd_register_err_handler(started, HTTPD_405_METHOD_NOT_ALLOWED, handle_method_not_allowed) != ESP_OK)
  {
    server = nullptr;
    httpd_stop(started);
  }
}

void stop()
{
  httpd_handle_t stopping = server.exchange(nullptr);
  if (stopping)
    httpd_stop(stopping); // ends every session, and on_close tells the loop task
}

void poll()
{
  static Event event;
  static std::string line;
  login_pending = protocol::wifi_login_pending();
  for (int handled = 0; handled < 4 && to_loop.receive(event, 0); handled++)
  {
    switch (event.type)
    {
    case Event::Type::Open:
      protocol::wifi_opened();
      break;
    case Event::Type::Close:
      protocol::wifi_closed();
      break;
    case Event::Type::Line:
      line.assign(event.text, event.size);
      reply_text = protocol::handle_line(line, protocol::Transport::Wifi);
      reply_id = event.id;
      xSemaphoreGive(reply_ready);
      break;
    }
  }
}

void reap()
{
  httpd_handle_t handle = server.load();
  if (!handle)
    return;
  int open[pixelart_net::ConnectionWatch::MAX_SOCKETS];
  size_t count = pixelart_net::ConnectionWatch::MAX_SOCKETS;
  if (httpd_get_client_list(handle, &count, open) != ESP_OK)
    return;
  int expired[pixelart_net::ConnectionWatch::MAX_SOCKETS + 1];
  // The socket first, then the generation: a claim in between shows as a new client, never as the old one.
  const int slot = client_fd.load();
  const uint32_t generation = client_generation.load();
  const size_t closing = watch.check(open, count, slot, generation, login_pending.load(), (uint32_t)millis(), expired,
                                     sizeof(expired) / sizeof(expired[0]));
  for (size_t i = 0; i < closing; i++)
    httpd_sess_trigger_close(handle, expired[i]);
}

void close_client()
{
  const int fd = client_fd.load();
  httpd_handle_t handle = server.load();
  if (fd < 0 || !handle)
    return;
  httpd_ws_frame_t frame = {};
  frame.type = HTTPD_WS_TYPE_CLOSE;
  frame.payload = close_payload;
  frame.len = sizeof(close_payload);
  // The close frame goes out in the server task, after the handler that may be waiting for its reply.
  if (httpd_ws_send_data_async(handle, fd, &frame, after_close_frame, nullptr) != ESP_OK)
    httpd_sess_trigger_close(handle, fd);
}

} // namespace ws_server

#endif
