# SPDX-License-Identifier: GPL-3.0-or-later
"""PlatformIO library build script: embeds assets/player.html in the simulator.

Writes player_html.h (a NUL-terminated byte array named PLAYER_HTML) into the
build directory and adds that directory to this library's include path. The
header is rewritten only when the HTML changes, so unchanged builds stay
incremental.
"""

import os

Import("env")  # noqa: F821 - provided by PlatformIO (SCons)

source = os.path.join(env.subst("$PROJECT_DIR"), "lib", "ArduinoSim", "assets", "player.html")  # noqa: F821
out_dir = os.path.join(env.subst("$BUILD_DIR"), "ArduinoSim_generated")  # noqa: F821
out_file = os.path.join(out_dir, "player_html.h")

with open(source, "rb") as f:
    data = f.read()

lines = ["// Generated from assets/player.html by scripts/embed_assets.py. Do not edit.", "#pragma once", ""]
lines.append("static const unsigned char PLAYER_HTML[] = {")
for i in range(0, len(data), 16):
    lines.append("    " + ", ".join("0x%02x" % b for b in data[i : i + 16]) + ",")
lines.append("    0x00};")
content = "\n".join(lines) + "\n"

os.makedirs(out_dir, exist_ok=True)
current = None
if os.path.exists(out_file):
    with open(out_file) as f:
        current = f.read()
if current != content:
    with open(out_file, "w") as f:
        f.write(content)

env.Append(CPPPATH=[out_dir])  # noqa: F821
