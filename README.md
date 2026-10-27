# PixelArt

Firmware that plays pixel-art animations on a 16x16 WS2812B LED matrix driven by an ESP32-C3 SuperMini board. Animations are data files (YAML in this repository, JSON on the board), so adding one needs no code. A simulator shows the animations on your computer, without any hardware.

## Web app

The web app manages a board from the browser, with nothing to install:

1. Open <https://monska85.github.io/PixelArt/> in a desktop Chromium browser (Chrome, Edge, Opera or another browser built on Chromium). Connecting over USB and installing firmware need Web Serial, which Firefox, Safari and phones do not have. Connecting over WiFi is expected to work in Chromium browsers only (a browser test confirms it once the project's Pages site is live), see [Connecting over WiFi](#connecting-over-wifi).
2. **Firmware:** plug in the board, open the Firmware view, and use **Install from scratch** for an empty board, or **Update firmware** to keep the animations, playlists and settings. The view tells you when a newer firmware is published. Install from scratch also installs the latest animations and playlists, and the board must stay connected until the app says they are installed ([Install and update](docs/web/web-app-v1.md#install-and-update)).
3. **Board:** choose **Connect board** and pick the serial port, or **Connect over WiFi** and type the board's address. The Board view lists the animations and playlists stored on the board and previews, edits, downloads and deletes them. **Upload files**, **Upload folder** or a drop sends your own files through one queue, which checks them, skips the ones the board already has and asks once about the ones that differ. The view also shows how much space is left on the board, sets the brightness and the active playlist, edits playlists, and has **Delete everything** in its **More** menu. The details are in [Board view](docs/web/web-app-v1.md#board-view).
4. **Library:** the Library view lists the animations and playlists of the latest release, with a preview of each, and marks the ones that are not on the board or differ from it. The install button of a row adds one (a playlist with the animations it names), and **Install all** adds all animations, all playlists or everything, asking once about files that differ.
5. **Editor:** the Editor view makes and changes animations without writing YAML by hand. Open a file, use **Edit** on a board animation or **Open in editor** on a Library animation, or start a new one. It edits the palette, the sprites on a 16x16 grid, composites and the timeline with every effect, plays a preview, lists the engine's errors and warnings as you type, and shows the same document as YAML. **Download YAML** and **Upload to board** save the work, the header says where it is saved, and a draft in the browser survives a reload. The details are in [Editor view](docs/web/web-app-v1.md#editor-view).

The theme follows the operating system. The button at the top right cycles System, Dark and Light and remembers the choice in the browser.

To try the app without a board, run `make serve`, then choose **Use the simulator** in the connect card of the Board view and **Connect simulator**. The app is described in [`docs/web/web-app-v1.md`](docs/web/web-app-v1.md).

### Privacy

The web app runs entirely in your browser, and nothing personal leaves your browser and your board: your animations, playlists, settings and WiFi network name and password go only to your board, over USB or to the address of your board, and to log in over WiFi the app sends a code derived from your token, never the token. The same text is in the footer of the app, with a **Privacy** view that lists what the app keeps.

- **Stays in your browser:** your theme choice, the last simulator address, the address of your board on your network (its name ending in `.local`, or the address you typed) from your last WiFi connection or read from the board over USB, the token of a board you logged in to (as written, to log in again; it is never sent, the board checks a code derived from it), that you dismissed the Editor note, and the animation you are editing (a draft, so a reload does not lose it). They are in `localStorage` (`pixelart.theme`, `pixelart.simulator`, `pixelart.wifi`, `pixelart.token.<host>`, `pixelart.editorNote`) and in IndexedDB (`pixelart-editor`). The app sets no cookies. Clear the site data to remove them.
- **The site only serves files:** the app, the release manifest, the animations, the playlists and the firmware come from the same GitHub Pages site. The app uses no font, analytics, error reporting or other service. Like any website, GitHub Pages sees the standard data of a request, such as your IP address and your browser's user agent.
- **What your board contacts:** to check for updates the board itself contacts the release site (the firmware manifest) and the animation source, and pool.ntp.org for the time when the install window is narrower than the whole day. Those requests carry none of your data, and those hosts see the board's IP address. Set the update mode to Off to stop them.
- **Limits:** the WebSocket to the board is a plain `ws:` connection, so on your local network someone who can watch the traffic can see what you send and the network name in `status` (with the network login off there is no login at all). The board keeps the WiFi network name and password in plain text, and anyone who holds it can read them. The token is stored in your browser as written (clear text), readable by anyone with access to that browser profile.
- **Check it:** the project is free software under GPL-3.0-or-later (see [License](#license)), so anyone can read the code and verify this. The repository is <https://github.com/Monska85/PixelArt> (the web app links the repository of the build: a fork's own, see [Forking](#forking)). The content security policy in [`web/index.html`](web/index.html) lets the app load everything only from its own site (`default-src 'self'`) and connect only to its own site and to WebSocket addresses (`connect-src 'self' ws:`, how it reaches a board on your network): the page can reach no other site over HTTP or HTTPS, and it can open a WebSocket to any address, but the app opens one only to the board you choose. The web app source is in [`web/src`](web/src) and the firmware source in [`src/`](src) and [`lib/`](lib).

## 3D printed frame

Download the [3D printable frame model](https://www.printables.com/model/1497091-pixel-art-frame) for the 16x16 LED matrix. The frame holds the matrix and has a back support for the ESP32 board and connection wires.

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

### Flash layout

The firmware builds with Arduino-ESP32 3.3.12 (ESP-IDF 5.5.5), through PlatformIO platform `espressif32` 8.0.0. Every board uses the table in `partitions.csv`: two firmware slots of 1.5 MiB (`0x180000`) each, a file system of 960 KiB (`0xF0000`) for animations and playlists, and the settings memory. The coredump partition is gone. The firmware is built with `-Os` and with Espressif's common certificate bundle (`certs/README.md`), and leaves about 200 KB of its slot free on the ESP32-C3; `make release-firmware` refuses a firmware that leaves less than 64 KiB. A layout change after the first release erases the animations of every board. A board flashed before this layout needs one **Install from scratch**, which erases its animations and settings. Later updates keep them.

### If the upload fails

- **"Could not open port" or no board found:** check the cable and plug the board straight into the computer, without a hub or dock. The board must show up as a USB serial device: `/dev/ttyACM*` on Linux, `/dev/cu.usbmodem*` on macOS, a COM port on Windows.
- **The board is connected but does not respond:** hold the **BOOT** button, plug in the board, then release the button. This forces the download mode. Run `make upload` again, then press **RESET** (or replug the board) to start the new firmware.
- **More than one serial device is connected:** choose the port explicitly, for example `PLATFORMIO_UPLOAD_PORT=/dev/ttyACM0 make upload`.

## Wiring

- Connect the `5V` and `GND` pins of the ESP32-C3 SuperMini to the `DC IN` and `GND` pins of the LED matrix.
- Connect the `GPIO4` pin of the ESP32-C3 SuperMini to the `DIN` pin of the LED matrix.

### Power supply improvement

To power the LED matrix without routing its current through the ESP32-C3 SuperMini board's USB connector, use a separate 5V supply. Keep the `GPIO4` to `DIN` wire and connect the supply as follows:

- Connect the `5V` pin of the power supply to the `DC IN` pin of the LED matrix and to the `5V` pin of the ESP32-C3 SuperMini board.
- Connect the `GND` pin of the power supply to the `GND` pin of the LED matrix and to the `GND` pin of the ESP32-C3 SuperMini board.

This keeps the supply stable and prevents voltage drops when bright images or many LEDs are lit, and the computer's USB port is then used only to program the board.

## Animations

Every animation is a YAML file in [`content/animations/`](content/animations/), and [`content/playlists/default.yaml`](content/playlists/default.yaml) decides which ones play and in which order. They are released apart from the firmware, as the content package (see [Releases](#releases)). The formats are specified in [`docs/format/pixelart-v1.md`](docs/format/pixelart-v1.md) and [`docs/format/playlist-v1.md`](docs/format/playlist-v1.md).

`make data` converts them to the JSON files the board reads, in `data/` (the layout of the board's file system: `data/animations/<id>.json`, `data/playlists/default.json`). The file name is the animation ID. The board plays the playlist named by its `playlist` setting, `default` unless changed; without a valid one, it plays every animation in alphabetical order. Other playlists, such as `content/playlists/halloween.yaml`, stay idle until you select them, with `settings playlist=halloween` (see [Commands from a terminal](#commands-from-a-terminal)) or in the Board view of the web app.

An animation can play softer than the board's brightness setting with the optional field `brightness`, a percentage from 1 to 100 (for example `brightness: 50`), never brighter: see [Brightness](docs/format/pixelart-v1.md#brightness).

### Adding an animation

1. Create `content/animations/my_animation.yaml`. Any existing animation is a working example; this one blinks a small heart:

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

2. Add `- animation: my_animation` to `content/playlists/default.yaml`, in the position it should play.
3. Preview it with `make sim ANIM=my_animation` (then look at `sim-out/sheet.png`) or `make emulate ANIM=my_animation`.
4. Run `make validate`, which checks every file with the same engine the board uses, then `make upload-content` to send the animations to the board without rebuilding the firmware.

## Commands

Run `make help` to list every target. Each one is a thin wrapper around `tools/pixelart.py`, a `pio` command or an `npm` script, which you can also run directly. The `justfile` has the same commands with the same steps, as `just <name>` (`just` lists them): `BOARD=x` is `just <name> x`, `ANIM=x` is `--anim x`, `WS=1` is `--ws` and `PORT=x` is `just serve x`.

`ANIM=name[,name]` limits `sim`, `sim-open`, `sim-play`, `emulate` and `serve` to those animations (`emulate` plays them in a loop), `BOARD=esp32` or `BOARD=esp32s3` builds and flashes another board than the ESP32-C3 SuperMini, and `WS=1` adds the WebSocket to `emulate`, as `make serve` does.

### Resource limits

Builds and tests use many cores. The Makefile and the justfile, each on its own, take two variables with defaults for a laptop: `JOBS` (at most this many parallel jobs: the `-j` of every `pio run`, and the workers of Playwright, default 4) and `NICE` (the priority of the heavy steps, `nice -n`, default 10, where 0 is normal and 19 the lowest). The heavy targets (builds, uploads, `test`, `check`, `release-firmware`, `release-content`, `release-site`, `web-build`, `web-test`, `web-e2e`, `web-screenshots`) run one step at a time. `JOBS` must be a whole number of 1 or more and `NICE` one from 0 to 19: an empty value (`make check JOBS=`) or any other stops make and just at once, with a message, before any step runs. Override them per run:

```sh
make check JOBS=8 NICE=0
JOBS=8 NICE=0 just check     # or: just jobs=8 nice=0 check
```

`pio test` has no job option and runs with the priority only. CI sets `JOBS` to the runner's cores and `NICE` to 0, except that it runs the end-to-end tests and the screenshot comparison with 2 workers (`PIXELART_JOBS=2`), because they are timing sensitive.

### Board

| Command                | What it does                                                         |
| ---------------------- | -------------------------------------------------------------------- |
| `make upload`          | Flash the firmware and the animations of the working tree            |
| `make upload-firmware` | Flash only the firmware, keeping the animations on the board         |
| `make upload-content`  | Flash only the animations and playlists, keeping the firmware        |
| `make monitor`         | Open the serial monitor (115200 baud)                                |
| `make flash`           | Flash the firmware and the animations, then open the serial monitor  |
| `make mirror`          | Flash with the live mirror on, then watch the matrix in the terminal |
| `make build`           | Build the firmware for the ESP32-C3 SuperMini, or `BOARD`            |
| `make build-all`       | Build for every board (`esp32c3`, `esp32`, `esp32s3`)                |

### Animations and simulator

| Command         | What it does                                                                                        |
| --------------- | --------------------------------------------------------------------------------------------------- |
| `make data`     | Convert `content/animations/` and `content/playlists/` to the board's JSON files in `data/`         |
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
| `make release-content`        | Build the content part of the release site (animations, playlists, their manifest) into `site/`                              |
| `make release-site`           | Build every board, the content and the web app into `site/`, the site Pages shows, see [Releases](#releases)                 |
| `make web-dev`                | Start the web app on `http://localhost:5173` with live reload                                                                |
| `make web-build`              | Build the web app into `web/dist`                                                                                            |
| `make web-test`               | Type check, lint, check the formatting and run the web app's unit tests and the conformance suite                            |
| `make web-size`               | Fail when the JavaScript the web app loads at start is over its budget                                                       |
| `make web-e2e`                | Run the web app's end-to-end tests and the layout checks of every view against the simulator                                 |
| `make web-screenshots`        | Compare one main state per view with its reference image, in the Playwright container (needs Docker)                         |
| `make web-screenshots-update` | Draw the reference images again, in the Playwright container                                                                 |
| `make clean`                  | Remove build outputs, `data/`, `site/` and simulator output                                                                  |

The web app needs Node.js at the version in the `engines` field of `web/package.json`. `make check` and the `make web-*` targets run `npm ci` in `web/` the first time they need the dependencies.

## WiFi

A board can join a 2.4 GHz WiFi network. The specification is in [`docs/board/wifi-and-updates-v1.md`](docs/board/wifi-and-updates-v1.md).

**Setting it up.** Connect the board over USB and use one of these:

- **Web app:** in the Board view, the **WiFi** card has **Set up WiFi**. It lists the networks the board sees and asks for the password, then waits until the board has an address. The board uses [Improv Wi-Fi](https://www.improv-wifi.com/serial/) on the same USB port as the protocol, so the Firmware view's install dialog offers the same setup after an install.
- **Terminal:** `python3 tools/pixelart.py board --port /dev/ttyACM0 wifi` asks for the network name and the password with hidden input, sends them with Improv and prints the state. Improv needs the USB port, so `--ws` does not work for it. `wifi --forget` erases the stored network.

`board status` and the WiFi card show the name of the network the board stored. Over USB any client gets the name. Over WiFi it follows the [network login](#connecting-over-wifi): with the login on, only a client that has logged in gets it, and with the login off every client does. The board never sends the password back, over any transport, and never logs either of them. It keeps them in its settings memory in plain text, so anyone who holds the board can read them. `wipe --settings` and **Delete everything** with **Also reset the settings** forget the network too.

**What it does.** The board is called `pixelart-XXXX`, where `XXXX` are the last four digits of its WiFi MAC address, and it answers to `pixelart-XXXX.local`. If the network is lost it tries again after 1, 2, 4, 8, 16 and 32 seconds and then every minute. `status` (or the WiFi card) says which network it stored and whether it is connected, did not find the network, was refused the password, or joined but got no address, which happens on networks that block new devices. Opening the board's address (`http://pixelart-XXXX.local/`) in a browser shows a small page that links to the web app; the page is not shown (the board answers 503) while the web app or another WebSocket client is connected over WiFi, since the board serves one client at a time, and also while the board checks for or downloads an update, since a secure connection leaves it no memory for another one. Try again in a minute.

**Transmit power.** The `wifi_power` setting is `auto` (recommended) or a fixed power from 8.5 to 19.5 dBm. The WiFi card shows the legend:

- Auto starts at full power and lowers it by itself when the board cannot connect.
- Lower values give less range and draw less current. They help boards with a weak antenna, such as some ESP32-C3 SuperMini boards.
- If the board does not connect or keeps dropping the connection, choose 8.5 dBm.
- If the connection is stable but the signal is weak (below -75 dBm), try a higher value.
- Signal: -50 dBm or more is excellent, -50 to -67 dBm good, -67 to -75 dBm fair, below -75 dBm weak.

### Connecting over WiFi

A board that has joined a network serves the command protocol on `ws://<board>/ws`, port 80, while it is on that network. The web app and `tools/pixelart.py` use it, so a board can be managed without the cable. Everything works over WiFi except what changes the WiFi network or the token: **Set up WiFi**, **Forget network**, the token itself and **Delete everything** with **Also reset the settings** need the USB cable, and the board answers `usb_only` to them.

- **Web app:** in the Board view, type the board's name (`pixelart-XXXX.local`) or its IP address in **Board address** and choose **Connect over WiFi**. The app remembers the name the board gave over USB, and the address you last used. Use a Chromium browser (Chrome, Edge, Opera): Chrome asks once to allow the page to reach devices on the local network, and Firefox and Safari are expected not to let a page from the internet reach a board (a browser test confirms it once the project's Pages site is live). The page of the project is served over HTTPS and the board speaks plain `ws://`, which is why the browser asks.
- **Terminal:** `python3 tools/pixelart.py board --ws ws://pixelart-XXXX.local/ws info`. The commands are the same as over USB, except those that need USB.
- **One client at a time.** While one program holds the connection, a second one is refused until it closes. USB works at the same time.
- **Which pages may connect.** The board accepts the web app of the site address it was built with (`https://monska85.github.io` for the project's own build, your own site for a fork) and pages from `localhost`, from `.local` names and from private network addresses, so a website on the internet cannot change your board. A command line tool sends no origin and is accepted.

**Network login and the token.** The `network_login` setting, which the **Network access** card of the Board view sets, decides who can use the WiFi connection:

- **Off** (the default): anyone on your network can change the board's animations and settings, and start updates of the project's firmware. The card says so next to the switch.
- **On:** a WiFi client must log in first. The board has a token of 16 characters, made at the first start. The **Network access** card shows it over USB (**Show**, **Copy**) and makes a new one (**Regenerate**, which closes the WiFi connection). The web app asks for the token once when the board wants a login, keeps it in the browser for that board, and sends only a proof of it: the board sends a random number, and the app answers with an HMAC-SHA256 of it under the token. The terminal tool takes the token from the `PIXELART_TOKEN` environment variable, or from `--token`, which other users of the computer can see in the list of processes. After 3 wrong answers the board closes the connection.

The connection is not encrypted. The token never crosses the network, but someone who can watch your network sees what you send, and someone who can change it on the way can take over a connection that has logged in. Use the network login on a network you trust. Anyone who holds the board can read the token and the WiFi password from its memory.

## Updates

A board on WiFi can keep its animations and playlists up to date from a manifest, the file that lists them with their sizes and SHA-256 checksums. The specification is in [`docs/board/wifi-and-updates-v1.md`](docs/board/wifi-and-updates-v1.md#updates), and the manifest in [`docs/format/manifest-v1.md`](docs/format/manifest-v1.md). The same checks look for a new firmware, and the board can install it itself, with an automatic rollback if the new one does not start well, see [Firmware updates](#firmware-updates).

**Modes.** The `update_mode` setting, which the **Updates** card of the Board view sets, takes one of three values:

- **Off:** the board never checks. Animations come over USB or from the web app only.
- **Notify:** the board checks 5 minutes after it first has an address, then every `check_hours` hours (6 unless you change it) plus up to 10 minutes at random, and again after 30 minutes when a check fails. It reports in `status` how many files would change and which firmware is available, and installs only when you ask: **Install animations** and **Install firmware** in the web app, or `board update install animations` and `board update install firmware` in the terminal.
- **Automatic** (the default): the board checks the same way and installs what it finds, inside the install window, so a new board, and a board after a settings reset, updates itself as soon as a release is published. A board that was on the old default (Notify) and never had a mode stored switches to Automatic when it gets this firmware, so it starts installing updates by itself inside the install window. A board where you chose a mode (Off, Notify after another mode, or Automatic) keeps it. To keep Notify, choose **Notify** in the Updates card, or run `python3 tools/pixelart.py board --port /dev/ttyACM0 settings update_mode=notify`, right after the update, and check that the card or `settings` shows `notify`. To limit the installs to animations and playlists, turn off **Firmware updates** (`update_firmware=false`): the board then never installs a firmware by itself. The window is `install_start` to `install_end`, in the time zone of the `timezone` setting; equal times mean the whole day, and an end before the start runs over midnight. The web app sets the time zone from your browser. A board that does not know the time waits for it when the window is narrower than the whole day, and `status` says `waiting_for_time`. The board asks `pool.ntp.org` for the time (and again every 12 hours) only when the window is narrower than the whole day and updates are not off.

**No release yet.** Until a release is published at the animation source, a check ends with `http_error` and the detail `no_release`: the web app says "No release is published at this address yet. Check the animation source, or try again after the first release.", and `board status` and `board update check` print the same in a line. A wrong `animation_source` shows the same text, since the address answers 404.

**The release wins.** For every animation and playlist in the manifest, the board adds it when it is not stored, and replaces it when the stored file has another SHA-256, even if you edited it on the board. A file with the same SHA-256 is left alone, and so is every stored file the manifest does not list. An animation you delete on the board comes back at the next update. To keep local changes, turn off **Animation updates** (`update_animations`) or choose another source. Each file is downloaded to a temporary file, checked against the manifest's size and SHA-256, validated by the same engine as an upload, and only then moved over the stored one; a file that fails leaves the stored one as it was, and the update goes on with the next file. While an update writes the files, the matrix can show a brief glitch now and then.

**Your own source.** The `animation_source` setting is the address of the manifest, `https://monska85.github.io/PixelArt/manifest.json` by default; **Reset to default** in the web app puts it back. To host your own set, run `make release-content` or copy the `animations/`, `playlists/` and `manifest.json` of a content release (`pixelart-content-<version>.zip`), change the files, and publish the folder anywhere. The paths in the manifest are relative to its own address, so a copy works without edits. Then set the address:

```sh
python3 tools/pixelart.py board --port /dev/ttyACM0 settings animation_source=https://example.org/pixelart/manifest.json
python3 tools/pixelart.py board --port /dev/ttyACM0 update check
python3 tools/pixelart.py board --port /dev/ttyACM0 update install animations
```

The board reads manifests over HTTPS and checks the server's certificate against Espressif's common certificate bundle of 43 roots (`certs/README.md`): an `https://` source on your own server needs a certificate from one of them, as any public certificate authority gives. A source can also be an `http://` address, for a test server on your own network, and then the files come over `http://` too. A manifest is refused when it is over 64 KiB, is not strict JSON, is not of the format `pixelart-manifest/1`, or has a path that is absolute, holds `..`, or points to another host. Over HTTPS the manifest must also fit in memory next to the secure connection, so the board reads one of up to about 26 KB that way and refuses a larger one with `out_of_memory`; a release keeps its manifest at 20 KiB or less. Files must keep to the limits of the formats.

### Firmware updates

When **Firmware updates** (`update_firmware`) is on, every check also reads the project's manifest, built into the firmware, and looks for the firmware of your board in it. It is an update when the release is newer than the running firmware by Semantic Versioning. A development build of a version is older than its release, and a release is never installed over a newer or equal one. Custom firmware, and any version, goes over USB only.

Notify mode reports the firmware in `status` and the Updates card, and installs it when you ask. Automatic mode installs it inside the install window, after the animations. An installation stops the animation and shows an arrow pointing down into a tray, with a progress bar along the bottom row, at the brightness you set. The board downloads the firmware over HTTPS into the second firmware slot, checks its size and SHA-256 against the manifest, and restarts into it. The settings and the stored files stay. If anything fails before the restart (the network, the checksum, the slot), the running firmware stays, the animation comes back, and the Updates card and `status` report the error; you can ask again.

**Rollback.** A new firmware starts on trial. It confirms itself once the file system is mounted, the settings are read and the first frame is shown. If it crashes, restarts or loses power before that, the bootloader starts the previous firmware again, which reports `rolled_back` with both versions and puts the version that failed on its skip list. A health check that fails without a crash does the same at once. Rollback is always on and has no setting.

**The skip list.** The board never installs a skipped version by itself, in any mode; the Updates card still shows it as available, and installing it asks for a confirmation, because it failed before. `board update install firmware --force` does the same from a terminal. A release newer than the skipped version ends the skip. When a skipped version is installed by force and holds, it is no longer skipped.

```sh
python3 tools/pixelart.py board --port /dev/ttyACM0 update check
python3 tools/pixelart.py board --port /dev/ttyACM0 update install firmware           # waits for the restart
python3 tools/pixelart.py board --port /dev/ttyACM0 update install firmware --force   # a skipped version
```

After the restart, `status` says `updated` (with the versions) once the new firmware shows its first frame, or `rolled_back` if the board went back. The **Firmware** view of the web app shows the same next to its USB install. The board's flash holds two firmware slots, see [Flash layout](#flash-layout), so the install over the network needs no more room than the USB one.

## Commands from a terminal

The board answers a command protocol over its USB serial port, and the simulator over a local WebSocket. Both are driven by `tools/pixelart.py board`, which needs PyYAML (`pip install pyyaml`). The protocol itself is specified in [`docs/protocol/protocol-v1.md`](docs/protocol/protocol-v1.md).

```sh
python3 tools/pixelart.py board --port /dev/ttyACM0 info          # a board over USB serial
python3 tools/pixelart.py board --ws ws://127.0.0.1:8765 info     # the simulator (make serve)
python3 tools/pixelart.py board --ws ws://pixelart-118c.local/ws info   # a board over WiFi
```

Use `--port DEVICE` for a board over USB, and `--ws URL` for the simulator or a board over WiFi. A board with network login on needs the token: set `PIXELART_TOKEN` (or pass `--token`), see [Connecting over WiFi](#connecting-over-wifi). The serial option needs `pyserial`, which PlatformIO already installs; with another Python, run `pip install pyserial`. The WebSocket option needs the `websockets` package, version 15 or later (`pip install websockets`). The commands are the same for both:

| Command                             | What it does                                                                                             |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `info`                              | Firmware version, board, storage, memory and the protocol limits                                         |
| `ls [--kind animation\|playlist]`   | List the stored files with their size, SHA-256, name and version                                         |
| `put FILE [--id ID] [--kind KIND]`  | Upload an animation or playlist, YAML or JSON. The board validates it before it replaces the file        |
| `get ID [--kind KIND] [-o FILE]`    | Download a file, checked against the SHA-256 that `ls` reports                                           |
| `rm ID [--kind KIND]`               | Delete a file                                                                                            |
| `wipe [--yes] [--settings]`         | Delete every animation and playlist after a confirmation (`--yes` skips it) and print the counts         |
| `settings [key=value ...]`          | Show the settings, or change them (`brightness`, `playlist`, `wifi_power`, and the update settings)      |
| `status`                            | WiFi state, network name, address, signal, transmit power and update state of the board                  |
| `wifi [--forget]`                   | Set up WiFi over USB, asking for the network name and password (hidden), or forget the network           |
| `update check`                      | Check for updates now, wait for the result and print the update state                                    |
| `update install animations`         | Install the animations and playlists the last check found, wait, and print the update state              |
| `update install firmware [--force]` | Install the firmware the last check found and wait for the restart; `--force` installs a skipped version |

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

**The simulator as a board over WiFi.** `ARGS="--ws-transport wifi --token k3j9x0q7w2m5z8a1"` makes the WebSocket stand for the board's WiFi transport: the client is a WiFi client, so `settings_get` leaves the token out, `wifi_forget`, `token_regenerate` and `delete_all` with `settings: true` are answered `usb_only`, and with `network_login` on the client has to log in with the token (3 wrong answers close the connection). The serial port stays the USB transport and none of its traffic goes to the WebSocket. `--token` gives the simulated board a token (16 characters from `a-z` and `0-9`) instead of a new one at each start. The web app's end-to-end tests of the login and `tools/test_ws_bridge.py` use it, and so can a client under development: connect it with **Connect over WiFi** to `127.0.0.1:8765`.

### Updates in the simulator

`--update-source DIR` makes a folder stand in for the servers of the updates: the simulator looks the path of a manifest or file URL up in it, so a folder with a release site (`manifest.json`, `animations/`, `playlists/`) answers for the default `animation_source` and for any other. Without the option the simulator reaches no server, so a check fails with `network_error` and the simulator does not check on a schedule. With it, the board checks 5 minutes of virtual time after the start, as the real one does after its first address, or at once with `update_check`.

```sh
make serve ARGS="--update-source site"        # serve what make release-site built
```

`--update-fail down` makes every request fail. `--update-fail KIND[:PATH]` makes the requests for one file (or all files) fail, with a kind of `tls`, `http`, `cut` (the download ends halfway), `corrupt` (a changed byte) or `too_long` (a byte too many); repeat the option for several. `--update-time HH:MM` sets the local time the install window sees; without it the time is not known. The simulated board is named `simulator`: a manifest offers it a firmware with an entry for that `board`, whose file can be any bytes, and `--firmware-version VERSION` sets the version it runs. An installed firmware restarts the simulator, which keeps its slots, its skip list and the record of the last installation across the restart; the new firmware boots on trial and confirms itself at its first frame, and `--update-trial fail` makes its health check fail so the board rolls back. The tests in `test/test_updates` and the cases `update_*` in `conformance/protocol` use the same hooks.

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

The `pr-title` check (`.github/workflows/pr-title.yml`) fails a pull request whose title breaks the rule; fix the title and it runs again. The workflow runs on `pull_request_target`, so the workflow and `tools/check_pr_title.py` come from `main`, never from the pull request: the check that judges a pull request is not the pull request's own, and a change to the check takes effect once it is merged. On `pull_request_target` the workflow checks out `main` only and reads nothing of the pull request but its title. `python3 tools/check_pr_title.py "<title>"` runs the same check locally.

## Releases

The firmware, the content (the animations and playlists) and the web app are released separately, each with its own version, tag and changelog. [release-please](https://github.com/googleapis/release-please) cuts the three from the commit messages on `main`, which follow [Conventional Commits](https://www.conventionalcommits.org/), with the settings in `release-please-config.json` and the released versions in `.release-please-manifest.json`:

| Package  | Contents                                                  | Tags             | Changelog              |
| -------- | --------------------------------------------------------- | ---------------- | ---------------------- |
| Firmware | Everything in the repository except `content/` and `web/` | `vX.Y.Z`         | `CHANGELOG.md`         |
| Content  | The `content/` folder: `animations/` and `playlists/`     | `content-vX.Y.Z` | `content/CHANGELOG.md` |
| Web app  | The `web/` folder                                         | `web-vX.Y.Z`     | `web/CHANGELOG.md`     |

1. Every push to `main` updates one release pull request per package that has changes, each with the next version and its changelog entries: `feat` commits go under Added, `fix` under Fixed, and `perf` and `refactor` under Changed. Other types are left out of the changelog. While a version is below 1.0.0, a breaking change raises the minor number; the content package starts at 1.0.0. A commit belongs to every package it changes files of: a commit that changes only `content/` is part of the content release only, so a new animation never raises the firmware version, and a commit that changes `content/` and the tests is part of both. release-please rebuilds the open release pull requests from `main` on every run, so they never conflict or fall behind.
2. Merging the firmware pull request creates the `vX.Y.Z` tag and the GitHub Release. The release workflow (`.github/workflows/release.yml`) runs the quick checks on every push to `main` before release-please runs, so a `main` that fails them gets no release. After the release exists, the workflow checks out the tag, normally the commit it just checked (it runs the checks again when the tag points to another commit), builds the firmware of every board, and attaches `pixelart-site-<version>.zip`, the factory image of each board and the firmware's `THIRD_PARTY_NOTICES.txt` to the GitHub Release, whose description it ends with a line on the source code and the licenses. The firmware release holds no animations: its first install writes the firmware, and the web app then installs the animations of the latest content release (see [Install and update](docs/web/web-app-v1.md#install-and-update)).
3. Merging the content pull request creates the `content-vX.Y.Z` tag and its GitHub Release. The workflow checks out the tag, converts and validates the animations and playlists, and attaches `pixelart-content-<version>.zip`, the files and their manifest, ending the description with the same line on the source code and the licenses.
4. Merging the web pull request creates the `web-vX.Y.Z` tag and its GitHub Release. The workflow checks out the tag, builds the web app and attaches `pixelart-web-<version>.zip`, the built app, and its `THIRD_PARTY_NOTICES.txt`, and ends the description with the same line on the source code and the licenses.
5. After any of the three releases, the workflow publishes GitHub Pages. A Pages deployment replaces the whole site, so the workflow downloads the latest firmware, content and web archives from the GitHub Releases, merges them into one folder and deploys it ([Assembling the site](docs/format/manifest-v1.md#assembling-the-site)). When a package has never been released, the site holds the others alone; until the first content release, it keeps the animations of the latest firmware release that carried them. A file name present in two archives fails the deployment. The deployment runs whenever the site was assembled, even though a release builds only some of the packages. To deploy the site by hand without a release, run the workflow on `main` from the Actions tab (Release, Run workflow) with `dry_run` unchecked: it builds nothing, creates no release and deploys the latest firmware, content and web releases.

GitHub Pages, at <https://monska85.github.io/PixelArt/>, holds the latest release of each package: the web app at the root, next to the firmware release files. The GitHub Releases keep every version. The layout, the release assets and the manifest are specified in [`docs/format/manifest-v1.md`](docs/format/manifest-v1.md#where-it-is-published), and the web release in [`docs/web/web-app-v1.md`](docs/web/web-app-v1.md#publishing).

### Forking

A fork releases to its own GitHub Pages site without code changes. The firmware and the board's page take the site address from the build ([`tools/site_url.py`](tools/site_url.py)): the repository variable or environment variable `PIXELART_SITE_URL` when it is set, else `https://<owner>.github.io/<repository>/` in GitHub Actions (the root `https://<owner>.github.io/` for a repository named `<owner>.github.io`), else the project's own address for local builds. The web app's default animation source is the `manifest.json` next to the page it is served from, and the project's address when it runs from `localhost`, plain `http` or a file. Two repository settings cannot be changed from the code, and a maintainer must set them once, in the fork or here:

- **Settings, Pages, Source:** `GitHub Actions`.
- **Settings, Environments, `release`, Environment secrets:** `RELEASE_PLEASE_TOKEN`, the token release-please acts with (see below).

Only for a custom domain, add the repository variable `PIXELART_SITE_URL` (Settings, Secrets and variables, Actions, Variables) with the address, `https` with a trailing slash (`https://art.example.org/`). The release workflow passes it to the firmware build, which fails unless every firmware carries that address. Before the deployment it checks that Pages announces that address, and stops otherwise, so the live site stays as it was; after the deployment it checks the address of the deployment again, which can only mark the run as failed, since the site is live by then. The details are in [Site address](docs/board/wifi-and-updates-v1.md#site-address). A custom domain follows the certificate rule of [Updates](#updates): its certificate must chain up to one of the common roots a public certificate authority gives.

The web app of your fork links your repository: in GitHub Actions the web build derives `https://github.com/<owner>/<repository>` from `GITHUB_REPOSITORY` (a value that is not `owner/repository` fails the build), and any other build uses the project's address. A board of your fork looks for its manifest at your site, accepts your web app's origin, and links to your site on its page. The release fails when the site is served at another address than the one the firmware was built with. For a local build, `PIXELART_SITE_URL=https://art.example.org/ make build-all` builds boards for that address.

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

To try a release without publishing, run `make release-site` (`just release-site`). It builds every board and the firmware manifests, converts the animations and playlists with their manifest, builds the web app, and merges the three with `tools/release.py assemble` into `site/`, which Git ignores: the site Pages would show if the three packages were released from this commit. It checks every manifest against its JSON Schema, and needs PlatformIO, PyYAML, `jsonschema` and Node.js (see [Commands](#commands)). `make release-firmware` builds only the firmware part and `make release-content` only the content part. The workflow can also run as a dry run from the Actions tab (`Run workflow`, with `dry_run` on): it runs the checks, lints the web app, builds the firmware site, the content site and the web app, assembles them, attaches the four to the run, and publishes nothing.

The firmware reports its version in `info`, by the rules of [Firmware version](docs/protocol/protocol-v1.md#firmware-version). The release build takes the version from release-please and fails if the firmware is not built with it. The content version follows the same rules with the `content-vX.Y.Z` tags: `PIXELART_CONTENT_VERSION` when it is set (the release workflow sets it from release-please), else the nearest content tag, with `-dev.<commits>+g<commit>` after it when the checkout is not exactly the tag (`0.0.0-dev.<commits>+g<commit>` before the first content release). The content release fails when its manifest does not carry the version of its tag.

## Development

### Project layout

| Path                           | Content                                                                                                                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `content/`                     | The animations and playlists, in YAML (`content/animations/`, `content/playlists/`), released as the content package                                                                             |
| `platformio.ini`               | Boards, libraries, the simulator and test environments, and the physical panel settings                                                                                                          |
| `src/main.cpp`                 | `setup()`, `loop()` and the matrix configuration                                                                                                                                                 |
| `src/app.cpp`                  | Plays the playlist and the animations stored on the board                                                                                                                                        |
| `src/storage.cpp`              | File access: LittleFS on the board, the `data/` folder in the simulator                                                                                                                          |
| `src/protocol.cpp`             | The command protocol, served over USB serial on the board and over the WebSocket in the simulator                                                                                                |
| `src/settings.cpp`             | The settings and the token, kept in NVS on the board                                                                                                                                             |
| `src/network_*.cpp`            | The network task: WiFi connection, scans and mDNS on the board (`_board`), fixed values in the simulator (`_sim`)                                                                                |
| `src/ws_server_*.cpp`          | The protocol over WiFi: the WebSocket server on the board (`_board`), and the simulator's WiFi transport mode (`_sim`)                                                                           |
| `lib/PixelNet/`                | The decisions of the protocol over WiFi: the origin check, the WebSocket message rules and the network login                                                                                     |
| `src/wifi_logic.cpp`           | The connection states, reconnection schedule and transmit power fallback, shared by the board and the tests                                                                                      |
| `src/improv.cpp`               | Improv Wi-Fi Serial: frames and the handler that sets up WiFi over USB                                                                                                                           |
| `src/updates.cpp`              | The updates as the loop task sees them: settings, requests, status, and the validation and storing of downloaded files                                                                           |
| `src/update_http.cpp`          | The board's HTTPS client for manifests and files, with the certificate bundle and the redirect rules                                                                                             |
| `src/crt_bundle.S`, `certs/`   | The certificate bundle the board checks HTTPS servers with, how it is made again, and the GitHub Pages chain CI checks against it                                                                |
| `src/update_sim.cpp`           | The simulator's update source and failure injection                                                                                                                                              |
| `src/firmware*.cpp`            | The trial boot, the rollback and the skip list (`firmware.cpp`), and the firmware slots: ESP-IDF OTA and NVS on the board (`_board`), simulated slots in the simulator (`_sim`)                  |
| `src/update_icon.cpp`          | The icon the matrix shows while a firmware installs                                                                                                                                              |
| `src/net_time.cpp`             | The time of day from SNTP, for the install window (board only)                                                                                                                                   |
| `src/task_sync.cpp`            | The lock for large allocations and the signal that a frame was shown, shared by the loop task and the network task                                                                               |
| `lib/PixelUpdate/`             | The update decisions: manifest reading, URL rules, versions, the sync plan, the schedule, the install window and the state machine                                                               |
| `src/platform.cpp`             | Board services: firmware version, memory and boot ID                                                                                                                                             |
| `include/`                     | Headers of the modules in `src/`                                                                                                                                                                 |
| `src/pixel_matrix.cpp`         | The matrix `show()`, with the optional live mirror                                                                                                                                               |
| `src/sim_main.cpp`             | Entry point of the host simulator (only built by the `native` env)                                                                                                                               |
| `lib/PixelEngine/`             | The animation engine: parsing, validation and playback of the file formats, shared by all builds                                                                                                 |
| `lib/PixelCodec/`              | CRC-32, SHA-256, base64 and UTF-8 helpers used by the protocol                                                                                                                                   |
| `lib/ArduinoSim/`              | Host Arduino core, simulated NeoPixel driver and simulator (`assets/player.html` is the HTML player)                                                                                             |
| `conformance/`                 | Test cases every implementation of the animation format must pass                                                                                                                                |
| `test/`                        | Tests that run on the simulator (`native_test` env)                                                                                                                                              |
| `tools/pixelart.py`            | Converts animations and playlists from YAML to the board's JSON, and talks to a board or the simulator                                                                                           |
| `tools/ws_bridge.py`           | Serves the simulator's command protocol on a WebSocket, started by the simulator's `--ws`                                                                                                        |
| `tools/test_*.py`              | Unit tests of the tools, run by `make check`                                                                                                                                                     |
| `tools/fw_version.py`          | The firmware version rules, shared by `tools/release.py` and the PlatformIO version script                                                                                                       |
| `tools/crt_bundle.py`          | Makes the firmware's certificate bundle again from ESP-IDF at a pinned tag (`certs/README.md`)                                                                                                   |
| `tools/release.py`             | Builds the firmware release site (parts, ESP Web Tools manifests, `manifest.json`) and the content release site (animations, playlists, their `manifest.json`), and merges them with the web app |
| `tools/check_pr_title.py`      | Checks that a pull request title is a conventional commit release-please accepts, for the `pr-title` check                                                                                       |
| `web/`                         | The web app: React and TypeScript, its own `package.json`, tests and changelog, see [`web/README.md`](web/README.md)                                                                             |
| `monitor/filter_pixelart.py`   | Serial monitor filter that draws the live mirror of the real matrix                                                                                                                              |
| `.github/actions/checks`       | The checks shared by the CI and release workflows                                                                                                                                                |
| `scripts/`                     | PlatformIO build scripts, including the firmware version, which uses `tools/fw_version.py`                                                                                                       |
| `release-please-config.json`   | Release automation settings for the firmware, the content and the web app, with `.release-please-manifest.json` and `version.txt`                                                                |
| `docs/`, `schema/`             | Specifications of the formats, the protocol and the web app, their JSON Schemas, and architecture decision records (`docs/adr/`)                                                                 |
| `LICENSE`, `LICENSE-EXCEPTION` | The license, GPL-3.0-or-later, and the additional permission for Espressif's binary-only libraries, see [License](#license)                                                                      |
| `LICENSES/`                    | The third-party license texts the notices need and the build inputs do not carry, and the components of the firmware (`firmware.json`)                                                           |
| `tools/firmware_notices.py`    | Writes the third-party notices of the firmware from the link map of each board                                                                                                                   |
| `v0/`                          | The original Arduino IDE sketch and its README, kept unchanged for history, see [History](#history)                                                                                              |

### Continuous integration

The GitHub Actions workflow in `.github/workflows/ci.yml` runs on every pull request and every push to `main`. A newer run of the same pull request or of `main` cancels the one still running. It has four jobs:

- **`check`:** Checks C++ formatting, converts animations, checks them against the JSON Schemas and validates them with the engine. It runs the tests, including the GitHub Pages certificate chain check. It drives the simulator's WebSocket with `tools/pixelart.py board` to test board information, uploads, listings, downloads, deletions and file rejection. It builds every board, the firmware release site and the content release site, checks their manifests against the JSON Schema and the board limits, checks that each firmware leaves 64 KiB of its slot free, and attaches a rendered preview of every animation.
- **`web`:** Lints and tests the web app, checks formatting and startup JavaScript size, and builds it with type checking. It runs the end-to-end and layout checks against the simulator in Chromium and compares reference images in the Playwright container.
- **`actionlint`:** Checks the workflows with a pinned actionlint release and their `run:` blocks with shellcheck.
- **`certificates`:** Rebuilds the firmware's certificate bundle from the pinned ESP-IDF files and compares it byte for byte with `certs/`.

`.github/workflows/release.yml` publishes releases, see [Releases](#releases). CI installs its Python tools at the exact versions in `requirements-ci.txt`. Dependabot opens a weekly pull request to update the pinned actions, the web app's npm dependencies and the Python tools.

### Code style

C++ sources follow `.clang-format`. Run `make format` before committing; `make check` fails on unformatted code. Formatting needs `clang-format`. CI uses the version pinned in `requirements-ci.txt` (`pip install clang-format==23.1.3`), since other versions can format differently.

### Testing updates against a local server

A board test that runs the whole update path against a local copy of the release site builds the firmware with the manifest address replaced and, to reach the server over `http://`, one more flag. Both are for test builds only and are never set in a release build: release firmware never accepts firmware over `http://`. The animation source needs neither flag, since it may be `http://` already.

1. Build and flash a test firmware with the flags in the environment, with the address of your computer in place of `<your computer>`. `PIXELART_VERSION` sets the version of the build, so the firmware flashed here gets a low one:

   ```sh
   PIXELART_VERSION=0.0.1 PLATFORMIO_BUILD_FLAGS='-DPIXELART_FIRMWARE_MANIFEST=\"http://<your computer>:8000/manifest.json\" -DPIXELART_FIRMWARE_ALLOW_HTTP' make upload-firmware
   ```

   The backslashes keep the quotes in the C++ string. `-DPIXELART_FIRMWARE_ALLOW_HTTP` lets the firmware manifest and the firmware download use `http://`; it does nothing without the manifest flag.

   A board in the default `automatic` update mode installs a newer firmware as soon as a check finds it, and its scheduled check can run any time once the server of step 3 offers one. So put the board in the `notify` mode now, before the server exists, and note the mode it had (`automatic` unless you changed it):

   ```sh
   python3 tools/pixelart.py board --port /dev/ttyACM0 settings
   python3 tools/pixelart.py board --port /dev/ttyACM0 settings update_mode=notify
   ```

2. Build the firmware part of the site with a higher version, without `PLATFORMIO_BUILD_FLAGS`, so the firmware it serves is a normal release build: `PIXELART_VERSION=99.0.1 make release-firmware`. Use a version no earlier run of this test used (99.0.2 for the second run, and so on), because the board keeps the result of its last installation across reflashing, and only a result that names this run's version proves this run. It is enough for this test and needs no web build. It goes to `site/` and holds the manifest and the firmware of every board. It rebuilds the boards, so run it after step 1. The release targets check the manifest against its JSON Schema, so the Python that `make` uses needs the `jsonschema` package, or the build stops with `--schema needs the jsonschema package`. Pass another Python with `make release-firmware PYTHON=<python with jsonschema>`. The manifest must offer a firmware newer than the one on the board, because an older or equal version is never installed over the network.
3. Serve it from your computer with `python3 -m http.server 8000 --directory site`. The board must reach your computer on the same network.
4. Check and install. The install returns when the board starts to restart, not when it is back, so ask for `status` until the board answers again, read the result below, and only then put the previous mode back (`automatic` in this example):

   ```sh
   python3 tools/pixelart.py board --port /dev/ttyACM0 update check
   python3 tools/pixelart.py board --port /dev/ttyACM0 update install firmware
   python3 tools/pixelart.py board --port /dev/ttyACM0 status
   ```

   Repeat the `status` command until it prints the board's state instead of an error. An answer only shows that the board is back. The test passed only when `status` prints `installed updated, from 0.0.1 to 99.0.1`, with the version the board ran before in place of 0.0.1 and this run's version in place of 99.0.1. Then run `python3 tools/pixelart.py board --port /dev/ttyACM0 info`: its `firmware` line must show that version, which proves the new firmware kept running. If it prints `installed rolled_back` instead, the new firmware did not start properly, the board went back to the previous one and the update failed. A board still on trial may show the installation before this one until its first frame, so repeat `status` once more; a result that names another version is not this run's. Only after you have read this result, put the previous mode back: `python3 tools/pixelart.py board --port /dev/ttyACM0 settings update_mode=automatic`. The Updates card of the web app does the same checks and installs. To test the automatic path instead, set `update_mode=automatic`, run `update check` and wait for the board to install and restart.

5. Go back to normal firmware: run `make upload-firmware` without `PLATFORMIO_BUILD_FLAGS` and `PIXELART_VERSION`, and `make upload` too if the animations changed. After a successful test the board runs the test version, and no real release is newer, so it would never update again. A board left on the test build also accepts firmware over plain `http://` from that address, so use a spare board or go back right after the test.

Animation updates need no test firmware, since the animation source may be `http://`. Build the content part of the site with `make release-content`, serve it as in step 3, point the board at it and install:

```sh
python3 tools/pixelart.py board --port /dev/ttyACM0 settings animation_source=http://<your computer>:8000/manifest.json
python3 tools/pixelart.py board --port /dev/ttyACM0 update check
python3 tools/pixelart.py board --port /dev/ttyACM0 update install animations
python3 tools/pixelart.py board --port /dev/ttyACM0 status
```

`status` reports the files that failed, if any, and `board ls` lists every stored file with the first 12 digits of its SHA-256, to compare with the manifest. Afterwards, put the default source back with **Reset to default** in the web app, or set `animation_source` to the address of your site's `manifest.json`.

### Loop task stack

The firmware parses, validates and plays files on the board's loop task, whose stack is small. To measure how much of it a change uses, on a real board:

1. Add temporary debug output, never committed: from code that runs on the loop task (for example `protocol::poll()`), print `uxTaskGetStackHighWaterMark(NULL)` about once a second. On the ESP32 the value is in bytes and is the smallest free stack since boot.
2. Flash that build with `make upload-firmware`.
3. For each case, reset the board, upload the test file with `tools/pixelart.py board put`, then run `board ls`, which parses every stored file. Only one program can open the serial port at a time, so open it only after the tool has exited, with a program that does not reset the board when it opens the port, and read the value printed: it is the smallest since the reset. Resetting before each case keeps the numbers independent; the debug lines share the port with the protocol, whose clients ignore them.
4. Use as test inputs a shipped animation, the deepest file the format accepts (nesting every construct to its limit), files nested deeper than the format allows but within the JSON nesting limit, and one file over the JSON nesting limit.
5. Afterwards, remove the debug code, flash the normal firmware and the files with `make upload`, set the settings back, and delete the test files, which belong outside the repository.

Compare the numbers before and after the change, case by case.

## License

PixelArt is free software under the GNU General Public License, version 3 or (at your option) any later version: [`LICENSE`](LICENSE) (the web app publishes both license files next to its third-party notices, as `LICENSE.txt` and `LICENSE-EXCEPTION.txt`). The firmware links binary-only libraries that Espressif distributes with ESP-IDF and Arduino-ESP32 (WiFi, PHY, Bluetooth, coexistence) and uses the code in the ROM of the chips, which come without source code, so [`LICENSE-EXCEPTION`](LICENSE-EXCEPTION) adds the permission of GPL version 3, section 7, to combine PixelArt with them and convey the result. Contributions are accepted under the same license and permission, see [`CONTRIBUTING.md`](CONTRIBUTING.md).

The third-party software in what the project publishes, with its licenses and their full texts, is listed in two notices files, written by the release builds:

- **Firmware:** `firmware/THIRD_PARTY_NOTICES.txt` on the site and attached to every firmware release. `tools/firmware_notices.py` writes it from the link map of each board, see [`LICENSES/README.md`](LICENSES/README.md).
- **Web app:** `THIRD_PARTY_NOTICES.txt` at the root of the site and attached to every web release, written by the web build from the packages it bundles. The Privacy view of the app links both, with the license and the release tag of the running version.

[`LICENSES/`](LICENSES/) holds the license texts the build inputs do not carry, with where each one comes from. Every GitHub Release ends with a line on its source code and licenses: the tag, the repository, how to build it again and where the notices are.

## History

The project started as a single Arduino IDE sketch. That sketch and its original README are kept in [`v0/`](v0/README.md), byte for byte, as the starting point of this project. They are not maintained and not built, and no tool of this repository formats or checks them.
