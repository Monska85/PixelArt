# SPDX-License-Identifier: GPL-3.0-or-later
"""Tests for tools/ws_bridge.py, the simulator's WebSocket, and for the simulator's --ws.

Run with: python3 -m unittest discover -s tools   (part of `make check`)
"""

import asyncio
import base64
import contextlib
import hashlib
import hmac
import json
import logging
import os
import select
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import zlib
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

import ws_bridge  # noqa: E402

try:
    from websockets.exceptions import ConnectionClosed, InvalidStatus
    from websockets.sync.client import connect
except ImportError:
    connect = None

ROOT = Path(__file__).resolve().parent.parent
SIMULATOR = Path(os.environ.get("PIXELART_SIM", ROOT / ".pio/build/native/program"))
KEY = "dGhlIHNhbXBsZSBub25jZQ=="  # the example of RFC 6455
ACCEPT = "s3pPLMBiTxaQ9kYGzzhZRbK+xOo="
DOT = (b'{"format":"pixelart/1","name":"Dot","canvas":{"width":16,"height":16},'
       b'"sprites":{"dot":{"points":[[7,7,"#ff0000"]]}},"timeline":[{"show":["dot"]}]}')


def frame(opcode, payload, fin=True, mask=True):
    """A client frame, masked unless `mask` is False."""
    payload = payload.encode() if isinstance(payload, str) else payload
    head = bytes([(0x80 if fin else 0) | opcode])
    bit = 0x80 if mask else 0
    head += bytes([bit | len(payload)]) if len(payload) < 126 else bytes([bit | 126]) + struct.pack("!H", len(payload))
    if not mask:
        return head + payload
    key = b"\x37\xfa\x21\x3d"
    return head + key + bytes(b ^ key[i % 4] for i, b in enumerate(payload))


