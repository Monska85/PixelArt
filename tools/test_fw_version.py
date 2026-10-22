"""Tests of tools/fw_version.py: python3 -m unittest discover -s tools"""

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fw_version  # noqa: E402


def fake_git(answers):
    def run(root, *args):
        return answers.get(args[0])

    return run


class DescribeVersionTest(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.dict(os.environ)
        patcher.start()
        self.addCleanup(patcher.stop)
        os.environ.pop("PIXELART_VERSION", None)

    def describe(self, **answers):
        with mock.patch.object(fw_version, "git", fake_git(answers)):
            return fw_version.describe_version(".")

    def test_override_wins_and_is_checked(self):
        os.environ["PIXELART_VERSION"] = "1.2.3"
        self.assertEqual(fw_version.describe_version("."), "1.2.3")
        os.environ["PIXELART_VERSION"] = "../x"
        with self.assertRaises(ValueError):
            fw_version.describe_version(".")

    def test_no_tag_counts_the_commits_from_0_0_0(self):
        self.assertEqual(self.describe(**{"rev-parse": "abc1234", "rev-list": "7", "status": ""}), "0.0.0-dev.7+gabc1234")

    def test_only_tags_that_are_not_releases_means_no_tag(self):
        self.assertEqual(self.describe(tag="v1.2.3rc1", **{"rev-parse": "abc1234", "rev-list": "7", "status": ""}),
                         "0.0.0-dev.7+gabc1234")

    def test_a_trailing_newline_is_not_a_valid_version(self):
        self.assertIsNotNone(fw_version.SAFE_VERSION.fullmatch("1.2.3"))
        self.assertIsNone(fw_version.SAFE_VERSION.fullmatch("1.2.3\n"))

    def make_repository(self, root):
        def run(*args):
            subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t", *args], cwd=root, check=True,
                           capture_output=True)

        run("init", "-q")
        run("commit", "-q", "--allow-empty", "-m", "a")
        return run

    def test_only_exact_release_tags_are_used_in_a_real_repository(self):
        for odd in ("v1.2.3.4", "v1.2.3rc1", "v1.2.3+b", "v1.2.3-rc1"):
            with self.subTest(tag=odd), tempfile.TemporaryDirectory() as root:
                run = self.make_repository(root)
                run("tag", "v1.2.3")
                run("commit", "-q", "--allow-empty", "-m", "b")
                run("tag", odd)
                self.assertRegex(fw_version.describe_version(root), r"^1\.2\.3-dev\.1\+g[0-9a-f]+$")

    def test_the_highest_of_several_tags_on_one_commit_in_a_real_repository(self):
        with tempfile.TemporaryDirectory() as root:
            run = self.make_repository(root)
            run("tag", "v1.0.1")
            run("tag", "v1.10.0")
            run("tag", "v1.2.0-rc1")
            self.assertEqual(fw_version.describe_version(root), "1.10.0")
            run("commit", "-q", "--allow-empty", "-m", "b")
            self.assertRegex(fw_version.describe_version(root), r"^1\.10\.0-dev\.1\+g[0-9a-f]+$")

    def test_a_real_repository_gives_the_tag_when_clean_and_exact_and_dev_when_dirty_or_untagged(self):
        with tempfile.TemporaryDirectory() as root:
            run = self.make_repository(root)
            self.assertRegex(fw_version.describe_version(root), r"^0\.0\.0-dev\.1\+g[0-9a-f]+$")
            run("tag", "v1.2.3")
            self.assertEqual(fw_version.describe_version(root), "1.2.3")
            (Path(root) / "f").write_text("x")
            run("add", "f")
            self.assertRegex(fw_version.describe_version(root), r"^1\.2\.3-dev\.0\+g[0-9a-f]+\.dirty$")

    def test_no_git_is_unknown_in_a_folder_that_is_not_a_repository(self):
        with tempfile.TemporaryDirectory() as root, mock.patch.dict(os.environ, {"GIT_CEILING_DIRECTORIES": root}):
            self.assertEqual(fw_version.describe_version(root), "0.0.0-unknown")


if __name__ == "__main__":
    unittest.main()
