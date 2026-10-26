// SPDX-License-Identifier: GPL-3.0-or-later

// The protocol over WiFi (docs/board/wifi-and-updates-v1.md#protocol-over-wifi). On the board, a
// WebSocket server on port 80 runs in the HTTP server's own task, started and stopped by the network
// task; it passes every line to the loop task and sends the reply back. In the simulator the
// WebSocket of --ws stands for it when run with `--ws-transport wifi`.

#pragma once

#include <cstddef>

namespace ws_server
{

// Creates what the server needs. network::begin() calls it once, before the network task starts.
void begin();

// The network task calls these: start the server when WiFi has an address and stop it when WiFi is
// gone. Both can be called any number of times. The simulator has nothing to start.
void start();
void stop();

// The network task calls this every few seconds while the server runs: it closes the sockets that have
// not completed the WebSocket handshake in time and a client that has not logged in in time. The
// simulator has no such limits.
void reap();

// The loop task calls this often: it handles the requests that arrived over WiFi, one at a time like the
// serial ones, and sends their replies.
void poll();

// Closes the connection of the WiFi client, if there is one, once the replies already given are sent. Any
// task may call it.
void close_client();

} // namespace ws_server
