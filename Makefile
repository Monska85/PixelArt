BOARD ?= esp32c3
OUT ?= sim-out
SITE ?= site
ANIM ?=
ARGS ?=
WS ?=
PYTHON ?= python3
SIM := .pio/build/native/program
CPP_SOURCES = $(shell find src include test lib -name '*.cpp' -o -name '*.h')

ANIM_ARG := $(if $(ANIM),--anim $(ANIM),)
WS_ARG := $(if $(WS),--ws,)

.DEFAULT_GOAL := help
.PHONY: help data validate build build-all upload upload-firmware upload-data monitor flash mirror sim-build sim \
	sim-list sim-play emulate serve sim-open release-firmware release-site test format format-check web-install web-dev web-build web-test \
	web-e2e web-size web-screenshots web-screenshots-update check clean

help: ## Show this help
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z0-9_-]+:.*## / {printf "  %-24s %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@echo ""
	@echo "Variables: BOARD=$(BOARD) (esp32c3, esp32, esp32s3)  ANIM=name[,name]  OUT=$(OUT)  SITE=$(SITE)  ARGS=extra simulator options  WS=1 (emulate with the WebSocket)"

data: ## Build data/ (the board's files) from animations/ and playlists/
	$(PYTHON) tools/pixelart.py build

validate: data sim-build ## Check every animation and playlist with the board's engine
	$(SIM) --validate

build: ## Build the firmware for BOARD
	pio run -e $(BOARD)

build-all: ## Build the firmware for every board
	pio run -e esp32c3 -e esp32 -e esp32s3

upload: data ## Flash the firmware and the animations to BOARD
	pio run -e $(BOARD) -t upload
	pio run -e $(BOARD) -t uploadfs

upload-firmware: ## Flash only the firmware, keeping the animations on the board
	pio run -e $(BOARD) -t upload

upload-data: data ## Flash only the animations and playlists, keeping the firmware
	pio run -e $(BOARD) -t uploadfs

monitor: ## Open the serial monitor
	pio device monitor -e $(BOARD)

flash: data ## Flash the firmware and the animations, then open the serial monitor
	pio run -e $(BOARD) -t upload
	pio run -e $(BOARD) -t uploadfs
	pio device monitor -e $(BOARD)

mirror: data ## Flash with the frame mirror on, then watch the matrix live in the terminal
	PLATFORMIO_BUILD_FLAGS=-DPIXELART_MIRROR pio run -e $(BOARD) -t upload
	pio run -e $(BOARD) -t uploadfs
	pio device monitor -e $(BOARD)

sim-build: ## Build the host simulator
	pio run -e native

sim: data sim-build ## Run the simulator (ANIM=name to pick animations) and write OUT/
	$(SIM) $(ANIM_ARG) --out $(OUT) $(ARGS)

sim-list: data sim-build ## List the animations the simulator can run
	$(SIM) --list

sim-play: data sim-build ## Play once in real time in the terminal
	$(SIM) $(ANIM_ARG) --realtime --no-files $(ARGS)

emulate: data sim-build ## Emulate the board: live matrix and serial output in the terminal, no hardware (WS=1 adds the WebSocket)
	$(SIM) $(ANIM_ARG) --live $(WS_ARG) $(ARGS)

serve: data sim-build ## Emulate the board and serve the command protocol on ws://127.0.0.1:8765
	$(SIM) $(ANIM_ARG) --live --ws $(ARGS)

sim-open: sim ## Run the simulator and open the HTML player
	@if command -v xdg-open >/dev/null 2>&1; then xdg-open $(OUT)/player.html; \
	elif command -v open >/dev/null 2>&1; then open $(OUT)/player.html; \
	else echo "Open $(OUT)/player.html in a browser"; fi

release-firmware: data ## Build every board and the firmware part of the release site into SITE (default site/)
	@set -eu; \
	PIXELART_VERSION=$$($(PYTHON) tools/release.py version); export PIXELART_VERSION; \
	echo "Firmware release site for version $$PIXELART_VERSION"; \
	pio run -e esp32c3 -e esp32 -e esp32s3; \
	for board in esp32c3 esp32 esp32s3; do pio run -e $$board -t buildfs; done; \
	$(PYTHON) tools/release.py build --out $(SITE) --schema

release-site: data ## Build every board and the web app into SITE (default site/), the site Pages shows if both were released from this commit
	@set -eu; \
	PIXELART_VERSION=$$($(PYTHON) tools/release.py version); export PIXELART_VERSION; \
	echo "Release site for version $$PIXELART_VERSION"; \
	work=$$(mktemp -d); trap 'rm -rf "$$work"' EXIT; \
	pio run -e esp32c3 -e esp32 -e esp32s3; \
	for board in esp32c3 esp32 esp32s3; do pio run -e $$board -t buildfs; done; \
	$(PYTHON) tools/release.py build --out "$$work/firmware" --schema; \
	$(MAKE) --no-print-directory web-build; \
	$(PYTHON) tools/release.py assemble --out $(SITE) --firmware "$$work/firmware" --web web/dist

test: data ## Run the tests on the simulator
	pio test -e native_test

format: ## Format the C++ sources with clang-format
	@clang-format -i $(CPP_SOURCES)

format-check: ## Fail if a C++ source is not formatted
	@clang-format --dry-run --Werror $(CPP_SOURCES)

web-install: ## Install the web app's dependencies from the lockfile
	cd web && npm ci

web/node_modules: web/package-lock.json
	cd web && npm ci
	@touch web/node_modules

web-dev: web/node_modules ## Start the web app on http://localhost:5173 with live reload
	cd web && npm run dev

web-build: web/node_modules ## Build the web app into web/dist
	cd web && npm run build

web-size: web-build ## Fail when the JavaScript the web app loads at start is over its budget (190 KB gzip)
	cd web && npm run size

web-test: data web/node_modules ## Type check, lint and run the web app's unit tests and the conformance suite
	cd web && npm run typecheck && npm run lint && npm test

web-e2e: data sim-build web/node_modules ## Run the web app's end-to-end tests and layout checks against the simulator (first: cd web && npx playwright install chromium)
	cd web && npm run build && npm run e2e

web-screenshots: data sim-build web/node_modules ## Compare one main state per view with its reference image, inside the Playwright container (needs Docker)
	cd web && npm run build
	web/scripts/run-screenshots.sh compare

web-screenshots-update: data sim-build web/node_modules ## Draw the reference images of the screenshot suite again, inside the Playwright container (needs Docker)
	cd web && npm run build
	web/scripts/run-screenshots.sh update

check: data sim-build ## Check formatting and animations, run the tests and build every board
	@clang-format --dry-run --Werror $(CPP_SOURCES)
	$(SIM) --validate
	$(PYTHON) -m unittest discover -s tools
	pio test -e native_test
	pio run -e esp32c3 -e esp32 -e esp32s3
	$(MAKE) web-test

clean: ## Remove build outputs, data/ and simulator output
	pio run -t clean -e native -e native_test -e esp32c3 -e esp32 -e esp32s3
	rm -rf data $(OUT) $(SITE) web/dist web/test-results
