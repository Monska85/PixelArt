# SPDX-License-Identifier: GPL-3.0-or-later
# Checks of the shipped content in content/, which may change only together with them.
import unittest
from pathlib import Path

import pixelart

PLAYLISTS = Path(__file__).resolve().parent.parent / "content" / "playlists"


class DefaultPlaylistTest(unittest.TestCase):
    def test_default_plays_the_items_of_christmas(self):
        # A board on firmware 1.1.0 knows no schedule and plays `default`; new content uses `christmas`. The two must
        # play the same, until removing `default` is decided on its own.
        default = pixelart.load_source(PLAYLISTS / "default.yaml")
        christmas = pixelart.load_source(PLAYLISTS / "christmas.yaml")
        self.assertEqual(default["name"], "Default")
        for key in ("canvas", "items"):
            self.assertEqual(default[key], christmas[key], key)
        self.assertEqual(set(default) - {"name"}, set(christmas) - {"name"})


if __name__ == "__main__":
    unittest.main()
