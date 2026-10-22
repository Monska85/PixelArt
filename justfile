# The same commands as the Makefile, for just users: each recipe has the steps of the make target of the same name.
# BOARD=x is `just <name> x`, ANIM=x is `--anim x`, WS=1 is `--ws`, PORT=x is `just serve x` and SITE=x is
# `just release-site x`.

board := "esp32c3"
out := "sim-out"
site := "site"
python := "python3"
# The simulator's --ws starts tools/ws_bridge.py with this Python, the one the other tools use
export PIXELART_PYTHON := python
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

# Build the firmware for one board (esp32c3, esp32, esp32s3)
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
flash board=board: (upload board)
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

# Emulate the board and serve the command protocol on ws://127.0.0.1:8765 (e.g. just serve 9000, or just serve 8765 --anim santa)
serve port="8765" *args: data sim-build
    {{sim}} --live --ws {{port}} {{args}}

# Run the simulator and open the HTML player
sim-open *args: (sim args)
    @if command -v xdg-open >/dev/null 2>&1; then xdg-open {{out}}/player.html; \
    elif command -v open >/dev/null 2>&1; then open {{out}}/player.html; \
    else echo "Open {{out}}/player.html in a browser"; fi

# Build every board and the firmware part of the release site into site/ (or `just release-firmware out-folder`)
release-firmware folder=site: data
    #!/usr/bin/env sh
    set -eu
    PIXELART_VERSION=$({{python}} tools/release.py version)
    export PIXELART_VERSION
    echo "Firmware release site for version $PIXELART_VERSION"
    pio run -e esp32c3 -e esp32 -e esp32s3
    for board in esp32c3 esp32 esp32s3; do pio run -e "$board" -t buildfs; done
    {{python}} tools/release.py build --out "{{folder}}" --schema

# Build every board and the web app into site/ (or `just release-site out-folder`): the site Pages shows if both were released from this commit
release-site folder=site: data node-modules
    #!/usr/bin/env sh
    set -eu
    PIXELART_VERSION=$({{python}} tools/release.py version)
    export PIXELART_VERSION
    echo "Release site for version $PIXELART_VERSION"
    work=$(mktemp -d)
    trap 'rm -rf "$work"' EXIT
    pio run -e esp32c3 -e esp32 -e esp32s3
    for board in esp32c3 esp32 esp32s3; do pio run -e "$board" -t buildfs; done
    {{python}} tools/release.py build --out "$work/firmware" --schema
    (cd web && npm run build)
    {{python}} tools/release.py assemble --out "{{folder}}" --firmware "$work/firmware" --web web/dist

# Run the tests on the simulator
test: data
    pio test -e native_test

# Format the C++ sources with clang-format
format:
    find src include test lib \( -name '*.cpp' -o -name '*.h' \) -exec clang-format -i {} +

# Fail if a C++ source is not formatted
format-check:
    find src include test lib \( -name '*.cpp' -o -name '*.h' \) -exec clang-format --dry-run --Werror {} +

# Install the web app's dependencies from the lockfile
web-install:
    cd web && npm ci

# Run npm ci in web/ only when node_modules is missing or older than the lockfile, like make's web/node_modules
[private]
node-modules:
    #!/usr/bin/env sh
    set -eu
    if [ ! -d web/node_modules ] || [ web/package-lock.json -nt web/node_modules ]; then
        (cd web && npm ci)
        touch web/node_modules
    fi

# Start the web app on http://localhost:5173 with live reload
web-dev: node-modules
    cd web && npm run dev

# Build the web app into web/dist
web-build: node-modules
    cd web && npm run build

# Fail when the JavaScript the web app loads at start is over its budget (190 KB gzip)
web-size: web-build
    cd web && npm run size

# Type check, lint, check the formatting and run the web app's unit tests and the conformance suite
web-test: data node-modules
    cd web && npm run typecheck && npm run lint && npm run format:check && npm test

# Run the web app's end-to-end tests and layout checks against the simulator (first: cd web && npx playwright install chromium)
web-e2e: data sim-build web-build
    cd web && npm run e2e

# Compare one main state per view with its reference image, inside the Playwright container (needs Docker)
web-screenshots: data sim-build web-build
    web/scripts/run-screenshots.sh compare

# Draw the reference images of the screenshot suite again, inside the Playwright container (needs Docker)
web-screenshots-update: data sim-build web-build
    web/scripts/run-screenshots.sh update

# Check formatting and animations, run every test suite (simulator, tools, web app) and build every board
check: format-check validate && web-test
    {{python}} -m unittest discover -s tools
    pio test -e native_test
    pio run -e esp32c3 -e esp32 -e esp32s3

# Remove build outputs, data/ and simulator output
clean:
    pio run -t clean -e native -e native_test -e esp32c3 -e esp32 -e esp32s3
    rm -rf data {{out}} {{site}} web/dist web/test-results* web/playwright-report*
