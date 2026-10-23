// SPDX-License-Identifier: GPL-3.0-or-later

// Command line entry point: parses the options, runs the sketch and writes
// the outputs.

#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <map>
#include <sstream>

#include <Arduino.h>

#include "sim_internal.h"

namespace sim
{
namespace
{

using detail::State;

const char *USAGE = R"(Usage: program [options]

Runs the sketch on a virtual clock and records every matrix show() as a frame.

Selection:
  --data DIR           folder that stands in for the board's file system (default data,
                       built from animations/ and playlists/ by `make data`)
  --list               list the animations in DIR/animations and exit
  --validate           check every animation and playlist in the data folder, then exit
                       (status 1 if any file has an error)
  --anim NAME[,NAME]   run setup() then only these animations, instead of loop()
  --loops N            how many times to run loop() or the selected scenes (default 1, 0 = forever)
  --ws [PORT]          serve the command protocol over a WebSocket on 127.0.0.1 (default port 8765),
                       with --live or --realtime; uploads change the --data folder. Starts
                       tools/ws_bridge.py with python3 (PIXELART_PYTHON), which needs websockets
  --ws-origin ORIGIN   also accept this Origin (repeatable). Always accepted: no Origin,
                       http://localhost and http://127.0.0.1 (any port), https://monska85.github.io
  --live               emulate the board: run forever in real time, redraw the matrix in the
                       terminal and show serial output below it (no files written)

Limits (the run stops cleanly when one is hit):
  --max-ms MS          virtual time limit (default 600000)
  --max-frames N       frame limit (default 20000)

Output:
  --out DIR            output directory (default sim-out)
  --no-files           do not write frames.json, player.html or PNGs
  --png-frames         also write one PNG per frame to DIR/frames/
  --range A:B          frames used for the terminal, sheet.png and --png-frames (inclusive)
  --ansi               print frames in the terminal (truecolor)
  --realtime           play in real time in the terminal (implies --ansi)
  --raw                render raw LED output values instead of perceived colors

Hardware:
  --panel WxH          physical panel size (default 16x16)
  --layout SPEC        how the strip snakes through the panel, NeoMatrix terms
                       (default top,left,columns,zigzag)
)";

// Most frames sheet.png holds; --range selects the others.
constexpr size_t SHEET_MAX_FRAMES = 480;

struct RunConfig
{
  std::vector<std::string> selected;
  unsigned long long loops = 1;
  std::filesystem::path out_dir = "sim-out";
  bool write_files = true;
  bool png_frames = false;
  bool list = false;
};

bool parse_uint(const char *s, unsigned long long &out)
{
  char *end = nullptr;
  out = strtoull(s, &end, 10);
  return end && *end == '\0' && end != s;
}

[[noreturn]] void usage_error(const std::string &message)
{
  fprintf(stderr, "sim: %s\n", message.c_str());
  exit(2);
}

