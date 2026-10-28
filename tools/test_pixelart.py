# SPDX-License-Identifier: GPL-3.0-or-later
"""Tests for the board client in tools/pixelart.py: framing, retries, uploads and the WebSocket transport.

Run with: python3 -m unittest discover -s tools   (part of `make check`)
"""

import base64
import argparse
import contextlib
import hashlib
import io
import socket
import sys
import tempfile
import threading
import types
import zlib
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

import pixelart  # noqa: E402


class Responder:
    """Answers each request with `handler(body)`: a reply body, a raw line, a list of those, or None."""

    def __init__(self, handler):
        self.handler = handler
        self.sent = []
        self.inbox = []

    def receive(self, timeout):
        return self.inbox.pop(0) if self.inbox else None

    def send(self, line):
        self.sent.append(line)
        body = pixelart.decode_line(line)
        out = self.handler(body)
        for item in out if isinstance(out, list) else [out]:
            if isinstance(item, dict):
                self.inbox.append(pixelart.encode_line({"seq": body["seq"], **item}))
            elif item is not None:
                self.inbox.append(item)


INFO = {"ok": True, "protocol": 1, "limits": {"chunk": 512, "line": 1024}}


def serve(reply):
    """A handler that answers `info` with INFO and every other request with `reply` (a body, or a function of the request)."""
    return lambda body: INFO if body["cmd"] == "info" else reply(body) if callable(reply) else reply


class FramingTest(unittest.TestCase):
    def test_spec_example_line(self):
        self.assertEqual(pixelart.encode_line({"seq": 1, "cmd": "info"}), b'@PR 3c250228 {"seq":1,"cmd":"info"}')

    def test_round_trip(self):
        body = {"seq": 5, "cmd": "list", "kind": "animation"}
        self.assertEqual(pixelart.decode_line(pixelart.encode_line(body)), body)

    def test_ignored_lines(self):
        good = pixelart.encode_line({"seq": 1, "ok": True})
        for line in [b"", b"pixelart: log", b"@PX 256 ff00", good.replace(b"@PR", b"@pr"),
                     good[:-1] + b"x",  # CRC mismatch
                     b"@PR 3C250228 " + good[13:],  # upper case digits
                     b"@PR 3c25022 " + good[13:], b"@PR  " + good[5:],
                     pixelart.encode_line({"seq": 1})[:-1],  # broken JSON
                     b'@PR %08x []' % pixelart.zlib.crc32(b"[]")]:  # not an object
            self.assertIsNone(pixelart.decode_line(line), line)


class RequestTest(unittest.TestCase):
    def test_handshake_requires_protocol_1(self):
        t = Responder(lambda body: {"ok": True, "protocol": 2})
        with self.assertRaises(pixelart.BoardError) as e:
            pixelart.Board(t)
        self.assertIn("protocol 2", str(e.exception))

    def test_retry_after_silence_then_success(self):
        calls = []

        def handler(body):
            calls.append(body)
            return None if len(calls) < 3 else INFO

        board = pixelart.Board(Responder(handler))
        self.assertEqual(len(calls), 3)
        self.assertEqual({c["seq"] for c in calls}, {calls[0]["seq"]})  # a retry keeps its seq
        self.assertEqual(board.limits["chunk"], 512)

    def test_gives_up_after_five_tries(self):
        t = Responder(lambda body: None)
        with self.assertRaises(pixelart.BoardError):
            pixelart.Board(t)
        self.assertEqual(len(t.sent), pixelart.TRIES)

    def test_bad_frame_resends_at_once(self):
        # One bad_frame, then the answer: the retry is not delayed by a timeout.
        sent = []

        def handler(body):
            sent.append(body)
            if len(sent) == 1:
                return pixelart.encode_line({"ok": False, "error": "bad_frame", "message": "x"})
            return INFO

        pixelart.Board(Responder(handler))
        self.assertEqual(len(sent), 2)

    def test_noise_and_other_seq_are_skipped(self):
        def handler(body):
            return [b"pixelart: boot", b"@PX 1 ff0000", pixelart.encode_line({"seq": body["seq"] + 1, "ok": True}),
                    pixelart.encode_line({"event": "x"}), b"@PR 00000000 {}", dict(INFO)]

        self.assertEqual(pixelart.Board(Responder(handler)).info["protocol"], 1)

    def test_error_reply_raises_with_diagnostics(self):
        diagnostics = [{"severity": "error", "code": "unknown_color", "where": "a.b", "message": "bad"}]

        def handler(body):
            if body["cmd"] == "info":
                return INFO
            return {"ok": False, "error": "invalid_file", "message": "no", "diagnostics": diagnostics}

        board = pixelart.Board(Responder(handler))
        with self.assertRaises(pixelart.BoardError) as e:
            board.command("put_end")
        self.assertEqual(e.exception.diagnostics, diagnostics)
        self.assertEqual(str(e.exception), "invalid_file: no")

    def test_seq_differs_between_runs(self):
        seqs = set()
        for _ in range(5):
            t = Responder(lambda body: INFO)
            pixelart.Board(t)
            seqs.add(pixelart.decode_line(t.sent[0])["seq"])
        self.assertGreater(len(seqs), 1)


class UploadTest(unittest.TestCase):
    def test_chunks_follow_the_limit_and_the_data_matches(self):
        data = bytes(range(256)) * 5  # 1280 bytes: three chunks
        received = bytearray()
        sha = []

        def handler(body):
            cmd = body["cmd"]
            if cmd == "info":
                return INFO
            if cmd == "put_begin":
                sha.append(body["sha256"])
                self.assertEqual(body["size"], len(data))
            if cmd == "put_chunk":
                self.assertEqual(body["offset"], len(received))
                received.extend(base64.b64decode(body["data"]))
                return {"ok": True, "received": len(received)}
            if cmd == "put_end":
                return {"ok": True, "warnings": []}
            return {"ok": True}

        pixelart.upload(pixelart.Board(Responder(handler)), "animation", "x", data)
        self.assertEqual(bytes(received), data)
        self.assertEqual(sha[0], hashlib.sha256(data).hexdigest())

    def test_bad_offset_resumes_and_a_failure_aborts(self):
        data = b"a" * 1200
        offsets = []
        state = {"gap": True}

        def handler(body):
            cmd = body["cmd"]
            if cmd == "info":
                return INFO
            if cmd == "put_chunk":
                offsets.append(body["offset"])
                if body["offset"] == 512 and state["gap"]:
                    state["gap"] = False
                    return {"ok": False, "error": "bad_offset", "expected": 0}
                return {"ok": True, "received": body["offset"] + len(base64.b64decode(body["data"]))}
            if cmd == "put_end":
                return {"ok": False, "error": "checksum_mismatch", "message": "x"}
            return {"ok": True}

        t = Responder(handler)
        with self.assertRaises(pixelart.BoardError):
            pixelart.upload(pixelart.Board(t), "animation", "x", data)
        self.assertEqual(offsets, [0, 512, 0, 512, 1024])
        self.assertEqual(pixelart.decode_line(t.sent[-1])["cmd"], "put_abort")

    def lost_upload(self, lost_begins):
        """A board that loses the upload at the first chunk of each of the first `lost_begins` put_begin."""
        begins = []

        def handler(body):
            cmd = body["cmd"]
            if cmd == "info":
                return INFO
            if cmd == "put_begin":
                begins.append(1)
            if cmd == "put_chunk" and len(begins) <= lost_begins:
                return {"ok": False, "error": "no_upload"}
            if cmd == "put_chunk":
                return {"ok": True, "received": body["offset"] + len(base64.b64decode(body["data"]))}
            if cmd == "put_end":
                return {"ok": True, "warnings": []}
            return {"ok": True}

        return Responder(handler), begins

    def test_no_upload_restarts_the_upload_once(self):
        t, begins = self.lost_upload(1)
        pixelart.upload(pixelart.Board(t), "animation", "x", b"a" * 700)
        self.assertEqual(len(begins), 2)

    def test_busy_says_the_other_connection_holds_the_upload(self):
        def handler(body):
            if body["cmd"] == "info":
                return INFO
            if body["cmd"] == "put_begin":
                return {"ok": False, "error": "busy", "message": "other"}
            return {"ok": True}

        t = Responder(handler)
        with self.assertRaises(pixelart.BoardError) as caught:
            pixelart.upload(pixelart.Board(t), "animation", "x", b"a" * 10)
        self.assertEqual(str(caught.exception), pixelart.UPLOAD_BUSY)
        self.assertNotIn("put_chunk", [pixelart.decode_line(line)["cmd"] for line in t.sent])

    def test_no_upload_twice_gives_up_with_an_abort(self):
        t, begins = self.lost_upload(2)
        with self.assertRaises(pixelart.UploadGone):
            pixelart.upload(pixelart.Board(t), "animation", "x", b"a" * 700)
        self.assertEqual(len(begins), 2)
        self.assertEqual(pixelart.decode_line(t.sent[-1])["cmd"], "put_abort")


