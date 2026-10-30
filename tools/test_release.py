# SPDX-License-Identifier: GPL-3.0-or-later
"""Tests of tools/release.py that need neither PlatformIO nor a build: python3 -m unittest discover -s tools"""

import hashlib
import json
import os
import shutil
import struct
import sys
import tempfile
import unittest
from unittest import mock
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import release  # noqa: E402


def entry(label, kind, subtype, offset, size):
    return release.ENTRY_MAGIC + struct.pack("<BBII", kind, subtype, offset, size) + label.encode().ljust(16, b"\0") + b"\0" * 4


class PartitionTableTest(unittest.TestCase):
    def table(self, *entries):
        path = Path(tempfile.mkdtemp()) / "partitions.bin"
        path.write_bytes(b"".join(entries) + b"\xeb\xeb" + b"\xff" * 30 + b"\xff" * 64)
        return path

    def test_reads_entries_and_stops_at_the_md5_entry(self):
        path = self.table(entry("app0", 0, 0x10, 0x10000, 0x180000), entry("spiffs", 1, 0x82, 0x310000, 0xF0000))
        entries = release.read_partitions(path)
        self.assertEqual(entries[0], ("app0", 0, 0x10, 0x10000, 0x180000))
        self.assertEqual(release.find_partition(entries, 1, 0x82, "file system")[3], 0x310000)
        self.assertEqual(len(entries), 2)

    def test_missing_partition_is_reported(self):
        entries = release.read_partitions(self.table(entry("app0", 0, 0x10, 0x10000, 0x180000)))
        with self.assertRaises(release.ReleaseError):
            release.find_partition(entries, 1, 0x82, "file system")

    def test_empty_table_is_rejected(self):
        with self.assertRaises(release.ReleaseError):
            release.read_partitions(self.table())


class WebToolsManifestTest(unittest.TestCase):
    firmware = [
        {"board": b, "part": p, "file": f"firmware/{b}/{p}-1.0.0.bin", "offset": o}
        for b in release.BOARDS
        for p, o in (("app", 65536), ("bootloader", 0), ("factory", 0))
    ]

    def test_update_never_erases_and_paths_are_relative_to_firmware(self):
        manifest = release.web_tools_manifest("1.0.0", self.firmware, ["bootloader", "app"], False)
        self.assertFalse(manifest["new_install_prompt_erase"])
        self.assertEqual([b["chipFamily"] for b in manifest["builds"]], ["ESP32-C3", "ESP32", "ESP32-S3"])
        self.assertEqual(
            manifest["builds"][0]["parts"],
            [{"path": "esp32c3/bootloader-1.0.0.bin", "offset": 0}, {"path": "esp32c3/app-1.0.0.bin", "offset": 65536}],
        )

    def test_the_firmware_parts_have_no_file_system_and_no_factory_image(self):
        self.assertEqual(release.FIRMWARE_PARTS, ("bootloader", "partitions", "boot_app0", "app"))


class LimitsTest(unittest.TestCase):
    @staticmethod
    def manifest(files, name="x"):
        entries = [{"id": f"{name}{i}", "file": f"animations/{name}{i}.json", "size": 1, "sha256": "0" * 64} for i in range(files)]
        return {"format": release.FORMAT, "version": "1.0.0", "firmware": [], "animations": entries, "playlists": []}

    def test_a_manifest_takes_at_most_200_files(self):
        # 200 files are over the size limit, so the count passes and the size refuses them.
        with self.assertRaisesRegex(release.ReleaseError, "bytes, more than"):
            release.check_manifest_limits(self.manifest(200))
        with self.assertRaisesRegex(release.ReleaseError, "lists 201 animations, playlists, schedules and play files"):
            release.check_manifest_limits(self.manifest(201))

    def test_schedules_count_in_the_200_files(self):
        manifest = self.manifest(150)
        manifest["schedules"] = [{"id": f"s{i}", "file": f"schedules/s{i}.json", "size": 1, "sha256": "0" * 64} for i in range(51)]
        with self.assertRaisesRegex(release.ReleaseError, "lists 201 animations, playlists, schedules and play files"):
            release.check_manifest_limits(manifest)

    def test_a_manifest_takes_at_most_20_kib(self):
        self.assertEqual(release.MAX_MANIFEST_BYTES, 20 * 1024)
        manifest = self.manifest(10)
        manifest["padding"] = ""
        manifest["padding"] = "x" * (release.MAX_MANIFEST_BYTES - len(release.manifest_text(manifest).encode("utf-8")))
        self.assertEqual(len(release.manifest_text(manifest).encode("utf-8")), release.MAX_MANIFEST_BYTES)
        release.check_manifest_limits(manifest)
        manifest["padding"] += "x"
        with self.assertRaises(release.ReleaseError):
            release.check_manifest_limits(manifest)

    def test_compact_manifest_fits_more_entries_without_raising_the_byte_limit(self):
        manifest = self.manifest(130)
        self.assertGreater(len(release.json_text(manifest).encode("utf-8")), release.MAX_MANIFEST_BYTES)
        self.assertLessEqual(len(release.manifest_text(manifest).encode("utf-8")), release.MAX_MANIFEST_BYTES)
        release.check_manifest_limits(manifest)

    def test_an_application_keeps_64_kib_free_in_its_slot(self):
        slot = 0x180000
        self.assertEqual(release.check_app_room("esp32c3", slot - 65536, slot), 65536)
        with self.assertRaises(release.ReleaseError):
            release.check_app_room("esp32c3", slot - 65535, slot)


