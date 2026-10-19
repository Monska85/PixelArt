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

   Without `make`, run `python3 tools/pixelart.py build`, then `pio run -e esp32c3 -t upload` and `pio run -e esp32c3 -t uploadfs`. Run them as two commands: PlatformIO writes only the file system when both targets are given in one command. The first build downloads the ESP32 toolchain and the libraries, so it takes a few minutes. Later builds take seconds.

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

An animation can play softer than the board's brightness setting with the optional field `brightness`, a percentage from 1 to 100 (for example `brightness: 50`). The board setting stays the limit: an animation never plays brighter than it. See the [format specification](docs/format/pixelart-v1.md#brightness).

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
| `make serve`               | `just serve`                 | Emulate the board and serve the command protocol on `ws://127.0.0.1:8765`                           |
| `make emulate WS=1`        | `just emulate --ws`          | Same as `make serve`, through `emulate`                                                             |
| `make sim`                 | `just sim`                   | Run one pass of the playlist, write the output to `sim-out/`                                        |
| `make sim ANIM=santa,bell` | `just sim --anim santa,bell` | Run only some animations                                                                            |
| `make sim-list`            | `just sim-list`              | List the animations                                                                                 |
| `make sim-play ANIM=santa` | `just sim-play --anim santa` | Play once in real time in the terminal                                                              |
| `make sim-open`            | `just sim-open`              | Run and open the HTML player                                                                        |

### Development

