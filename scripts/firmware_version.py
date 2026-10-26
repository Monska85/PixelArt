# SPDX-License-Identifier: GPL-3.0-or-later
"""PlatformIO post-build script: defines the firmware version, the board name and the site address.

Both are defined only for the project sources (projenv), so a new commit
rebuilds src/ and not the libraries.

The version follows docs/protocol/protocol-v1.md#firmware-version:
  vX.Y.Z on a clean checkout        X.Y.Z
  anything else                     <last tag or 0.0.0>-dev.<commits>+g<sha>[.dirty]
  no git                            0.0.0-unknown
The PIXELART_VERSION environment variable overrides it (the release build sets
it from the release tag).

The site address (PIXELART_SITE_URL, include/site.h) comes from tools/site_url.py: the environment
variable of that name, else the repository of a GitHub Actions run, else the project's own address.
"""

import importlib.util
import os

Import("env", "projenv")  # noqa: F821 - provided by PlatformIO (SCons)

# The version rules live in tools/fw_version.py, shared with tools/release.py
_spec = importlib.util.spec_from_file_location(
    "pixelart_version", os.path.join(env.subst("$PROJECT_DIR"), "tools", "fw_version.py")  # noqa: F821
)
shared = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(shared)

_site_spec = importlib.util.spec_from_file_location(
    "pixelart_site_url", os.path.join(env.subst("$PROJECT_DIR"), "tools", "site_url.py")  # noqa: F821
)
site = importlib.util.module_from_spec(_site_spec)
_site_spec.loader.exec_module(site)

BOARDS = {"native": "simulator", "native_test": "simulator"}


def version():
    try:
        return shared.describe_version(env.subst("$PROJECT_DIR"))  # noqa: F821
    except ValueError as err:
        raise SystemExit(str(err))


def site_address():
    try:
        return site.site_url(os.environ)
    except ValueError as err:
        raise SystemExit(f"site address: {err}")


def quoted(text):
    return env.StringifyMacro(text)  # noqa: F821


projenv.Append(  # noqa: F821
    CPPDEFINES=[
        ("PIXELART_VERSION", quoted(version())),
        ("PIXELART_SITE_URL", quoted(site_address())),
        ("PIXELART_BOARD", quoted(BOARDS.get(env["PIOENV"], env["PIOENV"]))),  # noqa: F821
    ]
)
