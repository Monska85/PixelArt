# SPDX-License-Identifier: GPL-3.0-or-later
"""PlatformIO pre-build script for the native simulator env.

Adafruit GFX ships TFT and OLED display drivers (Adafruit_SPITFT.cpp,
Adafruit_GrayOLED.cpp) that need SPI/I2C hardware headers. The matrix never
uses them, so the simulator build skips compiling them.
"""

Import("env")  # noqa: F821 - provided by PlatformIO (SCons)


def skip(node):
    return None


for pattern in ("*/Adafruit_SPITFT.cpp", "*/Adafruit_GrayOLED.cpp"):
    env.AddBuildMiddleware(skip, pattern)  # noqa: F821