// Fills cfg and the simulator options from argv. Returns false when the
// program should exit right away with status 0 (--help).
bool parse_args(int argc, char **argv, RunConfig &cfg)
{
  detail::Options &opts = detail::state().opts;
  Panel &panel = detail::state().panel;
  bool loops_set = false, max_ms_set = false;

  for (int a = 1; a < argc; a++)
  {
    std::string arg = argv[a];
    auto value = [&]() -> const char *
    {
      if (a + 1 >= argc)
        usage_error(arg + " needs a value");
      return argv[++a];
    };
    auto number = [&]()
    {
      unsigned long long v;
      const char *s = value();
      if (!parse_uint(s, v))
        usage_error(arg + " expects a number, got '" + s + "'");
      return v;
    };

    if (arg == "--help" || arg == "-h")
    {
      fputs(USAGE, stdout);
      return false;
    }
    else if (arg == "--list")
      cfg.list = true;
    else if (arg == "--data")
      opts.data_dir = value();
    else if (arg == "--anim")
    {
      std::stringstream ss(value());
      std::string name;
      while (std::getline(ss, name, ','))
        if (!name.empty())
          cfg.selected.push_back(name);
    }
    else if (arg == "--loops")
    {
      cfg.loops = number();
      loops_set = true;
    }
    else if (arg == "--live")
      opts.live = opts.ansi = opts.realtime = true;
    else if (arg == "--ws")
    {
      opts.ws = true;
      if (a + 1 < argc && argv[a + 1][0] >= '0' && argv[a + 1][0] <= '9')
      {
        unsigned long long port;
        if (!parse_uint(argv[++a], port) || port < 1 || port > 65535)
          usage_error("--ws expects a port from 1 to 65535");
        opts.ws_port = (unsigned)port;
      }
    }
    else if (arg == "--ws-origin")
    {
      std::string origin = value();
      bool printable = !origin.empty();
      for (unsigned char c : origin)
        printable = printable && c > 0x20 && c < 0x7F;
      if (!printable)
        usage_error("--ws-origin expects an origin such as https://example.org");
      opts.ws_origins.push_back(origin);
    }
    else if (arg == "--max-ms")
    {
      opts.max_us = number() * 1000;
      max_ms_set = true;
    }
    else if (arg == "--max-frames")
      opts.max_frames = number();
    else if (arg == "--out")
      cfg.out_dir = value();
    else if (arg == "--no-files")
      cfg.write_files = false;
    else if (arg == "--png-frames")
      cfg.png_frames = true;
    else if (arg == "--range")
    {
      std::string r = value();
      auto colon = r.find(':');
      unsigned long long from = 0, to = SIZE_MAX;
      if (colon == std::string::npos || (colon > 0 && !parse_uint(r.substr(0, colon).c_str(), from)) ||
          (colon + 1 < r.size() && !parse_uint(r.substr(colon + 1).c_str(), to)))
        usage_error("--range expects A:B, A: or :B");
      opts.range_from = from;
      opts.range_to = to;
    }
    else if (arg == "--ansi")
      opts.ansi = true;
    else if (arg == "--realtime")
      opts.ansi = opts.realtime = true;
    else if (arg == "--raw")
      opts.raw_colors = true;
    else if (arg == "--panel")
    {
      int w = 0, h = 0;
      if (sscanf(value(), "%dx%d", &w, &h) != 2 || w <= 0 || h <= 0)
        usage_error("--panel expects WxH, e.g. 16x16");
      panel.width = w;
      panel.height = h;
    }
    else if (arg == "--layout")
    {
      if (!detail::parse_layout(value(), panel.layout))
        usage_error("--layout expects e.g. top,left,columns,zigzag");
    }
    else
      usage_error("unknown option '" + arg + "' (see --help)");
  }

  if (opts.ws && !opts.realtime)
    usage_error("--ws needs a real-time run: add --live or --realtime");
  if (!opts.ws && !opts.ws_origins.empty())
    usage_error("--ws-origin needs --ws");
  if (opts.live)
  {
    cfg.write_files = false;
    if (!loops_set)
      cfg.loops = 0;
    if (!max_ms_set)
      opts.max_us = UINT64_MAX;
  }
  return true;
}

std::vector<const Scene *> resolve_scenes(const std::vector<std::string> &names, const std::vector<Scene> &scenes)
{
  std::vector<const Scene *> plan;
  for (const std::string &name : names)
  {
    const Scene *found = nullptr;
    for (const Scene &scene : scenes)
      if (!found && name == scene.name)
        found = &scene;
    if (!found)
      usage_error("unknown scene '" + name + "' (see --list)");
    plan.push_back(found);
  }
  return plan;
}

// Runs setup() then loop() (or the selected scenes). Returns why it stopped.
std::string play(const std::vector<const Scene *> &plan, unsigned long long loops)
{
  try
  {
    set_scene("setup");
    setup();
    for (unsigned long long l = 0; loops == 0 || l < loops; l++)
    {
      if (plan.empty())
      {
        set_scene("loop");
        loop();
      }
      else
      {
        for (const Scene *s : plan)
        {
          set_scene(s->name);
          s->play();
        }
      }
    }
  }
  catch (const detail::Stop &stop)
  {
    return stop.reason;
  }
  return "finished";
}

