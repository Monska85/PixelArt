BOARD ?= esp32c3
OUT ?= sim-out
ANIM ?=
ARGS ?=
SIM := .pio/build/native/program
CPP_SOURCES = $(shell find src include test lib/ArduinoSim -name '*.cpp' -o -name '*.h')

ANIM_ARG := $(if $(ANIM),--anim $(ANIM),)

.DEFAULT_GOAL := help
.PHONY: help build build-all upload monitor flash mirror sim-build sim sim-list sim-play emulate sim-open test format format-check check clean

help: ## Show this help
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z_-]+:.*## / {printf "  %-12s %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@echo ""
	@echo "Variables: BOARD=$(BOARD) (esp32c3, esp32, esp32s3)  ANIM=name[,name]  OUT=$(OUT)  ARGS=extra simulator options"

build: ## Build the firmware for BOARD
	pio run -e $(BOARD)

build-all: ## Build the firmware for every board
	pio run -e esp32c3 -e esp32 -e esp32s3

upload: ## Build and flash the firmware to BOARD
	pio run -e $(BOARD) -t upload

monitor: ## Open the serial monitor
	pio device monitor -e $(BOARD)

flash: ## Flash BOARD, then open the serial monitor
	pio run -e $(BOARD) -t upload
	pio device monitor -e $(BOARD)

mirror: ## Flash BOARD with the frame mirror on and watch the matrix live in the terminal
	PLATFORMIO_BUILD_FLAGS=-DPIXELART_MIRROR pio run -e $(BOARD) -t upload
	pio device monitor -e $(BOARD)

sim-build: ## Build the host simulator
	pio run -e native

sim: sim-build ## Run the simulator (ANIM=name to pick animations) and write OUT/
	$(SIM) $(ANIM_ARG) --out $(OUT) $(ARGS)

sim-list: sim-build ## List the animations the simulator can run
	$(SIM) --list

sim-play: sim-build ## Play in real time in the terminal
	$(SIM) $(ANIM_ARG) --realtime --no-files $(ARGS)

emulate: sim-build ## Emulate the board: live matrix and serial output in the terminal, no hardware
	$(SIM) $(ANIM_ARG) --live $(ARGS)

sim-open: sim ## Run the simulator and open the HTML player
	@if command -v xdg-open >/dev/null 2>&1; then xdg-open $(OUT)/player.html; \
	elif command -v open >/dev/null 2>&1; then open $(OUT)/player.html; \
	else echo "Open $(OUT)/player.html in a browser"; fi

test: ## Run the simulator tests
	pio test -e native_test

format: ## Format the C++ sources with clang-format
	@clang-format -i $(CPP_SOURCES)

format-check: ## Fail if a C++ source is not formatted
	@clang-format --dry-run --Werror $(CPP_SOURCES)

check: ## Check formatting, run the tests and build every board
	@clang-format --dry-run --Werror $(CPP_SOURCES)
	pio test -e native_test
	pio run -e esp32c3 -e esp32 -e esp32s3

clean: ## Remove build outputs and simulator output
	pio run -t clean -e native -e native_test -e esp32c3 -e esp32 -e esp32s3
	rm -rf $(OUT)
