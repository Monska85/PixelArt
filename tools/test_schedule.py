# SPDX-License-Identifier: GPL-3.0-or-later
"""Tests of the schedule checks of tools/pixelart.py: validation, lengths, winner, ties, the build and the conformance cases.

Run with: python3 -m unittest discover -s tools   (part of `make check`)
"""

import contextlib
import io
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import pixelart  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CONFORMANCE = ROOT / "conformance" / "schedule"


def schedule(*entries, **fields):
    document = {"format": "pixelart-schedule/1", "fallback": ["default"], **fields}
    if entries:
        document["entries"] = list(entries)
    return document


def entry(first, last, playlists=("a",), **fields):
    return {"from": first, "to": last, "playlists": list(playlists), **fields}


def codes(diagnostics, severity="error"):
    return [d["code"] for d in diagnostics if d["severity"] == severity]


class ScheduleValidationTest(unittest.TestCase):
    def test_a_fallback_alone_is_valid(self):
        self.assertEqual(list(pixelart.validate_schedule(schedule())), [])
        self.assertEqual(list(pixelart.validate_schedule(schedule(entries=[]))), [])

    def test_every_part_set_is_accepted(self):
        ends = [({"year": 2026, "month": 12, "day": 24}, {"year": 2026, "month": 12, "day": 26}),
                ({"month": 12, "day": 1}, {"month": 1, "day": 6}),
                ({"year": 2026, "month": 11}, {"year": 2027, "month": 2}),
                ({"day": 28}, {"day": 3}),
                ({"month": 11}, {"month": 2}),
                ({"year": 2027}, {"year": 2028})]
        for first, last in ends:
            with self.subTest(first=first):
                self.assertEqual(list(pixelart.validate_schedule(schedule(entry(first, last)))), [])

    def test_the_format_must_be_a_schedule(self):
        for document in ([], "x", {"fallback": ["a"]}, {"format": "pixelart-playlist/1", "fallback": ["a"]}):
            with self.subTest(document=document):
                self.assertEqual(codes(pixelart.validate_schedule(document)), ["format_unsupported"])

    def test_structure_errors(self):
        cases = {
            "unknown field": schedule(extra=1),
            "missing fallback": {"format": "pixelart-schedule/1"},
            "null name": schedule(name=None),
            "empty name": schedule(name=""),
            "name of 129 characters": schedule(name="é" * 129),
            "name with U+0000": schedule(name="a\0"),
            "null entries": schedule(entries=None),
            "empty fallback": schedule(fallback=[]),
            "fallback twice": schedule(fallback=["a", "a"]),
            "bad ID": schedule(fallback=["A"]),
            "ID with a newline": schedule(fallback=["a\n"]),
            "entry not an object": schedule(entries=[1]),
            "entry unknown field": schedule(entry({"day": 1}, {"day": 2}, color="red")),
            "entry without to": schedule({"from": {"day": 1}, "playlists": ["a"]}),
            "entry without playlists": schedule({"from": {"day": 1}, "to": {"day": 2}}),
            "empty end": schedule(entry({}, {})),
            "end not an object": schedule(entry([1], [2])),
            "end unknown field": schedule(entry({"day": 1, "week": 1}, {"day": 2, "week": 1})),
            "year and day": schedule(entry({"year": 2026, "day": 1}, {"year": 2026, "day": 5})),
            "different parts": schedule(entry({"month": 1, "day": 1}, {"month": 2})),
            "boolean part": schedule(entry({"day": True}, {"day": True})),
            "fraction": schedule(entry({"month": 10.0}, {"month": 11})),
            "null part": schedule(entry({"day": None}, {"day": 2})),
        }
        for name, document in cases.items():
            with self.subTest(name):
                self.assertIn("structure", codes(pixelart.validate_schedule(document)))

    def test_limits(self):
        many = [entry({"day": 1}, {"day": 1}, (f"p{i}",)) for i in range(65)]
        self.assertEqual(codes(pixelart.validate_schedule(schedule(*many))), ["limit_exceeded"])
        self.assertEqual(codes(pixelart.validate_schedule(schedule(*many[:64]))), [])
        nine = [f"p{i}" for i in range(9)]
        self.assertEqual(codes(pixelart.validate_schedule(schedule(fallback=nine))), ["limit_exceeded"])
        self.assertEqual(codes(pixelart.validate_schedule(schedule(entry({"day": 1}, {"day": 2}, nine)))), ["limit_exceeded"])
        self.assertEqual(codes(pixelart.validate_schedule(schedule(fallback=nine[:8]))), [])
        self.assertEqual(codes(pixelart.validate_schedule(schedule(), size=16385)), ["limit_exceeded"])
        self.assertEqual(codes(pixelart.validate_schedule(schedule(), size=16384)), [])

    def test_invalid_dates(self):
        cases = {
            "year 1999": ({"year": 1999}, {"year": 2000}),
            "year 3000": ({"year": 2999}, {"year": 3000}),
            "month 13": ({"month": 13}, {"month": 1}),
            "day 0": ({"day": 0}, {"day": 1}),
            "negative day": ({"day": -1}, {"day": 1}),
            "April 31 every year": ({"month": 4, "day": 31}, {"month": 4, "day": 31}),
            "February 30 every year": ({"month": 2, "day": 30}, {"month": 3, "day": 1}),
            "February 29, 2027": ({"year": 2027, "month": 2, "day": 29}, {"year": 2027, "month": 3, "day": 1}),
            "February 29, 2100": ({"year": 2100, "month": 2, "day": 29}, {"year": 2100, "month": 2, "day": 29}),
            "years backwards": ({"year": 2027}, {"year": 2026}),
            "months backwards": ({"year": 2027, "month": 3}, {"year": 2027, "month": 2}),
            "days backwards": ({"year": 2027, "month": 3, "day": 2}, {"year": 2027, "month": 3, "day": 1}),
        }
        for name, (first, last) in cases.items():
            with self.subTest(name):
                self.assertEqual(codes(pixelart.validate_schedule(schedule(entry(first, last)))), ["invalid_date"])

    def test_a_part_beyond_64_bits_is_a_structure_error(self):
        for value in (2**63, 2**64, -2**63 - 1):
            with self.subTest(value=value):
                document = schedule(entry({"year": value}, {"year": 2026}))
                self.assertEqual(codes(pixelart.validate_schedule(document)), ["structure"])
        for value in (2**63 - 1, -2**63):
            with self.subTest(value=value):
                document = schedule(entry({"year": value}, {"year": 2026}))
                self.assertEqual(codes(pixelart.validate_schedule(document)), ["invalid_date"])

    def test_a_part_out_of_range_still_compares_the_part_sets_of_the_ends(self):
        document = schedule(entry({"month": 13, "day": 1}, {"month": 2}))
        self.assertEqual(codes(pixelart.validate_schedule(document)), ["invalid_date", "structure"])

    def test_february_29_and_ranges_that_cross_their_cycle_are_valid(self):
        for first, last in [({"month": 2, "day": 29}, {"month": 2, "day": 29}),
                            ({"year": 2028, "month": 2, "day": 29}, {"year": 2028, "month": 2, "day": 29}),
                            ({"year": 2000, "month": 2, "day": 29}, {"year": 2000, "month": 2, "day": 29}),
                            ({"month": 12, "day": 31}, {"month": 1, "day": 1}),
                            ({"day": 31}, {"day": 31})]:
            with self.subTest(first=first):
                self.assertEqual(codes(pixelart.validate_schedule(schedule(entry(first, last)))), [])

    def test_unknown_playlists_are_warnings_only_when_the_playlists_are_known(self):
        document = schedule(entry({"month": 10}, {"month": 10}, ("halloween", "gone")))
        self.assertEqual(list(pixelart.validate_schedule(document)), [])
        diagnostics = pixelart.validate_schedule(document, playlists={"halloween"})
        self.assertEqual(codes(diagnostics), [])
        self.assertEqual([(d["code"], d["where"]) for d in diagnostics],
                         [("unknown_playlist", "fallback[0]"), ("unknown_playlist", "entries[0].playlists[1]")])
        self.assertFalse(diagnostics.has_errors())

    def test_at_most_32_messages_and_an_error_replaces_the_latest_warning(self):
        warnings = [entry({"day": 1}, {"day": 1}, (f"p{i}",)) for i in range(40)]
        # 41 warnings (the fallback and each entry), then the two errors of an entry without to and playlists
        diagnostics = pixelart.validate_schedule(schedule(*warnings, {"from": {"day": 1}}), playlists=set())
        self.assertEqual(len(diagnostics), 32)
        self.assertEqual(codes(diagnostics), ["structure", "structure"])
        self.assertEqual(codes(diagnostics, "warning"), ["unknown_playlist"] * 30)
        self.assertEqual([d["code"] for d in diagnostics[-2:]], ["structure", "structure"])

    def test_strict_json(self):
        good = b'{"format":"pixelart-schedule/1","fallback":["a"]}'
        self.assertEqual(pixelart.parse_strict_json(good)["fallback"], ["a"])
        for bad in (b"\xef\xbb\xbf" + good, b'{"a": NaN}', b'{"a": Infinity}', b'{"a": "\\ud800"}', b'{"a\\u0000": 1}',
                    b'{"a": "x\\u0000"}', b'{"a": "\xc0\xaf"}', b'{"a": "\xed\xa0\x80"}', good + b"{}", b"{'a': 1}",
                    good + b"// x", b'{"a": "\x01"}'):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                pixelart.parse_strict_json(bad)


