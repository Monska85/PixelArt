"""PlatformIO monitor filter that draws the LED matrix live in the terminal.

Firmware built with -DPIXELART_MIRROR sends each frame as one serial line:
"@PX <count> <rrggbb...>" in LED strip order. This filter maps the strip onto
the physical panel (same wiring as the simulator), redraws the matrix in place
and keeps the latest serial output below it. Other lines pass through as-is
until the first frame arrives.

Panel settings come from the env in platformio.ini:
  custom_panel_size = 16x16
  custom_panel_layout = top,left,columns,zigzag
  custom_monitor_log_lines = 12
"""

import time

from platformio.public import DeviceMonitorFilterBase

FRAME_PREFIX = "@PX "
OFF_CELL = "\x1b[38;2;60;60;60m··"


def parse_layout(spec):
    flags = {"bottom": False, "right": False, "columns": False, "zigzag": False}
    for token in spec.split(","):
        token = token.strip()
        if token in flags:
            flags[token] = True
        elif token not in ("top", "left", "rows", "progressive"):
            raise ValueError("unknown layout token: %s" % token)
    return flags


def strip_to_grid(width, height, layout):
    """Return a list mapping LED strip index to y * width + x.

    Same single-matrix math as Adafruit_NeoMatrix::drawPixel(). The simulator
    has the same mapping in lib/ArduinoSim/src/sim_panel.cpp: keep them in sync.
    """
    mapping = [0] * (width * height)
    for y in range(height):
        for x in range(width):
            minor, major = x, y
            if layout["right"]:
                minor = width - 1 - minor
            if layout["bottom"]:
                major = height - 1 - major
            if layout["columns"]:
                minor, major = major, minor
                scale = height
            else:
                scale = width
            if layout["zigzag"] and major & 1:
                index = (major + 1) * scale - 1 - minor
            else:
                index = major * scale + minor
            mapping[index] = y * width + x
    return mapping


def perceived(value):
    """LED output is linear light; convert to an sRGB value for the screen."""
    return round(255 * (value / 255) ** (1 / 2.2))


class PixelArtMirror(DeviceMonitorFilterBase):
    NAME = "pixelart"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        section = "env:%s" % self.environment if self.environment else "env"
        size = self.config.get(section, "custom_panel_size", "16x16")
        self.width, self.height = (int(v) for v in str(size).lower().split("x"))
        self.layout_name = self.config.get(section, "custom_panel_layout", "top,left,columns,zigzag")
        self.mapping = strip_to_grid(self.width, self.height, parse_layout(self.layout_name))
        self.log_size = int(self.config.get(section, "custom_monitor_log_lines", 12))
        self.buffer = ""
        self.log = []
        self.frames = 0
        self.first_frame_at = 0.0
        self.last_frame = None

    def rx(self, text):
        self.buffer += text
        out = []
        while "\n" in self.buffer:
            line, self.buffer = self.buffer.split("\n", 1)
            line = line.rstrip("\r")
            if line.startswith(FRAME_PREFIX):
                frame = self.parse_frame(line)
                if frame is not None:
                    self.last_frame = frame
                    self.frames += 1
                    if self.frames == 1:
                        self.first_frame_at = time.monotonic()
                        out.append("\x1b[2J")
                    out.append(self.render())
                    continue
            if self.last_frame is None:
                out.append(line + "\n")
            else:
                self.log = (self.log + [line])[-self.log_size:]
                out.append(self.render())
        return "".join(out)

    def parse_frame(self, line):
        try:
            _, count, data = line.split(" ", 2)
            count = int(count)
            data = data.strip()
            if len(data) != count * 6:
                return None
            pixels = [(0, 0, 0)] * (self.width * self.height)
            for n in range(min(count, len(self.mapping))):
                pixels[self.mapping[n]] = (
                    int(data[n * 6 : n * 6 + 2], 16),
                    int(data[n * 6 + 2 : n * 6 + 4], 16),
                    int(data[n * 6 + 4 : n * 6 + 6], 16),
                )
            return pixels
        except ValueError:
            return None

    def render(self):
        rows = ["\x1b[H"]
        for y in range(self.height):
            cells = []
            for x in range(self.width):
                color = self.last_frame[y * self.width + x]
                if color == (0, 0, 0):
                    cells.append(OFF_CELL)
                else:
                    r, g, b = (perceived(c) for c in color)
                    cells.append("\x1b[38;2;%d;%d;%dm██" % (r, g, b))
            rows.append("".join(cells) + "\x1b[0m\x1b[K\n")
        elapsed = time.monotonic() - self.first_frame_at
        rows.append(
            "\x1b[2mframe %d  %.1fs  %dx%d %s  (Ctrl+C to quit)\x1b[0m\x1b[K\n"
            % (self.frames, elapsed, self.width, self.height, self.layout_name)
        )
        rows.append("\x1b[2m" + "-" * (self.width * 2) + "\x1b[0m\x1b[K\n")
        for line in self.log:
            rows.append(line + "\x1b[K\n")
        rows.append("\x1b[J")
        return "".join(rows)
