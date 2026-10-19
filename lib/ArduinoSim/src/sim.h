// Native LED matrix simulator: records every NeoPixel show() as a frame on
// a virtual clock and renders the result (terminal, PNG, JSON, HTML player).

#pragma once

#include <chrono>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <string>
#include <vector>

namespace sim
{

// One show() call, mapped onto the physical panel grid.
struct Frame
{
  uint64_t t_us = 0;        // virtual time of the show() call
  uint64_t duration_us = 0; // time until the next show() (or end of run)
  std::string scene;        // scene running when the frame was shown
  std::vector<uint8_t> rgb; // width * height * 3 bytes, row-major, LED output values

  // Packed 0xRRGGBB LED output value at panel coordinate (x, y).
  uint32_t at(int x, int y) const;
};

struct SerialLine
{
  uint64_t t_us;
  std::string text;
};

// A named entry point the simulator can run on its own (--anim).
struct Scene
{
  std::string name;
  std::function<void()> play;
};

// Returns the scenes available for --list and --anim. Called after the
// options are parsed, so it can depend on them (for example on data_dir()).
using SceneProvider = std::function<std::vector<Scene>()>;

// Physical panel: size and how the LED strip snakes through it. Uses the
// NEO_MATRIX_* bit values so it can be compared with the sketch's flags.
struct Panel
{
  int width = 16;
  int height = 16;
  uint8_t layout = 0x04 | 0x08; // top, left, columns, zigzag
};

const std::vector<Frame> &frames();
const std::vector<SerialLine> &serial();
const Panel &panel();
uint64_t now_us();
unsigned long seed();

// Folder that stands in for the board's file system (--data, default "data").
const std::string &data_dir();
void set_data_dir(const std::string &dir);

// Bytes the sketch will read from Serial: queued by tests and transports,
// consumed by Serial.read().
void serial_input(const std::string &bytes);
size_t serial_input_size();
// Next input byte (removed from the queue when `consume`), or -1 when empty.
int serial_input_read(bool consume);

// WebSocket transport for the command protocol (sim_ws.cpp), for real-time
// runs. Each text message from the client is one protocol line queued as
// serial input; each `@PR` line the sketch writes to Serial goes to the client.
// ws_listen() binds 127.0.0.1 only (port 0 picks a free port: see ws_port())
// and accepts the origins of docs/protocol/protocol-v1.md plus `extra_origins`.
// ws_poll() never blocks: call it often.
bool ws_listen(unsigned port, const std::vector<std::string> &extra_origins, std::string &error);
void ws_poll();
// Waits up to `limit` (rounded up to a whole millisecond) for the sockets to need service, serves
// what is ready, and returns at once when something was. A request thus reaches the serial input
// early, but the sketch only sees it when the caller returns. Does not sleep without a listening server.
void ws_wait(std::chrono::microseconds limit);
void ws_stop();
bool ws_active();
unsigned ws_port();

// Clears recorded frames, serial output, queued input and the clock. Call between tests.
void reset();
void set_scene(const std::string &name);

// Runs setup() then loop() (or the selected scenes) and writes the outputs.
int run(int argc, char **argv, const SceneProvider &scenes);

// Hooks used by the Arduino and NeoPixel shims.
void advance_us(uint64_t us);
void on_show(const uint8_t *pixels, uint16_t count, uint8_t r_off, uint8_t g_off, uint8_t b_off,
             uint8_t bytes_per_pixel);
void on_serial(char c);
// Lets a real-time run wait for the wall clock to reach the virtual time while
// polling the WebSocket; without a WebSocket it just sleeps.
void sync_wall_clock();

} // namespace sim
