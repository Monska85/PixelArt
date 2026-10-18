# PixelArt

Firmware that plays pixel-art animations on a 16x16 WS2812B LED matrix driven by an ESP32-C3 SuperMini board. Animations are data files (YAML in this repository, JSON on the board), so adding one needs no code. A simulator shows the animations on your computer, without any hardware.

## 3D printed frame

You can find the 3D model files to print a frame for the 16x16 LEDs matrix [here](https://www.printables.com/model/1497091-pixel-art-frame). The frame holds the LEDs matrix and has a back support to increase stability and hold the ESP32 board and connection wires.

## Quick start: flash an empty board

1. **Wire the board to the matrix** as described in [Wiring](#wiring).
2. **Install the tools:**
   - [PlatformIO Core](https://docs.platformio.org/en/latest/core/installation/index.html). On Linux, also install the [udev rules](https://docs.platformio.org/en/latest/core/installation/udev-rules.html), so you can flash the board without root.
   - Python 3 with [PyYAML](https://pypi.org/project/PyYAML/) (`pip install pyyaml`), which converts the animations for the board.
3. **Get the code:**

   ```sh
   git clone https://github.com/Monska85/PixelArt.git
   cd PixelArt
   ```

4. **Connect the board** to your computer with a USB-C cable. The cable must carry data: many USB-C cables only carry power.
5. **Build and flash the firmware and the animations:**

   ```sh
   make upload
   ```

   Without `make`, run `python3 tools/pixelart.py build`, then `pio run -e esp32c3 -t upload -t uploadfs`. The first build downloads the ESP32 toolchain and the libraries, so it takes a few minutes. Later builds take seconds.

The animations start as soon as the upload finishes. To see the serial output, run `make monitor` (or `pio device monitor -e esp32c3`). A board with the firmware but no animations shows a dim question mark.

### If the upload fails

- **"Could not open port" or no board found:** check the cable and plug the board straight into the computer, without a hub or dock. The board must show up as a USB serial device: `/dev/ttyACM*` on Linux, `/dev/cu.usbmodem*` on macOS, a COM port on Windows.
- **The board is connected but does not respond:** hold the **BOOT** button, plug in the board, then release the button. This forces the download mode. Run `make upload` again, then press **RESET** (or replug the board) to start the new firmware.
- **More than one serial device is connected:** choose the port explicitly, for example `PLATFORMIO_UPLOAD_PORT=/dev/ttyACM0 make upload`.

## Wiring

- Connect the `5V` and `GND` pins of the ESP32 C3 Supermini to the `DC IN` and `GND` pins of the LED matrix.
- Connect the `GPIO4` pin of the ESP32 C3 Supermini to the `DIN` pin of the LED matrix.

### Power supply improvement

You can improve the power supply avoiding to power the LED matrix through the ESP32 C3 Supermini board USB connector. Instead, you can use a separate 5V power supply and wire it as follows:

- connect the `5V` pin of the power supply to the `DC IN` pin of the LED matrix and to the `5V` pin of the ESP32 C3 Supermini board.
- Connect the `GND` pin of the power supply to the `GND` pin of the LED matrix and to the `GND` pin of the ESP32 C3 Supermini board.
- Connect the `GPIO4` pin of the ESP32 C3 Supermini to the `DIN` pin of the LED matrix.

This solution will provide a more stable power supply to the LED matrix, especially when displaying bright images or animations with many LEDs lit up. This will help to prevent voltage drops and issues when you use the PC USB port to power the ESP32 C3 Supermini board. In other words, you use a proper power supply to power both the ESP32 C3 Supermini board and the LED matrix and PC USB port is used only for programming the ESP32 C3 Supermini board.

## Animations

Every animation is a YAML file in [`animations/`](animations/), and [`playlists/default.yaml`](playlists/default.yaml) decides which ones play and in which order. The formats are specified in [`docs/format/pixelart-v1.md`](docs/format/pixelart-v1.md) and [`docs/format/playlist-v1.md`](docs/format/playlist-v1.md).

`make data` converts them to the JSON files the board reads, in `data/` (the layout of the board's file system: `data/animations/<id>.json`, `data/playlists/default.json`). The file name is the animation ID. The board plays the default playlist; without one, it plays every animation in alphabetical order.

### Adding an animation

1. Create `animations/my_animation.yaml`. Any existing animation is a working example; this one blinks a small heart:

   ```yaml
   format: pixelart/1
   name: My animation
   canvas: { width: 16, height: 16 }
   frame_ms: 400

   palette:
     red: "#ff0000"

   sprites:
     heart:
       at: [6, 6]
       points:
         red: [[0, 0], [2, 0], [0, 1], [1, 1], [2, 1], [1, 2]]

   timeline:
     - loop: 4
       steps:
         - show: [heart]
         - show: []
   ```

2. Add `- animation: my_animation` to `playlists/default.yaml`, in the position it should play.
3. Preview it with `make sim ANIM=my_animation` (then look at `sim-out/sheet.png`) or `make emulate ANIM=my_animation`.
4. Run `make validate`, which checks every file with the same engine the board uses, then `make upload-data` to send the animations to the board without rebuilding the firmware.

## Commands

Every command is available through both `make` and `just`. Run `make help` or `just` to list them. Each one is a thin wrapper around `tools/pixelart.py` or a `pio` command, which you can also run directly.

### Board

| make                       | just                   | What it does                                                         |
| -------------------------- | ---------------------- | -------------------------------------------------------------------- |
| `make upload`              | `just upload`          | Flash the firmware and the animations                                |
| `make upload-firmware`     | `just upload-firmware` | Flash only the firmware, keeping the animations on the board         |
| `make upload-data`         | `just upload-data`     | Flash only the animations and playlists, keeping the firmware        |
| `make monitor`             | `just monitor`         | Open the serial monitor (115200 baud)                                |
| `make flash`               | `just flash`           | Flash the firmware and the animations, then open the serial monitor  |
| `make mirror`              | `just mirror`          | Flash with the live mirror on, then watch the matrix in the terminal |
| `make build`               | `just build`           | Build the firmware for the ESP32-C3 SuperMini                        |
| `make build BOARD=esp32s3` | `just build esp32s3`   | Build for another board (`esp32c3`, `esp32`, `esp32s3`)              |
| `make build-all`           | `just build-all`       | Build for every board                                                |

### Animations and simulator

| make                       | just                         | What it does                                                                                        |
| -------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------- |
| `make data`                | `just data`                  | Convert `animations/` and `playlists/` to the board's JSON files in `data/`                         |
| `make validate`            | `just validate`              | Check every animation and playlist with the board's engine                                          |
| `make emulate`             | `just emulate`               | Emulate the board: run forever in real time, with the matrix and serial output live in the terminal |
| `make emulate ANIM=santa`  | `just emulate --anim santa`  | Emulate only some animations, in a loop                                                             |
| `make sim`                 | `just sim`                   | Run one pass of the playlist, write the output to `sim-out/`                                        |
| `make sim ANIM=santa,bell` | `just sim --anim santa,bell` | Run only some animations                                                                            |
| `make sim-list`            | `just sim-list`              | List the animations                                                                                 |
| `make sim-play ANIM=santa` | `just sim-play --anim santa` | Play once in real time in the terminal                                                              |
| `make sim-open`            | `just sim-open`              | Run and open the HTML player                                                                        |

### Development

| make          | just          | What it does                                                         |
| ------------- | ------------- | -------------------------------------------------------------------- |
| `make test`   | `just test`   | Run the tests in `test/` on the simulator                            |
| `make format` | `just format` | Format the C++ sources with `clang-format`                           |
| `make check`  | `just check`  | Check formatting and animations, run the tests and build every board |
| `make clean`  | `just clean`  | Remove build outputs, `data/` and simulator output                   |

## Live mirror of the real matrix

`make mirror` builds the firmware with `-DPIXELART_MIRROR`, flashes it and opens the serial monitor. With the mirror on, every `matrix.show()` also sends the frame over USB serial as one line (`@PX <count> <rrggbb...>`, in LED strip order, with brightness applied). The monitor filter in `monitor/filter_pixelart.py` draws the matrix live in the terminal and keeps the latest serial output below it.

The filter places the LEDs using the panel wiring set in `platformio.ini` (`custom_panel_size`, `custom_panel_layout`), so wrong matrix flags in the firmware show up here as they do on the frame. Builds without the flag send nothing extra, and the filter passes normal serial output through unchanged.

The ESP32-C3 SuperMini sends over native USB, which keeps up with any frame rate, and skips the mirror when no monitor is connected. Boards that use a USB-UART bridge (`esp32`) need about 130 ms per frame at 115200 baud, which slows fast animations while the mirror is on.

## Simulator

The simulator runs the firmware on your computer and shows what the 16x16 matrix displays, without any hardware. It compiles the same code with the official Adafruit GFX and NeoMatrix libraries. Only the NeoPixel driver is replaced: each `matrix.show()` is recorded as a frame instead of being sent to GPIO4. The `data/` folder stands in for the board's file system (`--data` picks another folder). Time is virtual, so `delay()` costs nothing and a full pass of the playlist runs in about 0.1 seconds. `make emulate` is the exception: it runs in real time, like the board.

The simulator needs a host C++17 compiler (`g++` or `clang++`).

With `make`, pass any other simulator option through `ARGS`, for example `make sim ARGS="--png-frames --range 0:16"`. Run `.pio/build/native/program --help` for the full list.

A run writes:

- `sim-out/frames.json`: every frame with its time, duration, animation name and pixels (row-major `rrggbb` hex), plus the serial output.
- `sim-out/player.html`: a player with play/pause, frame stepping, speed and a jump-to-animation menu.
- `sim-out/sheet.png`: all frames side by side in one image.
- `sim-out/frames/NNNNN.png`: one image per frame, with `--png-frames`.

Colors are shown as the panel looks to the eye (LED output converted to screen colors). Use `--raw` to see the exact values sent to the LEDs, which include the brightness and gamma correction.

The simulator models the physical panel wiring (16x16, strip starting top-left, running in zigzag columns). Firmware configured with the wrong `NEO_MATRIX_*` flags looks scrambled in the simulator, as it would on the real frame. Use `--panel` and `--layout` to simulate a different panel.

### Simulator limits

The simulator does not emulate the ESP32 itself. Timing, memory use, WiFi and other ESP32-only APIs are not covered: `make build-all` checks that the code compiles for each board, and the real board is the final check. GPIO reads always return `LOW` and `random()` is seeded with a fixed value (`--seed` changes it), so runs are repeatable.

## Development

### Project layout

| Path                         | Content                                                                                              |
| ---------------------------- | ---------------------------------------------------------------------------------------------------- |
| `animations/`, `playlists/`  | The animations and playlists, in YAML                                                                |
| `platformio.ini`             | Boards, libraries, the simulator and test environments, and the physical panel settings              |
| `src/main.cpp`               | `setup()`, `loop()` and the matrix configuration                                                     |
| `src/app.cpp`                | Plays the playlist and the animations stored on the board                                            |
| `src/storage.cpp`            | File access: LittleFS on the board, the `data/` folder in the simulator                              |
| `src/pixel_matrix.cpp`       | The matrix `show()`, with the optional live mirror                                                   |
| `src/sim_main.cpp`           | Entry point of the host simulator (only built by the `native` env)                                   |
| `lib/PixelEngine/`           | The animation engine: parsing, validation and playback of the file formats, shared by all builds     |
| `lib/ArduinoSim/`            | Host Arduino core, simulated NeoPixel driver and simulator (`assets/player.html` is the HTML player) |
| `conformance/`               | Test cases every implementation of the animation format must pass                                    |
| `test/`                      | Tests that run on the simulator (`native_test` env)                                                  |
| `tools/pixelart.py`          | Converts animations and playlists from YAML to the board's JSON                                      |
| `monitor/filter_pixelart.py` | Serial monitor filter that draws the live mirror of the real matrix                                  |
| `scripts/`                   | PlatformIO build scripts                                                                             |
| `docs/`, `schema/`           | Format specifications, JSON Schemas and architecture decision records                                |

### Design documents

- [`docs/format/`](docs/format/): specifications of the animation and playlist file formats.
- [`schema/`](schema/): their JSON Schemas.
- [`docs/adr/`](docs/adr/): architecture decision records, explaining why the project works the way it does.

### Continuous integration

The GitHub Actions workflow in `.github/workflows/ci.yml` converts the animations and checks them against the JSON Schemas, validates them with the engine, runs the tests, builds every board, and attaches a rendered preview of every animation to each run. It does not check C++ formatting yet: run `make format-check` locally.

### Code style

C++ sources follow `.clang-format`. Run `make format` before committing; `make check` fails on unformatted code. Formatting needs `clang-format`.
