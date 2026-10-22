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
        self.assertIn("brightness 100, playlist default", asked.call_args.args[0])
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
        self.assertIn("brightness 100, playlist default", " ".join(help_text.getvalue().split()))

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
        self.assertIsNone(pixelart.infer_kind(Path("/x/y/a.json"), {"format": "other"}))

    def test_settings(self):
        self.assertEqual(pixelart.parse_settings(["brightness=40", "playlist=xmas"]),
                         {"brightness": 40, "playlist": "xmas"})
        for bad in ["brightness=256", "brightness=-1", "brightness=x", "playlist=../x", "volume=1", "brightness"]:
            with self.assertRaises(pixelart.BoardError, msg=bad):
                pixelart.parse_settings([bad])


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
        args = types.SimpleNamespace(port="/dev/null", ws=None, board_command="get", kind="animation", id="x",
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
        with mock.patch.object(pixelart.time, "sleep"):
            with self.assertRaises(pixelart.BoardError) as e:
                pixelart.WebSocketTransport(url)
        self.assertEqual(str(e.exception), "the simulator already has a client")
        self.assertEqual(len(calls), pixelart.TRIES)

    def test_another_refusal_names_the_http_status(self):
        url = self.start(self.answer, lambda connection, request: connection.respond(404, "no\n"))
        with self.assertRaises(pixelart.BoardError) as e:
            pixelart.WebSocketTransport(url)
        self.assertIn("HTTP 404", str(e.exception))


if __name__ == "__main__":
    unittest.main()
