#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Converts animation and playlist sources (YAML or JSON) to the JSON files the board reads.

    python3 tools/pixelart.py build [--source DIR] [--out DIR] [--schema]
    python3 tools/pixelart.py board (--port DEVICE | --ws URL) [--token TOKEN] COMMAND

Reads <source>/animations/*.yaml|*.json and <source>/playlists/*.yaml|*.json and
writes compact JSON to <out>/animations/<id>.json and <out>/playlists/<id>.json,
the layout of the board's file system. The file name (without extension) is
the ID. With --schema, every file is also checked against the JSON Schemas in
schema/ (needs the jsonschema package). The full validation, including
references between sprites, runs in the engine: see `make validate`.

The board command talks to a board over USB serial (--port, needs pyserial), to
the simulator over its WebSocket (--ws ws://127.0.0.1:8765) or to a board over
WiFi (--ws ws://pixelart-XXXX.local/ws), with the protocol of
docs/protocol/protocol-v1.md. A board with network login on asks a WiFi client
to log in: give the token in the environment variable PIXELART_TOKEN (or, less
safely, as --token: other users can see a command line). The token is sent only
as an HMAC and never printed. Commands reserved for USB (wifi, token, wipe
--settings) are refused over WiFi. COMMAND is one of:

    info                           firmware, storage and limits of the board
    ls [--kind KIND]               stored animations and playlists
    put FILE [--id ID] [--kind KIND]   upload a YAML or JSON file
    get ID [--kind KIND] [-o FILE]     download a file, checked against its SHA-256
    rm ID [--kind KIND]            delete a file
    settings [key=value ...]       show or change the settings (brightness, playlist, wifi_power, update_mode, ...)
    status                         WiFi state, network name, address, signal, transmit power and update state
    update check                   check for updates now and wait for the result
    update install animations      install the animations and playlists the last check found, and wait
    update install firmware [--force]  install the firmware the last check found, and wait for the restart;
                                   --force also installs a version a rollback put on the skip list
    wifi [--forget]                set up WiFi with Improv over USB (--port only), or forget the stored network
    wipe [--settings] [--yes]      delete every animation and playlist, and with --settings reset the settings,
                                   forget the WiFi network and make a new token

The serial port can be open in one program only: close the serial monitor first.

Needs Python 3.9+ and PyYAML. --ws needs the websockets package, version 15 or later.
"""

import argparse
import base64
import getpass
import hashlib
import hmac
import json
import os
import re
import secrets
import sys
import time
import unicodedata
import urllib.parse
import zlib
from pathlib import Path

try:
    import yaml
except ImportError:
    sys.exit("pixelart: PyYAML is required (pip install pyyaml)")

ROOT = Path(__file__).resolve().parent.parent
ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]{0,31}$")
KINDS = {"animations": "pixelart-1.schema.json", "playlists": "playlist-1.schema.json"}


class StrictLoader(yaml.SafeLoader):
    """Safe YAML loader that rejects duplicate keys and keys that are not text."""


def _construct_mapping(loader, node, deep=False):
    mapping = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        if not isinstance(key, str):
            raise yaml.constructor.ConstructorError(
                None, None, f"key {key!r} is not text (YAML reads words like on, off, yes, no as true/false: quote them)",
                key_node.start_mark)
        if key in mapping:
            raise yaml.constructor.ConstructorError(None, None, f"duplicate key {key!r}", key_node.start_mark)
        mapping[key] = loader.construct_object(value_node, deep=deep)
    return mapping


StrictLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, _construct_mapping)


def load_source(path):
    text = path.read_text(encoding="utf-8")
    if path.suffix == ".json":
        return json.loads(text)
    return yaml.load(text, Loader=StrictLoader)


def compact_json(document):
    """The UTF-8 JSON of a board file, as `build` writes it and `board put` sends it."""
    text = json.dumps(document, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    try:
        return text.encode("utf-8")
    except UnicodeEncodeError as e:
        raise ValueError(f"text with a lone surrogate (U+{ord(e.object[e.start]):04X}), which UTF-8 cannot hold") from None


def build(source, out, use_schema):
    validators = {}
    if use_schema:
        try:
            import jsonschema
        except ImportError:
            sys.exit("pixelart: --schema needs the jsonschema package (pip install jsonschema)")
        for kind, schema in KINDS.items():
            validators[kind] = jsonschema.Draft202012Validator(json.loads((ROOT / "schema" / schema).read_text()))

    errors = 0
    written = 0
    for kind in KINDS:
        files = sorted(p for p in (source / kind).glob("*") if p.suffix in (".yaml", ".yml", ".json"))
        ids = {}
        for path in files:
            name = path.stem
            if not ID_PATTERN.match(name):
                print(f"{path}: invalid file name: use lowercase letters, digits, _ and -", file=sys.stderr)
                errors += 1
                continue
            if name in ids:
                print(f"{path}: same ID as {ids[name]}", file=sys.stderr)
                errors += 1
                continue
            ids[name] = path
            try:
                document = load_source(path)
                # Dates, binary values, .inf, .nan and lone surrogates have no JSON form for the board
                data = compact_json(document)
            except (yaml.YAMLError, TypeError, ValueError) as e:
                print(f"{path}: {e}", file=sys.stderr)
                errors += 1
                continue
            if kind in validators:
                problems = sorted(validators[kind].iter_errors(document), key=lambda e: list(e.absolute_path))
                for problem in problems:
                    where = ".".join(str(p) for p in problem.absolute_path) or "(root)"
                    print(f"{path}: {where}: {problem.message}", file=sys.stderr)
                if problems:
                    errors += 1
                    continue
            target = out / kind / f"{name}.json"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            written += 1
    print(f"pixelart: wrote {written} files to {out}" + (f", {errors} failed" if errors else ""))
    return 1 if errors else 0


# ---- board: command line client of the command protocol (docs/protocol/protocol-v1.md) ----

PROTOCOL_VERSION = 1
BAUD_RATE = 115200
REQUEST_TIMEOUT = 2.0  # seconds to wait for a reply
PUT_END_TIMEOUT = 10.0  # validating a large file takes longer
TRIES = 5  # sends of one request, the first included
CONNECT_DELAYS = (0.2, 0.4, 0.8, 1.6, 3.2)  # seconds waited after each refused WebSocket connection
# A reply line is at most 16 KiB (protocol-v1.md, limits): a line or a fragmented message gets that plus margin.
MAX_LINE = 64 * 1024
DEFAULT_CHUNK = 512
KIND_FOLDERS = {"animations": "animation", "playlists": "playlist"}
KIND_FORMATS = {"pixelart/1": "animation", "pixelart-playlist/1": "playlist"}
# The board's own limits (docs/protocol/protocol-v1.md, limits): the most a client accepts when the board names none.
FILE_LIMITS = {"animation": 64 * 1024, "playlist": 16 * 1024}
# Control (Cc), format (Cf, which holds the bidirectional overrides and zero-width marks), line and paragraph
# separators (Zl, Zp) and lone surrogates (Cs) change what a terminal shows or cannot be printed.
_UNSAFE_CATEGORIES = {"Cc", "Cf", "Zl", "Zp", "Cs"}
# Nesting of a reply shown() follows: a deeper value displays as "...".
MAX_SHOWN_DEPTH = 16


class BoardError(Exception):
    """A failure the user should see: printed without a traceback. Carries the board's diagnostics, if any."""

    def __init__(self, message, diagnostics=None):
        super().__init__(message)
        self.diagnostics = diagnostics


def safe(value, keep=""):
    """Text from the board for the terminal: control and formatting characters become visible escapes.

    The escapes are \\xNN, \\uNNNN and, above U+FFFF, \\UNNNNNNNN. The characters in keep pass through.
    """
    return "".join(c if c in keep or unicodedata.category(c) not in _UNSAFE_CATEGORIES else _escape(c)
                   for c in str(value))


def _escape(c):
    code = ord(c)
    if code <= 0xFF:
        return "\\x%02x" % code
    return "\\u%04x" % code if code <= 0xFFFF else "\\U%08x" % code


def shown(value, depth=0):
    """A copy of a reply value for display: every string, dict key included, goes through safe().

    Call it where board text becomes output: in a print or in the message of a BoardError. Never call it on
    data that is sent back to the board (IDs, checksums, base64, offsets): use the original there, so the
    protocol sees what the board said. A value the user typed (an ID or a path on the command line) needs no
    escaping. A container nested deeper than MAX_SHOWN_DEPTH shows as "...".
    """
    if isinstance(value, str):
        return safe(value)
    if isinstance(value, (dict, list)) and depth >= MAX_SHOWN_DEPTH:
        return "..."
    if isinstance(value, dict):
        return {safe(k): shown(v, depth + 1) for k, v in value.items()}
    if isinstance(value, list):
        return [shown(v, depth + 1) for v in value]
    return value


def encode_line(body):
    """The protocol line for a request or reply body: "@PR <crc32> <json>", without the newline."""
    payload = json.dumps(body, separators=(",", ":")).encode("utf-8")
    return b"@PR %08x " % zlib.crc32(payload) + payload


def decode_line(line):
    """The body of a protocol line, or None for a line to ignore: another kind of line, a damaged one."""
    if not line.startswith(b"@PR ") or len(line) < 14 or line[12:13] != b" ":
        return None
    digits = line[4:12]
    if not re.fullmatch(rb"[0-9a-f]{8}", digits):
        return None
    payload = line[13:]
    if zlib.crc32(payload) != int(digits, 16):
        return None
    try:
        body = json.loads(payload.decode("utf-8"))
    except (ValueError, RecursionError):  # a line nested too deep for the parser is a damaged line
        return None
    return body if isinstance(body, dict) else None


class SerialTransport:
    """The board's USB serial port: one line per message, newline added and removed here."""

    def __init__(self, device):
        try:
            import serial
        except ImportError:
            raise BoardError("--port needs pyserial (pip install pyserial; PlatformIO already includes it)")
        self._serial = serial.Serial()
        self._serial.port = device
        self._serial.baudrate = BAUD_RATE
        self._serial.timeout = 0.05
        try:
            self._serial.open()
        except (serial.SerialException, OSError) as e:
            raise BoardError(f"cannot open {device}: {e} (is the serial monitor still open?)")
        # The ESP32-C3 USB port resets the chip while RTS is high and DTR is low.
        # The port opens with both lines high, so RTS goes low first.
        self._serial.rts = False
        self._serial.dtr = False
        if hasattr(self._serial, "set_buffer_size"):  # Windows only
            self._serial.set_buffer_size(rx_size=16384, tx_size=16384)
        self._serial.reset_input_buffer()
        self._buffer = bytearray()

    def send(self, line):
        self._serial.write(line + b"\n")
        self._serial.flush()

    def send_raw(self, data):
        """Bytes as they are, with no newline: an Improv frame."""
        self._serial.write(data)
        self._serial.flush()

    def receive_raw(self, timeout):
        """The bytes that arrive within `timeout` seconds, or b"". Text the line reader already held comes first."""
        if self._buffer:
            data, self._buffer = bytes(self._buffer), bytearray()
            return data
        self._serial.timeout = timeout
        try:
            return self._serial.read(max(1, self._serial.in_waiting))
        finally:
            self._serial.timeout = 0.05

    def receive(self, timeout):
        """The next line, or None when none arrives within `timeout` seconds."""
        deadline = time.monotonic() + timeout
        while True:
            end = self._buffer.find(b"\n")
            if end >= 0:
                line = bytes(self._buffer[:end]).rstrip(b"\r")
                del self._buffer[: end + 1]
                return line
            if len(self._buffer) > MAX_LINE:
                self._buffer.clear()  # a runaway line: wait for the next newline
            if time.monotonic() >= deadline:
                return None
            self._buffer += self._serial.read(max(1, self._serial.in_waiting))

    def close(self):
        self._serial.close()


class WebSocketTransport:
    """A WebSocket of the simulator or of a board over WiFi, through the websockets package: one text message per protocol line."""

    def __init__(self, url, connect_timeout=5.0):
        parts = urllib.parse.urlsplit(url)
        if parts.scheme != "ws" or not parts.hostname:
            raise BoardError(f"--ws expects a URL like ws://127.0.0.1:8765 or ws://pixelart-XXXX.local/ws, got '{url}'")
        try:
            from websockets.exceptions import InvalidStatus, WebSocketException
            from websockets.sync.client import connect
        except ImportError:
            raise BoardError("--ws needs the websockets package, version 15 or later (pip install websockets)")
        host, port = parts.hostname, parts.port or 80
        # The simulator and the board serve one client at a time and free the slot a moment after a close. The board
        # closes a holder that stays silent for 3 seconds after its ping, so the waits double until the last try
        # comes about 6.2 seconds after the first, as in the web app.
        for delay in (*CONNECT_DELAYS, None):
            try:
                # No proxy, no compression and no keepalive pings: both speak plain RFC 6455. No Origin header, as for any command line client.
                # Entered by hand: websockets 17 deprecates a connection opened outside a with block.
                self._ws = connect(url, open_timeout=connect_timeout, close_timeout=1.0, max_size=MAX_LINE,
                                   compression=None, ping_interval=None, proxy=None).__enter__()
                return
            except InvalidStatus as e:
                status = e.response.status_code
                if status != 503:
                    raise BoardError(f"the server refused the WebSocket connection (HTTP {status})")
                if delay is not None:
                    time.sleep(delay)
            except OSError as e:
                raise BoardError(f"cannot connect to {host}:{port}: {e} (is `make serve` running, or the board on WiFi?)")
            except WebSocketException as e:
                raise BoardError(f"the WebSocket handshake failed: {e}")
        raise BoardError("the server already has a client")

    def send(self, line):
        from websockets.exceptions import WebSocketException

        try:
            self._ws.send(line.decode("utf-8"))
        except WebSocketException as e:
            raise _connection_error(e)

    def receive(self, timeout):
        """The next text message, or None when none arrives within `timeout` seconds."""
        from websockets.exceptions import WebSocketException

        try:
            message = self._ws.recv(timeout=timeout)
        except TimeoutError:
            return None
        except WebSocketException as e:
            raise _connection_error(e)
        if isinstance(message, bytes):
            raise BoardError("the server sent a binary WebSocket message: protocol lines are text messages")
        return message.encode("utf-8")

    def close(self):
        self._ws.close()


def _connection_error(error):
    """The BoardError for a WebSocket failure after the handshake."""
    from websockets.exceptions import ConnectionClosed

    if isinstance(error, ConnectionClosed):
        if error.sent is not None and error.sent.code == 1009:
            return BoardError("the server sent a WebSocket message that is too long")
        return BoardError("the server closed the WebSocket connection")
    return BoardError(f"the WebSocket connection failed: {error}")


class Board:
    """Requests and replies of the command protocol over a transport."""

    def __init__(self, transport, token=None):
        self.transport = transport
        self._token = token
        self._seq = secrets.randbelow(2**31) + 1  # a fresh run never reuses a seq the board still remembers
        info = self.request("info")
        if not info.get("ok"):
            raise BoardError(f"info failed: {describe_error(info)}")
        if info.get("protocol") != PROTOCOL_VERSION:
            raise BoardError(f"the board speaks protocol {shown(info.get('protocol'))}, this tool speaks {PROTOCOL_VERSION}")
        self.info = info
        self.limits = info.get("limits") or {}

    def request(self, cmd, timeout=REQUEST_TIMEOUT, **fields):
        """Sends a request and returns the reply body. Raises BoardError when no reply comes."""
        self._seq = (self._seq + 1) % 2**32
        seq = self._seq
        line = encode_line({"seq": seq, "cmd": cmd, **fields})
        for _ in range(TRIES):
            self.transport.send(line)
            deadline = time.monotonic() + timeout
            while True:
                remaining = deadline - time.monotonic()
                raw = self.transport.receive(remaining) if remaining > 0 else None
                if raw is None:
                    break  # timed out: send again
                reply = decode_line(raw)
                if reply is None:
                    continue
                if reply.get("error") == "bad_frame" and "seq" not in reply:
                    break  # the board did not understand the line: send again at once
                if reply.get("seq") == seq:
                    if reply.get("error") == "unauthorized" and cmd not in AUTH_COMMANDS:
                        self._log_in()
                        return self.request(cmd, timeout, **fields)
                    return reply
        raise BoardError(f"no reply to '{cmd}' after {TRIES} tries")

    def _log_in(self):
        """Answers the board's login challenge with an HMAC of the nonce under the token, once per connection."""
        if self._token is None:
            raise BoardError("the board asks for a login: give the token in PIXELART_TOKEN or with --token")
        token, self._token = self._token, None  # one try: a wrong token must not be sent again and again
        nonce = self.command("auth_challenge").get("nonce")
        if not isinstance(nonce, str):
            raise BoardError("the board sent an unexpected reply")
        reply = self.request("auth", hmac=login_hmac(token, nonce))
        if not reply.get("ok"):
            raise BoardError("the login failed: the token is not the board's")

    def command(self, cmd, timeout=REQUEST_TIMEOUT, **fields):
        """Like request(), but a failure reply raises BoardError carrying the board's diagnostics."""
        reply = self.request(cmd, timeout, **fields)
        if not reply.get("ok"):
            raise BoardError(describe_error(reply), reply.get("diagnostics"))
        return reply

    @property
    def chunk_size(self):
        return min(int(self.limits.get("chunk") or DEFAULT_CHUNK), DEFAULT_CHUNK)

    def entries(self, kind):
        """Every stored file of one kind, page by page."""
        after = None
        while True:
            fields = {"kind": kind}
            if after is not None:
                fields["after"] = after
            reply = self.command("list", **fields)
            yield from reply.get("entries", [])
            if not reply.get("more") or not reply.get("entries"):
                return
            last = reply["entries"][-1]["id"]
            if after is not None and last <= after:
                raise BoardError(f"the board repeats a page of the {kind} list: it did not move past '{shown(after)}'")
            after = last


TOKEN_PATTERN = re.compile(r"[a-z0-9]{16}")
AUTH_COMMANDS = ("auth_challenge", "auth")


def login_hmac(token, nonce):
    """The answer to a login challenge: HMAC-SHA256 with the token as the key and the nonce text as the message."""
    return hmac.new(token.encode("ascii"), nonce.encode("ascii"), hashlib.sha256).hexdigest()


def board_token(args):
    """The token from --token or PIXELART_TOKEN, or None. Never printed."""
    token = args.token if args.token is not None else os.environ.get("PIXELART_TOKEN")
    if token is not None and not TOKEN_PATTERN.fullmatch(token):
        raise BoardError("the token is 16 characters from a-z and 0-9")
    return token


def describe_error(reply):
    """The message of a failure reply, safe for the terminal."""
    reply = shown(reply)
    text = f"{reply.get('error', 'error')}: {reply.get('message', '')}".rstrip(": ")
    if reply.get("error") == "bad_offset":
        text += f" (expected offset {reply.get('expected')})"
    return text


def print_diagnostics(label, diagnostics, stream=sys.stderr):
    """Prints engine diagnostics the way `make validate` does."""
    for d in shown(diagnostics) if isinstance(diagnostics, list) else []:
        if not isinstance(d, dict):
            continue
        where = f" at {d['where']}" if d.get("where") else ""
        print(f"{label}: {d.get('severity')} {d.get('code')}{where}: {d.get('message')}", file=stream)


def infer_kind(path, document):
    """animation or playlist, from the folder the file is in, else from its `format` field."""
    kind = KIND_FOLDERS.get(path.resolve().parent.name)
    if kind is None and isinstance(document, dict):
        kind = KIND_FORMATS.get(document.get("format"))
    return kind


# The protocol spec fixes the count: a lost upload (no_upload) restarts from put_begin once.
UPLOAD_ATTEMPTS = 2


class UploadGone(BoardError):
    """The board has no upload in progress any more (no_upload): it timed out or restarted."""


# The message of busy during an upload: the board holds one upload, and its other connection has it.
UPLOAD_BUSY = "busy: the board is receiving a file over its other connection (USB or WiFi): try again when that upload ends"


def raise_for(reply):
    """Raises the error of a failure reply: UploadGone for no_upload, BoardError otherwise."""
    if reply.get("error") == "no_upload":
        raise UploadGone(describe_error(reply))
    if reply.get("error") == "busy":
        raise BoardError(UPLOAD_BUSY)
    raise BoardError(describe_error(reply), reply.get("diagnostics"))


def upload_once(board, kind, file_id, data):
    """One try at an upload: put_begin, put_chunk..., put_end. Returns the warnings of the board's validation.

    A chunk the board did not expect (bad_offset) moves the next send to the offset it names, a limited number of times.
    Raises UploadGone when the board lost the upload, and BoardError on any other failure.
    """
    reply = board.request("put_begin", kind=kind, id=file_id, size=len(data), sha256=hashlib.sha256(data).hexdigest())
    if not reply.get("ok"):
        raise_for(reply)
    offset, resumes = 0, 0
    while offset < len(data):
        chunk = data[offset : offset + board.chunk_size]
        reply = board.request("put_chunk", offset=offset, data=base64.b64encode(chunk).decode("ascii"))
        if reply.get("ok"):
            offset = reply["received"] if reply.get("received", 0) > offset else offset + len(chunk)
        elif reply.get("error") == "bad_offset" and resumes < TRIES and reply.get("expected", len(data)) < len(data):
            resumes += 1
            offset = reply["expected"]
        else:
            raise_for(reply)
    reply = board.request("put_end", PUT_END_TIMEOUT)
    if not reply.get("ok"):
        raise_for(reply)
    return reply.get("warnings", [])


def upload(board, kind, file_id, data):
    """put_begin, put_chunk..., put_end. Returns the warnings of the board's validation.

    Makes UPLOAD_ATTEMPTS tries: when the board lost the upload (no_upload), it starts again from put_begin, once.
    When it gives up, it sends put_abort.
    """
    for attempt in range(UPLOAD_ATTEMPTS):
        try:
            return upload_once(board, kind, file_id, data)
        except UploadGone:
            if attempt + 1 < UPLOAD_ATTEMPTS:
                continue
            abort_upload(board)
            raise
        except BoardError:
            abort_upload(board)
            raise


def abort_upload(board):
    try:
        board.request("put_abort")
    except BoardError:
        pass


def is_count(value):
    """A whole number of bytes from the board: an int, and not a bool, which is an int in Python."""
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def dict_of(value):
    """The value when it is a dict, else an empty dict: a board reply can have any shape."""
    return value if isinstance(value, dict) else {}


def download(board, kind, file_id):
    """The bytes of a stored file, checked against the SHA-256 that `list` reports."""
    entry = next((e for e in board.entries(kind) if e["id"] == file_id), None)
    if entry is None:
        raise BoardError(f"not_found: no {kind} '{file_id}' on the board")
    size, limit = entry["size"], board.limits.get(kind)
    if not is_count(size):
        raise BoardError(f"the board reports an invalid size for {kind} '{file_id}'")
    # The protocol's maximum caps what the board names: a larger limit is not one a client accepts.
    limit = min(limit, FILE_LIMITS[kind]) if is_count(limit) else FILE_LIMITS[kind]
    if size > limit:
        raise BoardError(f"the board reports {size} bytes for {kind} '{file_id}', above the limit of {limit}")
    data = bytearray()
    while True:
        reply = board.command("get", kind=kind, id=file_id, offset=len(data), length=board.chunk_size)
        part = base64.b64decode(reply.get("data", ""), validate=True)
        data += part
        if len(data) > size:
            raise BoardError("the board sent more bytes than the size it reported")
        if reply.get("size") != size:
            raise BoardError("the file changed while it was read: try again")
        if len(data) == size:
            break
        if not part:
            raise BoardError("the board returned no data before the end of the file")
    if hashlib.sha256(data).hexdigest() != entry["sha256"]:
        raise BoardError("the downloaded file does not match its SHA-256: try again")
    return bytes(data)


def board_info(board, args):
    i = shown(board.info)
    print(f"firmware  {i.get('firmware')}")
    print(f"board     {i.get('board')}")
    print(f"protocol  {i.get('protocol')}")
    canvas = dict_of(i.get("canvas"))
    print(f"canvas    {canvas.get('width')}x{canvas.get('height')}")
    formats = i.get("formats")
    if isinstance(formats, dict):
        formats = "; ".join(f"{k} {' '.join(map(str, v)) if isinstance(v, list) else v}" for k, v in formats.items())
    print(f"formats   {formats or ''}")
    storage = dict_of(i.get("storage"))
    print(f"storage   {storage.get('used')} of {storage.get('total')} bytes used")
    memory = dict_of(i.get("memory"))
    if memory.get("free") or memory.get("largest"):
        print(f"memory    {memory.get('free')} bytes free, largest block {memory.get('largest')}")
    else:
        print("memory    not measured")
    limits = i.get("limits")
    if isinstance(limits, dict):
        limits = ", ".join(f"{k} {v}" for k, v in limits.items())
    print(f"limits    {limits or ''}")
    return 0


def board_ls(board, args):
    for kind in [args.kind] if args.kind else ["animation", "playlist"]:
        for e in board.entries(kind):
            e = shown(e)
            # A faulty board may send an id that is not a string: the format spec needs one.
            name = f"  {e['name']}" if e.get("name") else ""
            version = f"  v{e['version']}" if "version" in e else ""
            print(f"{kind:<9}  {str(e['id']):<32}  {str(e['size']):>6} B  {str(e['sha256'])[:12]}{name}{version}")
    return 0


def board_put(board, args):
    path = args.file
    try:
        document = load_source(path)
        # The same bytes `build` writes, so the board holds what `make data` would produce.
        data = compact_json(document)
    except (OSError, yaml.YAMLError, TypeError, ValueError) as e:
        raise BoardError(f"{path}: {e}")
    kind = args.kind or infer_kind(path, document)
    if kind is None:
        raise BoardError(f"{path}: cannot tell an animation from a playlist: pass --kind")
    file_id = args.id or path.stem
    if not ID_PATTERN.match(file_id):
        raise BoardError(f"invalid ID '{file_id}': use lowercase letters, digits, _ and -, at most 32 characters (--id)")
    try:
        warnings = upload(board, kind, file_id, data)
    except BoardError as e:
        print_diagnostics(f"{kind}/{file_id}", e.diagnostics)
        raise
    print_diagnostics(f"{kind}/{file_id}", warnings)
    print(f"uploaded {kind} '{file_id}' ({len(data)} bytes)")
    return 0


def board_get(board, args):
    data = download(board, args.kind, args.id)
    if args.output:
        args.output.write_bytes(data)
        print(f"saved {args.kind} '{args.id}' to {args.output} ({len(data)} bytes)", file=sys.stderr)
    elif sys.stdout.isatty():
        text = data.decode("utf-8", errors="replace").replace("\r\n", "\n")
        print(safe(text, keep="\n\t"))
    else:
        sys.stdout.buffer.write(data + b"\n")
        sys.stdout.buffer.flush()
    return 0


def board_rm(board, args):
    board.command("delete", kind=args.kind, id=args.id)
    print(f"deleted {args.kind} '{args.id}'")
    return 0


WIPE_TIMEOUT = 10.0  # removing many files takes the board a while, as put_end does


def confirmed(prompt):
    """Whether the person typed "yes". No answer (a closed input) counts as no."""
    try:
        return input(prompt).strip().lower() == "yes"
    except EOFError:
        return False


# What `wipe --settings` puts back: the defaults of the settings table in docs/protocol/protocol-v1.md, also
# DEFAULT_SETTINGS in web/src/protocol/files.ts.
DEFAULT_SETTINGS = {"brightness": 100, "playlist": "default"}
DEFAULTS_TEXT = (f"brightness {DEFAULT_SETTINGS['brightness']}, playlist {DEFAULT_SETTINGS['playlist']} and the defaults "
                 "of the WiFi power, update and login settings; the WiFi network is forgotten and the token is made again")


def board_wipe(board, args):
    reset = args.settings
    question = ("Delete every animation and playlist on the board and put the settings back to their defaults "
                f"({DEFAULTS_TEXT}, over USB only)? " if reset else "Delete every animation and playlist on the board? The settings stay. ")
    if not args.yes and not confirmed(question + "Type yes to continue: "):
        print("nothing deleted", file=sys.stderr)
        return 1
    try:
        reply = board.command("delete_all", timeout=WIPE_TIMEOUT, **({"settings": True} if reset else {}))
    except BoardError as e:
        if str(e).startswith("unknown_command"):
            raise BoardError(f"{e}: update the board's firmware to use wipe") from e
        # A firmware older than the settings field refuses it and removes nothing.
        if reset and str(e).startswith("bad_request"):
            raise BoardError(f"{e}: nothing was deleted; update the board's firmware to use wipe --settings") from e
        raise
    playlists, animations = reply.get("playlists"), reply.get("animations")
    if not (is_count(playlists) and is_count(animations)):
        raise BoardError("the board reports invalid counts for delete_all")
    print(f"deleted {playlists} playlists and {animations} animations")
    if reset:
        settings = reply.get("settings")
        if not isinstance(settings, dict):
            raise BoardError("the board sent no settings after resetting them")
        for key, value in shown(settings).items():
            print(f"{key}={value}")
    return 0


WIFI_POWERS = ("auto", "8.5", "11", "13", "15", "17", "18.5", "19.5")
TEXT_SETTINGS = {"wifi_power", "update_mode", "timezone", "animation_source"}
FLAG_SETTINGS = {"update_firmware", "update_animations", "network_login"}
NUMBER_SETTINGS = {"check_hours": (1, 168), "install_start": (0, 1439), "install_end": (0, 1439)}
SETTING_NAMES = ("brightness", "playlist", "wifi_power", "update_mode", "update_firmware", "update_animations",
                 "check_hours", "install_start", "install_end", "timezone", "animation_source", "network_login")


def parse_settings(pairs):
    """The settings to change, from key=value arguments. The board checks each value again.

    Numbers become integers, true and false become booleans, the rest stays text. The token is read only.
    """
    changes = {}
    for pair in pairs:
        key, sep, value = pair.partition("=")
        if not sep:
            raise BoardError(f"'{pair}' is not key=value")
        if key == "brightness":
            if not re.fullmatch(r"[0-9]{1,3}", value) or int(value) > 255:
                raise BoardError("brightness is a whole number from 0 to 255")
            changes[key] = int(value)
        elif key == "playlist":
            if not ID_PATTERN.match(value):
                raise BoardError("playlist is a playlist ID: lowercase letters, digits, _ and -")
            changes[key] = value
        elif key == "wifi_power":
            if value not in WIFI_POWERS:
                raise BoardError("wifi_power is " + ", ".join(WIFI_POWERS))
            changes[key] = value
        elif key == "update_mode":
            if value not in ("off", "notify", "automatic"):
                raise BoardError("update_mode is off, notify or automatic")
            changes[key] = value
        elif key in FLAG_SETTINGS:
            if value not in ("true", "false"):
                raise BoardError(f"{key} is true or false")
            changes[key] = value == "true"
        elif key in NUMBER_SETTINGS:
            low, high = NUMBER_SETTINGS[key]
            if not re.fullmatch(r"[0-9]{1,4}", value) or not low <= int(value) <= high:
                raise BoardError(f"{key} is a whole number from {low} to {high}")
            changes[key] = int(value)
        elif key in TEXT_SETTINGS:
            changes[key] = value  # timezone and animation_source: the board has the rules
        elif key == "token":
            raise BoardError("token is read only: `board settings` shows it, and the board makes a new one on request")
        else:
            raise BoardError(f"unknown setting '{key}' ({', '.join(SETTING_NAMES)})")
    return changes


def board_settings(board, args):
    changes = parse_settings(args.pairs)
    reply = board.command("settings_set", **changes) if changes else board.command("settings_get")
    for key, value in shown(dict_of(reply.get("settings"))).items():
        print(f"{key}={value}")
    return 0


def age_text(seconds):
    """Seconds as a short age: 40 seconds, 12 minutes, 3 hours, 2 days."""
    if not isinstance(seconds, int) or isinstance(seconds, bool) or seconds < 0:
        return "unknown"
    for limit, unit, size in ((60, "second", 1), (3600, "minute", 60), (86400, "hour", 3600), (None, "day", 86400)):
        if limit is None or seconds < limit:
            count = seconds // size
            return f"{count} {unit}{'' if count == 1 else 's'}"
    return "unknown"


NO_RELEASE_RESULT = ("http_error: no release is published at this address yet "
                     "(check the animation source, or try again after the first release)")


def print_update_state(update):
    """The update state of a `status` reply, one fact per line. Text from the board is made safe for the terminal."""
    update = shown(update)
    state = update.get("state")
    progress = update.get("progress")
    working = state in ("checking", "downloading", "installing")
    print(f"update    {state}" + (f", {progress} %" if working and isinstance(progress, int) else ""))
    checked = update.get("last_check")
    result = update.get("last_result")
    if result == "http_error" and update.get("last_detail") == "no_release":
        result = NO_RELEASE_RESULT
    if checked is None:
        print("checked   not since the board started" + (f", last result {result}" if result else ""))
    else:
        print(f"checked   {age_text(checked)} ago, {result if result else 'no result'}")
    firmware = update.get("firmware")
    print(f"firmware  {'none available' if firmware is None else f'{firmware} available'}")
    files = update.get("files")
    print(f"files     {files} to add or replace" if isinstance(files, int) else "files     unknown")
    failed = update.get("failed_files")
    if failed:
        print(f"failed    {failed} file{'' if failed == 1 else 's'} in the last update")
    last = update.get("last_install")
    if isinstance(last, dict):
        print(f"installed {last.get('result')}, from {last.get('from')} to {last.get('to')}")


def board_status(board, args):
    reply = board.command("status")
    wifi, time_, update = (dict_of(reply.get(k)) for k in ("wifi", "time", "update"))
    wifi = shown(wifi)
    power = f"{wifi.get('power')} dBm" + (" (reduced)" if wifi.get("power_reduced") else "")
    print(f"wifi      {wifi.get('state')}")
    ssid = wifi.get("ssid")
    print(f"network   {'none' if ssid is None else ssid}")
    print(f"address   {wifi.get('ip') or 'none'}")
    print(f"hostname  {wifi.get('hostname')}.local")
    rssi = wifi.get("rssi")
    print(f"signal    {'none' if rssi is None else f'{rssi} dBm, {signal_quality(rssi)}'}")
    print(f"power     {power}")
    print(f"time      {'known' if time_.get('known') else 'not known'}")
    print_update_state(update)
    return 0


# How long `update check` and `update install` wait for the board, and how often they ask.
UPDATE_WAIT = {"check": 120.0, "install": 600.0}
UPDATE_POLL = 1.0


def wait_for_firmware(board):
    """Waits while the board writes the new firmware, until it restarts or the installation fails."""
    boot_id = board.info.get("boot_id")
    deadline = time.monotonic() + UPDATE_WAIT["install"]
    installing = False
    while True:
        try:
            update = dict_of(board.command("status").get("update"))
        except BoardError:
            if not installing:
                raise
            print("installed restarting: ask again with `status` once the board is back")
            return 0
        if update.get("state") == "installing":
            installing = True
        elif update.get("state") in ("idle", "waiting_for_time"):
            info = board.request("info")
            if installing and info.get("ok") and info.get("boot_id") != boot_id:
                print(f"installed restarted, the board runs {shown(info.get('firmware'))} on trial until it shows its "
                      "first frame: `status` then says updated or rolled_back")
                return 0
            print_update_state(update)
            return 0 if update.get("last_result") in (None, "ok") else 1
        if time.monotonic() > deadline:
            raise BoardError("the board is still working: ask again with `status`")
        time.sleep(UPDATE_POLL)


def board_update(board, args):
    """Starts a check or an installation and waits until the board is done, then prints the update state."""
    if args.update_command == "check":
        board.command("update_check")
    elif args.target == "firmware":
        board.command("update_install", target="firmware", **({"force": True} if getattr(args, "force", False) else {}))
        return wait_for_firmware(board)
    else:
        if getattr(args, "force", False):
            raise BoardError("--force applies to the firmware only")
        board.command("update_install", target=args.target)
    deadline = time.monotonic() + UPDATE_WAIT[args.update_command]
    while True:
        update = dict_of(board.command("status").get("update"))
        if update.get("state") in ("idle", "waiting_for_time"):
            break
        if time.monotonic() > deadline:
            raise BoardError("the board is still working: ask again with `status`")
        time.sleep(UPDATE_POLL)
    print_update_state(update)
    return 0 if update.get("last_result") in (None, "ok") else 1


def signal_quality(rssi):
    """The word the legend of docs/board/wifi-and-updates-v1.md#transmit-power gives to a signal strength."""
    if not isinstance(rssi, (int, float)) or isinstance(rssi, bool):
        return "unknown"
    if rssi >= -50:
        return "excellent"
    if rssi >= -67:
        return "good"
    if rssi >= -75:
        return "fair"
    return "weak"


# ---- Improv Wi-Fi Serial, version 1: docs/board/wifi-and-updates-v1.md#setup-with-improv ----

IMPROV_MAGIC = b"IMPROV"
IMPROV_VERSION = 1
IMPROV_STATE, IMPROV_ERROR, IMPROV_RPC, IMPROV_RESULT = 1, 2, 3, 4
IMPROV_PROVISIONED = 4
IMPROV_ERRORS = {1: "the board did not understand the request", 2: "the board does not know the command",
                 3: "the board could not connect"}
IMPROV_TIMEOUT = 40.0  # the board answers after 30 seconds


def improv_frame(frame_type, data):
    """A frame: IMPROV, the version, the type, the data length, the data and the checksum (the sum of the bytes before it)."""
    if len(data) > 255:
        raise ValueError("an Improv frame holds at most 255 bytes of data")
    head = IMPROV_MAGIC + bytes([IMPROV_VERSION, frame_type, len(data)]) + data
    return head + bytes([sum(head) % 256])


def improv_wifi_settings(ssid, password):
    """The frame that sends a network name and a password (both bytes) to the board."""
    if not 1 <= len(ssid) <= 32:
        raise BoardError("a network name is 1 to 32 bytes")
    if len(password) > 64:
        raise BoardError("a password is at most 64 bytes")
    if b"\0" in ssid or b"\0" in password:
        raise BoardError("a network name and a password cannot hold a NUL character")
    args = bytes([len(ssid)]) + ssid + bytes([len(password)]) + password
    return improv_frame(IMPROV_RPC, bytes([1, len(args)]) + args)


def improv_frames(buffer):
    """Takes the complete frames out of `buffer` (a bytearray) and returns them as (type, data).

    Other bytes (log lines, protocol lines) and frames with a wrong checksum are dropped.
    """
    frames = []
    while True:
        start = buffer.find(IMPROV_MAGIC + bytes([IMPROV_VERSION]))
        if start < 0:
            del buffer[: max(0, len(buffer) - len(IMPROV_MAGIC))]  # keep a header that is still arriving
            return frames
        del buffer[:start]
        if len(buffer) < 9:
            return frames
        total = 10 + buffer[8]
        if len(buffer) < total:
            return frames
        frame = bytes(buffer[:total])
        if sum(frame[:-1]) % 256 == frame[-1]:
            del buffer[:total]
            frames.append((frame[7], frame[9:-1]))
        else:
            del buffer[:1]  # not a frame: look for the next header


def improv_connect(transport, ssid, password, timeout=None):
    """Sends the network to the board and waits until it is provisioned. Raises BoardError when it is not."""
    if not hasattr(transport, "send_raw"):
        raise BoardError("WiFi setup needs the USB serial port (--port): Improv does not run over a WebSocket")
    transport.send_raw(improv_wifi_settings(ssid, password))
    buffer = bytearray()
    deadline = time.monotonic() + (IMPROV_TIMEOUT if timeout is None else timeout)
    error = None
    while time.monotonic() < deadline:
        buffer += transport.receive_raw(min(1.0, max(0.0, deadline - time.monotonic())))
        for frame_type, data in improv_frames(buffer):
            if frame_type == IMPROV_STATE and data[:1] == bytes([IMPROV_PROVISIONED]):
                return
            if frame_type == IMPROV_ERROR and data and data[0] != 0:
                error = data[0]
        if error is not None:
            raise BoardError(IMPROV_ERRORS.get(error, "the board reported an error") +
                             ": check the name and the password, and that the network is on 2.4 GHz. "
                             "The board keeps the network and tries again")
    raise BoardError("the board did not answer in time")


def board_wifi(board, args):
    if args.forget:
        board.command("wifi_forget")
        print("the WiFi network is forgotten")
        return 0
    if not hasattr(board.transport, "send_raw"):
        raise BoardError("wifi needs the USB serial port (--port): Improv does not run over a WebSocket")
    # Hidden input, so neither the name nor the password reaches the screen, the history or a log.
    ssid = getpass.getpass("Network name (hidden): ").encode("utf-8")
    password = getpass.getpass("Password (hidden, empty for an open network): ").encode("utf-8")
    try:
        improv_connect(board.transport, ssid, password)
    finally:
        ssid = password = b""
    print("connected")
    return board_status(board, args)


BOARD_COMMANDS = {"info": board_info, "ls": board_ls, "put": board_put, "get": board_get, "rm": board_rm, "wipe": board_wipe,
                  "settings": board_settings, "status": board_status, "wifi": board_wifi, "update": board_update}


def run_board(args):
    token = board_token(args)
    transport = SerialTransport(args.port) if args.port else WebSocketTransport(args.ws)
    try:
        return BOARD_COMMANDS[args.board_command](Board(transport, token), args)
    except (KeyError, TypeError, ValueError) as e:
        # A reply with a missing or wrongly typed field: one message instead of a traceback
        raise BoardError("the board sent an unexpected reply") from e
    finally:
        transport.close()


def add_board_parser(sub):
    b = sub.add_parser("board", help="talk to a board over serial, or to the simulator over a WebSocket")
    target = b.add_mutually_exclusive_group(required=True)
    target.add_argument("--port", help="serial device of the board, for example /dev/ttyACM0 (needs pyserial)")
    target.add_argument("--ws", metavar="URL",
                        help="a WebSocket: the simulator's, for example ws://127.0.0.1:8765, or a board's over WiFi, "
                             "ws://pixelart-XXXX.local/ws")
    b.add_argument("--token", help="the board's token, for a board over WiFi with network login on "
                                   "(safer: the environment variable PIXELART_TOKEN)")
    commands = b.add_subparsers(dest="board_command", required=True)
    kinds = ("animation", "playlist")
    commands.add_parser("info", help="firmware, storage and limits")
    ls = commands.add_parser("ls", help="list the stored files")
    ls.add_argument("--kind", choices=kinds, help="only this kind (default: both)")
    put = commands.add_parser("put", help="upload an animation or a playlist (YAML or JSON)")
    put.add_argument("file", type=Path)
    put.add_argument("--id", help="file ID (default: the file name without extension)")
    put.add_argument("--kind", choices=kinds, help="default: from the animations/ or playlists/ folder, else the format field")
    get = commands.add_parser("get", help="download a stored file, checking its SHA-256")
    get.add_argument("id")
    get.add_argument("--kind", choices=kinds, default="animation")
    get.add_argument("-o", "--output", type=Path, help="write to this file instead of the terminal")
    rm = commands.add_parser("rm", help="delete a stored file")
    rm.add_argument("id")
    rm.add_argument("--kind", choices=kinds, default="animation")
    wipe = commands.add_parser("wipe", help="delete every animation and playlist; the settings stay unless --settings")
    wipe.add_argument("--yes", action="store_true", help="do not ask for confirmation")
    wipe.add_argument("--settings", action="store_true",
                      help=f"also put the settings back to their defaults ({DEFAULTS_TEXT}; USB only)")
    settings = commands.add_parser("settings", help="show the settings, or change them with key=value")
    settings.add_argument("pairs", nargs="*", metavar="key=value",
                          help="any of: " + ", ".join(SETTING_NAMES) + ". The token is read only and shown by `settings`")
    commands.add_parser("status", help="WiFi state, network name, address, signal and update state")
    update = commands.add_parser("update", help="check for updates, or install what a check found, and wait for the board")
    update_commands = update.add_subparsers(dest="update_command", required=True)
    update_commands.add_parser("check", help="check now")
    install = update_commands.add_parser("install", help="install what the last check found, ignoring the install window")
    install.add_argument("target", choices=("animations", "firmware"),
                         help="animations: the animations and playlists; firmware: the firmware, which restarts the board")
    install.add_argument("--force", action="store_true",
                         help="firmware only: also install the version a rollback put on the skip list")
    wifi = commands.add_parser("wifi", help="set up WiFi with Improv over USB, asking for the name and password")
    wifi.add_argument("--forget", action="store_true", help="forget the stored network instead")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    b = sub.add_parser("build", help="convert sources to the board's JSON files")
    b.add_argument("--source", type=Path, default=ROOT, help="folder with animations/ and playlists/ (default: repository)")
    b.add_argument("--out", type=Path, default=ROOT / "data", help="output folder (default: data/)")
    b.add_argument("--schema", action="store_true", help="also check every file against the JSON Schemas")
    add_board_parser(sub)
    args = parser.parse_args()
    if args.command == "build":
        sys.exit(build(args.source, args.out, args.schema))
    try:
        sys.exit(run_board(args))
    except BoardError as e:
        print(f"pixelart: {e}", file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        sys.exit(130)


if __name__ == "__main__":
    main()
