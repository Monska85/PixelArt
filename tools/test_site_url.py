# SPDX-License-Identifier: GPL-3.0-or-later
import re
import unittest
from pathlib import Path

import site_url

ROOT = Path(__file__).resolve().parent.parent


class DeriveTest(unittest.TestCase):
    def test_a_local_build_uses_the_project_address(self):
        self.assertEqual(site_url.site_url({}), "https://monska85.github.io/PixelArt/")
        self.assertEqual(site_url.site_url({"GITHUB_REPOSITORY": "Other/Repo"}), site_url.DEFAULT_SITE_URL)  # not in Actions
        self.assertEqual(site_url.site_url({"GITHUB_ACTIONS": "false", "GITHUB_REPOSITORY": "Other/Repo"}),
                         site_url.DEFAULT_SITE_URL)
        self.assertEqual(site_url.site_url({"GITHUB_ACTIONS": "true"}), site_url.DEFAULT_SITE_URL)

    def test_a_repository_in_actions_gives_its_pages_address(self):
        env = {"GITHUB_ACTIONS": "true", "GITHUB_REPOSITORY": "Example-Owner/PixelArt"}
        self.assertEqual(site_url.site_url(env), "https://example-owner.github.io/PixelArt/")
        env = {"GITHUB_ACTIONS": "true", "GITHUB_REPOSITORY": "Monska85/PixelArt"}
        self.assertEqual(site_url.site_url(env), "https://monska85.github.io/PixelArt/")
        env = {"GITHUB_ACTIONS": "true", "GITHUB_REPOSITORY": "someone/pixel.art_2-fork"}
        self.assertEqual(site_url.site_url(env), "https://someone.github.io/pixel.art_2-fork/")

    def test_a_repository_named_owner_github_io_is_the_root_of_the_host(self):
        for name in ("example-owner.github.io", "Example-Owner.GitHub.io"):
            env = {"GITHUB_ACTIONS": "true", "GITHUB_REPOSITORY": f"Example-Owner/{name}"}
            self.assertEqual(site_url.site_url(env), "https://example-owner.github.io/", name)
        # Another owner's name is an ordinary repository.
        env = {"GITHUB_ACTIONS": "true", "GITHUB_REPOSITORY": "a/b.github.io"}
        self.assertEqual(site_url.site_url(env), "https://a.github.io/b.github.io/")

    def test_the_explicit_variable_wins_and_an_empty_one_does_not_count(self):
        env = {"PIXELART_SITE_URL": "https://art.example.org/", "GITHUB_ACTIONS": "true", "GITHUB_REPOSITORY": "a/b"}
        self.assertEqual(site_url.site_url(env), "https://art.example.org/")
        env["PIXELART_SITE_URL"] = ""
        self.assertEqual(site_url.site_url(env), "https://a.github.io/b/")
        env["PIXELART_SITE_URL"] = "  "
        self.assertEqual(site_url.site_url(env), "https://a.github.io/b/")
        self.assertEqual(site_url.site_url({"PIXELART_SITE_URL": "https://art.example.org:8443/pixel/art/"}),
                         "https://art.example.org:8443/pixel/art/")

    def test_an_invalid_explicit_value_is_an_error_and_never_falls_back(self):
        for bad in ("http://art.example.org/", "https://art.example.org", "https://user@art.example.org/",
                    "https://user:pass@art.example.org/", "https://art.example.org/?x=1", "https://art.example.org/#a",
                    "https://art.example.org//", "https://art.example.org/a/../", "https://art.example.org/a b/",
                    "https://art.example.org/%41/", "https://art.example.org/a+b/", "https://art.example.org/\"/",
                    "https://art.example.org/<b>/", "https://", "https:///x/", "ftp://art.example.org/", "art.example.org/",
                    "https://-art.example.org/", "https://art.example.org:/", "https://art.example.org:123456/",
                    "https://art.example.org/manifest.json"):
            with self.assertRaises(ValueError, msg=bad):
                site_url.site_url({"PIXELART_SITE_URL": bad})

    def test_the_host_is_lowercased_and_an_explicit_443_dropped(self):
        for given, want in (("https://Art.Example.com/", "https://art.example.com/"),
                            ("https://art.example.com:443/", "https://art.example.com/"),
                            ("https://ART.Example.com:443/Pixel/Art/", "https://art.example.com/Pixel/Art/"),
                            ("https://Art.Example.com:8443/Pixel/", "https://art.example.com:8443/Pixel/")):
            self.assertEqual(site_url.site_url({"PIXELART_SITE_URL": given}), want, given)
        # Other values stay invalid after the normalization.
        for bad in ("https://user@Art.Example.com:443/", "https://art.example.com:80443/", "HTTP://art.example.com/",
                    "https://x:0443/", "https://x:08443/", "https://x:0/", "https://x:00443/"):
            with self.assertRaises(ValueError, msg=bad):
                site_url.site_url({"PIXELART_SITE_URL": bad})

    def test_the_length_keeps_the_manifest_within_the_animation_source_limit(self):
        host = "https://example.org/"
        longest = host + "a" * (site_url.MAX_SITE_URL - len(host) - 1) + "/"
        self.assertEqual(len(longest), 499)
        self.assertEqual(len(site_url.manifest_url(site_url.validate(longest))), 512)
        with self.assertRaises(ValueError):
            site_url.validate(host + "a" * (site_url.MAX_SITE_URL - len(host)) + "/")

    def test_a_bad_repository_value_is_an_error(self):
        for bad in ("", "owner", "owner/", "/repo", "a/b/c", "-bad-/repo", "owner/..", "owner/re po", "owner/re<po"):
            with self.assertRaises(ValueError, msg=bad):
                site_url.site_url({"GITHUB_ACTIONS": "true", "GITHUB_REPOSITORY": bad or "x"} if bad else
                                  {"GITHUB_ACTIONS": "true", "GITHUB_REPOSITORY": " "})

    def test_the_default_is_valid_and_its_manifest_is_the_default_animation_source(self):
        self.assertEqual(site_url.validate(site_url.DEFAULT_SITE_URL), site_url.DEFAULT_SITE_URL)
        self.assertEqual(site_url.manifest_url(site_url.DEFAULT_SITE_URL), "https://monska85.github.io/PixelArt/manifest.json")


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


