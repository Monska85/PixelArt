# SPDX-License-Identifier: GPL-3.0-or-later
"""PlatformIO script for the board envs.

src/crt_bundle.S embeds certs/x509_crt_bundle.bin with .incbin, which the
build does not see as a dependency: this makes the object depend on the file,
so a regenerated bundle is assembled again.
"""

import os

Import("env")  # noqa: F821 - provided by PlatformIO (SCons)

env.Depends(  # noqa: F821
    os.path.join("$BUILD_DIR", "src", "crt_bundle.S.o"),
    os.path.join("$PROJECT_DIR", "certs", "x509_crt_bundle.bin"),
)
