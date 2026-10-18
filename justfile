board := "esp32c3"
out := "sim-out"
sim := ".pio/build/native/program"

# List recipes
default:
    @just --list

# Build the firmware (esp32c3, esp32, esp32s3)
build board=board:
    pio run -e {{board}}

# Build the firmware for every board
build-all:
    pio run -e esp32c3 -e esp32 -e esp32s3

# Build and flash the firmware
upload board=board:
    pio run -e {{board}} -t upload

# Open the serial monitor
monitor board=board:
    pio device monitor -e {{board}}

# Flash, then open the serial monitor
flash board=board:
    pio run -e {{board}} -t upload
    pio device monitor -e {{board}}

# Flash with the frame mirror on and watch the matrix live in the terminal
mirror board=board:
    PLATFORMIO_BUILD_FLAGS=-DPIXELART_MIRROR pio run -e {{board}} -t upload
    pio device monitor -e {{board}}

# Build the host simulator
sim-build:
    pio run -e native

# Run the simulator and write frames.json, player.html and sheet.png (e.g. just sim --anim santa)
sim *args: sim-build
    {{sim}} --out {{out}} {{args}}

# List the animations the simulator can run
sim-list: sim-build
    {{sim}} --list

# Play in real time in the terminal (e.g. just sim-play --anim santa)
sim-play *args: sim-build
    {{sim}} --realtime --no-files {{args}}

# Emulate the board: live matrix and serial output in the terminal, no hardware (e.g. just emulate --anim santa)
emulate *args: sim-build
    {{sim}} --live {{args}}

# Run the simulator and open the HTML player
sim-open *args: sim-build
    {{sim}} --out {{out}} {{args}}
    @if command -v xdg-open >/dev/null 2>&1; then xdg-open {{out}}/player.html; \
    elif command -v open >/dev/null 2>&1; then open {{out}}/player.html; \
    else echo "Open {{out}}/player.html in a browser"; fi

# Run the simulator tests
test:
    pio test -e native_test

# Format the C++ sources with clang-format
format:
    find src include test lib/ArduinoSim \( -name '*.cpp' -o -name '*.h' \) -exec clang-format -i {} +

# Fail if a C++ source is not formatted
format-check:
    find src include test lib/ArduinoSim \( -name '*.cpp' -o -name '*.h' \) -exec clang-format --dry-run --Werror {} +

# Check formatting, run the tests and build every board
check:
    find src include test lib/ArduinoSim \( -name '*.cpp' -o -name '*.h' \) -exec clang-format --dry-run --Werror {} +
    pio test -e native_test
    pio run -e esp32c3 -e esp32 -e esp32s3

# Remove build outputs and simulator output
clean:
    pio run -t clean -e native -e native_test -e esp32c3 -e esp32 -e esp32s3
    rm -rf {{out}}