class RawClient:
    """A socket that speaks RFC 6455 by hand, for what a well-behaved client never sends."""

    def __init__(self, port):
        self.sock = socket.create_connection(("127.0.0.1", port), timeout=3)
        self.rx = b""

    def close(self):
        self.sock.close()

    def _fill(self):
        data = self.sock.recv(65536)
        if not data:
            raise EOFError
        self.rx += data

    def handshake(self, headers="Origin: http://localhost:5173\r\n", path="/"):
        """Sends the opening request and returns the status line of the response."""
        self.sock.sendall(f"GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                          f"Sec-WebSocket-Key: {KEY}\r\nSec-WebSocket-Version: 13\r\n{headers}\r\n".encode())
        while b"\r\n\r\n" not in self.rx:
            self._fill()
        head, self.rx = self.rx.split(b"\r\n\r\n", 1)
        self.head = head.decode()
        return self.head.split("\r\n")[0]

    def read_frame(self):
        """The next server frame as (opcode, payload)."""
        while True:
            if len(self.rx) >= 2:
                length, start = self.rx[1] & 0x7F, 2
                if length == 126 and len(self.rx) >= 4:
                    length, start = struct.unpack("!H", self.rx[2:4])[0], 4
                if length < 126 or start == 4:
                    if len(self.rx) >= start + length:
                        opcode, payload = self.rx[0] & 0x0F, self.rx[start:start + length]
                        self.rx = self.rx[start + length:]
                        return opcode, payload
            self._fill()

    def read_close(self):
        opcode, payload = self.read_frame()
        assert opcode == 8, f"opcode {opcode}"
        return struct.unpack("!H", payload[:2])[0]

    def ended(self, timeout=3.0):
        """True once the server ended the connection."""
        self.sock.settimeout(timeout)
        try:
            while True:
                self._fill()
        except (EOFError, ConnectionError):
            return True
        except socket.timeout:
            return False


@unittest.skipIf(connect is None, "needs the websockets package")
class BridgeHarness(unittest.TestCase):
    """The bridge on a free port, with the test in the simulator's place on the other end of its pipes."""

    def setUp(self):
        logging.getLogger("websockets").addHandler(logging.NullHandler())
        logging.getLogger("websockets").propagate = False
        self.pending = b""

    def start(self, origins=(), wifi=False):
        to_read, to_write = os.pipe()
        from_read, from_write = os.pipe()

        def serve():
            with open(to_read, "rb", buffering=0) as stdin, open(from_write, "wb", buffering=0) as stdout:
                asyncio.run(ws_bridge.run(0, list(origins), stdin, stdout, wifi))

        thread = self.thread = threading.Thread(target=serve, daemon=True)
        thread.start()
        self.to_bridge = open(to_write, "wb", buffering=0)
        self.from_bridge = open(from_read, "rb", buffering=0)
        self.addCleanup(self.from_bridge.close)
        self.addCleanup(thread.join, 5)
        self.addCleanup(self.to_bridge.close)  # the end of its input stops the bridge
        ready = self.request(5)
        self.assertTrue(ready.startswith("ready "), ready)
        self.port = int(ready.split()[1])
        self.url = f"ws://127.0.0.1:{self.port}"

    def request(self, timeout=2.0):
        """The next line the bridge hands to the simulator, or None."""
        deadline = time.monotonic() + timeout
        while b"\n" not in self.pending:
            left = deadline - time.monotonic()
            if left <= 0 or not select.select([self.from_bridge], [], [], left)[0]:
                return None
            self.pending += os.read(self.from_bridge.fileno(), 65536)
        line, self.pending = self.pending.split(b"\n", 1)
        return line.decode()

    def reply(self, line):
        self.to_bridge.write(line.encode() + b"\n")

    def client(self, **options):
        with contextlib.ExitStack() as stack:
            ws = stack.enter_context(connect(self.url, compression=None, ping_interval=None, **options))
            self.addCleanup(stack.pop_all().close)
        return ws

    def raw(self):
        c = RawClient(self.port)
        self.addCleanup(c.close)
        return c

    def status(self, **options):
        """The HTTP status of a refused handshake, or 101."""
        try:
            self.client(**options).close()
            return 101
        except InvalidStatus as e:
            return e.response.status_code


class BridgeTest(BridgeHarness):
    def test_handshake_is_accepted_on_any_path(self):
        self.start()
        for path in ("/", "/any/path?x=1"):
            c = self.raw()
            self.assertEqual(c.handshake(path=path), "HTTP/1.1 101 Switching Protocols")
            self.assertIn(f"Sec-WebSocket-Accept: {ACCEPT}", c.head)
            c.close()
            self.assertTrue(self.slot_is_free())

    def slot_is_free(self):
        """True once a new client is served (the slot frees a moment after a close)."""
        for _ in range(100):
            try:
                self.client().close()
                return True
            except InvalidStatus:
                time.sleep(0.02)
        return False

    def test_allowed_origins(self):
        self.start(["https://example.org"])
        for origin in (None, "http://localhost", "http://localhost:5173", "http://127.0.0.1", "http://127.0.0.1:8080",
                       "https://monska85.github.io", "https://example.org"):
            with self.subTest(origin=origin):
                self.assertEqual(self.status(origin=origin), 101)

    def test_other_origins_get_403(self):
        self.start()
        for origin in ("https://evil.example", "http://localhost.evil.example", "http://localhostx", "http://localhost:",
                       "http://localhost:80a", "http://127.0.0.1.evil.example",
                       "https://monska85.github.io.evil.example", "http://monska85.github.io", "null", "file://",
                       "https://example.org"):
            with self.subTest(origin=origin):
                self.assertEqual(self.status(origin=origin), 403)
        # An empty Origin header is present, so it is not "no origin".
        self.assertEqual(self.raw().handshake("Origin:\r\n"), "HTTP/1.1 403 Forbidden")

    def test_request_and_reply_lines(self):
        self.start()
        ws = self.client()
        ws.send("@PR 3c250228 {\"seq\":1,\"cmd\":\"info\"}")
        self.assertEqual(self.request(), "@PR 3c250228 {\"seq\":1,\"cmd\":\"info\"}")
        self.reply("@PR 00000000 {\"seq\":1}")
        self.assertEqual(ws.recv(timeout=2), "@PR 00000000 {\"seq\":1}")

    def test_server_options(self):
        import websockets.asyncio.server

        with mock.patch.object(websockets.asyncio.server, "serve", wraps=websockets.asyncio.server.serve) as serve:
            self.start()
        args, options = serve.call_args
        self.assertEqual(args[1], "127.0.0.1")  # loopback only
        # Plain RFC 6455 with the documented timeouts: no compression and no keepalive pings
        self.assertEqual((options["compression"], options["ping_interval"]), (None, None))
        self.assertEqual((options["open_timeout"], options["close_timeout"]), (5.0, 1.0))
        self.assertEqual(options["max_size"], 1024)

    def test_a_client_that_reads_gets_more_than_the_output_cap_in_total(self):
        self.start()
        ws = self.client()
        line = "x" * 1000
        for _ in range(300):  # about 300 KiB in all, over the 256 KiB cap on unread replies
            self.reply(line)
            self.assertEqual(ws.recv(timeout=2), line)

    def test_the_bridge_ends_when_its_input_closes_while_a_write_waits(self):
        self.start()
        ws = self.client()
        # Nobody reads the requests: about 200 KiB fill the pipe and the bridge's own buffer, then a write waits
        for _ in range(200):
            ws.send("@PR 00000000 " + "x" * 1000)
        time.sleep(0.5)
        self.to_bridge.close()  # the simulator stops
        self.thread.join(5)
        self.assertFalse(self.thread.is_alive(), "the bridge did not end")

    def test_the_client_is_closed_with_1001_when_the_simulator_stops(self):
        self.start()
        ws = self.client()
        self.to_bridge.close()  # the simulator stops
        with self.assertRaises(ConnectionClosed) as closed:
            ws.recv(timeout=5)
        self.assertEqual(closed.exception.rcvd.code, 1001)

    def test_the_blocking_mode_of_the_pipes_is_restored(self):
        to_read, to_write = os.pipe()
        from_read, from_write = os.pipe()
        for fd in (to_read, from_read, from_write):
            self.addCleanup(os.close, fd)
        stdin, stdout = mock.Mock(fileno=lambda: to_read), mock.Mock(fileno=lambda: from_write)
        thread = threading.Thread(target=lambda: asyncio.run(ws_bridge.run(0, [], stdin, stdout)), daemon=True)
        thread.start()
        with open(from_read, "rb", buffering=0, closefd=False) as replies:
            self.assertTrue(replies.readline().startswith(b"ready "))
        os.close(to_write)  # the simulator stops
        thread.join(5)
        self.assertFalse(thread.is_alive())
        self.assertTrue(os.get_blocking(to_read))
        self.assertTrue(os.get_blocking(from_write))

    def test_lines_without_a_client_are_dropped(self):
        self.start()
        self.reply("@PR early")
        time.sleep(0.1)
        ws = self.client()
        self.reply("@PR late")
        self.assertEqual(ws.recv(timeout=2), "@PR late")

    def test_second_client_is_refused_until_the_first_closes(self):
        self.start()
        first = self.client()
        c = self.raw()
        c.sock.sendall(b"GET / HTTP/1.1\r\nHost: x\r\n\r\n")  # 503 whatever the request
        self.assertTrue(c.ended())
        self.assertTrue(c.rx.startswith(b"HTTP/1.1 503 Service Unavailable\r\n"), c.rx)
        first.send("still here")  # the first client still works
        self.assertEqual(self.request(), "still here")
        first.close()
        self.assertTrue(self.slot_is_free())

    def test_a_dropped_connection_frees_the_slot(self):
        self.start()
        c = self.raw()
        c.handshake()
        c.close()
        self.assertTrue(self.slot_is_free())

    def test_fragments_are_reassembled_and_pings_answered(self):
        self.start()
        c = self.raw()
        c.handshake()
        c.sock.sendall(frame(1, "@PR ab", fin=False) + frame(9, "mid") + frame(0, "cd", fin=False) + frame(0, "ef"))
        self.assertEqual(c.read_frame(), (10, b"mid"))
        self.assertEqual(self.request(), "@PR abcdef")

    def test_the_longest_line_is_accepted(self):
        self.start()
        ws = self.client()
        ws.send("a" * 1024)
        self.assertEqual(self.request(), "a" * 1024)

    def test_close_codes(self):
        self.start()
        cases = [
            ("message over 1,024 bytes", frame(1, "a" * 1025), 1009),
            ("fragments over 1,024 bytes", frame(1, "a" * 600, fin=False) + frame(0, "a" * 600), 1009),
            ("binary message", frame(2, b"\x01\x02"), 1003),
            ("newline in a message", frame(1, "one\ntwo"), 1008),
            ("invalid UTF-8", frame(1, b"\xff\xfe"), 1007),
            ("unmasked frame", frame(1, "x", mask=False), 1002),
            ("continuation without a message", frame(0, "x"), 1002),
            ("new message inside one", frame(1, "ab", fin=False) + frame(1, "cd"), 1002),
            ("fragmented control frame", frame(9, "x", fin=False), 1002),
            ("reserved opcode", frame(3, "x"), 1002),
        ]
        for name, data, code in cases:
            with self.subTest(name):
                c = self.raw()
                self.assertEqual(c.handshake(), "HTTP/1.1 101 Switching Protocols")
                c.sock.sendall(data)
                self.assertEqual(c.read_close(), code)
                c.close()
                self.assertTrue(self.slot_is_free())
        self.assertIsNone(self.request(0.1))  # nothing reached the simulator

    def test_close_handshake_echoes_the_status(self):
        self.start()
        c = self.raw()
        c.handshake()
        c.sock.sendall(frame(8, b"\x0b\xb8bye"))  # 3000
        self.assertEqual(c.read_close(), 3000)
        self.assertTrue(c.ended())

    def test_a_silent_connection_is_dropped_after_the_handshake_timeout(self):
        with mock.patch.object(ws_bridge, "HANDSHAKE_TIMEOUT", 0.3):
            self.start()
        c = self.raw()
        start = time.monotonic()
        self.assertTrue(c.ended(5))
        self.assertLess(time.monotonic() - start, 3)

    def test_a_client_that_does_not_read_its_replies_is_dropped(self):
        self.start()
        c = self.raw()
        c.handshake()
        time.sleep(0.1)
        line = "@PR " + "r" * 1000
        for _ in range(8000):  # about 8 MB: far more than the socket buffers and the output cap hold
            self.reply(line)
        time.sleep(0.5)
        received = 0
        c.sock.settimeout(3)
        with contextlib.suppress(ConnectionError, socket.timeout):
            while chunk := c.sock.recv(65536):
                received += len(chunk)
        self.assertLess(received, 4 * 1024 * 1024)
        self.assertTrue(c.ended(0.5))

    def test_a_client_that_pings_and_never_reads_is_dropped(self):
        self.start()
        c = self.raw()
        c.handshake()
        c.sock.setblocking(False)
        out = b""
        dropped = False
        deadline = time.monotonic() + 10
        while not dropped and time.monotonic() < deadline:
            out = out or frame(9, "p" * 125) * 16
            try:
                out = out[c.sock.send(out):]
            except BlockingIOError:
                time.sleep(0.001)
            except OSError:
                dropped = True
        self.assertTrue(dropped, "the bridge kept buffering pongs for a client that never reads")


class WifiBridgeTest(BridgeHarness):
    """The bridge with --transport wifi: lines carry a prefix, and the connection's events reach the simulator."""

    def test_events_and_prefixed_lines(self):
        self.start(wifi=True)
        ws = self.client()
        self.assertEqual(self.request(), "open")
        ws.send("@PR 00000000 {}")
        self.assertEqual(self.request(), "line @PR 00000000 {}")
        ws.send("close")  # a client text that looks like an event is only a line
        self.assertEqual(self.request(), "line close")
        ws.send("open")
        self.assertEqual(self.request(), "line open")
        self.reply("reply @PR 1 {}")
        self.assertEqual(ws.recv(timeout=2), "@PR 1 {}")
        ws.close()
        self.assertEqual(self.request(), "close")

    def test_a_line_the_simulator_did_not_prefix_is_not_sent(self):
        self.start(wifi=True)
        ws = self.client()
        self.assertEqual(self.request(), "open")
        self.reply("@PR 1 {}")
        self.reply("reply two")
        self.assertEqual(ws.recv(timeout=2), "two")

    def test_the_simulator_closes_the_client_after_the_replies_before_it(self):
        self.start(wifi=True)
        ws = self.client()
        self.assertEqual(self.request(), "open")
        self.reply("reply one")
        self.reply("close 1008")
        self.assertEqual(ws.recv(timeout=2), "one")
        with self.assertRaises(ConnectionClosed) as closed:
            ws.recv(timeout=2)
        self.assertEqual(closed.exception.rcvd.code, 1008)
        self.assertEqual(self.request(), "close")

    def test_a_close_without_a_client_is_ignored(self):
        self.start(wifi=True)
        self.reply("close 1008")
        ws = self.client()
        self.assertEqual(self.request(), "open")
        self.reply("reply alive")
        self.assertEqual(ws.recv(timeout=2), "alive")

    def test_a_message_with_a_newline_closes_with_1008_and_is_not_forwarded(self):
        self.start(wifi=True)
        ws = self.client()
        self.assertEqual(self.request(), "open")
        ws.send("a\nline x")
        with self.assertRaises(ConnectionClosed):
            ws.recv(timeout=2)
        self.assertEqual(self.request(), "close")


class PipeTest(unittest.TestCase):
    """The bridge's writer to the simulator."""

    def test_writes_wait_while_the_simulator_does_not_read(self):
        read_end, write_end = os.pipe()
        self.addCleanup(os.close, read_end)
        self.addCleanup(os.close, write_end)
        os.set_blocking(write_end, False)
        line = b"r" * 1024 + b"\n"

        async def scenario():
            pipe = ws_bridge.Pipe(write_end)
            accepted = 0
            # The pipe fills, then the writer holds MAX_PENDING bytes and makes the next write wait
            while True:
                try:
                    await asyncio.wait_for(pipe.write(line), 0.2)
                except asyncio.TimeoutError:
                    break
                accepted += len(line)
                self.assertLess(accepted, 8 * 1024 * 1024, "the writer never made a write wait")
            self.assertLessEqual(len(pipe.pending), ws_bridge.MAX_PENDING + 2 * len(line))
            self.assertGreater(len(pipe.pending), ws_bridge.MAX_PENDING)
            waiting = asyncio.ensure_future(pipe.write(line))
            # Once the simulator reads, the waiting write goes on and everything arrives in order
            total, received = accepted + 2 * len(line), b""
            deadline = time.monotonic() + 5
            while len(received) < total and time.monotonic() < deadline:
                await asyncio.sleep(0.001)
                with contextlib.suppress(BlockingIOError):
                    received += os.read(read_end, 65536)
            await asyncio.wait_for(waiting, 1)
            return total, received

        os.set_blocking(read_end, False)
        total, received = asyncio.run(scenario())
        self.assertEqual(received, line * (total // len(line)))


@unittest.skipIf(connect is None, "needs the websockets package")
@unittest.skipUnless(SIMULATOR.is_file() and (ROOT / "data").is_dir(), "needs the simulator and data/ (make sim-build data)")
class SimulatorHarness(unittest.TestCase):
    """A copy of data/ for a simulator with --ws. One simulator per folder: a second one deletes the first one's upload.tmp as it starts."""

    def setUp(self):
        self.folder = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.folder, True)
        self.data = self.folder / "data"
        shutil.copytree(ROOT / "data", self.data)

    def start(self, port, env=None, options=()):
        environment = {**os.environ, "PIXELART_PYTHON": sys.executable, **(env or {})}
        # Without --live, the serial output goes to stderr next to the simulator's own messages
        process = subprocess.Popen([str(SIMULATOR), "--data", str(self.data), "--realtime", "--no-files",
                                    "--loops", "0", "--ws", str(port), *options], stdout=subprocess.DEVNULL,
                                   stderr=subprocess.PIPE, env=environment, text=True)
        self.addCleanup(process.wait, 5)
        self.addCleanup(process.stderr.close)
        self.addCleanup(process.terminate)
        return process

    @staticmethod
    def free_port():
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            return probe.getsockname()[1]

    def open(self, port):
        for _ in range(100):
            try:
                with contextlib.ExitStack() as stack:
                    ws = stack.enter_context(connect(f"ws://127.0.0.1:{port}", compression=None, ping_interval=None))
                    self.addCleanup(stack.pop_all().close)
                return ws
            except OSError:
                time.sleep(0.05)
        self.fail("the simulator's WebSocket did not open")

    @staticmethod
    def line(seq, **fields):
        body = json.dumps({"seq": seq, **fields}, separators=(",", ":"))
        return f"@PR {zlib.crc32(body.encode()):08x} {body}"

    def ask(self, ws, seq, **fields):
        ws.send(self.line(seq, **fields))
        reply = json.loads(ws.recv(timeout=5)[13:])
        self.assertEqual(reply["seq"], seq)
        return reply


class SimulatorTest(SimulatorHarness):
    """The simulator's --ws, which starts the bridge."""

    def test_info_over_the_websocket(self):
        port = self.free_port()
        self.start(port)
        ws = self.open(port)
        body = b'{"seq":7,"cmd":"info"}'
        ws.send(f"@PR {zlib.crc32(body):08x} {body.decode()}")
        reply = ws.recv(timeout=5)  # only protocol lines arrive: the boot log is not sent
        self.assertTrue(reply.startswith("@PR "), reply)
        crc, json = reply[4:12], reply[13:]
        self.assertEqual(crc, f"{zlib.crc32(json.encode()):08x}")
        self.assertIn('"seq":7,"ok":true', json)
        self.assertIn('"board":"simulator"', json)

    def test_an_upload_continues_over_a_new_connection_and_writes_the_data_folder(self):
        port = self.free_port()
        self.start(port)
        content = DOT
        ws = self.open(port)
        self.assertTrue(self.ask(ws, 1, cmd="put_begin", kind="animation", id="dot", size=len(content),
                                 sha256=hashlib.sha256(content).hexdigest())["ok"])
        self.assertEqual(self.ask(ws, 2, cmd="put_chunk", offset=0,
                                  data=base64.b64encode(content[:100]).decode())["received"], 100)
        ws.close()
        ws = self.open(port)  # a dropped connection does not end the upload
        self.assertEqual(self.ask(ws, 3, cmd="put_chunk", offset=100,
                                  data=base64.b64encode(content[100:]).decode())["received"], len(content))
        self.assertTrue(self.ask(ws, 4, cmd="put_end")["ok"])
        self.assertEqual((self.data / "animations" / "dot.json").read_bytes(), content)

    def test_log_lines_are_not_sent(self):
        # One short animation, so the playlist set below is loaded at once
        (self.data / "animations" / "dot.json").write_bytes(DOT)
        (self.data / "playlists" / "default.json").write_text(
            '{"format":"pixelart-playlist/1","name":"Dot","canvas":{"width":16,"height":16},"items":[{"animation":"dot"}]}')
        (self.data / "playlists" / "broken.json").write_text("{}")
        port = self.free_port()
        process = self.start(port)
        ws = self.open(port)
        self.assertTrue(self.ask(ws, 1, cmd="settings_set", playlist="broken")["ok"])
        with self.assertRaises(TimeoutError):
            ws.recv(timeout=1.0)
        process.terminate()
        process.wait(5)
        self.assertIn("pixelart: /playlists/broken.json", process.stderr.read())

    def test_many_requests_at_once_all_get_their_reply_in_order(self):
        port = self.free_port()
        self.start(port)
        ws = self.open(port)
        started = time.monotonic()
        self.ask(ws, 1, cmd="info")
        self.assertLess(time.monotonic() - started, 1.0)  # a request wakes the simulator up
        # About 8 KiB of requests: more than the simulator reads ahead, so it holds back and catches up.
        # put_abort has a short reply: the simulator also copies every reply to stderr, which this test
        # does not read, so long replies would fill the pipe and stop the simulator
        for seq in range(2, 202):
            ws.send(self.line(seq, cmd="put_abort"))
        for seq in range(2, 202):
            self.assertIn(f'"seq":{seq},', ws.recv(timeout=5))

    def test_the_transport_option_needs_the_websocket(self):
        process = subprocess.run([str(SIMULATOR), "--no-files", "--ws-transport", "wifi"], capture_output=True,
                                 text=True, timeout=20)
        self.assertEqual(process.returncode, 2)
        self.assertIn("--ws-transport needs --ws", process.stderr)
        process = subprocess.run([str(SIMULATOR), "--no-files", "--realtime", "--ws", "--ws-transport", "tcp"],
                                 capture_output=True, text=True, timeout=20)
        self.assertEqual(process.returncode, 2)
        self.assertIn("--ws-transport expects usb or wifi", process.stderr)

    def test_a_python_that_cannot_start_is_reported(self):
        process = self.start(self.free_port(), {"PIXELART_PYTHON": "/nonexistent/python3"})
        self.assertEqual(process.wait(10), 1)
        self.assertIn("sim: cannot start /nonexistent/python3", process.stderr.read())

    def test_a_port_in_use_is_reported(self):
        with socket.socket() as taken:
            taken.bind(("127.0.0.1", 0))
            taken.listen()
            port = taken.getsockname()[1]
            process = self.start(port)
            self.assertEqual(process.wait(10), 1)
            errors = process.stderr.read()
        self.assertIn(f"ws_bridge: cannot listen on 127.0.0.1:{port}", errors)
        self.assertIn("sim: the WebSocket bridge did not start", errors)


@unittest.skipUnless(SIMULATOR.is_file(), "needs the simulator (make sim-build)")
class SimulatorValidateTest(unittest.TestCase):
    """The simulator's --validate keeps at most 32 messages per file, as the playlist specification says."""

    def test_the_unknown_animation_warnings_of_a_playlist_stop_at_32(self):
        with tempfile.TemporaryDirectory() as folder:
            (Path(folder) / "playlists").mkdir()
            items = [{"animation": f"missing{number}"} for number in range(40)]
            playlist = {"format": "pixelart-playlist/1", "name": "Many", "canvas": {"width": 16, "height": 16},
                        "items": items}
            (Path(folder) / "playlists" / "many.json").write_text(json.dumps(playlist))
            process = subprocess.run([str(SIMULATOR), "--validate", "--data", folder], capture_output=True,
                                     text=True, timeout=20)
        self.assertEqual(process.returncode, 0)
        warnings = [line for line in process.stdout.splitlines() if " warning unknown_animation" in line]
        self.assertEqual(len(warnings), 32)


class SimulatorWifiTest(SimulatorHarness):
    """The simulator's --ws-transport wifi: the WebSocket is the board's WiFi transport."""

    TOKEN = "k3j9x0q7w2m5z8a1"

    def setUp(self):
        super().setUp()
        self.port = self.free_port()
        self.start(self.port, options=("--ws-transport", "wifi", "--token", self.TOKEN))

    def login(self, ws, seq, token=None):
        nonce = self.ask(ws, seq, cmd="auth_challenge")["nonce"]
        answer = hmac.new((token or self.TOKEN).encode(), nonce.encode(), hashlib.sha256).hexdigest()
        return self.ask(ws, seq + 1, cmd="auth", hmac=answer)

    def test_an_upload_continues_over_a_new_wifi_connection_and_writes_the_data_folder(self):
        content = DOT
        ws = self.open(self.port)
        self.assertTrue(self.ask(ws, 1, cmd="put_begin", kind="animation", id="dot", size=len(content),
                                 sha256=hashlib.sha256(content).hexdigest())["ok"])
        self.assertEqual(self.ask(ws, 2, cmd="put_chunk", offset=0,
                                  data=base64.b64encode(content[:100]).decode())["received"], 100)
        ws.close()
        ws = self.open(self.port)  # a dropped connection does not end the upload
        self.assertEqual(self.ask(ws, 3, cmd="put_chunk", offset=100,
                                  data=base64.b64encode(content[100:]).decode())["received"], len(content))
        self.assertTrue(self.ask(ws, 4, cmd="put_end")["ok"])
        self.assertEqual((self.data / "animations" / "dot.json").read_bytes(), content)

    def test_the_replies_are_those_of_the_wifi_transport(self):
        ws = self.open(self.port)
        settings = self.ask(ws, 1, cmd="settings_get")["settings"]
        self.assertNotIn("token", settings)
        self.assertFalse(settings["network_login"])
        for seq, fields in enumerate(({"cmd": "wifi_forget"}, {"cmd": "token_regenerate"},
                                      {"cmd": "delete_all", "settings": True}), 2):
            reply = self.ask(ws, seq, **fields)
            self.assertEqual(reply["error"], "usb_only", fields)
        self.assertNotIn(self.TOKEN, json.dumps(self.ask(ws, 9, cmd="status")))

    def test_with_network_login_on_the_client_logs_in_with_an_hmac(self):
        ws = self.open(self.port)
        self.assertTrue(self.ask(ws, 1, cmd="settings_set", network_login=True)["ok"])
        self.assertEqual(self.ask(ws, 2, cmd="settings_get")["error"], "unauthorized")
        self.assertTrue(self.ask(ws, 3, cmd="info")["ok"])
        self.assertEqual(self.login(ws, 4, "a1z8m5w2q7x0j9k3")["error"], "unauthorized")
        self.assertTrue(self.login(ws, 6)["ok"])
        self.assertTrue(self.ask(ws, 8, cmd="settings_get")["settings"]["network_login"])

    def test_three_failed_logins_close_the_connection_and_the_next_one_logs_in_again(self):
        ws = self.open(self.port)
        self.assertTrue(self.ask(ws, 1, cmd="settings_set", network_login=True)["ok"])
        self.assertTrue(self.login(ws, 2)["ok"])
        self.assertEqual(self.login(ws, 4, "a1z8m5w2q7x0j9k3")["error"], "unauthorized")
        self.assertEqual(self.login(ws, 6, "a1z8m5w2q7x0j9k3")["error"], "unauthorized")
        ws.send(self.line(8, cmd="auth_challenge"))
        ws.recv(timeout=5)
        ws.send(self.line(9, cmd="auth", hmac="0" * 64))
        self.assertIn('"error":"unauthorized"', ws.recv(timeout=5))
        with self.assertRaises(ConnectionClosed) as closed:
            ws.recv(timeout=5)
        self.assertEqual(closed.exception.rcvd.code, 1008)
        ws = self.open(self.port)
        self.assertEqual(self.ask(ws, 1, cmd="settings_get")["error"], "unauthorized")
        self.assertTrue(self.login(ws, 2)["ok"])
        self.assertTrue(self.ask(ws, 4, cmd="settings_get")["ok"])

    def test_the_serial_port_traffic_stays_off_the_websocket(self):
        ws = self.open(self.port)
        self.assertTrue(self.ask(ws, 1, cmd="info")["ok"])
        with self.assertRaises(TimeoutError):
            ws.recv(timeout=0.5)


if __name__ == "__main__":
    unittest.main()
