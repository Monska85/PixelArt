# SPDX-License-Identifier: GPL-3.0-or-later
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PACKAGES = json.loads((ROOT / "release-please-config.json").read_text())["packages"]


class ReleaseConfigTest(unittest.TestCase):
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