class DownloadTest(unittest.TestCase):
    def serve(self, content, listed_sha=None):
        def handler(body):
            cmd = body["cmd"]
            if cmd == "info":
                return INFO
            if cmd == "list":
                return {"ok": True, "entries": [{"id": "x", "size": len(content),
                                                 "sha256": listed_sha or hashlib.sha256(content).hexdigest()}],
                        "more": False}
            part = content[body["offset"]: body["offset"] + body["length"]]
            return {"ok": True, "size": len(content), "offset": body["offset"],
                    "data": base64.b64encode(part).decode()}

        return pixelart.Board(Responder(handler))

    def test_download_verifies_the_checksum(self):
        content = b"0123456789" * 120
        self.assertEqual(pixelart.download(self.serve(content), "animation", "x"), content)
        with self.assertRaises(pixelart.BoardError):
            pixelart.download(self.serve(content, listed_sha="0" * 64), "animation", "x")

    def test_a_page_that_repeats_ends_the_listing(self):
        def handler(body):
            if body["cmd"] == "info":
                return INFO
            return {"ok": True, "entries": [{"id": "a", "size": 1, "sha256": "0" * 64}], "more": True}

        with self.assertRaises(pixelart.BoardError):
            list(pixelart.Board(Responder(handler)).entries("animation"))

    def test_a_size_above_the_limit_of_the_kind_is_refused(self):
        content = b"x" * 100
        board = self.serve(content)
        board.limits = {"animation": 99, "playlist": 1000}
        with self.assertRaises(pixelart.BoardError) as e:
            pixelart.download(board, "animation", "x")
        self.assertIn("limit", str(e.exception))
        board.limits = {"animation": 100}
        self.assertEqual(pixelart.download(board, "animation", "x"), content)

    def test_a_limit_above_the_protocol_maximum_is_capped(self):
        board = self.serve(b"x" * (64 * 1024 + 1))
        board.limits = {"animation": 10**9}
        with self.assertRaises(pixelart.BoardError) as e:
            pixelart.download(board, "animation", "x")
        self.assertIn("limit of 65536", str(e.exception))

    def test_a_board_without_limits_gets_the_protocol_maximum(self):
        for limits in ({}, {"animation": None}, {"animation": True}, {"animation": "9"}):
            board = self.serve(b"x" * (64 * 1024 + 1))
            board.limits = limits
            with self.assertRaises(pixelart.BoardError, msg=limits) as e:
                pixelart.download(board, "animation", "x")
            self.assertIn("limit of 65536", str(e.exception))
        board = self.serve(b"x" * (16 * 1024 + 1))
        board.limits = {}
        with self.assertRaises(pixelart.BoardError):
            pixelart.download(board, "playlist", "x")

    def test_a_boolean_size_is_refused(self):
        def handler(body):
            if body["cmd"] == "info":
                return INFO
            return {"ok": True, "entries": [{"id": "x", "size": True, "sha256": "0" * 64}], "more": False}

        with self.assertRaises(pixelart.BoardError) as e:
            pixelart.download(pixelart.Board(Responder(handler)), "animation", "x")
        self.assertIn("invalid size", str(e.exception))

    def test_more_bytes_than_the_reported_size_stop_the_download(self):
        def handler(body):
            if body["cmd"] == "info":
                return INFO
            if body["cmd"] == "list":
                return {"ok": True, "entries": [{"id": "x", "size": 10, "sha256": "0" * 64}], "more": False}
            return {"ok": True, "size": 10, "offset": body["offset"], "data": base64.b64encode(b"y" * 40).decode()}

        with self.assertRaises(pixelart.BoardError) as e:
            pixelart.download(pixelart.Board(Responder(handler)), "animation", "x")
        self.assertIn("more bytes", str(e.exception))

    def run_get(self, data, tty, output=None):
        board = self.serve(data)
        stdout = types.SimpleNamespace(isatty=lambda: tty, buffer=io.BytesIO(), flush=lambda: None)
        text = io.StringIO()
        stdout.write = text.write
        with mock.patch.object(sys, "stdout", stdout):
            pixelart.board_get(board, types.SimpleNamespace(kind="animation", id="x", output=output))
        return text.getvalue(), stdout.buffer.getvalue()

    def test_get_to_a_terminal_prints_escaped_text_and_to_a_pipe_the_raw_bytes(self):
        data = b'{"a":"\x1b[2J\xe2\x80\xae"}'
        text, raw = self.run_get(data, tty=True)
        self.assertEqual(raw, b"")
        self.assertNotIn("\x1b", text)
        self.assertNotIn("\u202e", text)
        self.assertIn("\\x1b[2J\\u202e", text)
        text, raw = self.run_get(data, tty=False)
        self.assertEqual((text, raw), ("", data + b"\n"))

    def test_get_to_a_terminal_keeps_lines_and_tabs_and_escapes_the_rest(self):
        text, _ = self.run_get(b"a\r\n\x1b[2J\tb\rc\xe2\x80\xae\n", tty=True)
        self.assertEqual(text, "a\n\\x1b[2J\tb\\x0dc\\u202e\n\n")

    def test_missing_file(self):
        board = self.serve(b"abc")
        with self.assertRaises(pixelart.BoardError):
            pixelart.download(board, "animation", "other")


class TerminalTextTest(unittest.TestCase):
    HOSTILE = "a\x1b[2J\u202eb\u2066\u200b\u2028\u061c\x85c"
    ESCAPED = "a\\x1b[2J\\u202eb\\u2066\\u200b\\u2028\\u061c\\x85c"

    def assert_clean(self, text):
        for c in "\x1b\u202e\u2066\u200b\u2028\u061c\x85\x07":
            self.assertNotIn(c, text)

    def test_control_and_formatting_characters_become_visible_escapes(self):
        self.assertEqual(pixelart.safe("a\x1b[31m\x00\x7f\x85\x9fb\n"), "a\\x1b[31m\\x00\\x7f\\x85\\x9fb\\x0a")
        self.assertEqual(pixelart.safe(self.HOSTILE), self.ESCAPED)
        self.assertEqual(pixelart.safe("\u00ad\u2029\ufeff"), "\\xad\\u2029\\ufeff")
        self.assertEqual(pixelart.safe("plain \u00e9 text \u00e8\u4e2d"), "plain \u00e9 text \u00e8\u4e2d")
        self.assertEqual(pixelart.safe(12), "12")

    def test_a_character_above_the_bmp_has_an_unambiguous_escape(self):
        self.assertEqual(pixelart.safe("a\U000e0001b"), "a\\U000e0001b")
        self.assertEqual(pixelart.safe("\u202e"), "\\u202e")

    def test_shown_stops_at_a_depth_bound(self):
        deep = "\x1b"
        for _ in range(pixelart.MAX_SHOWN_DEPTH + 40):
            deep = [deep]
        value = pixelart.shown(deep)
        for _ in range(pixelart.MAX_SHOWN_DEPTH):
            value = value[0]
        self.assertEqual(value, "...")
        self.assertEqual(pixelart.shown({"a": [{"b": "\x1b"}]}), {"a": [{"b": "\\x1b"}]})

    def test_a_reply_nested_too_deep_is_a_damaged_line(self):
        payload = b'{"seq":1}'
        line = b"@PR %08x " % zlib.crc32(payload) + payload
        with mock.patch.object(pixelart.json, "loads", side_effect=RecursionError):
            self.assertIsNone(pixelart.decode_line(line))
        self.assertEqual(pixelart.decode_line(line), {"seq": 1})

    def test_shown_escapes_every_string_and_leaves_the_original_alone(self):
        reply = {"k\x1b": ["a\x1b", {"n": "\u202e"}, 5, True, None]}
        self.assertEqual(pixelart.shown(reply), {"k\\x1b": ["a\\x1b", {"n": "\\u202e"}, 5, True, None]})
        self.assertEqual(reply["k\x1b"][0], "a\x1b")

    def test_board_supplied_text_is_escaped_in_errors_and_diagnostics(self):
        text = pixelart.describe_error({"error": "bad\x1b", "message": "hi\x07\u202e", "expected": "\x1b"})
        self.assertEqual(text, "bad\\x1b: hi\\x07\\u202e")
        text = pixelart.describe_error({"error": "bad_offset", "message": "", "expected": "\x1b"})
        self.assertEqual(text, "bad_offset (expected offset \\x1b)")
        out = io.StringIO()
        pixelart.print_diagnostics("l", [{"severity": "error", "code": "c", "where": "w\x1b", "message": "m\x9b\u202e"}], out)
        self.assertEqual(out.getvalue(), "l: error c at w\\x1b: m\\x9b\\u202e\n")

    def run_command(self, function, handler, **args):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            function(pixelart.Board(Responder(handler)), types.SimpleNamespace(**args))
        self.assert_clean(out.getvalue())
        return out.getvalue()

    def test_error_path_is_escaped(self):
        board = pixelart.Board(Responder(serve({"ok": False, "error": "x" + self.HOSTILE, "message": self.HOSTILE})))
        with self.assertRaises(pixelart.BoardError) as e:
            board.command("delete")
        self.assert_clean(str(e.exception))
        self.assertIn(self.ESCAPED, str(e.exception))

    def test_protocol_mismatch_message_is_escaped(self):
        with self.assertRaises(pixelart.BoardError) as e:
            pixelart.Board(Responder(lambda body: {"ok": True, "protocol": self.HOSTILE}))
        self.assert_clean(str(e.exception))
        self.assertIn(self.ESCAPED, str(e.exception))

    def test_repeated_page_message_is_escaped(self):
        page = {"ok": True, "entries": [{"id": self.HOSTILE, "size": 1, "sha256": "0" * 64}], "more": True}

        with self.assertRaises(pixelart.BoardError) as e:
            list(pixelart.Board(Responder(serve(page))).entries("animation"))
        self.assert_clean(str(e.exception))
        self.assertIn(self.ESCAPED, str(e.exception))

    def test_ls_escapes_ids_and_names(self):
        entry = {"id": "a\x1b[2J" + self.HOSTILE, "size": 1, "sha256": "0" * 64, "name": "n\x07" + self.HOSTILE,
                 "version": "\x1b"}
        text = self.run_command(pixelart.board_ls, serve({"ok": True, "entries": [entry], "more": False}),
                                kind="animation")
        self.assertIn("a\\x1b[2J" + self.ESCAPED, text)
        self.assertIn("n\\x07" + self.ESCAPED, text)

    def test_ls_accepts_ids_that_are_not_strings(self):
        for bad in (None, ["a"], {"a": 1}, 7):
            entry = {"id": bad, "size": 1, "sha256": "0" * 64}
            text = self.run_command(pixelart.board_ls, serve({"ok": True, "entries": [entry], "more": False}),
                                    kind="animation")
            self.assertIn(str(bad), text)

    def test_ls_uses_the_original_id_for_paging(self):
        asked = []

        def page(body):
            asked.append(body.get("after"))
            if body.get("after") is None:
                return {"ok": True, "entries": [{"id": "a\x1bb", "size": 1, "sha256": "0" * 64}], "more": True}
            return {"ok": True, "entries": [{"id": "a\x1bc", "size": 1, "sha256": "0" * 64}], "more": False}

        self.run_command(pixelart.board_ls, serve(page), kind="animation")
        self.assertEqual(asked, [None, "a\x1bb"])

    def test_info_escapes_every_field_and_accepts_any_shape(self):
        hostile = {**INFO, "firmware": self.HOSTILE, "board": self.HOSTILE, "canvas": {"width": self.HOSTILE},
                   "formats": {self.HOSTILE: [self.HOSTILE, 1]}, "storage": {"used": self.HOSTILE},
                   "memory": {"free": self.HOSTILE}, "limits": {self.HOSTILE: self.HOSTILE}}
        text = self.run_command(pixelart.board_info, lambda body: hostile)
        self.assertIn(self.ESCAPED, text)
        for formats in (7, "text", None, ["a", "b"], {"animation": 5}, {"animation": None}):
            for field in ("canvas", "storage", "memory", "limits"):
                shape = {**INFO, "formats": formats, field: formats}
                self.run_command(pixelart.board_info, lambda body, shape=shape: shape)

    def test_settings_escapes_keys_and_values(self):
        reply = {"ok": True, "settings": {"k" + self.HOSTILE: "v" + self.HOSTILE}}
        text = self.run_command(pixelart.board_settings, serve(reply), pairs=[])
        self.assertIn("k" + self.ESCAPED + "=v" + self.ESCAPED, text)


