# SPDX-License-Identifier: GPL-3.0-or-later
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PACKAGES = json.loads((ROOT / "release-please-config.json").read_text())["packages"]

# One invented sample file per documented path, with the package it releases
# (None: it ships in nothing). Keep in step with the Releases section of the README.
EXPECTED = {
    "src/main.cpp": "firmware",
    "include/x.h": "firmware",
    "lib/x/x.cpp": "firmware",
    "scripts/x.py": "firmware",
    "platformio.ini": "firmware",
    "partitions.csv": "firmware",
    "certs/x.bin": "firmware",
    "version.txt": "firmware",
    "CHANGELOG.md": "firmware",
    "tools/release.py": "firmware",
    "schema/x.json": "firmware",
    "docs/protocol/x.md": "firmware",
    "docs/format/x.md": "firmware",
    "docs/board/x.md": "firmware",
    "LICENSES/firmware/x": "firmware",
    "README.md": "firmware",
    "AGENTS.md": "firmware",
    "Makefile": "firmware",
    "web/src/x.ts": "web",
    "web/package.json": "web",
    "web/scripts/x.ts": "web",
    "web/e2e/x.ts": None,
    "web/test/x.ts": None,
    "web/screenshots/x.png": None,
    "docs/web/x.md": None,
    "LICENSES/web/x": None,
    ".github/workflows/ci.yml": None,
    "conformance/x.json": None,
    "test/x/x.cpp": None,
    "monitor/x.py": None,
    "docs/adr/x.md": None,
    "v0/x.ino": None,
    "content/animations/x.yaml": "content",
    "content/playlists/x.yaml": "content",
    "content/schedules/x.yaml": "content",
}
PACKAGE_NAMES = {".": "firmware", "web": "web", "content": "content"}


def releases(file):
    """Packages a file releases.

    Mirrors release-please's CommitSplit and CommitExclude: the root package
    "." takes every file not under one of its exclude-paths entries (matched
    as entry + "/" prefix); another package takes the files under "<path>/"
    that are not under one of its entries.
    """
    found = set()
    for path, config in PACKAGES.items():
        excluded = [entry + "/" for entry in config.get("exclude-paths", [])]
        if path != "." and not file.startswith(path + "/"):
            continue
        if not any(file.startswith(prefix) for prefix in excluded):
            found.add(PACKAGE_NAMES[path])
    return found


class ReleaseConfigTest(unittest.TestCase):
    def test_every_documented_path_releases_its_package(self):
        for file, package in EXPECTED.items():
            self.assertEqual(
                {package} if package else set(), releases(file), f"{file} releases"
            )

    def test_root_package_excludes_every_other_package(self):
        excluded = PACKAGES["."]["exclude-paths"]
        for path in PACKAGES:
            if path != ".":
                self.assertIn(
                    path, excluded, f"a change to {path} would also release the firmware"
                )

    def test_excluded_paths_are_existing_folders(self):
        # release-please matches an entry as a folder prefix, so a file or a
        # missing folder would silently exclude nothing.
        for package, config in PACKAGES.items():
            for entry in config.get("exclude-paths", []):
                self.assertTrue(
                    (ROOT / entry).is_dir(), f"{package}: {entry} is not a folder"
                )

    def test_excluded_paths_are_plain_relative_folders(self):
        for package, config in PACKAGES.items():
            for entry in config.get("exclude-paths", []):
                self.assertFalse(
                    entry.startswith(("./", "/")) or entry.endswith("/"),
                    f"{package}: {entry} must have no leading ./ or / and no trailing /",
                )

    def test_non_root_exclusions_stay_inside_the_package(self):
        for package, config in PACKAGES.items():
            if package == ".":
                continue
            for entry in config.get("exclude-paths", []):
                self.assertTrue(
                    entry.startswith(package + "/"),
                    f"{package}: {entry} is outside the package folder",
                )


if __name__ == "__main__":
    unittest.main()