| make                | just                | What it does                                                                             |
| ------------------- | ------------------- | ---------------------------------------------------------------------------------------- |
| `make test`         | `just test`         | Run the tests in `test/` on the simulator                                                |
| `make format`       | `just format`       | Format the C++ sources with `clang-format`                                               |
| `make format-check` | `just format-check` | Fail if a C++ source is not formatted                                                    |
| `make check`        | `just check`        | Check formatting and animations, run the C++ and Python unit tests and build every board |
| `make release-site` | `just release-site` | Build every board and the release site into `site/`, see [Releases](#releases)           |
| `make clean`        | `just clean`        | Remove build outputs, `data/`, `site/` and simulator output                              |

## Commands from a terminal

The board answers a command protocol over its USB serial port, and the simulator over a local WebSocket. Both are driven by `tools/pixelart.py board`, which needs PyYAML (`pip install pyyaml`). The protocol itself is specified in [`docs/protocol/protocol-v1.md`](docs/protocol/protocol-v1.md).

```sh
python3 tools/pixelart.py board --port /dev/ttyACM0 info          # a board over USB serial
python3 tools/pixelart.py board --ws ws://127.0.0.1:8765 info     # the simulator (make serve)
```

Use `--port DEVICE` for a board and `--ws URL` for the simulator. The serial option needs `pyserial`, which PlatformIO already installs; with another Python, run `pip install pyserial`. The commands are the same for both:

| Command                                      | What it does                                                                                      |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `info`                                       | Firmware version, board, storage, memory and the protocol limits                                  |
| `ls [--kind animation\|playlist]`            | List the stored files with their size, SHA-256, name and version                                  |
| `put FILE [--id ID] [--kind KIND]`           | Upload an animation or playlist, YAML or JSON. The board validates it before it replaces the file |
| `get ID [--kind KIND] [-o FILE]`             | Download a file, checked against the SHA-256 that `ls` reports                                    |
| `rm ID [--kind KIND]`                        | Delete a file                                                                                     |
| `settings [brightness=0..255] [playlist=ID]` | Show the settings, or change them                                                                 |

`put` converts YAML the same way `make data` does, and takes the ID from the file name (`--id` overrides it). It takes the kind from the folder (`animations/` or `playlists/`), or else from the file's `format` field (`--kind` overrides it). `get` and `rm` use `animation` unless `--kind playlist` is given.

A rejected file leaves the board unchanged. The tool prints the engine's diagnostics in the format of `make validate` and exits with a non-zero status, as it does for any other failure.

```text
$ python3 tools/pixelart.py board --ws ws://127.0.0.1:8765 put bad.yaml
animation/bad: error unknown_color at sprites.dot.points[0][2]: unknown color "#gren": not a palette name or a "#rrggbb" value
pixelart: invalid_file: the file is not a valid animation
```

Only one program can open the serial port at a time. Close the serial monitor (`make monitor`) before you run the client, and the client before you open the monitor again. The board keeps playing while it handles commands. If the board has just started, the first command can take a few seconds while the client retries.

The client keeps the DTR and RTS lines low, so opening the port does not reset the board. Other programs may reset the board when they open the port, which stops the animation and cancels an upload in progress.

Over USB, a request takes a few milliseconds to tens of milliseconds, and a 64 KB animation uploads in a few seconds.

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

### WebSocket

`make serve` (or `make emulate WS=1`) starts the emulation with the command protocol on `ws://127.0.0.1:8765`, so a client can be developed without a board. Choose another port with `ARGS="--ws 9000"`. The option is `--ws [PORT]` in the simulator itself, and it works with `--live` or `--realtime` only, because the clients need a clock that runs.

- The server listens on `127.0.0.1` only and serves one client at a time. A second connection gets HTTP 503 until the first one closes.
- Each WebSocket text message is one protocol line, without the final newline. The simulator sends back only the `@PR` reply lines.
- Uploads and deletions change the `--data` folder (`data/` by default). `make data` writes the converted repository files there again.
- A web page you visit could try to open a WebSocket to `localhost`, so the simulator checks the `Origin` header. It accepts connections with no `Origin` (command line clients), `http://localhost` and `http://127.0.0.1` on any port, and `https://monska85.github.io`. Anything else gets HTTP 403. Add an origin with `--ws-origin ORIGIN`, which can be repeated, for example `make serve ARGS="--ws-origin https://example.org"`.
- There is no authentication: any program on your computer can connect.

### Simulator limits

The simulator does not emulate the ESP32 itself. Timing, memory use, WiFi and other ESP32-only APIs are not covered: `make build-all` checks that the code compiles for each board, and the real board is the final check. GPIO reads always return `LOW` and `random()` is seeded with a fixed value (`--seed` changes it), so runs are repeatable. The one exception is the `boot_id` that `info` reports: it is random on every run, as on the board.

## Releases

Versions are cut by [release-please](https://github.com/googleapis/release-please) from the commit messages on `main`, which follow [Conventional Commits](https://www.conventionalcommits.org/):

1. Every push to `main` updates a release pull request. It holds the next version and the `CHANGELOG.md` entries: `feat` commits go under Added, `fix` under Fixed, and `perf` and `refactor` under Changed. Other types are left out of the changelog. While the version is below 1.0.0, a breaking change raises the minor number.
2. Merging that pull request creates the `vX.Y.Z` tag and the GitHub Release. The release workflow (`.github/workflows/release.yml`) runs the quick checks on every push to `main` before release-please runs, so a `main` that fails them gets no release. After the release exists, the workflow checks out the tag, runs the checks again, builds the firmware of every board and the animations, attaches `pixelart-site-<version>.zip` and the factory image of each board to the GitHub Release, and publishes the site on GitHub Pages.

GitHub Pages, at <https://monska85.github.io/PixelArt/>, holds the latest release only: `manifest.json`, the firmware of each board with ESP Web Tools manifests (`firmware/install.json` for a first install, `firmware/update.json` to keep the animations), and every animation and playlist as stored on a board. The GitHub Releases keep every version: each holds `pixelart-site-<version>.zip`, the same files in the same layout as Pages (so the manifests resolve inside it), and the `<board>-factory-<version>.bin` images for `esptool write_flash 0x0`. The layout and the manifest are specified in [`docs/format/manifest-v1.md`](docs/format/manifest-v1.md).

Two repository settings cannot be changed from the code, and a maintainer must set them once:

- **Settings, Pages, Source:** `GitHub Actions`.
- **Settings, Actions, General, Workflow permissions:** turn on `Allow GitHub Actions to create and approve pull requests`, so release-please can open its pull request.

Checks do not run on the release pull request, because pull requests opened by the default workflow token do not trigger workflows. The release workflow runs them again before it publishes anything.

If the build or a publish job fails after the release was created, open the failed workflow run in the Actions tab and choose "Re-run failed jobs". Do not push to `main` to retry: a new push finds the release already created, reports `release_created` as false and builds nothing. The re-run keeps the outputs of the run, so it builds and publishes the same release.

To try a release without publishing, run `make release-site` (`just release-site`). It builds every board, the file system images and the manifests into `site/`, which Git ignores, and checks `manifest.json` against its JSON Schema. It needs PlatformIO, PyYAML and `jsonschema`. The workflow can also run as a dry run from the Actions tab (`Run workflow`, with `dry_run` on): it builds the site and attaches it to the run, and publishes nothing. CI builds the site on every push too.

The firmware reports its version in `info`. A build of a commit tagged `vX.Y.Z` with no local changes reports `X.Y.Z`. Any other build reports `<last tag>-dev.<commits since the tag>+g<commit>`, with `.dirty` at the end when there are local changes, and `0.0.0` stands for the last tag until the first release. The release build takes the version from release-please and fails if the firmware is not built with it.

## Development

### Project layout

| Path                         | Content                                                                                                                             |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `animations/`, `playlists/`  | The animations and playlists, in YAML                                                                                               |
| `platformio.ini`             | Boards, libraries, the simulator and test environments, and the physical panel settings                                             |
| `src/main.cpp`               | `setup()`, `loop()` and the matrix configuration                                                                                    |
| `src/app.cpp`                | Plays the playlist and the animations stored on the board                                                                           |
| `src/storage.cpp`            | File access: LittleFS on the board, the `data/` folder in the simulator                                                             |
| `src/protocol.cpp`           | The command protocol, served over USB serial on the board and over the WebSocket in the simulator                                   |
| `src/settings.cpp`           | Brightness and active playlist, kept in NVS on the board                                                                            |
| `src/platform.cpp`           | Board services: firmware version, memory and boot ID                                                                                |
| `include/`                   | Headers of the modules in `src/`                                                                                                    |
| `src/pixel_matrix.cpp`       | The matrix `show()`, with the optional live mirror                                                                                  |
| `src/sim_main.cpp`           | Entry point of the host simulator (only built by the `native` env)                                                                  |
| `lib/PixelEngine/`           | The animation engine: parsing, validation and playback of the file formats, shared by all builds                                    |
| `lib/PixelCodec/`            | CRC-32, SHA-256, base64 and UTF-8 helpers used by the protocol                                                                      |
| `lib/ArduinoSim/`            | Host Arduino core, simulated NeoPixel driver, simulator and its protocol WebSocket server (`assets/player.html` is the HTML player) |
| `conformance/`               | Test cases every implementation of the animation format must pass                                                                   |
| `test/`                      | Tests that run on the simulator (`native_test` env)                                                                                 |
| `tools/pixelart.py`          | Converts animations and playlists from YAML to the board's JSON, and talks to a board or the simulator                              |
| `tools/test_*.py`            | Unit tests of the tools, run by `make check`                                                                                        |
| `tools/fw_version.py`        | The firmware version rules, shared by `tools/release.py` and the PlatformIO version script                                          |
| `tools/release.py`           | Builds the release site: firmware parts, ESP Web Tools manifests, animations, playlists and `manifest.json`                         |
| `monitor/filter_pixelart.py` | Serial monitor filter that draws the live mirror of the real matrix                                                                 |
| `.github/actions/checks`     | The checks shared by the CI and release workflows                                                                                   |
| `scripts/`                   | PlatformIO build scripts, including the firmware version, which uses `tools/fw_version.py`                                          |
| `release-please-config.json` | Release automation settings, with `.release-please-manifest.json` and `version.txt`                                                 |
| `docs/`, `schema/`           | Format specifications, JSON Schemas and architecture decision records                                                               |

### Design documents

- [`docs/format/`](docs/format/): specifications of the animation, playlist and release manifest file formats.
- [`docs/protocol/`](docs/protocol/): the command protocol of the board and the simulator.
- [`schema/`](schema/): their JSON Schemas.
- [`docs/adr/`](docs/adr/): architecture decision records, explaining why the project works the way it does.

### Continuous integration

The GitHub Actions workflow in `.github/workflows/ci.yml` converts the animations and checks them against the JSON Schemas, validates them with the engine, runs the tests, drives the simulator's WebSocket with `tools/pixelart.py board` (info, upload, list, download, delete and a rejected file), builds every board and the release site (checking its manifest against the JSON Schema), and attaches a rendered preview of every animation to each run. `.github/workflows/release.yml` publishes releases, see [Releases](#releases). It does not check C++ formatting yet: run `make format-check` locally. Dependabot opens a weekly pull request to update the pinned actions.

### Code style

C++ sources follow `.clang-format`. Run `make format` before committing; `make check` fails on unformatted code. Formatting needs `clang-format`.
