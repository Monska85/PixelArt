BOARD ?= esp32c3
OUT ?= sim-out
ANIM ?=
ARGS ?=
PYTHON ?= python3
SIM := .pio/build/native/program
CPP_SOURCES = $(shell find src include test lib -name '*.cpp' -o -name '*.h')

ANIM_ARG := $(if $(ANIM),--anim $(ANIM),)

.DEFAULT_GOAL := help
.PHONY: help data validate build build-all upload upload-firmware upload-data monitor flash mirror sim-build sim \
	sim-list sim-play emulate sim-open test format format-check check clean

help: ## Show this help
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z_-]+:.*## / {printf "  %-16s %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@echo ""
	@echo "Variables: BOARD=$(BOARD) (esp32c3, esp32, esp32s3)  ANIM=name[,name]  OUT=$(OUT)  ARGS=extra simulator options"

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

emulate: data sim-build ## Emulate the board: live matrix and serial output in the terminal, no hardware
	$(SIM) $(ANIM_ARG) --live $(ARGS)

sim-open: sim ## Run the simulator and open the HTML player
	@if command -v xdg-open >/dev/null 2>&1; then xdg-open $(OUT)/player.html; \
	elif command -v open >/dev/null 2>&1; then open $(OUT)/player.html; \
	else echo "Open $(OUT)/player.html in a browser"; fi

test: data ## Run the tests on the simulator
	pio test -e native_test

format: ## Format the C++ sources with clang-format
	@clang-format -i $(CPP_SOURCES)

format-check: ## Fail if a C++ source is not formatted
	@clang-format --dry-run --Werror $(CPP_SOURCES)

check: data sim-build ## Check formatting and animations, run the tests and build every board
	@clang-format --dry-run --Werror $(CPP_SOURCES)
	$(SIM) --validate
	pio test -e native_test
	pio run -e esp32c3 -e esp32 -e esp32s3

clean: ## Remove build outputs, data/ and simulator output
	pio run -t clean -e native -e native_test -e esp32c3 -e esp32 -e esp32s3
	rm -rf data $(OUT)