class WipeTest(unittest.TestCase):
    def board(self, reply):
        responder = Responder(serve(reply))
        return pixelart.Board(responder), responder

    def run_wipe(self, board, yes, answer=None, settings=False):
        out, err = io.StringIO(), io.StringIO()
        args = types.SimpleNamespace(yes=yes, settings=settings)
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err), \
                mock.patch("builtins.input", side_effect=answer if isinstance(answer, BaseException) else [answer]):
            code = pixelart.board_wipe(board, args)
        return code, out.getvalue(), err.getvalue()

    def sent_commands(self, responder):
        return [pixelart.decode_line(line)["cmd"] for line in responder.sent]

    def test_yes_skips_the_question_and_prints_the_counts(self):
        board, responder = self.board({"ok": True, "playlists": 1, "animations": 30})
        code, out, _ = self.run_wipe(board, yes=True, answer=AssertionError("asked"))
        self.assertEqual(code, 0)
        self.assertEqual(out, "deleted 1 playlists and 30 animations\n")
        self.assertIn("delete_all", self.sent_commands(responder))

    def test_the_command_waits_10_seconds_for_the_reply(self):
        board, _ = self.board({"ok": True, "playlists": 0, "animations": 0})
        with mock.patch.object(board, "command", wraps=board.command) as command:
            self.run_wipe(board, yes=True)
        command.assert_called_once_with("delete_all", timeout=10.0)

    def sent_requests(self, responder):
        return [pixelart.decode_line(line) for line in responder.sent]

    def test_without_settings_the_request_has_no_settings_field(self):
        board, responder = self.board({"ok": True, "playlists": 0, "animations": 0})
        self.run_wipe(board, yes=True)
        wipe = [r for r in self.sent_requests(responder) if r["cmd"] == "delete_all"]
        self.assertEqual(len(wipe), 1)
        self.assertNotIn("settings", wipe[0])

    def test_settings_resets_them_and_prints_the_defaults(self):
        board, responder = self.board({"ok": True, "playlists": 1, "animations": 30,
                                       "settings": {"brightness": 100, "playlist": "default"}})
        code, out, _ = self.run_wipe(board, yes=True, settings=True)
        self.assertEqual(code, 0)
        self.assertEqual(out, "deleted 1 playlists and 30 animations\nbrightness=100\nplaylist=default\n")
        wipe = [r for r in self.sent_requests(responder) if r["cmd"] == "delete_all"]
        self.assertIs(wipe[0]["settings"], True)

    def test_settings_asks_a_question_that_names_the_defaults(self):
        board, responder = self.board({"ok": True, "playlists": 0, "animations": 0})
        with mock.patch("builtins.input", return_value="no") as asked:
            with contextlib.redirect_stderr(io.StringIO()):
                code = pixelart.board_wipe(board, types.SimpleNamespace(yes=False, settings=True))
        self.assertEqual(code, 1)
        self.assertIn("brightness 100, play auto, playlists default, schedule default, playlist default, time_sync_hours 6, "
                      "ntp_server pool.ntp.org", asked.call_args.args[0])
        self.assertNotIn("delete_all", self.sent_commands(responder))

    def test_settings_on_an_old_firmware_says_nothing_was_deleted(self):
        board, _ = self.board({"ok": False, "error": "bad_request", "message": "unknown field \"settings\""})
        with self.assertRaises(pixelart.BoardError) as e:
            self.run_wipe(board, yes=True, settings=True)
        self.assertIn("nothing was deleted", str(e.exception))
        self.assertIn("wipe --settings", str(e.exception))

    def test_settings_needs_the_settings_in_the_reply(self):
        board, _ = self.board({"ok": True, "playlists": 0, "animations": 0})
        with self.assertRaises(pixelart.BoardError) as e:
            self.run_wipe(board, yes=True, settings=True)
        self.assertIn("no settings", str(e.exception))

    def test_the_command_line_has_the_settings_option(self):
        parser = argparse.ArgumentParser()
        pixelart.add_board_parser(parser.add_subparsers(dest="command"))
        args = parser.parse_args(["board", "--port", "x", "wipe", "--yes", "--settings"])
        self.assertTrue(args.settings)
        self.assertFalse(parser.parse_args(["board", "--port", "x", "wipe"]).settings)
        help_text = io.StringIO()
        with contextlib.redirect_stdout(help_text), self.assertRaises(SystemExit):
            parser.parse_args(["board", "--port", "x", "wipe", "--help"])
        self.assertIn("brightness 100, play auto, playlists default, schedule default, playlist default, time_sync_hours 6, "
                      "ntp_server pool.ntp.org", " ".join(help_text.getvalue().split()))

    def test_the_answer_yes_runs_the_command(self):
        board, responder = self.board({"ok": True, "playlists": 0, "animations": 0})
        code, out, _ = self.run_wipe(board, yes=False, answer="Yes")
        self.assertEqual(code, 0)
        self.assertIn("deleted 0 playlists and 0 animations", out)
        self.assertIn("delete_all", self.sent_commands(responder))

    def test_any_other_answer_or_a_closed_input_deletes_nothing(self):
        for answer in ["", "y", "no", EOFError()]:
            board, responder = self.board({"ok": True, "playlists": 1, "animations": 1})
            code, out, err = self.run_wipe(board, yes=False, answer=answer)
            self.assertEqual(code, 1, msg=repr(answer))
            self.assertEqual(out, "")
            self.assertIn("nothing deleted", err)
            self.assertNotIn("delete_all", self.sent_commands(responder))

    def test_an_old_firmware_gets_an_update_hint(self):
        board, _ = self.board({"ok": False, "error": "unknown_command", "message": "this firmware does not know the command"})
        with self.assertRaises(pixelart.BoardError) as e:
            self.run_wipe(board, yes=True)
        self.assertIn("update the board's firmware", str(e.exception))

    def test_a_storage_error_is_reported(self):
        board, _ = self.board({"ok": False, "error": "storage_error", "message": "a file cannot be removed"})
        with self.assertRaises(pixelart.BoardError) as e:
            self.run_wipe(board, yes=True)
        self.assertIn("storage_error", str(e.exception))

    def test_invalid_counts_are_refused(self):
        for reply in [{"ok": True}, {"ok": True, "playlists": "1", "animations": 2}, {"ok": True, "playlists": True, "animations": 2}]:
            board, _ = self.board(reply)
            with self.assertRaises(pixelart.BoardError):
                self.run_wipe(board, yes=True)


class ArgumentTest(unittest.TestCase):
    def test_kind_inference(self):
        self.assertEqual(pixelart.infer_kind(Path("/x/animations/a.yaml"), {}), "animation")
        self.assertEqual(pixelart.infer_kind(Path("/x/playlists/a.yaml"), {}), "playlist")
        self.assertEqual(pixelart.infer_kind(Path("/x/y/a.json"), {"format": "pixelart/1"}), "animation")
        self.assertEqual(pixelart.infer_kind(Path("/x/y/a.json"), {"format": "pixelart-playlist/1"}), "playlist")
        self.assertEqual(pixelart.infer_kind(Path("/x/play/a.json"), {}), "play")
        self.assertEqual(pixelart.infer_kind(Path("/x/content/play.yaml"), {"format": "pixelart-play/1"}), "play")
        self.assertIsNone(pixelart.infer_kind(Path("/x/y/a.json"), {"format": "other"}))

    def test_settings(self):
        self.assertEqual(pixelart.parse_settings(["brightness=40", "playlist=xmas"]),
                         {"brightness": 40, "playlist": "xmas"})
        for bad in ["brightness=256", "brightness=-1", "brightness=x", "playlist=../x", "volume=1", "brightness"]:
            with self.assertRaises(pixelart.BoardError, msg=bad):
                pixelart.parse_settings([bad])

    def test_schedule_kind_inference(self):
        self.assertEqual(pixelart.infer_kind(Path("/x/schedules/a.yaml"), {}), "schedule")
        self.assertEqual(pixelart.infer_kind(Path("/x/y/a.json"), {"format": "pixelart-schedule/1"}), "schedule")

    def test_play_settings(self):
        self.assertEqual(
            pixelart.parse_settings(["play=playlists", "playlists=halloween,christmas", "time_sync_hours=168",
                                     "ntp_server=time.example-1.org"]),
            {"play": "playlists", "playlists": ["halloween", "christmas"], "time_sync_hours": 168,
             "ntp_server": "time.example-1.org"})
        self.assertEqual(pixelart.parse_settings(["play=auto", "playlists=default", "ntp_server=192.168.0.1"]),
                         {"play": "auto", "playlists": ["default"], "ntp_server": "192.168.0.1"})
        self.assertEqual(pixelart.parse_settings(["play=schedule", "schedule=seasons"]),
                         {"play": "schedule", "schedule": "seasons"})
        eight = ",".join(f"p{i}" for i in range(8))
        self.assertEqual(len(pixelart.parse_settings([f"playlists={eight}"])["playlists"]), 8)
        for bad in ["play=other", "schedule=", "schedule=Bad", "schedule=a,b", "play=", "playlists=", "playlists=a,", "playlists=a,a", "playlists=A",
                    f"playlists={eight},p8", "playlists=a b", "time_sync_hours=0", "time_sync_hours=169",
                    "ntp_server=", "ntp_server=" + "a" * 65, "ntp_server=a_b", "ntp_server=a:123", "ntp_server=a b"]:
            with self.assertRaises(pixelart.BoardError, msg=bad):
                pixelart.parse_settings([bad])
        self.assertEqual(len(pixelart.parse_settings(["ntp_server=" + "a" * 64])["ntp_server"]), 64)

    def test_the_command_line_takes_the_schedule_and_play_kinds(self):
        parser = argparse.ArgumentParser()
        pixelart.add_board_parser(parser.add_subparsers(dest="command"))
        for kind in ("schedule", "play"):
            for command in (["ls"], ["put", "x.yaml"], ["get", "default"], ["rm", "default"]):
                args = parser.parse_args(["board", "--port", "x", *command, "--kind", kind])
                self.assertEqual(args.kind, kind)