class ScheduleRulesTest(unittest.TestCase):
    def test_lengths_follow_the_specification(self):
        cases = [
            (({"year": 2026, "month": 12, "day": 20}, {"year": 2027, "month": 1, "day": 10}), 22),
            (({"year": 2028, "month": 2, "day": 28}, {"year": 2028, "month": 3, "day": 1}), 3),
            (({"month": 12, "day": 1}, {"month": 1, "day": 6}), 37),
            (({"month": 2, "day": 28}, {"month": 2, "day": 29}), 2),
            (({"month": 2, "day": 29}, {"month": 3, "day": 1}), 1),
            (({"month": 12, "day": 25}, {"month": 12, "day": 25}), 1),
            (({"year": 2026, "month": 11}, {"year": 2027, "month": 2}), 4),
            (({"day": 28}, {"day": 3}), 7),
            (({"day": 1}, {"day": 31}), 31),
            (({"month": 11}, {"month": 2}), 4),
            (({"year": 2000}, {"year": 2999}), 1000),
        ]
        for (first, last), length in cases:
            with self.subTest(first=first, last=last):
                self.assertEqual(pixelart.schedule_length(entry(first, last)), length)

    def test_the_worked_examples_of_the_specification(self):
        document = schedule(entry({"month": 12}, {"month": 12}), entry({"month": 12, "day": 1}, {"month": 1, "day": 6}),
                            entry({"month": 12, "day": 25}, {"month": 12, "day": 25}), entry({"year": 2026}, {"year": 2026}))
        for date, winner in [((2026, 12, 25), 2), ((2026, 12, 24), 1), ((2027, 1, 3), 1), ((2026, 11, 30), 3),
                             ((2027, 11, 30), None)]:
            with self.subTest(date=date):
                self.assertEqual(pixelart.schedule_winner(document, *date), winner)
        rule_two = schedule(entry({"month": 10}, {"month": 10}), entry({"day": 1}, {"day": 7}))
        self.assertEqual(pixelart.schedule_winner(rule_two, 2026, 10, 3), 1)
        self.assertEqual(pixelart.schedule_winner(rule_two, 2026, 10, 8), 0)

    def test_days_a_month_lacks_never_match(self):
        last = schedule(entry({"day": 31}, {"day": 31}))
        self.assertEqual(pixelart.schedule_winner(last, 2026, 3, 31), 0)
        self.assertIsNone(pixelart.schedule_winner(last, 2026, 4, 30))
        turn = schedule(entry({"day": 30}, {"day": 2}))
        self.assertIsNone(pixelart.schedule_winner(turn, 2026, 2, 28))
        self.assertEqual(pixelart.schedule_winner(turn, 2026, 2, 2), 0)
        self.assertEqual(pixelart.schedule_winner(turn, 2026, 1, 31), 0)
        leap = schedule(entry({"month": 2, "day": 29}, {"month": 2, "day": 29}))
        self.assertEqual(pixelart.schedule_winner(leap, 2028, 2, 29), 0)
        self.assertIsNone(pixelart.schedule_winner(leap, 2027, 3, 1))

    def test_two_equal_entries_tie(self):
        document = schedule(entry({"month": 12, "day": 1}, {"month": 12, "day": 31}),
                            entry({"month": 12, "day": 1}, {"month": 12, "day": 31}))
        self.assertEqual(pixelart.find_schedule_tie(document), ("12-01 of a leap year", 0, 1))
        self.assertEqual(pixelart.schedule_winner(document, 2026, 12, 10), 0)

    def test_equal_entries_that_a_better_entry_always_beats_do_not_tie(self):
        document = schedule(entry({"month": 12}, {"month": 12}), entry({"month": 12}, {"month": 12}),
                            entry({"month": 12, "day": 1}, {"month": 12, "day": 31}))
        self.assertIsNone(pixelart.find_schedule_tie(document))

    def test_a_tie_through_february_29_is_found(self):
        # Both are 1 day long, since February 29 has the day number of March 1
        document = schedule(entry({"month": 2, "day": 29}, {"month": 3, "day": 1}),
                            entry({"month": 3, "day": 1}, {"month": 3, "day": 1}))
        self.assertEqual(pixelart.find_schedule_tie(document), ("03-01 of a leap year", 0, 1))


    def test_a_tie_only_in_one_dated_year_is_found(self):
        document = schedule(entry({"year": 2900}, {"year": 2900}), entry({"year": 2900}, {"year": 2900}),
                            entry({"year": 2000}, {"year": 2001}))
        self.assertEqual(pixelart.find_schedule_tie(document), ("2900-01-01", 0, 1))

    def test_a_dated_entry_that_beats_a_yearly_tie_in_its_year_leaves_the_tie_in_other_years(self):
        dated = entry({"year": 2026, "month": 1, "day": 1}, {"year": 2026, "month": 12, "day": 31})
        yearly = entry({"month": 5, "day": 1}, {"month": 5, "day": 2})
        self.assertIsNotNone(pixelart.find_schedule_tie(schedule(dated, yearly, yearly)))
        self.assertIsNone(pixelart.find_schedule_tie(schedule(dated, yearly)))

    def test_check_schedule_reports_a_tie_as_schedule_tie(self):
        tied = schedule(entry({"day": 1}, {"day": 1}), entry({"day": 1}, {"day": 1}))
        diagnostics = pixelart.check_schedule(tied)
        self.assertEqual(codes(diagnostics), ["schedule_tie"])
        self.assertIn("entries 0 and 1 tie on", diagnostics[0]["message"])
        # A schedule with errors is not checked for ties
        self.assertEqual(codes(pixelart.check_schedule(dict(tied, name=""))), ["structure"])

    def test_the_worst_case_of_the_tie_check_is_fast(self):
        entries = [entry({"year": 2000}, {"year": 2999})]
        for i in range(1, 64):
            entries.append(entry({"year": 2000, "month": 1, "day": 1}, {"year": 2999 - i, "month": 12, "day": 31}))
        start = time.monotonic()
        self.assertEqual(list(pixelart.check_schedule(schedule(*entries))), [])
        self.assertLess(time.monotonic() - start, 10)


