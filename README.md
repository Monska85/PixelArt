# PixelArt

Firmware that plays pixel-art animations on a 16x16 WS2812B LED matrix driven by an ESP32-C3 SuperMini board. It also includes a simulator that shows the animations on your computer, without any hardware.

## 3D printed frame

You can find the 3D model files to print a frame for the 16x16 LEDs matrix [here](https://www.printables.com/model/1497091-pixel-art-frame). The frame holds the LEDs matrix and has a back support to increase stability and hold the ESP32 board and connection wires.

## Quick start: flash an empty board

1. **Wire the board to the matrix** as described in [Wiring](#wiring).
2. **Install PlatformIO Core** by following the [PlatformIO installation guide](https://docs.platformio.org/en/latest/core/installation/index.html). On Linux, also install the [udev rules](https://docs.platformio.org/en/latest/core/installation/udev-rules.html), so you can flash the board without root.
3. **Get the code:**

   ```sh
   git clone https://github.com/Monska85/PixelArt.git
   cd PixelArt
   ```

4. **Connect the board** to your computer with a USB-C cable. The cable must carry data: many USB-C cables only carry power.
5. **Build and flash:**

   ```sh
   make upload
   ```

   Without `make`, run `pio run -e esp32c3 -t upload`. The first build downloads the ESP32 toolchain and the libraries, so it takes a few minutes. Later builds take seconds.

The animations start as soon as the upload finishes. To see the serial output, run `make monitor` (or `pio device monitor -e esp32c3`).

### If the upload fails

- **"Could not open port" or no board found:** check the cable and plug the board straight into the computer, without a hub or dock. The board must show up as a USB serial device: `/dev/ttyACM*` on Linux, `/dev/cu.usbmodem*` on macOS, a COM port on Windows.
- **The board is connected but does not respond:** hold the **BOOT** button, plug in the board, then release the button. This forces the download mode. Run `make upload` again, then press **RESET** (or replug the board) to start the new firmware.
- **More than one serial device is connected:** choose the port explicitly, for example `PLATFORMIO_UPLOAD_PORT=/dev/ttyACM0 make upload`, or `pio run -e esp32c3 -t upload --upload-port /dev/ttyACM0`.

## Wiring

- Connect the `5V` and `GND` pins of the ESP32 C3 Supermini to the `DC IN` and `GND` pins of the LED matrix.
- Connect the `GPIO4` pin of the ESP32 C3 Supermini to the `DIN` pin of the LED matrix.

### Power supply improvement

You can improve the power supply avoiding to power the LED matrix through the ESP32 C3 Supermini board USB connector. Instead, you can use a separate 5V power supply and wire it as follows:

- connect the `5V` pin of the power supply to the `DC IN` pin of the LED matrix and to the `5V` pin of the ESP32 C3 Supermini board.
- Connect the `GND` pin of the power supply to the `GND` pin of the LED matrix and to the `GND` pin of the ESP32 C3 Supermini board.
- Connect the `GPIO4` pin of the ESP32 C3 Supermini to the `DIN` pin of the LED matrix.

This solution will provide a more stable power supply to the LED matrix, especially when displaying bright images or animations with many LEDs lit up. This will help to prevent voltage drops and issues when you use the PC USB port to power the ESP32 C3 Supermini board. In other words, you use a proper power supply to power both the ESP32 C3 Supermini board and the LED matrix and PC USB port is used only for programming the ESP32 C3 Supermini board.

## Commands

Every command is available through both `make` and `just`. Run `make help` or `just` to list them. Each one is a thin wrapper around a `pio` command, which you can also run directly.

### Firmware

| make                       | just                 | What it does                                                         |
| -------------------------- | -------------------- | -------------------------------------------------------------------- |
| `make build`               | `just build`         | Build the firmware for the ESP32-C3 SuperMini                        |
| `make build BOARD=esp32s3` | `just build esp32s3` | Build for another board (`esp32c3`, `esp32`, `esp32s3`)              |
| `make build-all`           | `just build-all`     | Build for every board                                                |
| `make upload`              | `just upload`        | Build and flash the board                                            |
| `make monitor`             | `just monitor`       | Open the serial monitor (115200 baud)                                |
| `make flash`               | `just flash`         | Flash, then open the serial monitor                                  |
| `make mirror`              | `just mirror`        | Flash with the live mirror on, then watch the matrix in the terminal |

### Simulator

| make                       | just                         | What it does                                                                                        |
| -------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------- |
| `make emulate`             | `just emulate`               | Emulate the board: run forever in real time, with the matrix and serial output live in the terminal |
| `make emulate ANIM=santa`  | `just emulate --anim santa`  | Emulate only some animations, in a loop                                                             |
| `make sim`                 | `just sim`                   | Run `setup()` and one `loop()`, write the output to `sim-out/`                                      |
| `make sim ANIM=santa,bell` | `just sim --anim santa,bell` | Run only some animations                                                                            |
| `make sim-list`            | `just sim-list`              | List the animations                                                                                 |
| `make sim-play ANIM=santa` | `just sim-play --anim santa` | Play once in real time in the terminal                                                              |
| `make sim-open`            | `just sim-open`              | Run and open the HTML player                                                                        |

### Development

| make          | just          | What it does                                          |
| ------------- | ------------- | ----------------------------------------------------- |
| `make test`   | `just test`   | Run the tests in `test/` on the simulator             |
| `make format` | `just format` | Format the C++ sources with `clang-format`            |
| `make check`  | `just check`  | Check formatting, run the tests and build every board |
| `make clean`  | `just clean`  | Remove build outputs and simulator output             |

## Live mirror of the real matrix

`make mirror` builds the firmware with `-DPIXELART_MIRROR`, flashes it and opens the serial monitor. With the mirror on, every `matrix.show()` also sends the frame over USB serial as one line (`@PX <count> <rrggbb...>`, in LED strip order, with brightness applied). The monitor filter in `monitor/filter_pixelart.py` draws the matrix live in the terminal and keeps the latest serial output below it.

The filter places the LEDs using the panel wiring set in `platformio.ini` (`custom_panel_size`, `custom_panel_layout`), so wrong matrix flags in the sketch show up here as they do on the frame. Builds without the flag send nothing extra, and the filter passes normal serial output through unchanged.

The ESP32-C3 SuperMini sends over native USB, which keeps up with any frame rate, and skips the mirror when no monitor is connected. Boards that use a USB-UART bridge (`esp32`) need about 130 ms per frame at 115200 baud, which slows fast animations while the mirror is on.

## Simulator

The simulator runs the firmware on your computer and shows what the 16x16 matrix displays, without any hardware. It compiles the same code with the official Adafruit GFX and NeoMatrix libraries. Only the NeoPixel driver is replaced: each `matrix.show()` is recorded as a frame instead of being sent to GPIO4. Time is virtual, so `delay()` costs nothing and a full loop of all animations runs in about 0.1 seconds. `make emulate` is the exception: it runs in real time, like the board.

The simulator needs a host C++17 compiler (`g++` or `clang++`).

With `make`, pass any other simulator option through `ARGS`, for example `make sim ARGS="--png-frames --range 0:16"`. Run `.pio/build/native/program --help` for the full list.

A run writes:

- `sim-out/frames.json`: every frame with its time, duration, animation name and pixels (row-major `rrggbb` hex), plus the serial output.
- `sim-out/player.html`: a player with play/pause, frame stepping, speed and a jump-to-animation menu.
- `sim-out/sheet.png`: all frames side by side in one image.
- `sim-out/frames/NNNNN.png`: one image per frame, with `--png-frames`.

Colors are shown as the panel looks to the eye (LED output converted to screen colors). Use `--raw` to see the exact values sent to the LEDs, which include the brightness and gamma correction.

The simulator models the physical panel wiring (16x16, strip starting top-left, running in zigzag columns). A sketch configured with the wrong `NEO_MATRIX_*` flags looks scrambled in the simulator, as it would on the real frame. Use `--panel` and `--layout` to simulate a different panel.

### Simulator limits

The simulator does not emulate the ESP32 itself. Timing, memory use, WiFi and other ESP32-only APIs are not covered: `make build-all` checks that the code compiles for each board, and the real board is the final check. GPIO reads always return `LOW` and `random()` is seeded with a fixed value (`--seed` changes it), so runs are repeatable.

## Development

### Project layout

| Path                         | Content                                                                                              |
| ---------------------------- | ---------------------------------------------------------------------------------------------------- |
| `platformio.ini`             | Boards, libraries, the simulator and test environments, and the physical panel settings              |
| `src/main.cpp`               | `setup()`, `loop()` and the matrix configuration                                                     |
| `src/animations/`            | One file per animation                                                                               |
| `src/playlist.cpp`           | The `ANIMATIONS` table: the animations `loop()` plays, in order                                      |
| `src/pixel_matrix.cpp`       | The matrix `show()`, with the optional live mirror                                                   |
| `include/pixel_art.h`        | Constants, colors, the `Pixel` struct and the `draw()` and `play_frames()` helpers                   |
| `include/animations.h`       | The animation declarations and the `ANIMATIONS` table                                                |
| `src/sim_main.cpp`           | Entry point of the host simulator (only built by the `native` env)                                   |
| `lib/ArduinoSim/`            | Host Arduino core, simulated NeoPixel driver and simulator (`assets/player.html` is the HTML player) |
| `test/`                      | Tests that run the animations on the simulator (`native_test` env)                                   |
| `monitor/filter_pixelart.py` | Serial monitor filter that draws the live mirror of the real matrix                                  |
| `scripts/`                   | PlatformIO build scripts                                                                             |

### Adding an animation

1. Create `src/animations/my_animation.cpp`. Put the colors (`rgb565()`) and the `Pixel` arrays in an anonymous namespace, so they are stored in flash and do not clash with other animations. Then write `void my_animation()`, usually as one `play_frames()` call:

   ```cpp
   void my_animation()
   {
     play_frames(TOTAL_FRAMES, DEFAULT_DELAY_MS, [](int frame) {
       draw(body);
       if (frame % 2 == 1)
       {
         draw(blink);
       }
     });
   }
   ```

   `play_frames()` clears the matrix before each frame and shows it after, so the lambda only draws. Any of the existing animations is a working example.

2. Declare it in `include/animations.h`.
3. Add `{"my_animation", my_animation}` to the `ANIMATIONS` table in `src/playlist.cpp`, in the position it should play.
4. Check it with `make sim ANIM=my_animation` and look at `sim-out/sheet.png`, then run `make check`.

### Design documents

- [`docs/format/`](docs/format/): specifications of the upcoming animation and playlist file formats (draft, not implemented yet).
- [`schema/`](schema/): their JSON Schemas.
- [`docs/adr/`](docs/adr/): architecture decision records, explaining why the project works the way it does.

### Code style

C++ sources follow `.clang-format`. Run `make format` before committing; `make check` fails on unformatted code. Formatting needs `clang-format`.