void print_summary(const std::string &stop_reason)
{
  const State &s = detail::state();
  fprintf(stderr, "sim: %zu frames, %.1fs virtual time, %s\n", s.frames.size(), s.clock_us / 1e6, stop_reason.c_str());
  std::map<std::string, std::pair<size_t, uint64_t>> per_scene;
  std::vector<std::string> order;
  for (const Frame &f : s.frames)
  {
    if (!per_scene.count(f.scene))
      order.push_back(f.scene);
    per_scene[f.scene].first++;
    per_scene[f.scene].second += f.duration_us;
  }
  for (const std::string &name : order)
    fprintf(stderr, "  %-20s %4zu frames  %7.1fs\n", name.c_str(), per_scene[name].first, per_scene[name].second / 1e6);
}

int write_outputs(const RunConfig &cfg)
{
  const State &s = detail::state();
  std::error_code ec;
  std::filesystem::create_directories(cfg.out_dir, ec);
  if (ec)
  {
    fprintf(stderr, "sim: cannot create %s: %s\n", cfg.out_dir.string().c_str(), ec.message().c_str());
    return 1;
  }
  std::string json = detail::frames_json();
  std::ofstream(cfg.out_dir / "frames.json") << json;
  std::ofstream(cfg.out_dir / "player.html") << detail::player_html(json);

  std::vector<const Frame *> selected;
  std::vector<size_t> indexes;
  for (size_t i = 0; i < s.frames.size(); i++)
    if (detail::in_range(i))
    {
      selected.push_back(&s.frames[i]);
      indexes.push_back(i);
    }

  if (!selected.empty())
  {
    std::vector<const Frame *> sheet(selected.begin(), selected.begin() + std::min(selected.size(), SHEET_MAX_FRAMES));
    detail::write_sheet_png(cfg.out_dir / "sheet.png", sheet);
    if (selected.size() > SHEET_MAX_FRAMES)
      fprintf(stderr, "sim: sheet.png shows the first %zu of %zu frames, use --range for the rest\n", SHEET_MAX_FRAMES,
              selected.size());
  }
  if (cfg.png_frames)
  {
    std::filesystem::create_directories(cfg.out_dir / "frames", ec);
    for (size_t k = 0; k < selected.size(); k++)
    {
      char name[32];
      snprintf(name, sizeof(name), "%05zu.png", indexes[k]);
      detail::write_frame_png(cfg.out_dir / "frames" / name, *selected[k]);
    }
  }
  fprintf(stderr, "sim: wrote %s/{frames.json,player.html%s%s}\n", cfg.out_dir.string().c_str(),
          selected.empty() ? "" : ",sheet.png", cfg.png_frames ? ",frames/" : "");
  return 0;
}

} // namespace

int run(int argc, char **argv, const SceneProvider &provider)
{
  RunConfig cfg;
  if (!parse_args(argc, argv, cfg))
    return 0;
  std::vector<Scene> scenes = provider ? provider() : std::vector<Scene>();
  if (cfg.list)
  {
    for (const Scene &scene : scenes)
      printf("%s\n", scene.name.c_str());
    return 0;
  }
  std::vector<const Scene *> plan = resolve_scenes(cfg.selected, scenes);

  State &s = detail::state();
  reset();
  detail::build_strip_map();
  s.wall_start = std::chrono::steady_clock::now();
  if (s.opts.ws)
  {
    std::string error;
    if (!detail::ws_start(argv[0], s.opts.ws_port, s.opts.ws_origins, error))
    {
      fprintf(stderr, "sim: %s\n", error.c_str());
      return 1;
    }
  }
  if (s.opts.realtime)
    fputs("\x1b[2J", stdout);
  if (s.opts.ws)
  {
    std::string note = "WebSocket: ws://127.0.0.1:" + std::to_string(s.opts.ws_port);
    if (s.opts.live)
      s.live_log.push_back(note); // the live display owns the terminal
    else
      fprintf(stderr, "sim: %s\n", note.c_str());
  }

  std::string stop_reason = play(plan, cfg.loops);
  detail::ws_stop();
  detail::finish_frames();
  print_summary(stop_reason);
  return cfg.write_files ? write_outputs(cfg) : 0;
}

} // namespace sim