class ScheduleCommandTest(unittest.TestCase):
    def test_ls_lists_schedules_only_on_a_board_that_has_them(self):
        for formats, kinds in (({"animation": ["pixelart/1"], "playlist": ["pixelart-playlist/1"]}, ["animation", "playlist"]),
                               ({"schedule": ["pixelart-schedule/1"]}, ["animation", "playlist", "schedule"]),
                               ({"schedule": ["pixelart-schedule/1"], "play": ["pixelart-play/1"]},
                                ["animation", "playlist", "schedule", "play"]),
                               (None, ["animation", "playlist"])):
            info = dict(INFO, formats=formats)
            asked = []

            def handler(body, asked=asked, info=info):
                if body["cmd"] == "info":
                    return info
                asked.append(body["kind"])
                return {"ok": True, "entries": [], "more": False}

            board = pixelart.Board(Responder(handler))
            with contextlib.redirect_stdout(io.StringIO()):
                pixelart.board_ls(board, types.SimpleNamespace(kind=None))
            self.assertEqual(asked, kinds, formats)

    def test_a_schedule_download_is_limited_to_16_kib(self):
        size = 16 * 1024 + 1
        board = pixelart.Board(Responder(serve({"ok": True, "entries": [{"id": "default", "size": size, "sha256": "0" * 64}]})))
        board.limits = {}
        with self.assertRaises(pixelart.BoardError) as e:
            pixelart.download(board, "schedule", "default")
        self.assertIn("above the limit of 16384", str(e.exception))

    def test_a_play_download_is_limited_to_1_kib(self):
        board = pixelart.Board(Responder(serve({"ok": True, "entries": [{"id": "default", "size": 1025, "sha256": "0" * 64}]})))
        board.limits = {}
        with self.assertRaises(pixelart.BoardError) as e:
            pixelart.download(board, "play", "default")
        self.assertIn("above the limit of 1024", str(e.exception))

    def test_put_sends_a_play_file_as_the_id_default(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "play.yaml"
            path.write_text("format: pixelart-play/1\ndefault: {schedule: seasons}\n")
            for file_id, expected in ((None, "default"), ("other", "other")):
                begun = []

                def handler(body, begun=begun):
                    if body["cmd"] == "info":
                        return INFO
                    if body["cmd"] == "put_begin":
                        begun.append((body["kind"], body["id"], body["size"]))
                        return {"ok": True}
                    if body["cmd"] == "put_chunk":
                        return {"ok": True, "received": body["offset"] + len(base64.b64decode(body["data"]))}
                    return {"ok": True, "warnings": []}

                with contextlib.redirect_stdout(io.StringIO()) as out:
                    args = types.SimpleNamespace(file=path, kind=None, id=file_id)
                    pixelart.board_put(pixelart.Board(Responder(handler)), args)
                self.assertEqual(begun, [("play", expected, 61)])
                self.assertIn(f"uploaded play '{expected}'", out.getvalue())

    def test_put_sends_a_schedule_from_its_folder(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "schedules" / "default.yaml"
            path.parent.mkdir()
            path.write_text("format: pixelart-schedule/1\nfallback: [default]\n")
            begun = []

            def handler(body):
                if body["cmd"] == "info":
                    return INFO
                if body["cmd"] == "put_begin":
                    begun.append((body["kind"], body["id"]))
                    return {"ok": True}
                if body["cmd"] == "put_chunk":
                    return {"ok": True, "received": body["offset"] + len(base64.b64decode(body["data"]))}
                return {"ok": True, "warnings": []}

            with contextlib.redirect_stdout(io.StringIO()) as out:
                pixelart.board_put(pixelart.Board(Responder(handler)), types.SimpleNamespace(file=path, kind=None, id=None))
            self.assertEqual(begun, [("schedule", "default")])
            self.assertIn("uploaded schedule 'default'", out.getvalue())

    def test_settings_prints_a_list_as_ids_separated_by_commas(self):
        reply = {"ok": True, "settings": {"play": "playlists", "playlists": ["halloween", "christmas"], "playlist": "halloween"}}
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            pixelart.board_settings(pixelart.Board(Responder(serve(reply))), types.SimpleNamespace(pairs=[]))
        self.assertEqual(out.getvalue(), "play=playlists\nplaylists=halloween,christmas\nplaylist=halloween\n")

    def test_wipe_prints_the_schedules_a_newer_board_removed(self):
        board = pixelart.Board(Responder(serve({"ok": True, "schedules": 1, "playlists": 2, "animations": 30})))
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(pixelart.board_wipe(board, types.SimpleNamespace(yes=True, settings=False)), 0)
        self.assertEqual(out.getvalue(), "deleted 1 schedules, 2 playlists and 30 animations\n")
        for schedules in ("1", True, -1, None):
            board = pixelart.Board(Responder(serve({"ok": True, "schedules": schedules, "playlists": 0, "animations": 0})))
            with self.assertRaises(pixelart.BoardError, msg=repr(schedules)):
                pixelart.board_wipe(board, types.SimpleNamespace(yes=True, settings=False))

    def test_wipe_prints_the_play_files_a_newer_board_removed(self):
        board = pixelart.Board(Responder(serve({"ok": True, "play": 1, "schedules": 1, "playlists": 2, "animations": 30})))
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(pixelart.board_wipe(board, types.SimpleNamespace(yes=True, settings=False)), 0)
        self.assertEqual(out.getvalue(), "deleted 1 play files, 1 schedules, 2 playlists and 30 animations\n")
        for play in ("1", True, -1, None):
            board = pixelart.Board(Responder(serve({"ok": True, "play": play, "schedules": 0, "playlists": 0, "animations": 0})))
            with self.assertRaises(pixelart.BoardError, msg=repr(play)):
                pixelart.board_wipe(board, types.SimpleNamespace(yes=True, settings=False))

    def test_wipe_settings_prints_the_lists_of_the_reset(self):
        reply = {"ok": True, "schedules": 0, "playlists": 0, "animations": 0,
                 "settings": {"brightness": 100, "play": "auto", "playlists": ["default"], "playlist": "default"}}
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            pixelart.board_wipe(pixelart.Board(Responder(serve(reply))), types.SimpleNamespace(yes=True, settings=True))
        self.assertEqual(out.getvalue(), "deleted 0 schedules, 0 playlists and 0 animations\n"
                                         "brightness=100\nplay=auto\nplaylists=default\nplaylist=default\n")



class ImprovFake:
    """A transport that records the raw bytes sent and answers them with queued raw chunks."""

    def __init__(self, handler, protocol_handler=None):
        self.raw_sent = []
        self.chunks = []
        self.handler = handler
        self.protocol = Responder(protocol_handler or serve({"ok": True}))

    def send(self, line):
        self.protocol.send(line)

    def receive(self, timeout):
        return self.protocol.receive(timeout)

    def send_raw(self, data):
        self.raw_sent.append(data)
        self.chunks += self.handler(data)

    def receive_raw(self, timeout):
        return self.chunks.pop(0) if self.chunks else b""

    def close(self):
        pass


class ImprovTest(unittest.TestCase):
    def test_a_frame_is_built_like_the_specification(self):
        # IMPROV is 477; 477 + 1 + 3 + 2 + 2 + 0 = 485, which is 0xE5.
        self.assertEqual(pixelart.improv_frame(3, bytes([2, 0])), b"IMPROV" + bytes([1, 3, 2, 2, 0, 0xE5]))

    def test_wifi_settings_carry_the_lengths_and_both_texts(self):
        frame = pixelart.improv_wifi_settings(b"ab", b"xyz")
        args = bytes([2]) + b"ab" + bytes([3]) + b"xyz"
        self.assertEqual(frame[:9], b"IMPROV" + bytes([1, 3, len(args) + 2]))
        self.assertEqual(frame[9:-1], bytes([1, len(args)]) + args)
        self.assertEqual(frame[-1], sum(frame[:-1]) % 256)

    def test_wifi_settings_refuse_what_the_board_would(self):
        for ssid, password in [(b"", b"x"), (b"a" * 33, b""), (b"a", b"p" * 65), (b"a\0", b"p"), (b"a", b"p\0")]:
            with self.assertRaises(pixelart.BoardError):
                pixelart.improv_wifi_settings(ssid, password)
        pixelart.improv_wifi_settings(b"a" * 32, b"p" * 64)
        pixelart.improv_wifi_settings(b"a", b"")

    def test_frames_are_found_in_a_stream_with_other_bytes_and_split_reads(self):
        state = pixelart.improv_frame(1, bytes([4]))
        error = pixelart.improv_frame(2, bytes([3]))
        stream = bytearray(b"pixelart: boot\n@PR 12345678 {}\n" + state[:5])
        self.assertEqual(pixelart.improv_frames(stream), [])
        stream += state[5:] + b"noise" + error
        self.assertEqual(pixelart.improv_frames(stream), [(1, bytes([4])), (2, bytes([3]))])

    def test_a_frame_with_a_newline_and_a_bad_checksum(self):
        good = pixelart.improv_frame(4, b"a\nb")
        bad = good[:-1] + bytes([(good[-1] + 1) % 256])
        stream = bytearray(bad + good)
        self.assertEqual(pixelart.improv_frames(stream), [(4, b"a\nb")])

    def reply(self, *frames):
        return lambda data: [b"".join(frames)]

    def run_wifi(self, transport, forget=False, answers=("HomeNet", "pw")):
        out, err = io.StringIO(), io.StringIO()
        board = pixelart.Board(transport)
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err), \
                mock.patch("getpass.getpass", side_effect=list(answers)) as asked:
            code = pixelart.board_wifi(board, types.SimpleNamespace(forget=forget))
        return code, out.getvalue(), err.getvalue(), asked

    def test_wifi_sends_the_network_and_waits_for_provisioned(self):
        provisioning = pixelart.improv_frame(1, bytes([3]))
        provisioned = pixelart.improv_frame(1, bytes([4]))
        status = {"ok": True, "wifi": {"state": "connected", "ip": "10.0.0.5", "rssi": -58, "power": "19.5",
                                       "power_reduced": False, "hostname": "pixelart-118c"},
                  "time": {"known": False}, "update": {"state": "idle"}}
        transport = ImprovFake(self.reply(provisioning, provisioned),
                               lambda body: INFO if body["cmd"] == "info" else status)
        code, out, err, asked = self.run_wifi(transport, answers=("SecretNet", "SecretPass"))
        self.assertEqual(code, 0)
        self.assertEqual(transport.raw_sent, [pixelart.improv_wifi_settings(b"SecretNet", b"SecretPass")])
        self.assertIn("connected", out)
        self.assertIn("10.0.0.5", out)
        self.assertIn("good", out)  # -58 dBm
        # The name and the password are asked for with hidden input and never printed.
        self.assertEqual(asked.call_count, 2)
        for text in (out, err):
            self.assertNotIn("SecretNet", text)
            self.assertNotIn("SecretPass", text)

    def test_wifi_reports_unable_to_connect_without_the_secrets(self):
        transport = ImprovFake(self.reply(pixelart.improv_frame(2, bytes([3]))), lambda body: INFO)
        with self.assertRaises(pixelart.BoardError) as e:
            self.run_wifi(transport, answers=("SecretNet", "SecretPass"))
        self.assertIn("could not connect", str(e.exception))
        self.assertNotIn("SecretNet", str(e.exception))
        self.assertNotIn("SecretPass", str(e.exception))

    def test_wifi_ignores_error_none_and_times_out(self):
        transport = ImprovFake(self.reply(pixelart.improv_frame(2, bytes([0]))), lambda body: INFO)
        with mock.patch.object(pixelart, "IMPROV_TIMEOUT", 0.05), self.assertRaises(pixelart.BoardError) as e:
            self.run_wifi(transport)
        self.assertIn("did not answer", str(e.exception))

    def test_wifi_over_the_websocket_says_it_needs_usb(self):
        board = pixelart.Board(Responder(serve({"ok": True})))
        with self.assertRaises(pixelart.BoardError) as e, mock.patch("getpass.getpass") as asked:
            pixelart.board_wifi(board, types.SimpleNamespace(forget=False))
        self.assertIn("--port", str(e.exception))
        asked.assert_not_called()

    def test_forget_sends_wifi_forget_and_asks_for_nothing(self):
        responder = Responder(serve({"ok": True}))
        board = pixelart.Board(responder)
        out = io.StringIO()
        with contextlib.redirect_stdout(out), mock.patch("getpass.getpass") as asked:
            self.assertEqual(pixelart.board_wifi(board, types.SimpleNamespace(forget=True)), 0)
        asked.assert_not_called()
        self.assertEqual([pixelart.decode_line(l)["cmd"] for l in responder.sent][-1], "wifi_forget")

    def test_the_command_line_has_wifi_and_status(self):
        parser = argparse.ArgumentParser()
        pixelart.add_board_parser(parser.add_subparsers(dest="command"))
        self.assertTrue(parser.parse_args(["board", "--port", "x", "wifi", "--forget"]).forget)
        self.assertFalse(parser.parse_args(["board", "--port", "x", "wifi"]).forget)
        self.assertEqual(parser.parse_args(["board", "--ws", "ws://x", "status"]).board_command, "status")


class UpdateCommandTest(unittest.TestCase):
    """`board update check` and `board update install animations`: a request, then status until the board is idle."""

    @staticmethod
    def args(command, target=None, force=False):
        return types.SimpleNamespace(update_command=command, target=target, force=force)

    @staticmethod
    def scripted(updates, start_error=None, boot_ids=None):
        """A board that answers the update request and then a status per entry of `updates`, the last one repeating."""
        requests = []
        states = list(updates)

        def answer(body):
            requests.append(body)
            if body["cmd"] == "info":
                if boot_ids is None:
                    return INFO
                # The first info is the one the Board reads when it starts: the boot before the restart.
                return {**INFO, "boot_id": 1} if len(requests) == 1 else {**INFO, "boot_id": boot_ids.pop(0), "firmware": "1.3.0"}
            if body["cmd"] in ("update_check", "update_install"):
                return {"ok": False, "error": start_error, "message": "no"} if start_error else {"ok": True}
            update = states.pop(0) if len(states) > 1 else states[0]
            return {"ok": True, "wifi": {}, "time": {}, "update": update}

        return requests, Responder(answer)

    def run_update(self, args, updates, start_error=None, boot_ids=None):
        requests, responder = self.scripted(updates, start_error, boot_ids)
        out = io.StringIO()
        with contextlib.redirect_stdout(out), mock.patch.object(pixelart, "UPDATE_POLL", 0):
            code = pixelart.board_update(pixelart.Board(responder), args)
        return code, out.getvalue(), requests

    def test_check_waits_for_the_board_and_prints_the_result(self):
        running = {"state": "checking", "progress": 0, "last_check": None, "last_result": None, "files": 0}
        done = {"state": "idle", "progress": 0, "last_check": 0, "last_result": "ok", "failed_files": 0, "firmware": None,
                "files": 3, "last_install": None}
        code, out, requests = self.run_update(self.args("check"), [running, running, done])
        self.assertEqual(code, 0)
        self.assertEqual([r["cmd"] for r in requests][1:], ["update_check", "status", "status", "status"])
        self.assertIn("3 to add or replace", out)
        self.assertIn("0 seconds ago, ok", out)

    def test_a_check_without_a_published_release_says_so_and_fails(self):
        done = {"state": "idle", "progress": 0, "last_check": 0, "last_result": "http_error", "last_detail": "no_release",
                "failed_files": 0, "firmware": None, "files": 0, "last_install": None}
        code, out, _ = self.run_update(self.args("check"), [done])
        self.assertEqual(code, 1)
        self.assertIn("http_error: no release is published at this address yet", out)

    def test_install_sends_its_target_and_fails_when_the_update_did(self):
        done = {"state": "idle", "progress": 0, "last_check": 5, "last_result": "network_error", "failed_files": 1,
                "firmware": None, "files": 1, "last_install": None}
        code, out, requests = self.run_update(self.args("install", "animations"), [done])
        self.assertEqual(code, 1)
        self.assertEqual(requests[1]["cmd"], "update_install")
        self.assertEqual(requests[1]["target"], "animations")
        self.assertIn("network_error", out)
        self.assertIn("1 file in the last update", out)

    def test_waiting_for_the_install_window_counts_as_done(self):
        waiting = {"state": "waiting_for_time", "progress": 0, "last_check": 0, "last_result": "ok", "files": 1}
        code, out, _ = self.run_update(self.args("check"), [waiting])
        self.assertEqual(code, 0)
        self.assertIn("waiting_for_time", out)

    def test_a_refused_request_is_an_error_with_the_boards_code(self):
        with self.assertRaises(pixelart.BoardError) as e:
            self.run_update(self.args("check"), [{"state": "idle"}], start_error="updates_off")
        self.assertIn("updates_off", str(e.exception))

    def test_a_board_that_never_finishes_ends_the_wait(self):
        running = {"state": "downloading", "progress": 10}
        with mock.patch.dict(pixelart.UPDATE_WAIT, {"check": 0.0}), self.assertRaises(pixelart.BoardError) as e:
            self.run_update(self.args("check"), [running])
        self.assertIn("still working", str(e.exception))

    def test_the_command_line_has_update_check_and_install_animations(self):
        parser = argparse.ArgumentParser()
        pixelart.add_board_parser(parser.add_subparsers(dest="command"))
        self.assertEqual(parser.parse_args(["board", "--ws", "ws://x", "update", "check"]).update_command, "check")
        args = parser.parse_args(["board", "--ws", "ws://x", "update", "install", "animations"])
        self.assertEqual((args.update_command, args.target), ("install", "animations"))
        args = parser.parse_args(["board", "--ws", "ws://x", "update", "install", "firmware", "--force"])
        self.assertEqual((args.target, args.force), ("firmware", True))
        self.assertFalse(parser.parse_args(["board", "--ws", "ws://x", "update", "install", "firmware"]).force)
        with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
            parser.parse_args(["board", "--ws", "ws://x", "update", "install", "other"])

    def test_firmware_install_sends_force_only_when_asked_and_waits_for_the_restart(self):
        installing = {"state": "installing", "progress": 40}
        idle = {"state": "idle", "progress": 0, "last_check": None, "last_result": None, "firmware": None, "files": 0}
        code, out, requests = self.run_update(self.args("install", "firmware"), [installing, installing, idle],
                                              boot_ids=[2])
        self.assertEqual(code, 0)
        self.assertEqual(requests[1], {"seq": requests[1]["seq"], "cmd": "update_install", "target": "firmware"})
        self.assertIn("restarted", out)
        self.assertIn("1.3.0", out)
        _, _, requests = self.run_update(self.args("install", "firmware", force=True), [installing, idle], boot_ids=[2])
        self.assertIs(requests[1]["force"], True)

    def test_a_failed_firmware_install_prints_the_state_and_fails(self):
        installing = {"state": "installing", "progress": 40}
        failed = {"state": "idle", "progress": 0, "last_check": 3, "last_result": "checksum_mismatch", "firmware": "1.3.0",
                  "files": 0, "last_install": None}
        code, out, _ = self.run_update(self.args("install", "firmware"), [installing, failed], boot_ids=[1])
        self.assertEqual(code, 1)
        self.assertIn("checksum_mismatch", out)

    def test_force_is_for_the_firmware_only(self):
        with self.assertRaises(pixelart.BoardError) as e:
            self.run_update(self.args("install", "animations", force=True), [{"state": "idle"}])
        self.assertIn("firmware only", str(e.exception))


class RequestLineTest(unittest.TestCase):
    def test_every_setting_at_its_longest_fits_the_1024_byte_request_line(self):
        body = {"seq": 4294967295, "cmd": "settings_set", "brightness": 255, "playlist": "p" * 32, "wifi_power": "18.5",
                "update_mode": "automatic", "update_firmware": False, "update_animations": False, "check_hours": 168,
                "install_start": 1439, "install_end": 1439, "timezone": "Z" * 64,
                "animation_source": "https://example.com/" + "a" * 492, "network_login": False}
        self.assertEqual(len(body["animation_source"]), 512)
        line = pixelart.encode_line(body)
        # 13 bytes of marker and CRC, then the JSON: 903 bytes in all, 121 under the limit.
        self.assertEqual(len(line), 903)
        self.assertLessEqual(len(line), 1024)


class StatusTest(unittest.TestCase):
    def test_status_prints_the_wifi_and_update_state(self):
        status = {"ok": True, "wifi": {"state": "network_not_found", "ip": None, "rssi": None, "power": "8.5",
                                       "power_reduced": True, "hostname": "pixelart-118c"},
                  "time": {"known": True}, "update": {"state": "idle", "last_check": None, "files": 0}}
        board = pixelart.Board(Responder(serve(status)))
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            pixelart.board_status(board, None)
        text = out.getvalue()
        for expected in ("network_not_found", "none", "pixelart-118c.local", "8.5 dBm (reduced)", "known",
                         "update    idle", "not since the board started", "none available", "0 to add or replace"):
            self.assertIn(expected, text)

    def status_text(self, wifi, update=None):
        status = {"ok": True, "wifi": wifi, "time": {"known": True}, "update": update or {"state": "idle"}}
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            pixelart.board_status(pixelart.Board(Responder(serve(status))), None)
        return out.getvalue()

    def test_status_prints_the_network_name_through_safe(self):
        text = self.status_text({"state": "connected", "ssid": "Caf\u00e9 \u00dc 2.4G"})
        self.assertIn("network   Caf\u00e9 \u00dc 2.4G\n", text)
        self.assertIn("network   none\n", self.status_text({"state": "not_configured", "ssid": None}))
        self.assertIn("network   none\n", self.status_text({"state": "connected"}))
        hostile = self.status_text({"state": "connected", "ssid": "Net\x1b[2J\x07\u202e\ufffd"})
        self.assertNotIn("\x1b", hostile)
        self.assertNotIn("\x07", hostile)
        self.assertNotIn("\u202e", hostile)
        self.assertIn("network   Net\\x1b[2J\\x07\\u202e\ufffd\n", hostile)

    def test_status_says_when_no_release_is_published_yet(self):
        update = {"state": "idle", "last_check": 120, "last_result": "http_error", "last_detail": "no_release"}
        text = self.status_text({"state": "connected"}, update)
        self.assertIn("checked   2 minutes ago, http_error: no release is published at this address yet", text)
        self.assertIn("check the animation source", text)
        # Another HTTP error keeps its code alone, and so does a detail on another result.
        plain = self.status_text({"state": "connected"}, dict(update, last_detail=None))
        self.assertIn("checked   2 minutes ago, http_error\n", plain)
        other = self.status_text({"state": "connected"}, dict(update, last_result="network_error"))
        self.assertIn("checked   2 minutes ago, network_error\n", other)
        before = self.status_text({"state": "connected"}, dict(update, last_check=None))
        self.assertIn("not since the board started, last result http_error: no release", before)

    def test_status_describes_a_running_and_a_finished_update_readably(self):
        wifi = {"state": "connected", "ip": "10.0.0.5", "rssi": -58, "power": "19.5", "power_reduced": False,
                "hostname": "pixelart-118c"}
        update = {"state": "downloading", "progress": 42, "last_check": 720, "last_result": "ok", "failed_files": 2,
                  "firmware": "1.3.0", "files": 3, "last_install": {"result": "updated", "from": "1.2.0", "to": "1.3.0"}}
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            pixelart.board_status(pixelart.Board(Responder(serve({"ok": True, "wifi": wifi, "time": {"known": True},
                                                                  "update": update}))), None)
        text = out.getvalue()
        for expected in ("update    downloading, 42 %", "checked   12 minutes ago, ok", "firmware  1.3.0 available",
                         "files     3 to add or replace", "failed    2 files in the last update",
                         "installed updated, from 1.2.0 to 1.3.0"):
            self.assertIn(expected, text)
        self.assertNotIn("update.", text)

    def test_ages_are_short_words(self):
        for seconds, text in [(0, "0 seconds"), (1, "1 second"), (59, "59 seconds"), (60, "1 minute"), (3599, "59 minutes"),
                              (3600, "1 hour"), (86399, "23 hours"), (86400, "1 day"), (200000, "2 days"),
                              (None, "unknown"), (-1, "unknown"), (True, "unknown")]:
            self.assertEqual(pixelart.age_text(seconds), text, seconds)

    def test_status_escapes_text_from_the_board(self):
        status = {"ok": True, "wifi": {"state": "x\x1b[2J", "hostname": "h\x07"}, "time": {}, "update": {"state": "a\x1b"}}
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            pixelart.board_status(pixelart.Board(Responder(serve(status))), None)
        self.assertNotIn("\x1b", out.getvalue())
        self.assertNotIn("\x07", out.getvalue())

    def test_signal_words_follow_the_legend(self):
        for rssi, word in [(-30, "excellent"), (-50, "excellent"), (-51, "good"), (-67, "good"), (-68, "fair"),
                           (-75, "fair"), (-76, "weak"), (None, "unknown")]:
            self.assertEqual(pixelart.signal_quality(rssi), word, rssi)

    def test_new_settings_parse_to_their_types(self):
        self.assertEqual(
            pixelart.parse_settings(["wifi_power=8.5", "update_mode=automatic", "update_firmware=false", "check_hours=12",
                                     "install_start=0", "install_end=1439", "network_login=true", "timezone=CET-1",
                                     "animation_source=http://localhost:8000/manifest.json"]),
            {"wifi_power": "8.5", "update_mode": "automatic", "update_firmware": False, "check_hours": 12, "install_start": 0,
             "install_end": 1439, "network_login": True, "timezone": "CET-1",
             "animation_source": "http://localhost:8000/manifest.json"})
        for bad in ["wifi_power=20", "update_mode=on", "update_firmware=yes", "check_hours=0", "check_hours=169",
                    "install_start=1440", "install_end=-1", "network_login=1", "token=abc"]:
            with self.assertRaises(pixelart.BoardError, msg=bad):
                pixelart.parse_settings([bad])

    def test_settings_prints_the_new_settings_and_the_token(self):
        reply = {"ok": True, "settings": {"brightness": 100, "wifi_power": "auto", "token": "abcdefghijklmnop"}}
        board = pixelart.Board(Responder(serve(reply)))
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            pixelart.board_settings(board, types.SimpleNamespace(pairs=[]))
        self.assertIn("wifi_power=auto", out.getvalue())
        self.assertIn("token=abcdefghijklmnop", out.getvalue())


class PlayChoiceTest(unittest.TestCase):
    SCHEDULES, PLAYLISTS = {"seasons"}, {"default", "christmas"}

    def check(self, document, size=None):
        return pixelart.validate_play(document, size, self.SCHEDULES, self.PLAYLISTS)

    def codes(self, document, size=None):
        return [d["code"] for d in self.check(document, size)]

    def test_a_schedule_or_a_list_of_playlists_is_valid(self):
        for choice in ({"schedule": "seasons"}, {"playlists": ["christmas"]}, {"playlists": ["christmas", "default"]}):
            with self.subTest(choice=choice):
                self.assertEqual(self.check({"format": "pixelart-play/1", "default": choice}), [])

    def test_the_format_is_checked_first(self):
        for document in (None, [], "play", {}, {"format": "pixelart-play/2", "default": {"schedule": "seasons"}},
                         {"default": {"schedule": "seasons"}}):
            with self.subTest(document=document):
                self.assertEqual(self.codes(document), ["format_unsupported"])

    def test_the_structure_is_checked(self):
        play = "pixelart-play/1"
        for document in ({"format": play},
                         {"format": play, "default": None},
                         {"format": play, "default": "seasons"},
                         {"format": play, "default": {}},
                         {"format": play, "default": {"schedule": "seasons", "playlists": ["default"]}},
                         {"format": play, "default": {"schedule": "seasons", "other": 1}},
                         {"format": play, "default": {"other": 1}},
                         {"format": play, "default": {"schedule": None}},
                         {"format": play, "default": {"schedule": 5}},
                         {"format": play, "default": {"schedule": "Bad ID"}},
                         {"format": play, "default": {"schedule": "x" * 33}},
                         {"format": play, "default": {"playlists": "default"}},
                         {"format": play, "default": {"playlists": None}},
                         {"format": play, "default": {"playlists": []}},
                         {"format": play, "default": {"playlists": [1]}},
                         {"format": play, "default": {"playlists": ["Bad"]}},
                         {"format": play, "default": {"playlists": ["default", "default"]}},
                         {"format": play, "default": {"seasons": "x"}, "extra": 1}):
            with self.subTest(document=document):
                self.assertIn("structure", self.codes(document))

    def test_more_than_eight_playlists_exceed_the_limit(self):
        ids = [f"p{i}" for i in range(9)]
        self.assertIn("limit_exceeded", self.codes({"format": "pixelart-play/1", "default": {"playlists": ids}}))
        eight = pixelart.validate_play({"format": "pixelart-play/1", "default": {"playlists": ids[:8]}}, None, set(), set(ids))
        self.assertEqual(eight, [])

    def test_a_file_over_1_kib_exceeds_the_limit(self):
        document = {"format": "pixelart-play/1", "default": {"schedule": "seasons"}}
        self.assertEqual(self.codes(document, 1024), [])
        self.assertEqual(self.codes(document, 1025), ["limit_exceeded"])

    def test_what_the_choice_names_and_the_content_lacks_is_a_warning(self):
        for document, codes in (({"schedule": "ghost"}, ["unknown_schedule"]),
                                ({"playlists": ["default", "ghost", "other"]}, ["unknown_playlist", "unknown_playlist"])):
            with self.subTest(document=document):
                diagnostics = self.check({"format": "pixelart-play/1", "default": document})
                self.assertEqual([d["code"] for d in diagnostics], codes)
                self.assertEqual({d["severity"] for d in diagnostics}, {"warning"})
                self.assertFalse(diagnostics.has_errors())

    def test_without_the_sets_nothing_is_checked_against_the_content(self):
        document = {"format": "pixelart-play/1", "default": {"schedule": "ghost"}}
        self.assertEqual(pixelart.validate_play(document), [])


class BuildStaleOutputTest(unittest.TestCase):
    PLAYLIST = "format: pixelart-playlist/1\ncanvas: { width: 16, height: 16 }\nitems:\n  - animation: dot\n"
    SCHEDULE = "format: pixelart-schedule/1\nfallback: [keep]\n"

    def run_build(self, source, out):
        err = io.StringIO()
        with contextlib.redirect_stdout(io.StringIO()) as stdout, contextlib.redirect_stderr(err):
            code = pixelart.build(source, out, False)
        return code, stdout.getvalue()

    def test_a_rebuild_leaves_exactly_the_build_of_the_content(self):
        with tempfile.TemporaryDirectory() as folder:
            source, out = Path(folder) / "src", Path(folder) / "out"
            for kind in ("animations", "playlists", "schedules"):
                (source / kind).mkdir(parents=True)
            for name in ("keep", "gone", "broken"):
                (source / "playlists" / f"{name}.yaml").write_text(self.PLAYLIST)
            (source / "schedules" / "old.yaml").write_text(self.SCHEDULE)
            self.assertEqual(self.run_build(source, out)[0], 0)
            # A source deleted, one that now fails, a schedule removed, and files that no source produces, such as an
            # upload to the simulator, in every folder of the board
            (source / "playlists" / "gone.yaml").unlink()
            (source / "playlists" / "broken.yaml").write_text("items: [\n")
            (source / "schedules" / "old.yaml").unlink()
            for path in ("animations/uploaded.json", "play/other.json"):
                (out / path).parent.mkdir(parents=True, exist_ok=True)
                (out / path).write_text("{}")
            (out / "playlists" / "notes.txt").write_text("not a board file")
            code, printed = self.run_build(source, out)
            self.assertEqual(code, 1)  # broken.yaml fails
            files = sorted(p.relative_to(out).as_posix() for p in out.rglob("*") if p.is_file())
            self.assertEqual(files, ["playlists/keep.json", "playlists/notes.txt"])
            self.assertIn("removed 5 stale", printed)


class BuildPlayTest(unittest.TestCase):
    SCHEDULE = "format: pixelart-schedule/1\nfallback: [default]\n"
    PLAYLIST = "format: pixelart-playlist/1\ncanvas: { width: 16, height: 16 }\nitems:\n  - animation: dot\n"
    # Every file of the content built here, written by the fixtures below
    CONTENT = ["playlists/christmas.json", "playlists/default.json", "schedules/seasons.json"]

    def build(self, play, schema=False, schedules=True):
        with tempfile.TemporaryDirectory() as folder:
            source, out = Path(folder) / "src", Path(folder) / "out"
            for kind in ("animations", "playlists", "schedules"):
                (source / kind).mkdir(parents=True)
            (source / "playlists" / "default.yaml").write_text(self.PLAYLIST)
            (source / "playlists" / "christmas.yaml").write_text(self.PLAYLIST)
            if schedules:
                (source / "schedules" / "seasons.yaml").write_text(self.SCHEDULE)
            if play is not None:
                (source / "play.yaml").write_text(play)
            err = io.StringIO()
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(err):
                code = pixelart.build(source, out, schema)
            files = sorted(p.relative_to(out).as_posix() for p in out.rglob("*") if p.is_file())
            played = (out / "play" / "default.json").read_bytes() if (out / "play" / "default.json").exists() else None
            return code, err.getvalue(), files, played

    def test_a_valid_play_yaml_is_built_as_the_play_file_default(self):
        for play, expected in (("format: pixelart-play/1\ndefault: {schedule: seasons}\n",
                                b'{"format":"pixelart-play/1","default":{"schedule":"seasons"}}'),
                               ("format: pixelart-play/1\ndefault:\n  playlists: [christmas, default]\n",
                                b'{"format":"pixelart-play/1","default":{"playlists":["christmas","default"]}}')):
            for schema in (False, True):
                with self.subTest(play=play, schema=schema):
                    code, err, files, played = self.build(play, schema)
                    self.assertEqual((code, err), (0, ""))
                    self.assertEqual(files, sorted(self.CONTENT + ["play/default.json"]))
                    self.assertEqual(played, expected)

    def test_a_rebuild_into_the_same_folder_drops_a_play_file_whose_source_is_gone_or_fails(self):
        for second in (None, "format: pixelart-play/1\ndefault: {playlists: []}\n"):
            with self.subTest(second=second), tempfile.TemporaryDirectory() as folder:
                source, out = Path(folder) / "src", Path(folder) / "out"
                (source / "schedules").mkdir(parents=True)
                (source / "schedules" / "seasons.yaml").write_text(self.SCHEDULE)
                (source / "play.yaml").write_text("format: pixelart-play/1\ndefault: {schedule: seasons}\n")
                with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                    self.assertEqual(pixelart.build(source, out, False), 0)
                    self.assertTrue((out / "play" / "default.json").exists())
                    if second is None:
                        (source / "play.yaml").unlink()
                    else:
                        (source / "play.yaml").write_text(second)
                    pixelart.build(source, out, False)
                self.assertFalse((out / "play" / "default.json").exists())

    def test_no_play_yaml_builds_no_play_file(self):
        code, err, files, played = self.build(None)
        self.assertEqual((code, err, files, played), (0, "", self.CONTENT, None))

    def test_a_play_yaml_with_a_problem_fails_the_build_and_writes_nothing(self):
        for play, message in (("format: pixelart-play/1\ndefault: {schedule: seasons, playlists: [default]}\n", "exactly one"),
                              ("format: pixelart-play/1\ndefault: {schedule: seasons}\nextra: 1\n", "unknown field 'extra'"),
                              ("format: pixelart-play/1\n", "default is required"),
                              ("format: pixelart-play/2\ndefault: {schedule: seasons}\n", "format_unsupported"),
                              ("default: {schedule: seasons}\ndefault: {schedule: seasons}\n", "duplicate key"),
                              ("format: pixelart-play/1\ndefault: {playlists: []}\n", "no playlist"),
                              ("format: pixelart-play/1\ndefault: {playlists: [a, a]}\n", "twice")):
            for schema in (False, True):
                with self.subTest(play=play, schema=schema):
                    code, err, files, played = self.build(play, schema)
                    self.assertEqual(code, 1)
                    self.assertIn("play.yaml", err)
                    self.assertIsNone(played)
                    if not schema or "duplicate" in message:
                        self.assertIn(message, err)

    def test_what_the_play_yaml_names_and_the_content_lacks_is_a_warning_and_the_file_is_built(self):
        for play, message in (("format: pixelart-play/1\ndefault: {schedule: ghost}\n", "warning unknown_schedule"),
                              ("format: pixelart-play/1\ndefault: {playlists: [christmas, ghost]}\n", "warning unknown_playlist")):
            with self.subTest(play=play):
                code, err, files, played = self.build(play)
                self.assertEqual(code, 0)
                self.assertIn(message, err)
                self.assertIn("play/default.json", files)

    def test_a_schedule_that_fails_its_own_check_does_not_count_as_in_the_content(self):
        code, err, files, played = self.build("format: pixelart-play/1\ndefault: {schedule: seasons}\n", schedules=False)
        self.assertEqual(code, 0)
        self.assertIn("warning unknown_schedule", err)
        self.assertIn("play/default.json", files)


class BuildTest(unittest.TestCase):
    def test_values_without_a_json_form_are_errors_of_their_file(self):
        with tempfile.TemporaryDirectory() as folder:
            source, out = Path(folder) / "src", Path(folder) / "out"
            (source / "animations").mkdir(parents=True)
            (source / "playlists").mkdir()
            files = {"date.yaml": "a: 2024-01-01\n", "binary.yaml": "a: !!binary aGk=\n", "inf.yaml": "a: .inf\n",
                     "nan.json": '{"a": NaN}', "good.yaml": "a: 1\n"}
            for name, text in files.items():
                (source / "animations" / name).write_text(text)
            err = io.StringIO()
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(err):
                self.assertEqual(pixelart.build(source, out, False), 1)
            for name in ("date.yaml", "binary.yaml", "inf.yaml", "nan.json"):
                self.assertIn(name, err.getvalue())
            self.assertEqual([p.name for p in (out / "animations").iterdir()], ["good.json"])
            self.assertEqual((out / "animations" / "good.json").read_text(), '{"a":1}')

    def test_put_refuses_a_value_without_a_json_form(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "a.yaml"
            path.write_text("format: pixelart/1\na: .inf\n")
            args = types.SimpleNamespace(file=path, kind=None, id=None)
            with self.assertRaises(pixelart.BoardError) as e:
                pixelart.board_put(None, args)
            self.assertIn(str(path), str(e.exception))

    def test_a_lone_surrogate_is_an_error_of_its_file_and_writes_nothing(self):
        with tempfile.TemporaryDirectory() as folder:
            source, out = Path(folder) / "src", Path(folder) / "out"
            (source / "animations").mkdir(parents=True)
            (source / "playlists").mkdir()
            (source / "animations" / "lone.yaml").write_text('a: "\\ud800"\n')
            (source / "animations" / "good.yaml").write_text("a: 1\n")
            err = io.StringIO()
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(err):
                self.assertEqual(pixelart.build(source, out, False), 1)
            self.assertIn("lone.yaml: text with a lone surrogate (U+D800)", err.getvalue())
            self.assertEqual([p.name for p in (out / "animations").iterdir()], ["good.json"])

    def test_put_refuses_a_lone_surrogate(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "a.yaml"
            path.write_text('format: pixelart/1\na: "\\ud800"\n')
            args = types.SimpleNamespace(file=path, kind=None, id=None)
            with self.assertRaises(pixelart.BoardError) as e:
                pixelart.board_put(None, args)
            self.assertEqual(str(e.exception), f"{path}: text with a lone surrogate (U+D800), which UTF-8 cannot hold")


class RunBoardTest(unittest.TestCase):
    def test_a_reply_with_a_missing_field_is_one_error(self):
        responder = Responder(serve({"ok": True, "entries": [{"id": "x"}], "more": False}))
        responder.close = mock.Mock()
        args = types.SimpleNamespace(port="/dev/null", ws=None, token=None, board_command="get", kind="animation", id="x",
                                     output=None)
        with mock.patch.object(pixelart, "SerialTransport", return_value=responder):
            with self.assertRaises(pixelart.BoardError) as e:
                pixelart.run_board(args)
        self.assertEqual(str(e.exception), "the board sent an unexpected reply")
        responder.close.assert_called_once()


try:
    from websockets.sync.server import serve as websocket_server
except ImportError:
    websocket_server = None


class LoginTest(unittest.TestCase):
    """A board over WiFi with network login on: the client answers the challenge with an HMAC of the nonce."""

    TOKEN = "k3j9x0q7w2m5z8a1"
    NONCE = "000102030405060708090a0b0c0d0e0f"
    # Worked out with Python's hmac module, outside this tool: HMAC-SHA256(TOKEN, NONCE) as hex.
    ANSWER = "8a2422fe7ca97df26f5b82ca480c6f0362cb0e3eb9ebc9e8c0dd7467c28ffe23"

    def board(self, token, accepts=ANSWER):
        state = {"logged_in": False, "log": []}

        def handler(body):
            state["log"].append(body)
            if body["cmd"] == "info":
                return INFO
            if body["cmd"] == "auth_challenge":
                return {"ok": True, "nonce": self.NONCE}
            if body["cmd"] == "auth":
                state["logged_in"] = body.get("hmac") == accepts
                return {"ok": True} if state["logged_in"] else {"ok": False, "error": "unauthorized", "message": "the login failed"}
            if not state["logged_in"]:
                return {"ok": False, "error": "unauthorized", "message": "log in first with auth_challenge and auth"}
            return {"ok": True, "settings": {}}

        return pixelart.Board(Responder(handler), token), state

    def test_the_answer_is_the_hmac_of_the_nonce_text_under_the_token(self):
        self.assertEqual(pixelart.login_hmac(self.TOKEN, self.NONCE), self.ANSWER)

    def test_a_request_that_is_unauthorized_logs_in_and_goes_again(self):
        board, state = self.board(self.TOKEN)
        self.assertTrue(board.command("settings_get")["ok"])
        self.assertEqual([b["cmd"] for b in state["log"]], ["info", "settings_get", "auth_challenge", "auth", "settings_get"])
        self.assertEqual(state["log"][3]["hmac"], self.ANSWER)

    def test_the_token_never_goes_over_the_link(self):
        board, state = self.board(self.TOKEN)
        board.command("settings_get")
        self.assertNotIn(self.TOKEN, repr(state["log"]))
        self.assertNotIn(self.TOKEN.encode(), b"".join(board.transport.sent))

    def test_the_login_is_made_once(self):
        board, state = self.board(self.TOKEN)
        board.command("settings_get")
        board.command("settings_get")
        self.assertEqual(sum(b["cmd"] == "auth" for b in state["log"]), 1)

    def test_no_login_without_a_request_that_needs_it(self):
        board, state = self.board(self.TOKEN)
        self.assertEqual([b["cmd"] for b in state["log"]], ["info"])

    def test_without_a_token_the_error_says_what_to_give(self):
        board, _ = self.board(None)
        with self.assertRaises(pixelart.BoardError) as e:
            board.command("settings_get")
        self.assertIn("PIXELART_TOKEN", str(e.exception))

    def test_a_wrong_token_is_tried_once_and_not_shown(self):
        board, state = self.board("a1z8m5w2q7x0j9k3")
        with self.assertRaises(pixelart.BoardError) as e:
            board.command("settings_get")
        self.assertIn("login failed", str(e.exception))
        self.assertNotIn("a1z8m5w2q7x0j9k3", str(e.exception))
        self.assertEqual(sum(b["cmd"] == "auth" for b in state["log"]), 1)

    def test_a_token_comes_from_the_option_or_the_environment(self):
        args = types.SimpleNamespace(token=None)
        with mock.patch.dict("os.environ", {"PIXELART_TOKEN": self.TOKEN}):
            self.assertEqual(pixelart.board_token(args), self.TOKEN)
            self.assertEqual(pixelart.board_token(types.SimpleNamespace(token="a1z8m5w2q7x0j9k3")), "a1z8m5w2q7x0j9k3")
        with mock.patch.dict("os.environ", clear=True):
            self.assertIsNone(pixelart.board_token(args))

    def test_a_token_in_the_wrong_form_is_refused_without_echoing_it(self):
        for token in ("short", "UPPERCASE0123456", "k3j9x0q7w2m5z8a1x", "k3j9x0q7w2m5z8a!", "k3j9x0q7w2m5z8a1\n", ""):
            with self.assertRaises(pixelart.BoardError) as e:
                pixelart.board_token(types.SimpleNamespace(token=token))
            self.assertNotIn(token or "\0", str(e.exception))
            self.assertIn("16 characters", str(e.exception))


class WebSocketTest(unittest.TestCase):
    def test_a_url_that_is_not_ws_is_refused(self):
        for url in ("http://127.0.0.1:8765", "wss://127.0.0.1:8765", "127.0.0.1:8765"):
            with self.assertRaises(pixelart.BoardError, msg=url) as e:
                pixelart.WebSocketTransport(url)
            self.assertIn("--ws expects a URL", str(e.exception))

    def test_without_the_websockets_package_the_error_says_what_to_install(self):
        with mock.patch.dict(sys.modules, {"websockets": None, "websockets.exceptions": None,
                                           "websockets.sync.client": None}):
            with self.assertRaises(pixelart.BoardError) as e:
                pixelart.WebSocketTransport("ws://127.0.0.1:8765")
        self.assertIn("pip install websockets", str(e.exception))

    def test_a_closed_port_cannot_connect(self):
        if websocket_server is None:
            self.skipTest("needs the websockets package")
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        with self.assertRaises(pixelart.BoardError) as e:
            pixelart.WebSocketTransport(f"ws://127.0.0.1:{port}")
        self.assertIn("cannot connect", str(e.exception))


@unittest.skipIf(websocket_server is None, "needs the websockets package")
class WebSocketServerTest(unittest.TestCase):
    """The transport against a websockets server on a free local port."""

    def start(self, handler, process_request=None):
        server = websocket_server(handler, "127.0.0.1", 0, process_request=process_request, compression=None)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.shutdown)
        return f"ws://127.0.0.1:{server.socket.getsockname()[1]}"

    def connect(self, url):
        transport = pixelart.WebSocketTransport(url)
        self.addCleanup(transport.close)
        return transport

    @staticmethod
    def answer(connection):
        for message in connection:
            if message == "big":
                connection.send("a" * (pixelart.MAX_LINE + 1))
            elif message == "max":
                connection.send("a" * pixelart.MAX_LINE)
            elif message != "quiet":
                connection.send(message.upper())

    def test_a_line_is_sent_and_the_reply_received_as_bytes(self):
        transport = self.connect(self.start(self.answer))
        transport.send(b"hello")
        self.assertEqual(transport.receive(2.0), b"HELLO")

    def test_receive_times_out(self):
        transport = self.connect(self.start(self.answer))
        transport.send(b"quiet")
        self.assertIsNone(transport.receive(0.05))

    def test_a_message_of_exactly_the_cap_is_accepted(self):
        transport = self.connect(self.start(self.answer))
        transport.send(b"max")
        self.assertEqual(len(transport.receive(2.0)), pixelart.MAX_LINE)

    def test_a_message_one_byte_over_the_cap_is_refused(self):
        transport = self.connect(self.start(self.answer))
        transport.send(b"big")
        with self.assertRaises(pixelart.BoardError) as e:
            transport.receive(2.0)
        self.assertIn("too long", str(e.exception))

    def test_a_binary_message_is_refused(self):
        transport = self.connect(self.start(lambda connection: connection.send(b"@PR 00000000 {}") or connection.recv()))
        with self.assertRaises(pixelart.BoardError) as e:
            transport.receive(2.0)
        self.assertIn("binary WebSocket message", str(e.exception))

    def test_a_close_from_the_server_is_an_error(self):
        transport = self.connect(self.start(lambda connection: connection.close()))
        with self.assertRaises(pixelart.BoardError) as e:
            transport.receive(2.0)
        self.assertIn("closed", str(e.exception))

    def test_a_busy_simulator_is_tried_again_then_given_up(self):
        calls = []

        def busy(connection, request):
            calls.append(request.path)
            return connection.respond(503, "busy\n")

        url = self.start(self.answer, busy)
        with mock.patch.object(pixelart.time, "sleep") as sleep:
            with self.assertRaises(pixelart.BoardError) as e:
                pixelart.WebSocketTransport(url)
        self.assertEqual(str(e.exception), "the server already has a client")
        self.assertEqual(len(calls), 6)
        self.assertEqual([call.args[0] for call in sleep.call_args_list], [0.2, 0.4, 0.8, 1.6, 3.2])

    def test_another_refusal_names_the_http_status(self):
        url = self.start(self.answer, lambda connection, request: connection.respond(404, "no\n"))
        with self.assertRaises(pixelart.BoardError) as e:
            pixelart.WebSocketTransport(url)
        self.assertIn("HTTP 404", str(e.exception))


if __name__ == "__main__":
    unittest.main()
