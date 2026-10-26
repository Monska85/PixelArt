# SPDX-License-Identifier: GPL-3.0-or-later
"""Checks of the firmware's third-party notices (tools/firmware_notices.py), on made-up link maps and packages."""

import json
import tempfile
import unittest
from pathlib import Path

import firmware_notices as fn

CONFIG = json.loads(fn.CONFIG.read_text(encoding="utf-8"))
PROJECT_LIBS = {"PixelEngine": {"dependencies": {"bblanchon/ArduinoJson": "7.4.3"}}, "PixelCodec": {}}


def link_map(archives):
    members = "".join(f"{a}(x.o)\n                              main.o (symbol)\n" for a in archives)
    return "Archive member included to satisfy reference by file (symbol)\n\n" + members + \
        "\nDiscarded input sections\n\n /not/an/archive.a(y.o)\n"


class Packages:
    """A made-up PlatformIO folder: the framework's library package, the compiler and the libraries of a board."""

    def __init__(self, root, idf="v5.5.5", arduino="3.3.12", components=None):
        self.root = Path(root)
        self.libs = self.root / "packages" / "framework-arduinoespressif32-esp32c3-libs"
        self.tool = self.root / "packages" / "toolchain-riscv32-esp"
        self.libdeps = self.root / "libdeps"
        (self.libs / "esp32c3" / "lib").mkdir(parents=True)
        pins = dict(CONFIG["pins"]["components"], **(components or {}))
        lines = "".join(f"{name}: {version}\n" for name, version in pins.items())
        (self.libs / "versions.txt").write_text(f"esp-idf: {idf} b774170ff46\narduino: master e7c1e8cd4\n" + lines)
        (self.libs / "package.json").write_text(json.dumps({"version": arduino}))
        for path, text in (("newlib/COPYING.NEWLIB", "newlib terms"), ("gcc/COPYING3", "GPL 3 text"),
                           ("gcc/COPYING.RUNTIME", "runtime exception")):
            (self.tool / "share" / "licenses" / path).parent.mkdir(parents=True, exist_ok=True)
            (self.tool / "share" / "licenses" / path).write_text(text)
        (self.tool / "package.json").write_text(json.dumps({"version": "14.2.0+20260121"}))
        for name, files, meta in (("Adafruit NeoPixel", {"COPYING": "LGPL 3 text"}, "version=1.15.5\nurl=https://example.org/neopixel\n"),
                                  ("ArduinoJson", {"LICENSE.txt": "MIT text of ArduinoJson"}, None)):
            folder = self.libdeps / name
            folder.mkdir(parents=True)
            for file, text in files.items():
                (folder / file).write_text(text)
            if meta:
                (folder / "library.properties").write_text(meta)
            else:
                (folder / "library.json").write_text(json.dumps({"version": "7.4.3", "repository": {"url": "https://example.org/aj.git"}}))

    def framework(self, name):
        return str(self.libs / "esp32c3" / "lib" / name)

    def compiler(self, name):
        return str(self.tool / "riscv32-esp-elf" / "lib" / name)


def notices_of(packages, archives):
    notices = fn.Notices(CONFIG, PROJECT_LIBS)
    notices.add_board("esp32c3", fn.linked_archives(link_map(archives)), packages.libdeps)
    return notices.render("1.2.0", "https://example.org/src")


class LinkedArchivesTest(unittest.TestCase):
    def test_reads_the_archives_of_included_members_only(self):
        text = link_map(["/p/lib a.a", "/p/libb.a", "/p/libb.a"])
        self.assertEqual(fn.linked_archives(text), ["/p/lib a.a", "/p/libb.a"])

    def test_refuses_a_map_without_the_list(self):
        with self.assertRaises(fn.NoticesError):
            fn.linked_archives("Memory Configuration\n")

    def test_finds_the_package_of_an_archive(self):
        self.assertEqual(fn.package_root("/x/packages/toolchain-y/lib/libc.a"), Path("/x/packages/toolchain-y"))
        self.assertIsNone(fn.package_root(".pio/build/esp32c3/lib407/libAdafruit NeoPixel.a"))


class NoticesTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.packages = Packages(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def archives(self):
        p = self.packages
        return [p.framework("liblwip.a"), p.framework("libnet80211.a"), p.compiler("libc.a"), p.compiler("libgcc.a"),
                ".pio/build/esp32c3/libFrameworkArduino.a", ".pio/build/esp32c3/lib1/libPixelEngine.a",
                ".pio/build/esp32c3/lib2/libAdafruit NeoPixel.a"]

    def test_lists_what_the_map_links_with_the_versions_of_the_build(self):
        text = notices_of(self.packages, self.archives())
        for line in ("Arduino-ESP32", "Version: 3.3.12", "lwIP", "Version: v5.5.5", "newlib C library",
                     "Version: 14.2.0+20260121", "GCC runtime libraries", "Adafruit NeoPixel", "Version: 1.15.5",
                     "Source: https://example.org/neopixel", "ArduinoJson", "Version: 7.4.3", "Mozilla CA certificate list",
                     "Espressif binary libraries", "https://example.org/src"):
            self.assertIn(line, text)
        # Read from the build: the compiler's texts and the libraries' own files, in full
        for body in ("newlib terms", "GPL 3 text", "runtime exception", "LGPL 3 text", "MIT text of ArduinoJson"):
            self.assertIn(body, text)
        self.assertIn(fn.LICENSES.joinpath("firmware", "lwip.COPYING").read_text(encoding="utf-8").strip(), text)
        # Not linked, so not listed
        self.assertNotIn("protobuf-c", text)
        self.assertNotIn("Mbed TLS", text)

    def test_each_license_text_appears_once(self):
        text = notices_of(self.packages, self.archives())
        apache = fn.LICENSES.joinpath("firmware", "esp-idf.LICENSE").read_text(encoding="utf-8").strip()
        self.assertEqual(text.count(apache), 1)

    def test_an_archive_no_section_names_fails(self):
        with self.assertRaisesRegex(fn.NoticesError, "libsomething_new.a"):
            notices_of(self.packages, self.archives() + [self.packages.framework("libsomething_new.a")])

    def test_a_library_the_config_does_not_name_fails(self):
        (self.packages.libdeps / "Unknown Lib").mkdir()
        with self.assertRaisesRegex(fn.NoticesError, "Unknown Lib"):
            notices_of(self.packages, self.archives() + [".pio/build/esp32c3/lib3/libUnknown Lib.a"])

    def test_a_missing_license_file_fails(self):
        (self.packages.libdeps / "Adafruit NeoPixel" / "COPYING").unlink()
        with self.assertRaisesRegex(fn.NoticesError, "license file"):
            notices_of(self.packages, self.archives())

    def build_with(self, **versions):
        self.tmp.cleanup()
        self.tmp = tempfile.TemporaryDirectory()
        self.packages = Packages(self.tmp.name, **versions)
        return notices_of(self.packages, self.archives())

    def test_another_esp_idf_version_fails(self):
        with self.assertRaisesRegex(fn.NoticesError, "esp-idf v5.5.6"):
            self.build_with(idf="v5.5.6")

    def test_another_arduino_version_fails(self):
        with self.assertRaisesRegex(fn.NoticesError, "arduino 3.3.13"):
            self.build_with(arduino="3.3.13")

    def test_another_component_version_fails(self):
        with self.assertRaisesRegex(fn.NoticesError, "espressif__mdns 1.14.0"):
            self.build_with(components={"espressif__mdns": "1.14.0"})

    def test_the_files_of_every_section_exist(self):
        for section in CONFIG["sections"]:
            for file in section["files"]:
                if not file.startswith("toolchain:"):
                    self.assertTrue((fn.LICENSES / "firmware" / file).is_file(), file)


if __name__ == "__main__":
    unittest.main()
