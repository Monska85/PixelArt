"""Tests of tools/release.py that need neither PlatformIO nor a build: python3 -m unittest discover -s tools"""

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
        path = self.table(entry("app0", 0, 0x10, 0x10000, 0x140000), entry("spiffs", 1, 0x82, 0x290000, 0x160000))
        entries = release.read_partitions(path)
        self.assertEqual(entries[0], ("app0", 0, 0x10, 0x10000, 0x140000))
        self.assertEqual(release.find_partition(entries, 1, 0x82, "file system")[3], 0x290000)
        self.assertEqual(len(entries), 2)

    def test_missing_partition_is_reported(self):
        entries = release.read_partitions(self.table(entry("app0", 0, 0x10, 0x10000, 0x140000)))
        with self.assertRaises(release.ReleaseError):
            release.find_partition(entries, 1, 0x82, "file system")

    def test_empty_table_is_rejected(self):
        with self.assertRaises(release.ReleaseError):
            release.read_partitions(self.table())


class WebToolsManifestTest(unittest.TestCase):
    firmware = [
        {"board": b, "part": p, "file": f"firmware/{b}/{p}-1.0.0.bin", "offset": o}
        for b in release.BOARDS
        for p, o in (("app", 65536), ("bootloader", 0), ("filesystem", 2686976), ("factory", 0))
    ]

    def test_update_has_no_file_system_and_paths_are_relative_to_firmware(self):
        manifest = release.web_tools_manifest("1.0.0", self.firmware, ["bootloader", "app"], False)
        self.assertFalse(manifest["new_install_prompt_erase"])
        self.assertEqual([b["chipFamily"] for b in manifest["builds"]], ["ESP32-C3", "ESP32", "ESP32-S3"])
        self.assertEqual(
            manifest["builds"][0]["parts"],
            [{"path": "esp32c3/bootloader-1.0.0.bin", "offset": 0}, {"path": "esp32c3/app-1.0.0.bin", "offset": 65536}],
        )

    def test_install_adds_the_file_system_and_never_the_factory_image(self):
        manifest = release.web_tools_manifest("1.0.0", self.firmware, ["bootloader", "app", "filesystem"], True)
        parts = [p["path"] for p in manifest["builds"][1]["parts"]]
        self.assertEqual(parts[-1], "esp32/filesystem-1.0.0.bin")
        self.assertFalse(any("factory" in p for p in parts))


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


if __name__ == "__main__":
    unittest.main()
