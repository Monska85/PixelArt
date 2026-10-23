"""PlatformIO post-build script: defines the firmware version and board name.

Both are defined only for the project sources (projenv), so a new commit
rebuilds src/ and not the libraries.

The version follows docs/protocol/protocol-v1.md#firmware-version:
  vX.Y.Z on a clean checkout        X.Y.Z
  anything else                     <last tag or 0.0.0>-dev.<commits>+g<sha>[.dirty]
  no git                            0.0.0-unknown
The PIXELART_VERSION environment variable overrides it (the release build sets
it from the release tag).
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

BOARDS = {"native": "simulator", "native_test": "simulator"}


def version():
    try:
        return shared.describe_version(env.subst("$PROJECT_DIR"))  # noqa: F821
    except ValueError as err:
        raise SystemExit(str(err))


def quoted(text):
    return env.StringifyMacro(text)  # noqa: F821


projenv.Append(  # noqa: F821
    CPPDEFINES=[
        ("PIXELART_VERSION", quoted(version())),
        ("PIXELART_BOARD", quoted(BOARDS.get(env["PIOENV"], env["PIOENV"]))),  # noqa: F821
    ]
)
