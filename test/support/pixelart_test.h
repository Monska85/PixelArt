// SPDX-License-Identifier: GPL-3.0-or-later

// Shared by the native test suites (test/test_*): a throwaway storage folder
// that undoes every simulator hook, file and color helpers, and the helpers to
// build protocol requests.
// Found through `-I$PROJECT_DIR/test/support` in [env:native_test].

#pragma once

#include <pixel_codec.h>
#include <sim.h>

#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <string>
#include <system_error>

#include "firmware.h"
#include "protocol.h"
#include "settings.h"
#include "storage.h"

namespace pixelart_test
{

namespace fs = std::filesystem;

// The board files built from animations/ and playlists/ by `make data`.
inline const std::string REPO_DATA = std::string(PIXELART_PROJECT_DIR) + "/data";

inline std::string read_file(const fs::path &path)
{
  std::ifstream in(path, std::ios::binary);
  std::stringstream ss;
  ss << in.rdbuf();
  return ss.str();
}

// Channels of a recorded LED color.
inline uint8_t red(uint32_t c) { return c >> 16; }
inline uint8_t green(uint32_t c) { return c >> 8; }
inline uint8_t blue(uint32_t c) { return c; }

// A throwaway storage folder for one test. The destructor puts back the
// simulator hooks a test may have changed, so the next test starts clean.
struct TempData
{
  fs::path root;

  explicit TempData(const std::string &prefix)
  {
    root = fs::temp_directory_path() / ("pixelart-" + prefix + "-" + std::to_string(std::rand()));
    fs::remove_all(root);
    fs::create_directories(root / "animations");
    fs::create_directories(root / "playlists");
    sim::set_data_dir(root.string());
    storage::set_capacity(storage::DEFAULT_CAPACITY);
    firmware::sim_reset();
  }
  ~TempData()
  {
    storage::set_capacity(storage::DEFAULT_CAPACITY);
    storage::set_fail_writes(false);
    storage::set_read_all_failure(storage::ReadResult::Ok);
    install::set_memory_probe(nullptr);
    settings::fail_brightness_saves(false);
    settings::fail_playlist_saves_after(-1);
    settings::fail_token_saves(false);
    std::error_code ignored; // a destructor must not throw
    fs::remove_all(root, ignored);
  }
  TempData(const TempData &) = delete;
  TempData &operator=(const TempData &) = delete;

  void write(const std::string &path, const std::string &bytes) const
  {
    fs::create_directories((root / path).parent_path());
    std::ofstream(root / path, std::ios::binary) << bytes;
  }
};

inline std::string sha256_hex(const std::string &bytes)
{
  pixelart::Sha256 hash;
  hash.update(bytes.data(), bytes.size());
  return hash.hex_digest();
}

// A dot at the corner that shows `frames` frames of `ms` milliseconds. A
// `brightness` above 0 is written as the animation's brightness percentage.
inline std::string dot_animation(const char *color, int frames = 1, int ms = 100, int brightness = 0)
{
  std::string timeline;
  for (int i = 0; i < frames; i++)
    timeline += std::string(i ? "," : "") + R"({"show":["d"]})";
  return std::string(R"({"format":"pixelart/1","name":"dot","canvas":{"width":16,"height":16},"frame_ms":)") +
         std::to_string(ms) + (brightness ? ",\"brightness\":" + std::to_string(brightness) : std::string()) +
         R"(,"sprites":{"d":{"points":{")" + color + R"(":[[0,0]]}}},"timeline":[)" + timeline + "]}";
}

// A 147 byte animation, the one the upload tests send.
inline const std::string DOT =
    R"({"format":"pixelart/1","name":"Dot","canvas":{"width":16,"height":16},"sprites":{"dot":{"points":[[7,7,"#ff0000"]]}},"timeline":[{"show":["dot"]}]})";

// `@PR <crc32> <json>`, without the newline.
inline std::string protocol_frame(const std::string &json)
{
  char head[16];
  snprintf(head, sizeof(head), "@PR %08x ", (unsigned)pixelart::crc32(json.data(), json.size()));
  return head + json;
}

// A framed request line with `seq` and the given JSON fields.
inline std::string request(unsigned seq, const std::string &fields)
{
  return protocol_frame("{\"seq\":" + std::to_string(seq) + "," + fields + "}") + "\n";
}

// put_begin of `bytes` as a file of `kind` and `id`.
inline std::string put_begin(unsigned seq, const char *kind, const char *id, const std::string &bytes)
{
  return request(seq, std::string(R"("cmd":"put_begin","kind":")") + kind + R"(","id":")" + id + R"(","size":)" +
                          std::to_string(bytes.size()) + R"(,"sha256":")" + sha256_hex(bytes) + "\"");
}

// put_chunk of `bytes` at offset 0.
inline std::string put_chunk(unsigned seq, const std::string &bytes)
{
  return request(seq, R"("cmd":"put_chunk","offset":0,"data":")" + pixelart::base64_encode(bytes.data(), bytes.size()) +
                          "\"");
}

} // namespace pixelart_test
