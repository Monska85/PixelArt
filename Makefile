BOARD ?= esp32c3
OUT ?= sim-out
SITE ?= site
ANIM ?=
ARGS ?=
WS ?=
# Set on the command line only (make serve PORT=9000): a PORT in the environment is ignored
PORT := 8765
PYTHON ?= python3
# Resource limits, set for a laptop: at most JOBS parallel jobs (PlatformIO, Playwright workers) and the priority
# NICE for the heavy steps (0 is normal, 19 the lowest). Override per run: make check JOBS=8 NICE=0
JOBS ?= 4
NICE ?= 10
# An empty or other value would reach pio as a bad -j and nice as a bad priority: stop before any step runs. Checked
# with make functions only, so no value reaches a shell: JOBS is one word of digits not starting with 0, NICE one of
# the words 0 to 19.
DIGITS_LEFT = $(subst 0,,$(subst 1,,$(subst 2,,$(subst 3,,$(subst 4,,$(subst 5,,$(subst 6,,$(subst 7,,$(subst 8,,$(subst 9,,$(1)))))))))))
ifneq ($(words $(JOBS))$(call DIGITS_LEFT,$(JOBS))$(filter 0%,$(JOBS)),1)
$(error JOBS must be a whole number of 1 or more, got '$(JOBS)')
endif
ifneq ($(words $(NICE))$(filter-out 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19,$(NICE)),1)
$(error NICE must be a whole number from 0 to 19, got '$(NICE)')
endif
NICED = nice -n $(NICE)
# Playwright (web/playwright*.config.ts and web/scripts/run-screenshots.sh) takes its workers from here
export PIXELART_JOBS = $(JOBS)
# The simulator's --ws starts tools/ws_bridge.py with this Python, the one the other tools use
export PIXELART_PYTHON = $(PYTHON)
SIM := .pio/build/native/program
CPP_SOURCES = $(shell find src include test lib -name '*.cpp' -o -name '*.h')

ANIM_ARG := $(if $(ANIM),--anim $(ANIM),)
WS_ARG := $(if $(WS),--ws,)

# One heavy step at a time, whatever -j the user gives make: the parallelism is JOBS, inside each step (the -j of
# pio run, the workers of Playwright). Sub-makes therefore get no -j of their own: .NOTPARALLEL would ignore it.
.NOTPARALLEL:

.DEFAULT_GOAL := help
.PHONY: help data validate build build-all upload upload-firmware upload-data monitor flash mirror sim-build sim \
	sim-list sim-play emulate serve sim-open release-firmware release-site test format format-check web-install web-dev web-build web-test \
	web-e2e web-size web-screenshots web-screenshots-update check clean

help: ## Show this help
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z0-9_-]+:.*## / {printf "  %-24s %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@echo ""
	@echo "Variables: BOARD=$(BOARD) (esp32c3, esp32, esp32s3)  ANIM=name[,name]  OUT=$(OUT)  SITE=$(SITE)  ARGS=extra simulator options  WS=1 (emulate with the WebSocket)  PORT=$(PORT) (serve)  PYTHON=$(PYTHON)  JOBS=$(JOBS) (parallel jobs)  NICE=$(NICE) (priority of the heavy steps)"

data: ## Build data/ (the board's files) from animations/ and playlists/
	$(PYTHON) tools/pixelart.py build

validate: data sim-build ## Check every animation and playlist with the board's engine
	$(NICED) $(SIM) --validate

build: ## Build the firmware for BOARD
	$(NICED) pio run -j $(JOBS) -e $(BOARD)

build-all: ## Build the firmware for every board
	$(NICED) pio run -j $(JOBS) -e esp32c3 -e esp32 -e esp32s3

upload: data ## Flash the firmware and the animations to BOARD
	$(NICED) pio run -j $(JOBS) -e $(BOARD) -t upload
	$(NICED) pio run -j $(JOBS) -e $(BOARD) -t uploadfs

upload-firmware: ## Flash only the firmware, keeping the animations on the board
	$(NICED) pio run -j $(JOBS) -e $(BOARD) -t upload

upload-data: data ## Flash only the animations and playlists, keeping the firmware
	$(NICED) pio run -j $(JOBS) -e $(BOARD) -t uploadfs

monitor: ## Open the serial monitor
	pio device monitor -e $(BOARD)

flash: ## Flash the firmware and the animations, then open the serial monitor
	$(MAKE) --no-print-directory upload
	$(MAKE) --no-print-directory monitor

mirror: data ## Flash with the frame mirror on, then watch the matrix live in the terminal
	PLATFORMIO_BUILD_FLAGS=-DPIXELART_MIRROR $(NICED) pio run -j $(JOBS) -e $(BOARD) -t upload
	$(NICED) pio run -j $(JOBS) -e $(BOARD) -t uploadfs
	pio device monitor -e $(BOARD)

sim-build: ## Build the host simulator
	$(NICED) pio run -j $(JOBS) -e native