class ScheduleConformanceTest(unittest.TestCase):
    """The tools' checks against the hand-computed cases of conformance/schedule."""

    @staticmethod
    def cases(folder):
        return sorted(p for p in (CONFORMANCE / folder).glob("*.json") if not p.name.endswith(".expected.json"))

    @staticmethod
    def expected(path):
        return json.loads(path.with_name(path.stem + ".expected.json").read_text(encoding="utf-8"))

    @staticmethod
    def check(path):
        data = path.read_bytes()
        try:
            document = pixelart.parse_strict_json(data)
        except ValueError:  # UnicodeDecodeError included
            return None, ["structure"]
        return document, codes(pixelart.check_schedule(document, len(data)))

    def test_every_valid_case_is_accepted_without_a_tie(self):
        cases = self.cases("valid")
        self.assertTrue(cases)
        for path in cases:
            with self.subTest(path.name):
                document, errors = self.check(path)
                self.assertEqual(errors, [])
                expected = self.expected(path)
                got = [{k: e[k] for k in ("from", "to", "playlists")} for e in document.get("entries", [])]
                self.assertEqual({"fallback": document["fallback"], "entries": got}, expected)

    def test_every_invalid_case_is_refused_with_its_code(self):
        cases = self.cases("invalid")
        self.assertTrue(cases)
        for path in cases:
            with self.subTest(path.name):
                _, errors = self.check(path)
                self.assertIn(self.expected(path)["error"], errors)

    def test_the_winner_rows_and_the_tie_schedules(self):
        winner = json.loads((CONFORMANCE / "winner.json").read_text(encoding="utf-8"))
        self.assertTrue(winner["tie_schedules"])
        for key, document in winner["schedules"].items():
            with self.subTest(schedule=key):
                expected = ["schedule_tie"] if key in winner["tie_schedules"] else []
                self.assertEqual(codes(pixelart.check_schedule(document)), expected)
        self.assertTrue(winner["rows"])
        for row in winner["rows"]:
            with self.subTest(row=row):
                year, month, day = (int(p) for p in row["date"].split("-"))
                self.assertEqual(pixelart.schedule_winner(winner["schedules"][row["schedule"]], year, month, day), row["entry"])

    def test_the_resolver_schedules_are_valid_for_the_tools(self):
        resolver = json.loads((CONFORMANCE / "resolver.json").read_text(encoding="utf-8"))
        for key, document in resolver["schedules"].items():
            with self.subTest(schedule=key):
                self.assertEqual(codes(pixelart.check_schedule(document)), [])


class ScheduleBuildTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.source, self.out = Path(tmp.name) / "src", Path(tmp.name) / "out"
        for kind in ("animations", "playlists", "schedules"):
            (self.source / kind).mkdir(parents=True)
        (self.source / "playlists" / "default.yaml").write_text("format: pixelart-playlist/1\nitems: []\n")

    def build(self, schema=False):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = pixelart.build(self.source, self.out, schema)
        return code, err.getvalue()

    def built(self):
        folder = self.out / "schedules"
        return sorted(p.name for p in folder.iterdir()) if folder.is_dir() else []

    def test_a_schedule_is_written_as_compact_json(self):
        (self.source / "schedules" / "default.yaml").write_text(
            "format: pixelart-schedule/1\nfallback: [default]\nentries:\n"
            "  - {from: {month: 12, day: 1}, to: {month: 1, day: 6}, playlists: [default]}\n")
        code, err = self.build()
        self.assertEqual((code, err), (0, ""))
        self.assertEqual((self.out / "schedules" / "default.json").read_text(),
                         '{"format":"pixelart-schedule/1","fallback":["default"],"entries":'
                         '[{"from":{"month":12,"day":1},"to":{"month":1,"day":6},"playlists":["default"]}]}')

    def test_a_tie_or_an_invalid_date_fails_the_build_and_writes_nothing(self):
        files = {"tie.yaml": "format: pixelart-schedule/1\nfallback: [default]\nentries:\n"
                             "  - {from: {day: 1}, to: {day: 2}, playlists: [default]}\n"
                             "  - {from: {day: 1}, to: {day: 2}, playlists: [default]}\n",
                 "april.yaml": "format: pixelart-schedule/1\nfallback: [default]\nentries:\n"
                               "  - {from: {month: 4, day: 31}, to: {month: 5, day: 1}, playlists: [default]}\n",
                 "good.yaml": "format: pixelart-schedule/1\nfallback: [default]\n"}
        for name, text in files.items():
            (self.source / "schedules" / name).write_text(text)
        code, err = self.build()
        self.assertEqual(code, 1)
        self.assertIn("tie.yaml: error schedule_tie at entries: entries 0 and 1 tie on", err)
        self.assertIn("april.yaml: error invalid_date at entries[0].from", err)
        self.assertEqual(self.built(), ["good.json"])

    def test_a_playlist_the_source_lacks_is_a_warning(self):
        (self.source / "schedules" / "default.yaml").write_text("format: pixelart-schedule/1\nfallback: [default, gone]\n")
        code, err = self.build()
        self.assertEqual(code, 0)
        self.assertIn("default.yaml: warning unknown_playlist at fallback[1]: no playlist 'gone'", err)
        self.assertEqual(self.built(), ["default.json"])

    def test_a_schedule_over_16_kib_fails_the_build(self):
        (self.source / "schedules" / "big.yaml").write_text(
            "format: pixelart-schedule/1\nfallback: [default]\nname: " + "x" * 128 + "\nentries:\n" +
            "".join(f"  - {{name: {'n' * 128}, from: {{day: {i % 28 + 1}}}, to: {{day: {i % 28 + 1}}}, "
                    f"playlists: [{','.join(f'p{j}-{i}-' + 'q' * 20 for j in range(8))}]}}\n" for i in range(64)))
        code, err = self.build()
        self.assertEqual(code, 1)
        self.assertIn("limit_exceeded", err)

    def test_the_schema_checks_schedules(self):
        try:
            import jsonschema  # noqa: F401
        except ImportError:
            if os.environ.get("CI"):
                raise
            self.skipTest("needs the jsonschema package")
        (self.source / "schedules" / "default.yaml").write_text("format: pixelart-schedule/1\nfallback: [default]\n")
        (self.source / "schedules" / "bad.yaml").write_text(
            "format: pixelart-schedule/1\nfallback: [default]\nentries:\n"
            "  - {from: {year: 2026, day: 1}, to: {year: 2026, day: 2}, playlists: [default]}\n")
        code, err = self.build(schema=True)
        self.assertEqual(code, 1)
        self.assertIn("bad.yaml: entries.0", err)
        self.assertEqual(self.built(), ["default.json"])


class ContentScheduleTest(unittest.TestCase):
    """The schedules the repository ships: valid, without a tie, and naming only playlists it ships."""

    def test_every_shipped_schedule_passes_every_check(self):
        content = ROOT / "content"
        playlists = {p.stem for p in (content / "playlists").glob("*") if p.suffix in (".yaml", ".yml", ".json")}
        sources = sorted(p for p in (content / "schedules").glob("*") if p.suffix in (".yaml", ".yml", ".json"))
        for path in sources:
            with self.subTest(path.name):
                document = pixelart.load_source(path)
                diagnostics = pixelart.check_schedule(document, len(pixelart.compact_json(document)), playlists)
                self.assertEqual(list(diagnostics), [])


if __name__ == "__main__":
    unittest.main()
