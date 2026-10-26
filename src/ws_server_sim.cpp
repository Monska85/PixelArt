// SPDX-License-Identifier: GPL-3.0-or-later

// The simulator's WiFi transport mode: the WebSocket of the simulator stands for the board's. See include/ws_server.h.

#ifdef PIXELART_SIM

#include "ws_server.h"

#include <net_ws.h>
#include <sim.h>

#include "protocol.h"

namespace ws_server
{

namespace
{
// A close asked for while a request runs goes out after that request's reply, as on the board.
bool close_pending = false;
} // namespace

void begin() {}
void start() {}
void stop() {}

void poll()
{
  if (!sim::ws_wifi())
    return;
  if (close_pending)
  {
    close_pending = false;
    sim::ws_close_client(pixelart_net::CLOSE_POLICY);
  }
  sim::WsEvent event;
  while (sim::ws_next_event(event))
  {
    switch (event.type)
    {
    case sim::WsEvent::Type::Open:
      protocol::wifi_opened();
      break;
    case sim::WsEvent::Type::Close:
      protocol::wifi_closed();
      break;
    case sim::WsEvent::Type::Line:
      sim::ws_reply(protocol::handle_line(event.text, protocol::Transport::Wifi));
      break;
    }
    if (close_pending)
    {
      close_pending = false;
      sim::ws_close_client(pixelart_net::CLOSE_POLICY);
    }
  }
}

void close_client() { close_pending = true; }
void reap() {}

} // namespace ws_server

#endif