class ProjectAddressTest(unittest.TestCase):
    """The places that repeat the project's own address, or the limit of an animation_source, agree with site_url."""

    ORIGIN = "https://monska85.github.io"

    def test_the_project_address_has_one_origin(self):
        self.assertEqual(site_url.DEFAULT_SITE_URL, self.ORIGIN + "/PixelArt/")

    def test_the_firmware_fallback_is_the_project_address(self):
        found = re.search(r'#define PIXELART_SITE_URL "([^"]+)"', read("include/site.h"))
        self.assertIsNotNone(found)
        self.assertEqual(found.group(1), site_url.DEFAULT_SITE_URL)

    def test_the_origin_fallback_of_the_board_is_the_project_origin(self):
        found = re.search(r'SITE_ORIGIN\[\] = "([^"]+)"', read("lib/PixelNet/src/net_origin.cpp"))
        self.assertIsNotNone(found)
        self.assertEqual(found.group(1), self.ORIGIN)

    def test_the_web_app_fallback_is_the_project_manifest(self):
        found = re.search(r'PROJECT_ANIMATION_SOURCE =\s*"([^"]+)"', read("web/src/ui/board/updates.ts"))
        self.assertIsNotNone(found)
        self.assertEqual(found.group(1), site_url.manifest_url(site_url.DEFAULT_SITE_URL))

    def test_the_simulator_bridge_accepts_the_project_origin(self):
        self.assertIn(f'"{self.ORIGIN}"', read("tools/ws_bridge.py"))

    def test_the_longest_site_address_is_the_one_the_page_is_sized_for(self):
        found = re.search(r"MAX_SITE_URL = ([0-9]+);", read("lib/PixelNet/src/net_page.h"))
        self.assertEqual(int(found.group(1)), site_url.MAX_SITE_URL)

    def test_the_animation_source_limit_is_the_one_of_settings_h(self):
        header = re.search(r"MAX_ANIMATION_SOURCE = ([0-9]+);", read("include/settings.h"))
        web = re.search(r"MAX_ANIMATION_SOURCE = ([0-9]+);", read("web/src/ui/board/updates.ts"))
        self.assertEqual(int(header.group(1)), site_url.MAX_ANIMATION_SOURCE)
        self.assertEqual(int(web.group(1)), site_url.MAX_ANIMATION_SOURCE)


if __name__ == "__main__":
    unittest.main()