class SiteFolderTest(unittest.TestCase):
    def test_refuses_repository_folders_other_than_site(self):
        for name in ["src", "data", "site/nested", "."]:
            with self.assertRaises(release.ReleaseError, msg=name):
                release.check_replaceable((release.ROOT / name).resolve())
        release.check_replaceable(release.ROOT / "site")

    def test_replaces_only_empty_or_previous_site_folders(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp) / "out"
            release.check_replaceable(folder)  # missing
            folder.mkdir()
            release.check_replaceable(folder)  # empty
            (folder / "keep.txt").write_text("x")
            with self.assertRaises(release.ReleaseError):
                release.check_replaceable(folder)
            (folder / "manifest.json").write_text('{"format": "other"}')
            with self.assertRaises(release.ReleaseError):
                release.check_replaceable(folder)
            (folder / "manifest.json").write_text(f'{{"format": "{release.FORMAT}"}}')
            release.check_replaceable(folder)
            (folder / "manifest.json").write_text("[]")
            with self.assertRaises(release.ReleaseError):
                release.check_replaceable(folder)

    def test_the_default_site_is_replaceable_without_a_manifest(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(release, "ROOT", Path(tmp).resolve()):
            site = release.ROOT / "site"
            site.mkdir()
            (site / "firmware").mkdir()
            (site / "half-written.bin").write_text("x")
            release.check_replaceable(site)
            with self.assertRaises(release.ReleaseError):
                release.check_replaceable(release.ROOT / "other")  # inside the repository, not site/
            (release.ROOT / "other").mkdir()
            with self.assertRaises(release.ReleaseError):
                release.check_replaceable(release.ROOT / "other")

    def test_a_folder_that_cannot_be_read_is_reported(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp) / "out"
            folder.mkdir()
            with mock.patch.object(Path, "iterdir", side_effect=PermissionError(13, "Permission denied")):
                with self.assertRaises(release.ReleaseError):
                    release.check_replaceable(folder)


class CollectDocumentsTest(unittest.TestCase):
    def test_a_file_that_is_not_an_object_is_reported_by_name(self):
        with tempfile.TemporaryDirectory() as tmp:
            data, site = Path(tmp) / "data", Path(tmp) / "site"
            (data / "animations").mkdir(parents=True)
            (data / "animations" / "list.json").write_text("[1, 2]")
            with self.assertRaises(release.ReleaseError) as caught:
                release.collect_documents(data, "animations", site, True)
            self.assertIn("list.json", str(caught.exception))

    def test_a_symbolic_link_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            data, site = Path(tmp) / "data", Path(tmp) / "site"
            (data / "animations").mkdir(parents=True)
            outside = Path(tmp) / "outside.json"
            outside.write_text('{"name": "outside"}')
            (data / "animations" / "linked.json").symlink_to(outside)
            with self.assertRaises(release.ReleaseError) as caught:
                release.collect_documents(data, "animations", site, True)
            self.assertIn("linked.json", str(caught.exception))
            self.assertFalse((site / "animations" / "linked.json").exists())

    def test_a_folder_or_a_broken_link_named_like_a_file_is_refused(self):
        for make in (lambda p: p.mkdir(), lambda p: p.symlink_to(p.parent / "missing")):
            with tempfile.TemporaryDirectory() as tmp:
                data, site = Path(tmp) / "data", Path(tmp) / "site"
                (data / "animations").mkdir(parents=True)
                make(data / "animations" / "odd.json")
                with self.assertRaises(release.ReleaseError) as caught:
                    release.collect_documents(data, "animations", site, True)
                self.assertIn("odd.json", str(caught.exception))

    def test_a_linked_kind_folder_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            data, site, elsewhere = Path(tmp) / "data", Path(tmp) / "site", Path(tmp) / "elsewhere"
            elsewhere.mkdir()
            (elsewhere / "outside.json").write_text('{"name": "outside"}')
            data.mkdir()
            (data / "animations").symlink_to(elsewhere)
            with self.assertRaises(release.ReleaseError):
                release.collect_documents(data, "animations", site, True)
            self.assertFalse((site / "animations" / "outside.json").exists())


SHA = "0" * 64


def listed(path, **extra):
    data = path.encode()
    return {"file": path, "size": len(data), "sha256": hashlib.sha256(data).hexdigest(), **extra}


def firmware_manifest(**extra):
    manifest = {"format": release.FORMAT, "version": "1.2.0", "released": "2026-11-02", "source": "https://example.org/v1.2.0",
                "firmware": [dict(listed("firmware/esp32c3/app-1.2.0.bin"), board="esp32c3", chip="ESP32-C3", part="app", offset=65536)],
                "animations": [], "playlists": []}
    manifest.update(extra)
    return manifest


def content_manifest(**extra):
    manifest = {"format": release.FORMAT, "version": "1.4.0", "released": "2026-11-05", "source": "https://example.org/content-v1.4.0",
                "content_version": "1.4.0",
                "animations": [dict(listed("animations/star.json"), id="star", name="Star", version=1)],
                "playlists": [dict(listed("playlists/default.json"), id="default")]}
    manifest.update(extra)
    return manifest


class AssembleTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        printing = mock.patch("builtins.print")
        printing.start()
        self.addCleanup(printing.stop)
        self.base = Path(self.tmp.name)

    def tree(self, name, files):
        root = self.base / name
        while root.exists():
            root = self.base / f"{root.name}-again"
        root.mkdir()
        for path, text in files.items():
            (root / path).parent.mkdir(parents=True, exist_ok=True)
            (root / path).write_text(text if isinstance(text, str) else json.dumps(text))
        return root

    def firmware_site(self, manifest=None, **extra):
        files = {"manifest.json": manifest or firmware_manifest(), "firmware/install.json": "i",
                 "firmware/esp32c3/app-1.2.0.bin": "a"}
        files.update(extra)
        return self.tree("fw", files)

    def content_site(self, manifest=None, **extra):
        files = {"manifest.json": manifest or content_manifest(), "animations/star.json": "s", "playlists/default.json": "p"}
        files.update(extra)
        return self.tree("ct", files)

    def web_site(self, **extra):
        return self.tree("web", {"index.html": "h", "assets/app.js": "j", **extra})

    def read(self, root):
        return {p.relative_to(root).as_posix(): p.read_text() for p in sorted(root.rglob("*")) if p.is_file()}

    def manifest_of(self, out):
        return json.loads((out / "manifest.json").read_text())

    def test_merges_the_three_sites_and_writes_the_manifest_of_both_releases(self):
        out = self.base / "out"
        release.assemble_site(out, self.firmware_site(), self.content_site(), self.web_site())
        self.assertEqual(sorted(self.read(out)), ["animations/star.json", "assets/app.js", "firmware/esp32c3/app-1.2.0.bin",
                                                  "firmware/install.json", "index.html", "manifest.json", "playlists/default.json"])
        manifest = self.manifest_of(out)
        self.assertEqual((out / "manifest.json").read_text(), release.manifest_text(manifest))
        self.assertEqual(list(manifest), ["format", "version", "released", "source", "content_version", "firmware",
                                          "animations", "playlists"])
        self.assertEqual(manifest["version"], "1.2.0")
        self.assertEqual(manifest["released"], "2026-11-02")
        self.assertEqual(manifest["source"], "https://example.org/v1.2.0")
        self.assertEqual(manifest["content_version"], "1.4.0")
        self.assertEqual(manifest["firmware"], firmware_manifest()["firmware"])
        self.assertEqual(manifest["animations"], content_manifest()["animations"])
        self.assertEqual(manifest["playlists"], content_manifest()["playlists"])

    def test_the_schedules_of_the_content_release_reach_the_site(self):
        schedules = [dict(listed("schedules/default.json"), id="default", name="Seasons")]
        content = self.content_site(content_manifest(schedules=schedules), **{"schedules/default.json": "schedules/default.json"})
        out = self.base / "out"
        release.assemble_site(out, self.firmware_site(), content, None)
        manifest = self.manifest_of(out)
        self.assertEqual(list(manifest), ["format", "version", "released", "source", "content_version", "firmware",
                                          "animations", "playlists", "schedules"])
        self.assertEqual(manifest["schedules"], schedules)
        self.assertIn("schedules/default.json", self.read(out))

    def play_content(self, **extra):
        play = [dict(listed("play/default.json"), id="default")]
        return self.content_site(content_manifest(play=play), **{"play/default.json": "play/default.json"}, **extra)

    def test_the_play_file_of_the_content_release_reaches_the_site(self):
        out = self.base / "out"
        release.assemble_site(out, self.firmware_site(), self.play_content(), None)
        manifest = self.manifest_of(out)
        self.assertEqual([e["id"] for e in manifest["play"]], ["default"])
        self.assertEqual(manifest["play"][0]["file"], "play/default.json")
        self.assertEqual(list(manifest)[-3:], ["animations", "playlists", "play"])
        self.assertIn("play/default.json", self.read(out))
        self.assertNotIn("default", manifest)
        alone = self.base / "alone"
        release.assemble_site(alone, None, self.play_content(), None)
        self.assertEqual([e["id"] for e in self.manifest_of(alone)["play"]], ["default"])
        self.assertIn("play/default.json", self.read(alone))

    def test_a_site_without_a_content_play_file_has_no_list(self):
        out = self.base / "out"
        release.assemble_site(out, self.firmware_site(), self.content_site(), None)
        self.assertNotIn("play", self.manifest_of(out))
        out = self.base / "out-fw"
        release.assemble_site(out, self.firmware_site(), None, None)
        self.assertNotIn("play", self.manifest_of(out))

    def test_a_firmware_release_cannot_hold_a_play_folder(self):
        with self.assertRaisesRegex(release.ReleaseError, "play/default.json"):
            release.assemble_site(self.base / "out", self.firmware_site(**{"play/default.json": "x"}), None, None)

    def test_the_play_file_counts_in_the_200_files_and_must_be_in_the_site(self):
        play = [dict(listed("play/default.json"), id="default")]
        with self.assertRaisesRegex(release.ReleaseError, "play/default.json"):
            release.assemble_site(self.base / "out", None, self.content_site(content_manifest(play=play)), None)

    def test_a_play_list_that_is_not_a_list_of_objects_is_refused(self):
        for play in ({"schedule": "seasons"}, ["default"], None):
            content = self.content_site(content_manifest(play=play))
            with self.subTest(play=play), self.assertRaisesRegex(release.ReleaseError, "bad play list"):
                release.assemble_site(self.base / "out", None, content, None)

    def test_the_assembled_manifest_with_a_play_list_matches_the_schema(self):
        try:
            import jsonschema  # noqa: F401
        except ImportError:
            if os.environ.get("CI"):
                raise
            self.skipTest("needs the jsonschema package")
        release.assemble_site(self.base / "ok", self.firmware_site(), self.play_content(), None, use_schema=True)
        good = dict(listed("play/default.json"), id="default")
        for entry in (dict(good, file="schedules/default.json"), dict(good, id="Bad"), dict(good, size=0),
                      dict(good, sha256="x"), dict(good, other=1), dict(good, name="Seasons")):
            content = self.content_site(content_manifest(play=[entry]), **{"play/default.json": "x", "schedules/default.json": "x"})
            with self.subTest(entry=entry), self.assertRaises(release.ReleaseError):
                release.assemble_site(self.base / "bad", None, content, None, use_schema=True)

    def test_a_content_release_without_schedules_gives_a_site_without_the_list(self):
        out = self.base / "out"
        release.assemble_site(out, self.firmware_site(), self.content_site(), None)
        self.assertNotIn("schedules", self.manifest_of(out))
        out = self.base / "out-alone"
        release.assemble_site(out, self.firmware_site(), None, None)
        self.assertNotIn("schedules", self.manifest_of(out))

    def test_a_listed_schedule_the_site_does_not_hold_is_refused(self):
        content = self.content_site(content_manifest(schedules=[dict(listed("schedules/gone.json"), id="gone")]))
        with self.assertRaisesRegex(release.ReleaseError, "schedules/gone.json"):
            release.assemble_site(self.base / "out", self.firmware_site(), content, None)

    def test_a_firmware_archive_holds_no_schedules(self):
        firmware = self.firmware_site(**{"schedules/default.json": "x"})
        with self.assertRaisesRegex(release.ReleaseError, "schedules/default.json"):
            release.assemble_site(self.base / "out", firmware, None, None)

    def test_a_bad_schedules_list_is_refused(self):
        for schedules in ("x", ["x"]):
            content = self.tree("ct-bad", {"manifest.json": content_manifest(schedules=schedules)})
            with self.subTest(schedules=schedules), self.assertRaises(release.ReleaseError):
                release.assemble_site(self.base / "out", None, content, None)

    def test_the_assembled_manifest_with_schedules_matches_the_schema(self):
        try:
            import jsonschema  # noqa: F401
        except ImportError:
            if os.environ.get("CI"):
                raise
            self.skipTest("needs the jsonschema package")
        schedules = [dict(listed("schedules/default.json"), id="default", name="Seasons")]
        content = self.content_site(content_manifest(schedules=schedules), **{"schedules/default.json": "s"})
        release.assemble_site(self.base / "out", self.firmware_site(), content, None, use_schema=True)
        bad = self.content_site(content_manifest(schedules=[dict(listed("playlists/default.json"), id="default")]))
        with self.assertRaises(release.ReleaseError):
            release.assemble_site(self.base / "out2", None, bad, None, use_schema=True)

    def test_the_content_release_replaces_the_folders_and_lists_of_an_older_firmware_archive(self):
        old = firmware_manifest(animations=[listed("animations/old.json", id="old", name="Old", version=1)],
                                playlists=[listed("playlists/old.json", id="old")])
        firmware = self.firmware_site(old, **{"animations/old.json": "o", "playlists/old.json": "o", "animations/star.json": "older"})
        out = self.base / "out"
        release.assemble_site(out, firmware, self.content_site(), None)
        files = self.read(out)
        self.assertNotIn("animations/old.json", files)
        self.assertNotIn("playlists/old.json", files)
        self.assertEqual(files["animations/star.json"], "s")
        self.assertEqual([a["id"] for a in self.manifest_of(out)["animations"]], ["star"])

    def test_without_a_content_release_an_older_firmware_archive_is_kept_as_it_is(self):
        old = firmware_manifest(animations=[listed("animations/old.json", id="old", name="Old", version=1)])
        firmware = self.firmware_site(old, **{"animations/old.json": "o"})
        web = self.web_site()
        out = self.base / "out"
        release.assemble_site(out, firmware, None, web)
        self.assertEqual(self.manifest_of(out), old)
        self.assertEqual(self.read(out)["animations/old.json"], "o")
        self.assertNotIn("content_version", self.manifest_of(out))

    def test_a_firmware_release_alone_keeps_its_manifest_as_it_is(self):
        out = self.base / "out"
        release.assemble_site(out, self.firmware_site(), None, None)
        self.assertEqual(self.manifest_of(out), firmware_manifest())
        self.assertEqual(self.manifest_of(out)["animations"], [])

    def test_a_content_release_alone_gives_a_manifest_without_firmware(self):
        out = self.base / "out"
        release.assemble_site(out, None, self.content_site(), self.web_site())
        manifest = self.manifest_of(out)
        self.assertEqual(manifest, content_manifest())
        self.assertNotIn("firmware", manifest)
        self.assertEqual(manifest["version"], manifest["content_version"])
        self.assertEqual(sorted(self.read(out)), ["animations/star.json", "assets/app.js", "index.html", "manifest.json",
                                                  "playlists/default.json"])

    def test_the_web_app_alone_writes_no_manifest(self):
        out = self.base / "out"
        release.assemble_site(out, None, None, self.web_site())
        self.assertEqual(self.read(out), {"index.html": "h", "assets/app.js": "j"})

    def test_one_input_at_least_is_required(self):
        with self.assertRaises(release.ReleaseError):
            release.assemble_site(self.base / "c", None, None, None)
        self.assertFalse((self.base / "c").exists())

    def test_the_assembled_manifest_matches_the_schema_when_asked(self):
        try:
            import jsonschema  # noqa: F401
        except ImportError:
            if os.environ.get("CI"):
                raise
            self.skipTest("needs the jsonschema package")
        firmware = self.firmware_site()
        content = self.content_site(content_manifest(animations=[dict(listed("animations/star.json"), id="star", name="Star", version=1)]))
        out = self.base / "out"
        release.assemble_site(out, firmware, content, None, use_schema=True)
        bad = self.tree("bad", {"manifest.json": content_manifest(animations=[{"id": "star"}]), "animations/star.json": "s"})
        with self.assertRaises(release.ReleaseError):
            release.assemble_site(self.base / "out2", None, bad, None, use_schema=True)
        self.assertFalse((self.base / "out2").exists())

    def test_a_path_in_two_sites_fails_and_writes_nothing(self):
        out = self.base / "out"
        cases = {
            "firmware and web": (self.firmware_site(), None, self.web_site(**{"firmware/install.json": "w"})),
            "content and web": (None, self.content_site(), self.web_site(**{"playlists/default.json": "w"})),
        }
        for name, (firmware, content, web) in cases.items():
            with self.subTest(name), self.assertRaises(release.ReleaseError) as caught:
                release.assemble_site(out, firmware, content, web)
            self.assertFalse(out.exists())
        self.assertIn("both hold", str(caught.exception))

    def test_a_manifest_in_the_web_app_fails_when_the_site_writes_one(self):
        with self.assertRaises(release.ReleaseError):
            release.assemble_site(self.base / "out", self.firmware_site(), None, self.web_site(**{"manifest.json": "w"}))
        self.assertFalse((self.base / "out").exists())

    def test_a_file_in_one_and_a_folder_of_that_name_in_the_other_fails(self):
        firmware = self.tree("fw", {"manifest.json": firmware_manifest(), "firmware": "a file"})
        web = self.tree("web", {"firmware/app.js": "j"})
        with self.assertRaises(release.ReleaseError) as caught:
            release.assemble_site(self.base / "out", firmware, None, web)
        self.assertIn("firmware", str(caught.exception))

    def test_a_site_that_holds_something_outside_its_folders_is_refused(self):
        for label, tree in (("firmware", self.tree("fw", {"manifest.json": firmware_manifest(), "index.html": "x"})),
                            ("content", self.tree("ct", {"manifest.json": content_manifest(), "firmware/app.bin": "x"}))):
            with self.subTest(label), self.assertRaises(release.ReleaseError):
                release.assemble_site(self.base / "out", tree if label == "firmware" else None,
                                      tree if label == "content" else None, None)

    def test_a_manifest_that_cannot_be_trusted_is_refused(self):
        bad = {
            "missing": None,
            "not json": "{",
            "not an object": [],
            "other format": {"format": "other/1"},
            "bad list": firmware_manifest(animations="x"),
            "bad entry": firmware_manifest(animations=["x"]),
        }
        for name, manifest in bad.items():
            files = {"firmware/app.bin": "a"}
            if manifest is not None:
                files["manifest.json"] = manifest
            tree = self.base / f"t-{name.replace(' ', '-')}"
            tree.mkdir()
            for path, text in files.items():
                (tree / path).parent.mkdir(parents=True, exist_ok=True)
                (tree / path).write_text(text if isinstance(text, str) else json.dumps(text))
            with self.subTest(name), self.assertRaises(release.ReleaseError):
                release.assemble_site(self.base / "out", tree, None, None)
            self.assertFalse((self.base / "out").exists())

    def test_a_content_manifest_without_a_valid_version_is_refused_next_to_a_firmware_release(self):
        firmware = self.firmware_site()
        for version in (None, 3, "../x"):
            content = self.tree("ct-bad", {"manifest.json": content_manifest(version=version)})
            with self.subTest(version=version), self.assertRaises(release.ReleaseError):
                release.assemble_site(self.base / "out", firmware, content, None)

    def test_a_listed_file_the_site_does_not_hold_is_refused(self):
        content = self.content_site(content_manifest(animations=[dict(listed("animations/gone.json"), id="gone", name="G", version=1)]))
        with self.assertRaises(release.ReleaseError) as caught:
            release.assemble_site(self.base / "out", None, content, None)
        self.assertIn("animations/gone.json", str(caught.exception))
        self.assertFalse((self.base / "out").exists())

    def test_the_assembled_manifest_stays_within_the_limits_of_a_board(self):
        many = [dict(listed(f"animations/a{i}.json"), id=f"a{i}", name="x" * 100, version=1) for i in range(100)]
        files = {f"animations/a{i}.json": "x" for i in range(100)}
        files["playlists/default.json"] = "p"
        content = self.tree("ct", {"manifest.json": content_manifest(animations=many), **files})
        with self.assertRaises(release.ReleaseError) as caught:
            release.assemble_site(self.base / "out", self.firmware_site(), content, None)
        self.assertIn("manifest.json", str(caught.exception))
        self.assertFalse((self.base / "out").exists())

    def test_a_symbolic_link_is_refused_in_a_file_a_folder_or_the_input_itself(self):
        secret = self.base / "secret.txt"
        secret.write_text("secret")
        elsewhere = self.base / "elsewhere"
        elsewhere.mkdir()
        (elsewhere / "x.txt").write_text("x")
        linked_file = self.tree("a", {"index.html": "h"})
        (linked_file / "leak.txt").symlink_to(secret)
        linked_dir = self.tree("b", {"index.html": "h"})
        (linked_dir / "assets").symlink_to(elsewhere)
        broken = self.tree("c", {"index.html": "h"})
        (broken / "gone").symlink_to(self.base / "missing")
        linked_root = self.base / "d"
        linked_root.symlink_to(elsewhere)
        for name, folder in (("file", linked_file), ("folder", linked_dir), ("broken", broken), ("root", linked_root)):
            out = self.base / f"out-{name}"
            for position in range(3):
                inputs = [None, None, None]
                inputs[position] = folder
                with self.assertRaises(release.ReleaseError, msg=f"{name} {position}"):
                    release.assemble_site(out, *inputs)
            self.assertFalse(out.exists(), name)

    def test_an_input_that_is_not_a_folder_is_refused(self):
        file = self.base / "file"
        file.write_text("x")
        for missing in (file, self.base / "missing"):
            for position in range(3):
                inputs = [None, None, None]
                inputs[position] = missing
                with self.assertRaises(release.ReleaseError):
                    release.assemble_site(self.base / "out", *inputs)

    def test_the_site_folder_and_an_input_must_not_contain_each_other(self):
        web = self.web_site()
        content = self.content_site()
        for out in (web, web / "inside", self.base):
            with self.assertRaises(release.ReleaseError):
                release.assemble_site(out, None, None, web)
        for out in (content, content / "inside"):
            with self.assertRaises(release.ReleaseError):
                release.assemble_site(out, None, content, None)
        self.assertEqual(self.read(web), {"index.html": "h", "assets/app.js": "j"})

    def test_a_non_empty_folder_that_is_not_a_site_is_not_replaced(self):
        web = self.web_site()
        out = self.tree("out", {"keep.txt": "mine"})
        with self.assertRaises(release.ReleaseError):
            release.assemble_site(out, None, None, web)
        self.assertEqual(self.read(out), {"keep.txt": "mine"})

    def test_replaces_an_empty_folder_and_an_earlier_site(self):
        firmware = self.firmware_site()
        web = self.web_site()
        out = self.base / "out"
        out.mkdir()
        release.assemble_site(out, firmware, None, web)
        (out / "stale.txt").write_text("stale")
        release.assemble_site(out, firmware, None, web)
        self.assertNotIn("stale.txt", self.read(out))
        self.assertIn("manifest.json", self.read(out))

    def test_the_repository_root_is_refused(self):
        with self.assertRaises(release.ReleaseError):
            release.assemble_site(release.ROOT, None, None, self.web_site())


class BuildSiteTest(unittest.TestCase):
    """The firmware and the content release sites, built from fake build folders and a fake data/."""

    SITE_URL = "https://example.org/art/"

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.legacy_file = self.base / "legacy-catalog.json"
        legacy_patch = mock.patch.object(release, "LEGACY_CATALOG", self.legacy_file)
        legacy_patch.start()
        self.addCleanup(legacy_patch.stop)
        env = {"PIXELART_SITE_URL": self.SITE_URL, "RELEASE_TAG": "v1.2.0", "SOURCE_DATE_EPOCH": "1793000000"}
        for patcher in (mock.patch("builtins.print"), mock.patch.dict(release.os.environ, env, clear=True)):
            patcher.start()
            self.addCleanup(patcher.stop)

    def fake_boards(self):
        build = self.base / "pio"
        for board in release.BOARDS:
            folder = build / board
            folder.mkdir(parents=True)
            (folder / "bootloader.bin").write_bytes(b"boot-" + board.encode())
            (folder / "partitions.bin").write_bytes(
                entry("app0", 0, 0x10, 0x10000, 0x180000) + entry("spiffs", 1, 0x82, 0x310000, 0xF0000) + b"\xeb\xeb" + b"\xff" * 94)
            (folder / "firmware.bin").write_bytes(b"app 1.2.0 " + (self.SITE_URL + "manifest.json").encode() + b"\0")
        boot = self.base / "boot_app0.bin"
        boot.write_bytes(b"boot_app0")
        return build, boot

    def merged(self, chip, output, parts):
        self.factories.append((chip, [offset for offset, _ in sorted(parts)]))
        Path(output).write_bytes(b"factory")

    def build_firmware(self, version="1.2.0", schema=False):
        build, boot = self.fake_boards()
        self.factories = []
        out = self.base / "firmware-site"
        with mock.patch.object(release, "BUILD_DIR", build), mock.patch.object(release, "boot_app0_path", return_value=boot), \
                mock.patch.object(release, "merge_factory", self.merged), \
                mock.patch.object(release.firmware_notices, "build_notices", return_value="notices\n"):
            release.build_site(out, version, schema)
        return out

    def test_a_firmware_release_has_no_animations_playlists_or_file_system(self):
        out = self.build_firmware()
        manifest = json.loads((out / "manifest.json").read_text())
        self.assertEqual((out / "manifest.json").read_text(), release.manifest_text(manifest))
        self.assertEqual(manifest["animations"], [])
        self.assertEqual(manifest["playlists"], [])
        self.assertNotIn("schedules", manifest)
        self.assertNotIn("content_version", manifest)
        self.assertEqual(manifest["version"], "1.2.0")
        self.assertEqual({e["part"] for e in manifest["firmware"]}, {"bootloader", "partitions", "boot_app0", "app", "factory"})
        self.assertEqual(sorted(p.relative_to(out).as_posix() for p in out.rglob("*") if p.is_dir()),
                         ["firmware", "firmware/esp32", "firmware/esp32c3", "firmware/esp32s3"])
        self.assertEqual(list(out.rglob("filesystem*")), [])
        self.assertEqual(list(out.rglob("littlefs*")), [])

    def test_a_firmware_release_needs_no_data_folder(self):
        with mock.patch.object(release, "ROOT", self.base / "empty"):
            self.build_firmware()

    def test_no_esp_web_tools_manifest_lists_a_file_system_part(self):
        out = self.build_firmware()
        for name, erase in (("install.json", True), ("update.json", False)):
            web_tools = json.loads((out / "firmware" / name).read_text())
            self.assertIs(web_tools["new_install_prompt_erase"], erase, name)
            self.assertEqual(len(web_tools["builds"]), 3)
            for build in web_tools["builds"]:
                paths = [p["path"] for p in build["parts"]]
                self.assertEqual(len(paths), 4, name)
                self.assertFalse(any("filesystem" in path or "littlefs" in path or "factory" in path for path in paths), name)
                self.assertEqual([p.split("/")[1].split("-")[0] for p in paths], ["bootloader", "partitions", "boot_app0", "app"])
                for path in paths:
                    self.assertTrue((out / "firmware" / path).is_file(), path)

    def test_the_install_and_update_manifests_list_the_same_parts(self):
        out = self.build_firmware()
        install = json.loads((out / "firmware" / "install.json").read_text())
        update = json.loads((out / "firmware" / "update.json").read_text())
        self.assertEqual(install["builds"], update["builds"])

    def test_the_factory_image_is_made_of_the_four_parts(self):
        self.build_firmware()
        self.assertEqual(self.factories, [("esp32c3", [0x0, 0x8000, 0xE000, 0x10000]),
                                          ("esp32", [0x1000, 0x8000, 0xE000, 0x10000]),
                                          ("esp32s3", [0x0, 0x8000, 0xE000, 0x10000])])

    def test_a_firmware_release_matches_the_schema(self):
        try:
            import jsonschema  # noqa: F401
        except ImportError:
            if os.environ.get("CI"):
                raise
            self.skipTest("needs the jsonschema package")
        self.build_firmware(schema=True)

    def test_a_firmware_not_built_with_the_version_is_refused(self):
        with self.assertRaisesRegex(release.ReleaseError, "not built with version"):
            self.build_firmware(version="9.9.9")

    def test_a_missing_build_is_refused(self):
        with mock.patch.object(release, "BUILD_DIR", self.base / "nothing"), \
                mock.patch.object(release, "boot_app0_path", return_value=self.base / "x"):
            with self.assertRaisesRegex(release.ReleaseError, "pio run"):
                release.build_site(self.base / "out", "1.2.0", False)

    def data(self, animations=("star",), playlists=("default",), schedules=()):
        data = self.base / "data"
        for kind, names in (("animations", animations), ("playlists", playlists), ("schedules", schedules)):
            (data / kind).mkdir(parents=True, exist_ok=True)
            for name in names:
                (data / kind / f"{name}.json").write_text(json.dumps({"name": name.title(), "version": 3}))
        self.legacy_file.write_text(json.dumps({"animations": list(animations), "playlists": list(playlists),
                                               "schedules": list(schedules), "play": []}))
        return data

    def test_an_empty_play_folder_left_by_a_rebuild_publishes_no_play_list(self):
        data = self.data()
        (data / "play").mkdir()
        out = self.base / "content-site"
        release.build_content_site(out, "1.4.0", data, False)
        self.assertNotIn("play", json.loads((out / "manifest.json").read_text()))
        self.assertFalse((out / "play").exists() and any((out / "play").iterdir()))

    def test_a_content_release_has_the_files_and_a_manifest_without_firmware(self):
        out = self.base / "content-site"
        release.build_content_site(out, "1.4.0", self.data(("star", "moon")), False)
        manifest = json.loads((out / "manifest.json").read_text())
        self.assertEqual((out / "manifest.json").read_text(), release.manifest_text(manifest))
        self.assertEqual(list(manifest), ["format", "version", "released", "source", "content_version", "animations", "playlists",
                                          "schedules", "content_pages"])
        self.assertEqual(manifest["schedules"], [])
        self.assertEqual(manifest["version"], "1.4.0")
        self.assertEqual(manifest["content_version"], "1.4.0")
        self.assertEqual(manifest["released"], "2026-10-26")
        self.assertEqual(manifest["source"], "https://github.com/Monska85/PixelArt/tree/v1.2.0")
        self.assertEqual([a["id"] for a in manifest["animations"]], ["star", "moon"])
        self.assertEqual(manifest["animations"][0]["version"], 3)
        self.assertEqual([p["id"] for p in manifest["playlists"]], ["default"])
        self.assertEqual(set(manifest["content_pages"]), set(release.CONTENT_KEYS))
        self.assertEqual([p["kind"] for p in (json.loads((out / ref["file"]).read_text())
                                               for ref in manifest["content_pages"]["animations"])], ["animations"])
        star = manifest["animations"][0]
        self.assertEqual(star["file"], "animations/star.json")
        self.assertEqual(star["sha256"], hashlib.sha256((out / "animations" / "star.json").read_bytes()).hexdigest())
        self.assertTrue(all((out / ref["file"]).is_file() for refs in manifest["content_pages"].values() for ref in refs))

    def test_300_published_files_keep_a_curated_legacy_subset(self):
        names = tuple(f"a{i:03}" for i in range(300))
        data = self.data(animations=names)
        self.legacy_file.write_text(json.dumps({"animations": ["a000", "a299"], "playlists": ["default"],
                                                "schedules": [], "play": []}))
        out = self.base / "content-site"
        release.build_content_site(out, "1.4.0", data, True)
        manifest = json.loads((out / "manifest.json").read_text())
        self.assertEqual([entry["id"] for entry in manifest["animations"]], ["a000", "a299"])
        refs = manifest["content_pages"]["animations"]
        self.assertEqual(len(refs), 10)
        self.assertEqual(sum(len(json.loads((out / ref["file"]).read_text())["entries"]) for ref in refs), 300)
        self.assertLessEqual((out / "manifest.json").stat().st_size, release.MAX_MANIFEST_BYTES)
        self.assertTrue(all(ref["size"] <= release.MAX_CONTENT_PAGE_BYTES for ref in refs))

    def test_a_content_release_lists_its_schedules(self):
        out = self.base / "content-site"
        release.build_content_site(out, "1.4.0", self.data(schedules=("default", "later")), False)
        manifest = json.loads((out / "manifest.json").read_text())
        self.assertEqual([s["id"] for s in manifest["schedules"]], ["default", "later"])
        first = manifest["schedules"][0]
        self.assertEqual(list(first), ["id", "name", "file", "size", "sha256"])
        self.assertNotIn("version", first)
        self.assertEqual(first["file"], "schedules/default.json")
        self.assertEqual(first["sha256"], hashlib.sha256((out / "schedules" / "default.json").read_bytes()).hexdigest())
        self.assertEqual(first["size"], (out / "schedules" / "default.json").stat().st_size)
        many = [f"s{i:03}" for i in range(200)]
        with self.assertRaises(release.ReleaseError):
            release.build_content_site(self.base / "many", "1.4.0", self.data(schedules=many), False)

    PLAY = b'{"format":"pixelart-play/1","default":{"schedule":"seasons"}}'

    def with_play(self, text=PLAY):
        data = self.data(schedules=("seasons",))
        (data / "play").mkdir(exist_ok=True)
        (data / "play" / "default.json").write_bytes(text)
        selection = json.loads(self.legacy_file.read_text())
        selection["play"] = ["default"]
        self.legacy_file.write_text(json.dumps(selection))
        return data

    def test_a_content_release_lists_its_play_file(self):
        out = self.base / "content-site"
        release.build_content_site(out, "1.4.0", self.with_play(), False)
        manifest = json.loads((out / "manifest.json").read_text())
        self.assertEqual(list(manifest)[-2:], ["content_pages", "play"])
        self.assertNotIn("default", manifest)
        self.assertEqual(manifest["play"], [{"id": "default", "file": "play/default.json", "size": len(self.PLAY),
                                             "sha256": hashlib.sha256(self.PLAY).hexdigest()}])
        self.assertEqual((out / "play" / "default.json").read_bytes(), self.PLAY)

    def test_a_content_release_without_a_play_file_has_no_play_list(self):
        out = self.base / "content-site"
        release.build_content_site(out, "1.4.0", self.data(schedules=("seasons",)), False)
        self.assertNotIn("play", json.loads((out / "manifest.json").read_text()))
        self.assertFalse((out / "play").exists())

    def test_the_play_file_counts_in_the_200_files(self):
        many = [f"s{i:03}" for i in range(199)]
        data = self.data(("star",), ("default",), many)
        (data / "play").mkdir()
        (data / "play" / "default.json").write_bytes(self.PLAY)
        selection = json.loads(self.legacy_file.read_text())
        selection["play"] = ["default"]
        self.legacy_file.write_text(json.dumps(selection))
        with self.assertRaisesRegex(release.ReleaseError, "lists 202 animations, playlists, schedules and play files"):
            release.build_content_site(self.base / "many", "1.4.0", data, False)

    def test_a_content_release_with_a_play_file_matches_the_schema(self):
        try:
            import jsonschema  # noqa: F401
        except ImportError:
            if os.environ.get("CI"):
                raise
            self.skipTest("needs the jsonschema package")
        release.build_content_site(self.base / "ok", "1.4.0", self.with_play(), True)

    def test_a_content_release_with_schedules_matches_the_schema(self):
        try:
            import jsonschema  # noqa: F401
        except ImportError:
            if os.environ.get("CI"):
                raise
            self.skipTest("needs the jsonschema package")
        release.build_content_site(self.base / "ok", "1.4.0", self.data(schedules=("default",)), True)

    def test_a_content_release_matches_the_schema(self):
        try:
            import jsonschema  # noqa: F401
        except ImportError:
            if os.environ.get("CI"):
                raise
            self.skipTest("needs the jsonschema package")
        release.build_content_site(self.base / "ok", "1.4.0", self.data(), True)
        release.build_content_site(self.base / "dev", "1.4.0-dev.2+gabc1234.dirty", self.data(), True)

    def test_a_content_release_needs_animations_and_playlists(self):
        for animations, playlists in (((), ("default",)), (("star",), ())):
            with self.subTest(animations=animations, playlists=playlists), self.assertRaisesRegex(release.ReleaseError, "run make data"):
                release.build_content_site(self.base / f"out-{len(animations)}", "1.4.0", self.data(animations, playlists), False)
            shutil.rmtree(self.base / "data")

    def test_a_content_release_refuses_a_bad_version_and_a_manifest_over_the_limits(self):
        with self.assertRaises(release.ReleaseError):
            release.build_content_site(self.base / "out", "../x", self.data(), False)
        many = [f"a{i:03}" for i in range(201)]
        with self.assertRaisesRegex(release.ReleaseError, "more than the 200 a board takes"):
            release.build_content_site(self.base / "out", "1.4.0", self.data(many), False)

    def test_a_content_release_refuses_files_that_are_not_regular(self):
        data = self.data()
        (data / "animations" / "linked.json").symlink_to(self.base / "data" / "playlists" / "default.json")
        with self.assertRaisesRegex(release.ReleaseError, "linked.json"):
            release.build_content_site(self.base / "out", "1.4.0", data, False)

    def test_the_content_site_assembles_with_a_firmware_site_and_matches_the_schema(self):
        try:
            import jsonschema  # noqa: F401
        except ImportError:
            if os.environ.get("CI"):
                raise
            self.skipTest("needs the jsonschema package")
        firmware = self.build_firmware()
        content = self.base / "content-site"
        release.build_content_site(content, "1.4.0", self.data(), True)
        site = self.base / "site"
        release.assemble_site(site, firmware, content, None, use_schema=True)
        manifest = json.loads((site / "manifest.json").read_text())
        self.assertEqual((manifest["version"], manifest["content_version"]), ("1.2.0", "1.4.0"))
        self.assertTrue((site / "animations" / "star.json").is_file())
        self.assertTrue((site / "firmware" / "esp32c3" / "app-1.2.0.bin").is_file())


class VersionTest(unittest.TestCase):
    def test_override_wins_and_is_checked(self):
        import os

        old = os.environ.get("PIXELART_VERSION")
        try:
            os.environ["PIXELART_VERSION"] = "1.2.3"
            self.assertEqual(release.describe_version(), "1.2.3")
            os.environ["PIXELART_VERSION"] = "../x"
            with self.assertRaises(release.ReleaseError):
                release.describe_version()
        finally:
            if old is None:
                os.environ.pop("PIXELART_VERSION", None)
            else:
                os.environ["PIXELART_VERSION"] = old


class ContentVersionCommandTest(unittest.TestCase):
    def test_override_wins_and_is_checked(self):
        with mock.patch.dict(os.environ, {"PIXELART_CONTENT_VERSION": "1.4.0"}):
            self.assertEqual(release.describe_content_version(), "1.4.0")
        with mock.patch.dict(os.environ, {"PIXELART_CONTENT_VERSION": "../x"}):
            with self.assertRaises(release.ReleaseError):
                release.describe_content_version()

    def test_the_command_prints_the_content_version_and_not_the_firmware_one(self):
        env = {"PIXELART_CONTENT_VERSION": "1.4.0", "PIXELART_VERSION": "2.0.0"}
        with mock.patch.dict(os.environ, env), mock.patch.object(sys, "argv", ["release.py", "content-version"]), \
                mock.patch("builtins.print") as printed:
            release.main()
        printed.assert_called_once_with("1.4.0")


class CheckVersionTest(unittest.TestCase):
    def check(self, manifest, prefix, env):
        path = Path(tempfile.mkdtemp()) / "manifest.json"
        path.write_text(json.dumps(manifest), encoding="utf-8")
        with mock.patch.dict(release.os.environ, env, clear=True):
            release.check_version(path, prefix)

    def test_a_tag_that_names_the_built_version_passes(self):
        self.check({"version": "1.2.0"}, "v", {"RELEASE_TAG": "v1.2.0", "PIXELART_VERSION": "1.2.0"})
        manifest = {"version": "0.3.0", "content_version": "0.3.0"}
        self.check(manifest, "content-v", {"RELEASE_TAG": "content-v0.3.0", "PIXELART_CONTENT_VERSION": "0.3.0"})

    def test_a_tag_that_names_another_version_stops_the_release(self):
        with self.assertRaises(release.ReleaseError):
            self.check({"version": "1.2.0"}, "v", {"RELEASE_TAG": "v1.3.0"})
        with self.assertRaises(release.ReleaseError):
            self.check({"version": "0.3.0", "content_version": "0.3.0"}, "content-v", {"RELEASE_TAG": "v0.3.0"})

    def test_a_dry_run_has_no_tag_and_no_version_variable(self):
        self.check({"version": "1.2.0-3-gabc"}, "v", {})
        with self.assertRaises(release.ReleaseError):
            self.check({"version": "1.2.0"}, "v", {"PIXELART_VERSION": "1.2.0"})
        with self.assertRaises(release.ReleaseError):
            self.check({"version": "0.3.0", "content_version": "0.3.0"}, "content-v", {"PIXELART_CONTENT_VERSION": "0.3.0"})

    def test_a_content_manifest_must_repeat_its_version(self):
        with self.assertRaises(release.ReleaseError):
            self.check({"version": "0.3.0"}, "content-v", {"RELEASE_TAG": "content-v0.3.0"})
        with self.assertRaises(release.ReleaseError):
            self.check({"version": "0.3.0", "content_version": "0.4.0"}, "content-v", {})

    def test_the_firmware_manifest_needs_no_content_version(self):
        self.check({"version": "1.2.0"}, "v", {"RELEASE_TAG": "v1.2.0"})

    def test_an_unreadable_manifest_stops_the_release(self):
        with self.assertRaises(release.ReleaseError):
            release.check_version(Path(tempfile.mkdtemp()) / "missing.json", "v")


class SiteAddressTest(unittest.TestCase):
    SITE = "https://example-owner.github.io/Fork/"

    def test_the_firmware_must_carry_the_manifest_address_of_the_site(self):
        app = b"\0\1binary\0" + (self.SITE + "manifest.json").encode() + b"\0more"
        release.check_firmware_address("esp32c3", app, self.SITE)
        for bad in (b"no address", (release.site_url.DEFAULT_SITE_URL + "manifest.json").encode() + b"\0",
                    (self.SITE + "manifest.json").encode()):  # not a C string
            with self.assertRaises(release.ReleaseError, msg=bad):
                release.check_firmware_address("esp32c3", bad, self.SITE)

    def test_the_address_pages_serves_must_be_the_one_of_the_build(self):
        env = {"GITHUB_ACTIONS": "true", "GITHUB_REPOSITORY": "Example-Owner/Fork"}
        with mock.patch.dict(release.os.environ, env, clear=True):
            release.check_site(self.SITE)
            release.check_site(self.SITE.rstrip("/"))  # a missing slash is the same address
            for other in ("https://example-owner.github.io/", "https://art.example.org/", "http://example-owner.github.io/Fork/"):
                with self.assertRaises(release.ReleaseError, msg=other):
                    release.check_site(other)
        # A custom domain is set with the variable, and then Pages must serve that address.
        env = {"PIXELART_SITE_URL": "https://art.example.org/", "GITHUB_ACTIONS": "true", "GITHUB_REPOSITORY": "a/b"}
        with mock.patch.dict(release.os.environ, env, clear=True):
            release.check_site("https://art.example.org/")
            with self.assertRaises(release.ReleaseError):
                release.check_site("https://a.github.io/b/")

    def test_an_invalid_site_address_stops_the_release(self):
        with mock.patch.dict(release.os.environ, {"PIXELART_SITE_URL": "http://art.example.org/"}, clear=True):
            with self.assertRaises(release.ReleaseError):
                release.site_address()


class SourceTest(unittest.TestCase):
    def test_the_source_is_the_tree_of_the_release_tag_in_github_actions(self):
        env = {"GITHUB_ACTIONS": "true", "GITHUB_REPOSITORY": "Owner/Fork", "GITHUB_SERVER_URL": "https://github.com",
               "RELEASE_TAG": "v1.2.0"}
        with mock.patch.dict(release.os.environ, env, clear=True):
            self.assertEqual(release.source_url(), "https://github.com/Owner/Fork/tree/v1.2.0")

    def test_an_invalid_repository_stops_the_release(self):
        for repository in ("Owner", "a/b/c", "-bad/Fork", "Owner/..", "Owner/", "Owner/Fo rk"):
            env = {"GITHUB_ACTIONS": "true", "GITHUB_REPOSITORY": repository, "RELEASE_TAG": "v1.2.0"}
            with self.subTest(repository=repository), mock.patch.dict(release.os.environ, env, clear=True):
                with self.assertRaises(release.ReleaseError):
                    release.source_url()

    def test_without_a_tag_the_source_is_the_tree_of_the_commit_in_the_project_repository(self):
        done = mock.Mock(stdout="0123abcd\n")
        with mock.patch.dict(release.os.environ, {}, clear=True), mock.patch.object(release.subprocess, "run", return_value=done):
            self.assertEqual(release.source_url(), release.firmware_notices.REPOSITORY + "/tree/0123abcd")

    def test_a_commit_that_cannot_be_read_stops_the_release(self):
        failure = release.subprocess.CalledProcessError(128, ["git"])
        with mock.patch.dict(release.os.environ, {}, clear=True), mock.patch.object(release.subprocess, "run", side_effect=failure):
            with self.assertRaises(release.ReleaseError):
                release.source_url()

    def test_the_schema_takes_an_https_source_only(self):
        try:
            import jsonschema  # noqa: F401
        except ImportError:
            if os.environ.get("CI"):
                raise
            self.skipTest("needs the jsonschema package")
        manifest = {"format": release.FORMAT, "version": "1.2.0", "released": "2026-11-02",
                    "source": "https://github.com/Owner/Fork/tree/v1.2.0", "animations": [], "playlists": [],
                    "firmware": [{"board": "esp32c3", "chip": "ESP32-C3", "part": "app", "offset": 65536,
                                  "file": "firmware/esp32c3/app-1.2.0.bin", "size": 1, "sha256": "0" * 64}]}
        release.validate(manifest)
        for bad in ("http://example.org/src", "https://example.org/" + "x" * 200, 7):
            manifest["source"] = bad
            with self.assertRaises(release.ReleaseError, msg=bad):
                release.validate(manifest)


if __name__ == "__main__":
    unittest.main()
