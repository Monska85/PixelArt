# PixelArt

Firmware that plays pixel-art animations on a 16x16 WS2812B LED matrix driven by an ESP32-C3 SuperMini board. Animations are data files (YAML in this repository, JSON on the board), so adding one needs no code. A simulator shows the animations on your computer, without any hardware.

## Web app

The web app manages a board from the browser, with nothing to install:

1. Open <https://monska85.github.io/PixelArt/> in a desktop Chromium browser (Chrome, Edge, Opera or another browser built on Chromium). Connecting to a board and installing firmware need Web Serial, which Firefox, Safari and phones do not have.
2. **Firmware:** plug in the board, open the Firmware view, and use **Install from scratch** for an empty board, or **Update firmware** to keep the animations, playlists and settings. The view tells you when a newer firmware is published.
3. **Board:** choose **Connect board** and pick the serial port. The Board view lists the animations and playlists stored on the board and previews, edits, downloads and deletes them. **Upload files**, **Upload folder** or a drop sends your own files through one queue, which checks them, skips the ones the board already has and asks once about the ones that differ. The view also sets the brightness and the active playlist, edits playlists, and has **Delete everything** in its **More** menu. The details are in [Board view](docs/web/web-app-v1.md#board-view).
4. **Library:** the Library view lists the animations and playlists of the latest release, with a preview of each, and marks the ones that are not on the board or differ from it. The install button of a row adds one (a playlist with the animations it names), and **Install all** adds all animations, all playlists or everything, asking once about files that differ.
5. **Editor:** the Editor view makes and changes animations without writing YAML by hand. Open a file, use **Edit** on a board animation or **Open in editor** on a Library animation, or start a new one. It edits the palette, the sprites on a 16x16 grid, composites and the timeline with every effect, plays a preview, lists the engine's errors and warnings as you type, and shows the same document as YAML. **Download YAML** and **Upload to board** save the work, the header says where it is saved, and a draft in the browser survives a reload. The details are in [Editor view](docs/web/web-app-v1.md#editor-view).

The theme follows the operating system. The button at the top right cycles System, Dark and Light and remembers the choice in the browser.

To try the app without a board, run `make serve`, then choose **Use the simulator** in the connect card of the Board view and **Connect simulator**. The app is described in [`docs/web/web-app-v1.md`](docs/web/web-app-v1.md).

## 3D printed frame

You can find the 3D model files to print a frame for the 16x16 LEDs matrix [here](https://www.printables.com/model/1497091-pixel-art-frame). The frame holds the LEDs matrix and has a back support to increase stability and hold the ESP32 board and connection wires.

## Quick start: flash an empty board

1. **Wire the board to the matrix** as described in [Wiring](#wiring).
2. **Install the tools:**
   - [PlatformIO Core](https://docs.platformio.org/en/latest/core/installation/index.html). On Linux, also install the [udev rules](https://docs.platformio.org/en/latest/core/installation/udev-rules.html), so you can flash the board without root.
   - Python 3.9 or later with [PyYAML](https://pypi.org/project/PyYAML/) (`pip install pyyaml`), which converts the animations for the board.
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

You can improve the power supply avoiding to power the LED matrix through the ESP32 C3 Supermini board USB connector. Instead, you can use a separate 5V power supply and wire it as follows, keeping the `GPIO4` to `DIN` wire:

- connect the `5V` pin of the power supply to the `DC IN` pin of the LED matrix and to the `5V` pin of the ESP32 C3 Supermini board.
- Connect the `GND` pin of the power supply to the `GND` pin of the LED matrix and to the `GND` pin of the ESP32 C3 Supermini board.

This keeps the supply stable and prevents voltage drops when bright images or many LEDs are lit, and the computer's USB port is then used only to program the board.

## Animations

Every animation is a YAML file in [`animations/`](animations/), and [`playlists/default.yaml`](playlists/default.yaml) decides which ones play and in which order. The formats are specified in [`docs/format/pixelart-v1.md`](docs/format/pixelart-v1.md) and [`docs/format/playlist-v1.md`](docs/format/playlist-v1.md).

`make data` converts them to the JSON files the board reads, in `data/` (the layout of the board's file system: `data/animations/<id>.json`, `data/playlists/default.json`). The file name is the animation ID. The board plays the playlist named by its `playlist` setting, `default` unless changed; without a valid one, it plays every animation in alphabetical order. Other playlists, such as `playlists/halloween.yaml`, stay idle until you select them, with `settings playlist=halloween` (see [Commands from a terminal](#commands-from-a-terminal)) or in the Board view of the web app.

An animation can play softer than the board's brightness setting with the optional field `brightness`, a percentage from 1 to 100 (for example `brightness: 50`), never brighter: see [Brightness](docs/format/pixelart-v1.md#brightness).

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

Run `make help` to list every target. Each one is a thin wrapper around `tools/pixelart.py`, a `pio` command or an `npm` script, which you can also run directly. The `justfile` has the same commands with the same steps, as `just <name>` (`just` lists them): `BOARD=x` is `just <name> x`, `ANIM=x` is `--anim x`, `WS=1` is `--ws` and `PORT=x` is `just serve x`.

`ANIM=name[,name]` limits `sim`, `sim-open`, `sim-play`, `emulate` and `serve` to those animations (`emulate` plays them in a loop), `BOARD=esp32` or `BOARD=esp32s3` builds and flashes another board than the ESP32-C3 SuperMini, and `WS=1` adds the WebSocket to `emulate`, as `make serve` does.

### Board

| Command                | What it does                                                         |
| ---------------------- | -------------------------------------------------------------------- |
| `make upload`          | Flash the firmware and the animations                                |
| `make upload-firmware` | Flash only the firmware, keeping the animations on the board         |
| `make upload-data`     | Flash only the animations and playlists, keeping the firmware        |
| `make monitor`         | Open the serial monitor (115200 baud)                                |
| `make flash`           | Flash the firmware and the animations, then open the serial monitor  |
| `make mirror`          | Flash with the live mirror on, then watch the matrix in the terminal |
| `make build`           | Build the firmware for the ESP32-C3 SuperMini, or `BOARD`            |
| `make build-all`       | Build for every board (`esp32c3`, `esp32`, `esp32s3`)                |

### Animations and simulator

| Command         | What it does                                                                                        |
| --------------- | --------------------------------------------------------------------------------------------------- |
| `make data`     | Convert `animations/` and `playlists/` to the board's JSON files in `data/`                         |
| `make validate` | Check every animation and playlist with the board's engine                                          |
| `make emulate`  | Emulate the board: run forever in real time, with the matrix and serial output live in the terminal |
| `make serve`    | Emulate the board and serve the command protocol on `ws://127.0.0.1:8765`                           |
| `make sim`      | Run one pass of the playlist, write the output to `sim-out/`                                        |
| `make sim-list` | List the animations                                                                                 |
| `make sim-play` | Play once in real time in the terminal                                                              |
| `make sim-open` | Run and open the HTML player                                                                        |

### Development

| Command                       | What it does                                                                                                                 |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `make test`                   | Run the tests in `test/` on the simulator                                                                                    |
| `make format`                 | Format the C++ sources with `clang-format`                                                                                   |
| `make format-check`           | Fail if a C++ source is not formatted                                                                                        |
| `make check`                  | Check formatting and animations, run the C++ and Python unit tests, build every board, type check, lint and test the web app |
| `make release-firmware`       | Build every board and the firmware part of the release site into `site/`, see [Releases](#releases)                          |
| `make release-site`           | Build every board and the web app into `site/`, the site Pages shows, see [Releases](#releases)                              |
| `make web-dev`                | Start the web app on `http://localhost:5173` with live reload                                                                |
| `make web-build`              | Build the web app into `web/dist`                                                                                            |
| `make web-test`               | Type check, lint, check the formatting and run the web app's unit tests and the conformance suite                            |
| `make web-size`               | Fail when the JavaScript the web app loads at start is over its budget                                                       |
| `make web-e2e`                | Run the web app's end-to-end tests and the layout checks of every view against the simulator                                 |
| `make web-screenshots`        | Compare one main state per view with its reference image, in the Playwright container (needs Docker)                         |
| `make web-screenshots-update` | Draw the reference images again, in the Playwright container                                                                 |
| `make clean`                  | Remove build outputs, `data/`, `site/` and simulator output                                                                  |

The web app needs Node.js at the version in the `engines` field of `web/package.json`. `make check` and the `make web-*` targets run `npm ci` in `web/` the first time they need the dependencies.

## Commands from a terminal

The board answers a command protocol over its USB serial port, and the simulator over a local WebSocket. Both are driven by `tools/pixelart.py board`, which needs PyYAML (`pip install pyyaml`). The protocol itself is specified in [`docs/protocol/protocol-v1.md`](docs/protocol/protocol-v1.md).

```sh
python3 tools/pixelart.py board --port /dev/ttyACM0 info          # a board over USB serial
python3 tools/pixelart.py board --ws ws://127.0.0.1:8765 info     # the simulator (make serve)
```

Use `--port DEVICE` for a board and `--ws URL` for the simulator. The serial option needs `pyserial`, which PlatformIO already installs; with another Python, run `pip install pyserial`. The WebSocket option needs the `websockets` package, version 15 or later (`pip install websockets`). The commands are the same for both:

| Command                                      | What it does                                                                                      |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `info`                                       | Firmware version, board, storage, memory and the protocol limits                                  |
| `ls [--kind animation\|playlist]`            | List the stored files with their size, SHA-256, name and version                                  |
| `put FILE [--id ID] [--kind KIND]`           | Upload an animation or playlist, YAML or JSON. The board validates it before it replaces the file |
| `get ID [--kind KIND] [-o FILE]`             | Download a file, checked against the SHA-256 that `ls` reports                                    |
| `rm ID [--kind KIND]`                        | Delete a file                                                                                     |
| `wipe [--yes] [--settings]`                  | Delete every animation and playlist after a confirmation (`--yes` skips it) and print the counts  |
| `settings [brightness=0..255] [playlist=ID]` | Show the settings, or change them                                                                 |

`put` converts YAML the same way `make data` does, and takes the ID from the file name (`--id` overrides it). It takes the kind from the folder (`animations/` or `playlists/`), or else from the file's `format` field (`--kind` overrides it). `get` and `rm` use `animation` unless `--kind playlist` is given. `wipe` runs the protocol's [`delete_all`](docs/protocol/protocol-v1.md#delete_all) and prints how many files it removed; with `--settings` it also resets the settings, as **Also reset the settings** does in the web app, and prints them. It asks you to type `yes` first, unless you give `--yes`; a board with an older firmware answers `unknown_command`, or `bad_request` to `--settings`, and then deletes nothing.

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

`make serve` starts the emulation with the command protocol on `ws://127.0.0.1:8765`, so a client can be developed without a board. Choose another port with `make serve PORT=9000` (`just serve 9000`), and allow another web page origin with `ARGS="--ws-origin https://example.org"`. The option is `--ws [PORT]` in the simulator itself, and it works with `--live` or `--realtime` only, because the clients need a clock that runs. The simulator starts `tools/ws_bridge.py` to serve the WebSocket, so `make serve`, `--ws` and the web app's end-to-end tests need `python3` with the `websockets` package, version 15 or later (`pip install websockets`). `make` and `just` start the bridge with the Python they use for the other tools (`PYTHON=...`, `just --set python ...`). A simulator started by hand uses the one in `PIXELART_PYTHON`, by default `python3`. Set `PIXELART_WS_BRIDGE` to the bridge's path when the simulator program is not in the repository's `.pio/build/native/`. The rules (local connections only, one client at a time, the origin check, no authentication, uploads changing the data folder) are in [WebSocket (simulator)](docs/protocol/protocol-v1.md#websocket-simulator).

### Simulator limits

The simulator does not emulate the ESP32 itself. Timing, memory use, WiFi and other ESP32-only APIs are not covered: `make build-all` checks that the code compiles for each board, and the real board is the final check. GPIO reads always return `LOW`, so runs are repeatable. The one exception is the `boot_id` that `info` reports: it is random on every run, as on the board.

## Contributing

Changes reach `main` through pull requests, merged by squashing: the commit on `main` takes the pull request's title and nothing else, and release-please reads that title. The title must therefore be a [Conventional Commit](https://www.conventionalcommits.org/):

```text
<type>[(scope)][!]: <description>
```

- **Type:** `feat`, `fix`, `docs`, `ci`, `chore`, `refactor`, `perf`, `test`, `build`, `style` or `revert`. `feat` and `fix` appear in the changelog and raise the version; see [Releases](#releases).
- **Scope:** optional, lowercase, in parentheses, for example `fix(web): ...`.
- **`!`:** marks a breaking change, for example `feat(protocol)!: ...`.
- **Description:** does not start with a capital letter or a space, and does not end with a period.

The `pr-title` check (`.github/workflows/pr-title.yml`) fails a pull request whose title breaks the rule; fix the title and it runs again. `python3 tools/check_pr_title.py "<title>"` runs the same check locally.

## Releases

The firmware and the web app are released separately, each with its own version, tag and changelog. [release-please](https://github.com/googleapis/release-please) cuts both from the commit messages on `main`, which follow [Conventional Commits](https://www.conventionalcommits.org/):

| Package  | Contents                                   | Tags         | Changelog          |
| -------- | ------------------------------------------ | ------------ | ------------------ |
| Firmware | Everything in the repository except `web/` | `vX.Y.Z`     | `CHANGELOG.md`     |
| Web app  | The `web/` folder                          | `web-vX.Y.Z` | `web/CHANGELOG.md` |

1. Every push to `main` updates two release pull requests, one per package, each with the next version and its changelog entries: `feat` commits go under Added, `fix` under Fixed, and `perf` and `refactor` under Changed. Other types are left out of the changelog. While a version is below 1.0.0, a breaking change raises the minor number. A commit that changes only `web/` is part of the web release only. A commit that changes `web/` and other files is part of both.
2. Merging the firmware pull request creates the `vX.Y.Z` tag and the GitHub Release. The release workflow (`.github/workflows/release.yml`) runs the quick checks on every push to `main` before release-please runs, so a `main` that fails them gets no release. After the release exists, the workflow checks out the tag, normally the commit it just checked (it runs the checks again when the tag points to another commit), builds the firmware of every board and the animations, and attaches `pixelart-site-<version>.zip` and the factory image of each board to the GitHub Release.
3. Merging the web pull request creates the `web-vX.Y.Z` tag and its GitHub Release. The workflow checks out the tag, builds the web app and attaches `pixelart-web-<version>.zip`, the built app.
4. After either release, the workflow publishes GitHub Pages. A Pages deployment replaces the whole site, so the workflow downloads the latest firmware archive and the latest web archive from the GitHub Releases, merges them into one folder and deploys it. When one of the two has never been released, the site holds the other alone. A file name present in both archives fails the deployment.

GitHub Pages, at <https://monska85.github.io/PixelArt/>, holds the latest release of each package: the web app at the root, next to the firmware release files. The GitHub Releases keep every version. The layout, the release assets and the manifest are specified in [`docs/format/manifest-v1.md`](docs/format/manifest-v1.md#where-it-is-published), and the web release in [`docs/web/web-app-v1.md`](docs/web/web-app-v1.md#publishing).

Two repository settings cannot be changed from the code, and a maintainer must set them once:

- **Settings, Pages, Source:** `GitHub Actions`.
- **Settings, Environments, `release`, Environment secrets:** `RELEASE_PLEASE_TOKEN`, the token release-please acts with (see below).

### The release-please token

release-please opens and updates the release pull requests, creates the tags and the GitHub Releases with the secret `RELEASE_PLEASE_TOKEN`, not with the workflow's default token: pull requests opened by the default token start no workflows, so CI and the required `pr-title` check would never run on them and they could not be merged. Every other job of the workflows keeps the default token with the least permissions it needs.

- **Where it lives:** an environment secret of the `release` environment. The environment's deployment branch policy allows only the `main` branch, with no required reviewers, no wait timer and no bypass for administrators. Only the `release-please` job of the release workflow uses the environment, so a workflow run on any other branch, a dry run from the Actions tab included, cannot read the token. A repository secret with the same name must not exist: every job and every branch could read it.
- **Setting it:** `gh secret set RELEASE_PLEASE_TOKEN --env release`, which asks for the value, or Settings, Environments, `release`, Environment secrets, Add environment secret.
- **Kind:** a fine-grained personal access token whose repository access is only this repository.
- **Permissions:** Contents, Pull requests and Issues, each read and write (Issues covers the labels release-please puts on its pull requests). Metadata read-only is added by GitHub. Nothing else.
- **Expiry:** fine-grained tokens expire on the date chosen when the token is created (at most one year). GitHub emails the token's owner a week before.
- **When it is missing or expired:** the release workflow stops at its first release-please step: a missing secret fails with "RELEASE_PLEASE_TOKEN is missing", an expired or revoked token with an authentication error from release-please. Nothing falls back to the default token, and nothing is released until the token is renewed.
- **Renewing it:** on GitHub, open Settings, Developer settings, Personal access tokens, Fine-grained tokens, choose the token and **Regenerate token** (same repository and permissions, a new expiry), or create a new one with the access above. Then replace the value of the environment secret with `gh secret set RELEASE_PLEASE_TOKEN --env release` (or in Settings, Environments, `release`), and run the release workflow again from `main` (Actions, Release, Run workflow, with `dry_run` off) or push to `main`.

The repository setting **Allow GitHub Actions to create and approve pull requests** is not needed for releases, since the default token no longer opens pull requests.

If a build or a publish job fails after a release was created, open the failed workflow run in the Actions tab and choose "Re-run failed jobs". Do not push to `main` to retry: a new push finds the release already created, reports `release_created` as false and builds nothing. The re-run keeps the outputs of the run, so it builds and publishes the same release, and the deployment of the site follows. The deployment waits until every build and publish job of the run has succeeded.

To try a release without publishing, run `make release-site` (`just release-site`). It builds every board, the file system images and the manifests, builds the web app, and merges both with `tools/release.py assemble` into `site/`, which Git ignores: the site Pages would show if both packages were released from this commit. It checks `manifest.json` against its JSON Schema, and needs PlatformIO, PyYAML, `jsonschema` and Node.js (see [Commands](#commands)). `make release-firmware` builds only the firmware part. The workflow can also run as a dry run from the Actions tab (`Run workflow`, with `dry_run` on): it runs the checks, lints the web app, builds the firmware site and the web app, assembles them, attaches the three to the run, and publishes nothing.

The firmware reports its version in `info`, by the rules of [Firmware version](docs/protocol/protocol-v1.md#firmware-version). The release build takes the version from release-please and fails if the firmware is not built with it.

## Development

### Project layout

| Path                         | Content                                                                                                                                  |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `animations/`, `playlists/`  | The animations and playlists, in YAML                                                                                                    |
| `platformio.ini`             | Boards, libraries, the simulator and test environments, and the physical panel settings                                                  |
| `src/main.cpp`               | `setup()`, `loop()` and the matrix configuration                                                                                         |
| `src/app.cpp`                | Plays the playlist and the animations stored on the board                                                                                |
| `src/storage.cpp`            | File access: LittleFS on the board, the `data/` folder in the simulator                                                                  |
| `src/protocol.cpp`           | The command protocol, served over USB serial on the board and over the WebSocket in the simulator                                        |
| `src/settings.cpp`           | Brightness and active playlist, kept in NVS on the board                                                                                 |
| `src/platform.cpp`           | Board services: firmware version, memory and boot ID                                                                                     |
| `include/`                   | Headers of the modules in `src/`                                                                                                         |
| `src/pixel_matrix.cpp`       | The matrix `show()`, with the optional live mirror                                                                                       |
| `src/sim_main.cpp`           | Entry point of the host simulator (only built by the `native` env)                                                                       |
| `lib/PixelEngine/`           | The animation engine: parsing, validation and playback of the file formats, shared by all builds                                         |
| `lib/PixelCodec/`            | CRC-32, SHA-256, base64 and UTF-8 helpers used by the protocol                                                                           |
| `lib/ArduinoSim/`            | Host Arduino core, simulated NeoPixel driver and simulator (`assets/player.html` is the HTML player)                                     |
| `conformance/`               | Test cases every implementation of the animation format must pass                                                                        |
| `test/`                      | Tests that run on the simulator (`native_test` env)                                                                                      |
| `tools/pixelart.py`          | Converts animations and playlists from YAML to the board's JSON, and talks to a board or the simulator                                   |
| `tools/ws_bridge.py`         | Serves the simulator's command protocol on a WebSocket, started by the simulator's `--ws`                                                |
| `tools/test_*.py`            | Unit tests of the tools, run by `make check`                                                                                             |
| `tools/fw_version.py`        | The firmware version rules, shared by `tools/release.py` and the PlatformIO version script                                               |
| `tools/release.py`           | Builds the firmware release site (parts, ESP Web Tools manifests, animations, playlists, `manifest.json`) and merges it with the web app |
| `tools/check_pr_title.py`    | Checks that a pull request title is a conventional commit release-please accepts, for the `pr-title` check                               |
| `web/`                       | The web app: React and TypeScript, its own `package.json`, tests and changelog, see [`web/README.md`](web/README.md)                     |
| `monitor/filter_pixelart.py` | Serial monitor filter that draws the live mirror of the real matrix                                                                      |
| `.github/actions/checks`     | The checks shared by the CI and release workflows                                                                                        |
| `scripts/`                   | PlatformIO build scripts, including the firmware version, which uses `tools/fw_version.py`                                               |
| `release-please-config.json` | Release automation settings for the firmware and the web app, with `.release-please-manifest.json` and `version.txt`                     |
| `docs/`, `schema/`           | Specifications of the formats, the protocol and the web app, their JSON Schemas, and architecture decision records (`docs/adr/`)         |
| `v0/`                        | The original Arduino IDE sketch and its README, kept unchanged for history, see [History](#history)                                      |

### Continuous integration

The GitHub Actions workflow in `.github/workflows/ci.yml` runs on every pull request and on every push to `main`, once per change: a newer run of the same pull request or of `main` cancels the one still running. It checks the C++ formatting, converts the animations and checks them against the JSON Schemas, validates them with the engine, runs the tests, drives the simulator's WebSocket with `tools/pixelart.py board` (info, upload, list, download, delete and a rejected file), builds every board and the firmware release site (checking its manifest against the JSON Schema), and attaches a rendered preview of every animation to each run. A second job, `web`, lints the web app, checks its formatting, runs its unit tests, builds it (which type checks it), checks the size of the JavaScript it loads at start, runs its end-to-end tests and the layout checks in Chromium against the simulator, and compares the reference images in the Playwright container. A third job, `actionlint`, checks the workflows with a pinned actionlint release and the `run:` blocks with shellcheck. `.github/workflows/release.yml` publishes releases, see [Releases](#releases). CI installs its Python tools at the exact versions in `requirements-ci.txt`. Dependabot opens a weekly pull request to update the pinned actions, the web app's npm dependencies and the Python tools.

### Code style

C++ sources follow `.clang-format`. Run `make format` before committing; `make check` fails on unformatted code. Formatting needs `clang-format`. CI uses the version pinned in `requirements-ci.txt` (`pip install clang-format==23.1.3`), since other versions can format differently.

### Loop task stack

The firmware parses, validates and plays files on the board's loop task, whose stack is small. To measure how much of it a change uses, on a real board:

1. Add temporary debug output, never committed: from code that runs on the loop task (for example `protocol::poll()`), print `uxTaskGetStackHighWaterMark(NULL)` about once a second. On the ESP32 the value is in bytes and is the smallest free stack since boot.
2. Flash that build with `make upload-firmware`.
3. For each case, reset the board, upload the test file with `tools/pixelart.py board put`, then run `board ls`, which parses every stored file. Only one program can open the serial port at a time, so open it only after the tool has exited, with a program that does not reset the board when it opens the port, and read the value printed: it is the smallest since the reset. Resetting before each case keeps the numbers independent; the debug lines share the port with the protocol, whose clients ignore them.
4. Use as test inputs a shipped animation, the deepest file the format accepts (nesting every construct to its limit), files nested deeper than the format allows but within the JSON nesting limit, and one file over the JSON nesting limit.
5. Afterwards, remove the debug code, flash the normal firmware and the files with `make upload`, set the settings back, and delete the test files, which belong outside the repository.

Compare the numbers before and after the change, case by case.

## History

The project started as a single Arduino IDE sketch. That sketch and its original README are kept in [`v0/`](v0/README.md), byte for byte, as the starting point of this project. They are not maintained and not built, and no tool of this repository formats or checks them.
