// Shared by the native test suites (test/test_*): a throwaway storage folder
// that undoes every simulator hook, and the helpers to build protocol requests.
// Found through `-I$PROJECT_DIR/test/support` in [env:native_test].

#pragma once

#include <pixel_codec.h>
#include <sim.h>

#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <string>
#include <system_error>

#include "protocol.h"
#include "settings.h"
#include "storage.h"

namespace pixelart_test
{

namespace fs = std::filesystem;

// Size of the board's data partition, the simulator's default capacity.
constexpr size_t DEFAULT_CAPACITY = 1441792;

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
    storage::set_capacity(DEFAULT_CAPACITY);
  }
  ~TempData()
  {
    storage::set_capacity(DEFAULT_CAPACITY);
    storage::set_fail_writes(false);
    storage::set_read_all_failure(storage::ReadResult::Ok);
    protocol::set_memory_probe(nullptr);
    settings::fail_brightness_saves(false);
    settings::fail_playlist_saves_after(-1);
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

// A dot at the corner that shows `frames` frames of `ms` milliseconds.
inline std::string dot_animation(const char *color, int frames = 1, int ms = 100)
{
  std::string timeline;
  for (int i = 0; i < frames; i++)
    timeline += std::string(i ? "," : "") + R"({"show":["d"]})";
  return std::string(R"({"format":"pixelart/1","name":"dot","canvas":{"width":16,"height":16},"frame_ms":)") +
         std::to_string(ms) + R"(,"sprites":{"d":{"points":{")" + color + R"(":[[0,0]]}}},"timeline":[)" + timeline +
         "]}";
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

} // namespace pixelart_test
