board := "esp32c3"
out := "sim-out"
site := "site"
python := "python3"
sim := ".pio/build/native/program"

# List recipes
default:
    @just --list

# Build data/ (the board's files) from animations/ and playlists/
data:
    {{python}} tools/pixelart.py build

# Check every animation and playlist with the board's engine
validate: data sim-build
    {{sim}} --validate

# Build the firmware (esp32c3, esp32, esp32s3)
build board=board:
    pio run -e {{board}}

# Build the firmware for every board
build-all:
    pio run -e esp32c3 -e esp32 -e esp32s3

# Flash the firmware and the animations
upload board=board: data
    pio run -e {{board}} -t upload
    pio run -e {{board}} -t uploadfs

# Flash only the firmware, keeping the animations on the board
upload-firmware board=board:
    pio run -e {{board}} -t upload

# Flash only the animations and playlists, keeping the firmware
upload-data board=board: data
    pio run -e {{board}} -t uploadfs

# Open the serial monitor
monitor board=board:
    pio device monitor -e {{board}}

# Flash the firmware and the animations, then open the serial monitor
flash board=board: data
    pio run -e {{board}} -t upload
    pio run -e {{board}} -t uploadfs
    pio device monitor -e {{board}}

# Flash with the frame mirror on, then watch the matrix live in the terminal
mirror board=board: data
    PLATFORMIO_BUILD_FLAGS=-DPIXELART_MIRROR pio run -e {{board}} -t upload
    pio run -e {{board}} -t uploadfs
    pio device monitor -e {{board}}

# Build the host simulator
sim-build:
    pio run -e native

# Run the simulator and write frames.json, player.html and sheet.png (e.g. just sim --anim santa)
sim *args: data sim-build
    {{sim}} --out {{out}} {{args}}

# List the animations the simulator can run
sim-list: data sim-build
    {{sim}} --list

# Play once in real time in the terminal (e.g. just sim-play --anim santa)
sim-play *args: data sim-build
    {{sim}} --realtime --no-files {{args}}

# Emulate the board: live matrix and serial output in the terminal, no hardware (e.g. just emulate --anim santa, or just emulate --ws)
emulate *args: data sim-build
    {{sim}} --live {{args}}

# Emulate the board and serve the command protocol on ws://127.0.0.1:8765 (e.g. just serve --anim santa)
serve *args: data sim-build
    {{sim}} --live --ws {{args}}

# Run the simulator and open the HTML player
sim-open *args: data sim-build
    {{sim}} --out {{out}} {{args}}
    @if command -v xdg-open >/dev/null 2>&1; then xdg-open {{out}}/player.html; \
    elif command -v open >/dev/null 2>&1; then open {{out}}/player.html; \
    else echo "Open {{out}}/player.html in a browser"; fi

# Build every board and the release site into site/ (or `just release-site out-folder`), as a release would publish it
release-site folder=site: data
    #!/usr/bin/env sh
    set -eu
    PIXELART_VERSION=$({{python}} tools/release.py version)
    export PIXELART_VERSION
    echo "Release site for version $PIXELART_VERSION"
    pio run -e esp32c3 -e esp32 -e esp32s3
    for board in esp32c3 esp32 esp32s3; do pio run -e "$board" -t buildfs; done
    {{python}} tools/release.py build --out "{{folder}}" --schema

# Run the tests on the simulator
test: data
    pio test -e native_test

# Format the C++ sources with clang-format
format:
    find src include test lib \( -name '*.cpp' -o -name '*.h' \) -exec clang-format -i {} +

# Fail if a C++ source is not formatted
format-check:
    find src include test lib \( -name '*.cpp' -o -name '*.h' \) -exec clang-format --dry-run --Werror {} +

# Check formatting and animations, run the tests and build every board
check: data sim-build
    find src include test lib \( -name '*.cpp' -o -name '*.h' \) -exec clang-format --dry-run --Werror {} +
    {{sim}} --validate
    {{python}} -m unittest discover -s tools
    pio test -e native_test
    pio run -e esp32c3 -e esp32 -e esp32s3

# Remove build outputs, data/ and simulator output
clean:
    pio run -t clean -e native -e native_test -e esp32c3 -e esp32 -e esp32s3
    rm -rf data {{out}} {{site}}
