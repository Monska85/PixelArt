// SPDX-License-Identifier: GPL-3.0-or-later

// WebSocket transport for the command protocol: tools/ws_bridge.py serves the
// WebSocket in a child process and exchanges protocol lines with the simulator
// over two pipes, so the terminal stays free for --live. See
// docs/protocol/protocol-v1.md#websocket-simulator.

#include <cerrno>
#include <csignal>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fcntl.h>
#include <poll.h>
#include <spawn.h>
#include <sys/wait.h>
#include <unistd.h>

#include "sim_internal.h"

extern char **environ;

namespace sim
{
namespace
{

// Bytes queued for Serial.read() above which the bridge is not read, so a
// flooding client waits in the pipe and in TCP instead of growing the queue.
constexpr size_t MAX_PENDING_INPUT = 4096;
// How long the bridge may take to start listening.
constexpr int START_TIMEOUT_MS = 10000;

struct Bridge
{
  pid_t pid = -1;
  int to = -1;   // the bridge's standard input
  int from = -1; // the bridge's standard output
};

Bridge &bridge()
{
  static Bridge b;
  return b;
}

// PIXELART_WS_BRIDGE, else tools/ws_bridge.py of the repository whose
// .pio/build/native/ holds the program.
std::filesystem::path bridge_script(const char *program)
{
  if (const char *env = getenv("PIXELART_WS_BRIDGE"))
    return env;
  return (std::filesystem::path(program).parent_path() / "../../../tools/ws_bridge.py").lexically_normal();
}

// Reads the bridge's first line, "ready PORT", byte by byte so the bytes after it stay in the pipe.
bool read_ready(int fd)
{
  std::string line;
  for (;;)
  {
    pollfd p = {fd, POLLIN, 0};
    if (poll(&p, 1, START_TIMEOUT_MS) <= 0)
      return false;
    char c;
    ssize_t n = read(fd, &c, 1);
    if (n < 0 && (errno == EINTR || errno == EAGAIN))
      continue;
    if (n <= 0)
      return false;
    if (c == '\n')
      return line.compare(0, 6, "ready ") == 0;
    line += c;
  }
}

[[noreturn]] void bridge_stopped() { throw detail::Stop{"the WebSocket bridge stopped"}; }

} // namespace

namespace detail
{

bool ws_start(const char *program, unsigned port, const std::vector<std::string> &extra_origins, std::string &error)
{
  Bridge &b = bridge();
  const char *python = getenv("PIXELART_PYTHON") ? getenv("PIXELART_PYTHON") : "python3";
  std::filesystem::path script = bridge_script(program);
  if (!std::filesystem::is_regular_file(script))
  {
    error = "cannot find the WebSocket bridge " + script.string() + " (set PIXELART_WS_BRIDGE to tools/ws_bridge.py)";
    return false;
  }

  std::vector<std::string> args = {python, script.string(), "--port", std::to_string(port)};
  for (const std::string &origin : extra_origins)
  {
    args.push_back("--origin");
    args.push_back(origin);
  }
  std::vector<char *> argv;
  for (std::string &arg : args)
    argv.push_back(arg.data());
  argv.push_back(nullptr);

  int to[2], from[2];
  if (pipe(to) != 0 || pipe(from) != 0)
  {
    error = std::string("cannot create a pipe: ") + strerror(errno);
    return false;
  }
  for (int fd : {to[0], to[1], from[0], from[1]})
    fcntl(fd, F_SETFD, FD_CLOEXEC);
  posix_spawn_file_actions_t actions;
  posix_spawn_file_actions_init(&actions);
  posix_spawn_file_actions_adddup2(&actions, to[0], 0);
  posix_spawn_file_actions_adddup2(&actions, from[1], 1);
  int status = posix_spawnp(&b.pid, python, &actions, nullptr, argv.data(), environ);
  posix_spawn_file_actions_destroy(&actions);
  close(to[0]);
  close(from[1]);
  b.to = to[1];
  b.from = from[0];
  if (status != 0)
  {
    b.pid = -1;
    ws_stop();
    error = std::string("cannot start ") + python + ": " + strerror(status) +
            " (set PIXELART_PYTHON to a Python with the websockets package)";
    return false;
  }
  signal(SIGPIPE, SIG_IGN); // a bridge that ended shows as a write error, not as a signal
  if (!read_ready(b.from))
  {
    ws_stop();
    error = "the WebSocket bridge did not start (see the message above)";
    return false;
  }
  fcntl(b.from, F_SETFL, fcntl(b.from, F_GETFL, 0) | O_NONBLOCK);
  return true;
}

void ws_stop()
{
  Bridge &b = bridge();
  for (int *fd : {&b.to, &b.from})
    if (*fd >= 0)
    {
      close(*fd);
      *fd = -1;
    }
  if (b.pid > 0)
  {
    kill(b.pid, SIGTERM);
    waitpid(b.pid, nullptr, 0);
  }
  b.pid = -1;
}

void ws_send_line(const std::string &line)
{
  Bridge &b = bridge();
  std::string out = line + "\n";
  for (size_t sent = 0; sent < out.size();)
  {
    ssize_t n = write(b.to, out.data() + sent, out.size() - sent);
    if (n > 0)
      sent += (size_t)n;
    else if (n < 0 && errno != EINTR)
      bridge_stopped();
  }
}

void ws_wait(std::chrono::microseconds limit)
{
  Bridge &b = bridge();
  // Whole milliseconds, rounded up: the wake-up may overshoot by under 1 ms, which the
  // caller absorbs because its target is absolute. A signal only cuts the wait short.
  const int timeout_ms = (int)std::chrono::ceil<std::chrono::milliseconds>(limit).count();
  const size_t pending = serial_input_size();
  pollfd p = {b.from, (short)(pending < MAX_PENDING_INPUT ? POLLIN : 0), 0};
  if (poll(&p, 1, timeout_ms) <= 0 || pending >= MAX_PENDING_INPUT)
    return;
  char buf[MAX_PENDING_INPUT];
  ssize_t n = read(b.from, buf, MAX_PENDING_INPUT - pending);
  if (n > 0)
    serial_input(std::string(buf, (size_t)n));
  else if (n == 0 || (errno != EAGAIN && errno != EINTR))
    bridge_stopped();
}

} // namespace detail

bool ws_active() { return bridge().pid > 0; }

} // namespace sim
