#!/usr/bin/env python3
"""Serves the simulator's command protocol on a WebSocket.

    python3 tools/ws_bridge.py [--port PORT] [--origin ORIGIN ...]

The simulator starts this bridge for --ws and talks to it over the bridge's
standard input and output. Each text message from the client becomes one line
on standard output, and each line read from standard input goes to the client
as one text message. The first line written is "ready PORT", once the bridge
listens. The bridge ends when its standard input closes. The WebSocket rules
are in docs/protocol/protocol-v1.md#websocket-simulator.

Needs Python 3.9+ and the websockets package, version 15 or later.
"""

import argparse
import asyncio
import http
import logging
import os
import re
import signal
import sys

MAX_MESSAGE = 1024  # the protocol's line limit
MAX_OUTPUT = 256 * 1024  # bytes queued for a client above which it is dropped
HANDSHAKE_TIMEOUT = 5.0
CLOSE_TIMEOUT = 1.0
# No Origin (command line clients), local pages on any port and the project's site. --origin adds more.
ORIGINS = [None, re.compile(r"http://(localhost|127\.0\.0\.1)(:[0-9]{1,5})?"), "https://monska85.github.io"]


class Bridge:
    """One client at a time between the WebSocket and the simulator's pipes."""

    def __init__(self, to_simulator):
        self.to_simulator = to_simulator
        self.client = None  # the connection holding the slot, from its request until it closes
        self.replies = None  # lines waiting for the open client
        self.queued = 0
        self.tasks = set()

    def process_request(self, connection, request):
        if self.client is not None:
            return connection.respond(http.HTTPStatus.SERVICE_UNAVAILABLE, "Service Unavailable\n")
        self.client = connection
        task = asyncio.ensure_future(self.free_slot(connection))
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)
        return None

    async def free_slot(self, connection):
        await connection.wait_closed()
        if self.client is connection:
            self.client = self.replies = None

    async def serve(self, connection):
        from websockets.exceptions import ConnectionClosed

        replies = self.replies = asyncio.Queue()
        self.queued = 0
        sender = asyncio.ensure_future(self.send_replies(connection, replies))
        try:
            async for message in connection:
                if isinstance(message, bytes):
                    await connection.close(1003)
                elif "\n" in message:
                    await connection.close(1008)  # one message is one line
                else:
                    self.to_simulator.write(message.encode("utf-8") + b"\n")
                    await self.to_simulator.drain()
        except ConnectionClosed:
            pass
        finally:
            sender.cancel()

    async def send_replies(self, connection, replies):
        while True:
            line = await replies.get()
            await connection.send(line)
            self.queued -= len(line)

    def reply(self, line):
        """Queues a line from the simulator for the client; dropped when no client is open."""
        if self.replies is None:
            return
        if self.queued + len(line) > MAX_OUTPUT:
            self.client.transport.abort()  # the client does not read its replies
            return
        self.queued += len(line)
        self.replies.put_nowait(line)


async def forward_replies(bridge, reader):
    pending = b""
    while True:
        chunk = await reader.read(65536)
        if not chunk:
            return
        *lines, pending = (pending + chunk).split(b"\n")
        for line in lines:
            bridge.reply(line.decode("utf-8", "replace"))


async def run(port, origins, stdin, stdout):
    """Serves until `stdin` (the simulator's replies) ends; requests go to `stdout`."""
    from websockets.asyncio.server import ServerConnection, serve

    class Connection(ServerConnection):
        def data_received(self, data):
            super().data_received(data)
            # Pongs and close echoes queue up like replies: a client that pings and never reads is dropped
            if self.transport.get_write_buffer_size() > MAX_OUTPUT:
                self.transport.abort()

    loop = asyncio.get_running_loop()
    reader = asyncio.StreamReader()
    await loop.connect_read_pipe(lambda: asyncio.StreamReaderProtocol(reader), stdin)
    transport, protocol = await loop.connect_write_pipe(asyncio.streams.FlowControlMixin, stdout)
    writer = asyncio.StreamWriter(transport, protocol, None, loop)

    bridge = Bridge(writer)
    # No compression and no keepalive pings: plain RFC 6455, as the clients expect.
    async with serve(bridge.serve, "127.0.0.1", port, origins=ORIGINS + origins, max_size=MAX_MESSAGE,
                     process_request=bridge.process_request, create_connection=Connection, compression=None,
                     open_timeout=HANDSHAKE_TIMEOUT, close_timeout=CLOSE_TIMEOUT, ping_interval=None,
                     server_header=None) as server:
        writer.write(f"ready {server.sockets[0].getsockname()[1]}\n".encode())
        await writer.drain()
        await forward_replies(bridge, reader)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Serves the simulator's command protocol on a WebSocket.")
    parser.add_argument("--port", type=int, default=8765, help="port on 127.0.0.1 (0 picks a free one)")
    parser.add_argument("--origin", action="append", default=[], help="also accept this Origin (repeatable)")
    args = parser.parse_args(argv)
    try:
        import websockets.asyncio.server  # noqa: F401
    except ImportError:
        sys.exit("ws_bridge: the simulator's --ws needs the websockets package, version 15 or later "
                 "(pip install websockets)")
    # Ctrl-C reaches the simulator too, which then closes the bridge's input
    signal.signal(signal.SIGINT, signal.SIG_IGN)
    # Refused handshakes and dropped clients are normal here: keep the terminal of --live clean
    logging.getLogger("websockets").addHandler(logging.NullHandler())
    logging.getLogger("websockets").propagate = False
    try:
        asyncio.run(run(args.port, args.origin, sys.stdin, sys.stdout))
    except OSError as e:
        sys.exit(f"ws_bridge: cannot listen on 127.0.0.1:{args.port}: {os.strerror(e.errno) if e.errno else e}")


if __name__ == "__main__":
    main()
