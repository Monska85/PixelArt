// SPDX-License-Identifier: GPL-3.0-or-later

// Simulator internals shared by the sim_*.cpp modules. Not part of the
// public API: sketches and tests use sim.h.

#pragma once

#include <chrono>
#include <deque>
#include <cstdint>
#include <filesystem>
#include <string>
#include <vector>

#include "sim.h"

namespace sim::detail
{

// Thrown from inside the sketch to end a run cleanly when a limit is hit.
struct Stop
{
  std::string reason;
};

struct Options
{
  uint64_t max_us = 600ULL * 1000 * 1000; // 10 virtual minutes
  size_t max_frames = 20000;
  bool realtime = false;
  bool ansi = false;
  bool live = false; // keep running, redraw in place, show serial below the matrix
  bool raw_colors = false;
  size_t range_from = 0;
  size_t range_to = SIZE_MAX;
  std::string data_dir = "data";
  bool ws = false; // serve the command protocol over a WebSocket
  unsigned ws_port = 8765;
  std::vector<std::string> ws_origins;
};

struct State
{
  Options opts;
  Panel panel;
  uint64_t clock_us = 0;
  std::string scene;
  std::vector<Frame> frames;
  std::vector<SerialLine> serial;
  std::string serial_buf;
  std::deque<char> serial_in;     // bytes waiting for Serial.read()
  std::vector<int> strip_to_grid; // LED index on the strip -> y * width + x
  std::chrono::steady_clock::time_point wall_start;
  size_t shown_frames = 0;
  std::vector<std::string> live_log;
};

constexpr size_t LIVE_LOG_LINES = 12;

State &state();

// sim.cpp
void finish_frames();

// sim_bridge.cpp: the WebSocket served by tools/ws_bridge.py in a child process.
// ws_start() reports why the bridge cannot start; once it runs, a bridge that
// ends stops the run.
bool ws_start(const char *program, unsigned port, const std::vector<std::string> &extra_origins, std::string &error);
void ws_stop();
void ws_send_line(const std::string &line);
// Waits up to `limit` (rounded up to a whole millisecond) for a request and returns at once when
// one arrives. The request reaches the serial input early, but the sketch only sees it when the
// caller returns.
void ws_wait(std::chrono::microseconds limit);

// sim_panel.cpp
void build_strip_map();
std::string layout_name(uint8_t layout);
bool parse_layout(const std::string &spec, uint8_t &out);

// sim_terminal.cpp
uint8_t display_value(uint8_t v);
bool in_range(size_t index);
void print_ansi(const Frame &f, size_t index);

// sim_png.cpp
bool write_frame_png(const std::filesystem::path &path, const Frame &f);
bool write_sheet_png(const std::filesystem::path &path, const std::vector<const Frame *> &frames);

// sim_report.cpp
std::string frames_json();
std::string player_html(const std::string &frames_json);

} // namespace sim::detail