sim: data sim-build ## Run the simulator (ANIM=name to pick animations) and write OUT/
	$(SIM) $(ANIM_ARG) --out $(OUT) $(ARGS)

sim-list: data sim-build ## List the animations the simulator can run
	$(SIM) --list

sim-play: data sim-build ## Play once in real time in the terminal
	$(SIM) $(ANIM_ARG) --realtime --no-files $(ARGS)

emulate: data sim-build ## Emulate the board: live matrix and serial output in the terminal, no hardware (WS=1 adds the WebSocket)
	$(SIM) $(ANIM_ARG) --live $(WS_ARG) $(ARGS)

serve: data sim-build ## Emulate the board and serve the command protocol on ws://127.0.0.1:PORT (default 8765)
	$(SIM) $(ANIM_ARG) --live --ws $(PORT) $(ARGS)

sim-open: sim ## Run the simulator and open the HTML player
	@if command -v xdg-open >/dev/null 2>&1; then xdg-open $(OUT)/player.html; \
	elif command -v open >/dev/null 2>&1; then open $(OUT)/player.html; \
	else echo "Open $(OUT)/player.html in a browser"; fi

release-firmware: data ## Build every board and the firmware part of the release site into SITE (default site/)
	@set -eu; \
	PIXELART_VERSION=$$($(PYTHON) tools/release.py version); export PIXELART_VERSION; \
	echo "Firmware release site for version $$PIXELART_VERSION"; \
	$(NICED) pio run -j $(JOBS) -e esp32c3 -e esp32 -e esp32s3; \
	for board in esp32c3 esp32 esp32s3; do $(NICED) pio run -j $(JOBS) -e $$board -t buildfs; done; \
	$(NICED) $(PYTHON) tools/release.py build --out $(SITE) --schema

release-site: data ## Build every board and the web app into SITE (default site/), the site Pages shows if both were released from this commit
	@set -eu; \
	PIXELART_VERSION=$$($(PYTHON) tools/release.py version); export PIXELART_VERSION; \
	echo "Release site for version $$PIXELART_VERSION"; \
	work=$$(mktemp -d); trap 'rm -rf "$$work"' EXIT; \
	$(NICED) pio run -j $(JOBS) -e esp32c3 -e esp32 -e esp32s3; \
	for board in esp32c3 esp32 esp32s3; do $(NICED) pio run -j $(JOBS) -e $$board -t buildfs; done; \
	$(NICED) $(PYTHON) tools/release.py build --out "$$work/firmware" --schema; \
	$(MAKE) --no-print-directory web-build; \
	$(PYTHON) tools/release.py assemble --out $(SITE) --firmware "$$work/firmware" --web web/dist

test: data ## Run the tests on the simulator
	$(NICED) pio test -e native_test

format: ## Format the C++ sources with clang-format
	@$(NICED) clang-format -i $(CPP_SOURCES)

format-check: ## Fail if a C++ source is not formatted
	@$(NICED) clang-format --dry-run --Werror $(CPP_SOURCES)

web-install: ## Install the web app's dependencies from the lockfile
	cd web && npm ci

web/node_modules: web/package-lock.json
	cd web && npm ci
	@touch web/node_modules

web-dev: web/node_modules ## Start the web app on http://localhost:5173 with live reload
	cd web && npm run dev

web-build: web/node_modules ## Build the web app into web/dist
	cd web && $(NICED) npm run build

web-size: web-build ## Fail when the JavaScript the web app loads at start is over its budget (190 KB gzip)
	cd web && npm run size

web-test: data web/node_modules ## Type check, lint, check the formatting and run the web app's unit tests and the conformance suite
	cd web && $(NICED) npm run typecheck && $(NICED) npm run lint && $(NICED) npm run format:check && $(NICED) npm test

web-e2e: data sim-build web-build ## Run the web app's end-to-end tests and layout checks against the simulator (first: cd web && npx playwright install chromium)
	cd web && $(NICED) npm run e2e

web-screenshots: data sim-build web-build ## Compare one main state per view with its reference image, inside the Playwright container (needs Docker)
	$(NICED) web/scripts/run-screenshots.sh compare

web-screenshots-update: data sim-build web-build ## Draw the reference images of the screenshot suite again, inside the Playwright container (needs Docker)
	$(NICED) web/scripts/run-screenshots.sh update

check: format-check validate ## Check formatting and animations, run every test suite (simulator, tools, web app) and build every board
	$(NICED) $(PYTHON) -m unittest discover -s tools
	$(NICED) pio test -e native_test
	$(NICED) pio run -j $(JOBS) -e esp32c3 -e esp32 -e esp32s3
	$(MAKE) web-test

clean: ## Remove build outputs, data/ and simulator output
	$(NICED) pio run -t clean -e native -e native_test -e esp32c3 -e esp32 -e esp32s3
	rm -rf data $(OUT) $(SITE) web/dist web/test-results* web/playwright-report*
