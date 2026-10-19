"""The firmware version, shared by tools/release.py and scripts/firmware_version.py.

The rules are in docs/protocol/protocol-v1.md#firmware-version. Standard
library only: the PlatformIO post script imports this file by path.
"""

import os
import re
import subprocess

# Selects the candidates only: git's glob also matches v1.2.3-rc1, v1.2.3.4 and v1.2.3+b, which RELEASE_TAG rejects.
TAG_PATTERN = "v[0-9]*.[0-9]*.[0-9]*"
RELEASE_TAG = re.compile(r"v[0-9]+\.[0-9]+\.[0-9]+")
SAFE_VERSION = re.compile(r"[0-9A-Za-z][0-9A-Za-z.+-]{0,63}")
_DESCRIBED = re.compile(r"v([0-9]+\.[0-9]+\.[0-9]+)-([0-9]+)-g([0-9a-f]+)")


def _version_key(tag):
    return tuple(int(part) for part in tag[1:].split("."))


def git(root, *args):
    try:
        out = subprocess.run(["git", *args], cwd=root, capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.SubprocessError):
        return None
    return out.stdout.strip() if out.returncode == 0 else None


def nearest_release(root):
    """The nearest release tag (exactly vX.Y.Z) as (version, commits since it, commit), or None when there is none."""
    candidates = (git(root, "tag", "--list", TAG_PATTERN) or "").splitlines()
    releases = [tag for tag in candidates if RELEASE_TAG.fullmatch(tag)]
    if not releases:
        return None
    matches = [arg for tag in releases for arg in ("--match", tag)]
    described = _DESCRIBED.fullmatch(git(root, "describe", "--tags", "--long", *matches) or "")
    if not described:
        return None
    version, commits, sha = described.groups()
    # Several release tags on the commit describe chose: the highest version counts. Equally near tags on
    # different commits (two merged branches) are left to git's choice.
    here = (git(root, "tag", "--points-at", f"v{version}^{{commit}}") or "").splitlines()
    best = max((t for t in here if RELEASE_TAG.fullmatch(t)), key=_version_key, default=f"v{version}")
    return best[1:], commits, sha


def describe_version(root):
    """The version of the checkout in root. Raises ValueError for a bad PIXELART_VERSION."""
    override = os.environ.get("PIXELART_VERSION", "").strip()
    if override:
        if not SAFE_VERSION.fullmatch(override):
            raise ValueError(f"PIXELART_VERSION '{override}' is not a valid version")
        return override

    release = nearest_release(root)
    if release:
        tag, commits, sha = release
    else:
        sha = git(root, "rev-parse", "--short", "HEAD")
        count = git(root, "rev-list", "--count", "HEAD")
        if not sha or not count:
            return "0.0.0-unknown"
        tag, commits = "0.0.0", count

    dirty = bool(git(root, "status", "--porcelain", "--untracked-files=no"))
    if commits == "0" and not dirty and release:
        return tag
    return f"{tag}-dev.{commits}+g{sha}{'.dirty' if dirty else ''}"
