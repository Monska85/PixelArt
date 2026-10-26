// SPDX-License-Identifier: GPL-3.0-or-later

// The simulator's side of the updates: a folder or a table of files stands in for the servers, and
// failures can be injected to test every error path. See include/updates.h.

#ifdef PIXELART_SIM

#include <pixel_codec.h>
#include <update_manifest.h>

#include <algorithm>
#include <filesystem>
#include <fstream>
#include <map>
#include <sstream>
#include <vector>

#include "network.h"
#include "storage.h"
#include "update_host.h"
#include "updates.h"

namespace updates
{

using pixelart_update::ByteBuffer;
using pixelart_update::Download;
using pixelart_update::Error;
using pixelart_update::Kind;

namespace
{

enum class Source
{
  Nothing,
  Folder,
  Files
};

struct Injection
{
  Failure failure;
  std::string path;
};

Source source = Source::Nothing;
std::string folder;
std::map<std::string, std::string> files;
std::vector<Injection> injections;
int local_time = -1;

// The path below the host, without a leading slash and without query. False for a path that could
// leave the folder.
bool path_of(const std::string &url, std::string &path)
{
  pixelart_update::Url parsed;
  if (!pixelart_update::parse_url(url, parsed))
    return false;
  path = parsed.path.substr(1);
  if (path.empty() || path.find("..") != std::string::npos || path.find('\\') != std::string::npos)
    return false;
  return true;
}

// Whether `path` is `pattern` or ends with it after a folder: injections name files the way the
// source folder does, without the folders of the URL.
bool names(const std::string &path, const std::string &pattern)
{
  return path == pattern ||
         (path.size() > pattern.size() && path.compare(path.size() - pattern.size(), pattern.size(), pattern) == 0 &&
          path[path.size() - pattern.size() - 1] == '/');
}

bool injected(Failure failure, const std::string &path)
{
  for (const Injection &i : injections)
    if (i.failure == failure && (i.path.empty() || failure == Failure::ServerDown || names(path, i.path)))
      return true;
  return false;
}

bool read_whole(const std::string &path, std::string &body)
{
  if (source == Source::Files)
  {
    auto it = files.find(path);
    if (it == files.end())
      return false;
    body = it->second;
    return true;
  }
  std::error_code ec;
  const std::filesystem::path file = std::filesystem::path(folder) / path;
  if (!std::filesystem::is_regular_file(file, ec))
    return false;
  std::ifstream in(file, std::ios::binary);
  std::stringstream ss;
  ss << in.rdbuf();
  body = ss.str();
  return (bool)in;
}

// The file of a URL path. A server publishes its files below a folder (`/PixelArt/manifest.json`),
// and the folder given to the simulator is that folder itself, so when the whole path is not there
// the folders of the path are dropped one by one from the front.
bool read_source(const std::string &path, std::string &body)
{
  for (size_t start = 0;;)
  {
    if (read_whole(path.substr(start), body))
      return true;
    start = path.find('/', start);
    if (start == std::string::npos)
      return false;
    start++;
  }
}

// What the server of `url` answers, or the error the request ends with. A file the source does not have is
// a 404, which a manifest request reports as ManifestNotFound.
Error serve(const std::string &url, bool allow_http, std::string &path, std::string &body, bool manifest = false)
{
  pixelart_update::Url parsed;
  if (injected(Failure::ServerDown, "") || source == Source::Nothing || !pixelart_update::parse_url(url, parsed) ||
      (!parsed.secure && !allow_http) || !path_of(url, path))
    return Error::NetworkError;
  if (injected(Failure::TlsError, path))
    return Error::TlsError;
  if (injected(Failure::HttpError, path))
    return Error::HttpError;
  if (!read_source(path, body))
    return manifest ? Error::ManifestNotFound : Error::HttpError;
  return Error::None;
}

class SimHost : public StorageHost
{
public:
  bool online() override
  {
    const network::Snapshot s = network::snapshot();
    return source != Source::Nothing && s.state == wifi_logic::State::Connected && s.has_ip;
  }

  void begin_large_work() override {}
  void end_large_work() override {}

  Error fetch_manifest(const std::string &url, bool allow_http, ByteBuffer &out) override
  {
    std::string path, body;
    if (Error e = serve(url, allow_http, path, body, true); e != Error::None)
      return e;
    switch (out.append(body.data(), body.size()))
    {
    case ByteBuffer::Append::Ok:
      return Error::None;
    case ByteBuffer::Append::TooLarge:
      return Error::BadManifest;
    case ByteBuffer::Append::OutOfMemory:
      break;
    }
    return Error::OutOfMemory;
  }

  Error download(const std::string &url, bool allow_http, size_t expected_size, Download &result) override
  {
    return fetch(url, allow_http, expected_size, result,
                 [](const std::string &body)
                 {
                   storage::Writer writer;
                   if (!writer.open(TEMP_FILE) || !writer.write(body.data(), body.size()))
                     return Error::StorageError;
                   writer.close();
                   return Error::None;
                 });
  }

  Error install(Kind kind, const std::string &id) override { return install_temp_file(kind, id); }

  Error download_firmware(const std::string &url, bool allow_http, size_t expected_size, Download &result) override
  {
    firmware::set_progress(0);
    const Error error =
        fetch(url, allow_http, expected_size, result,
              [expected_size](const std::string &body)
              {
                if (!firmware::begin_image(expected_size) || !firmware::write_image(body.data(), body.size()))
                  return Error::FlashError;
                return Error::None;
              });
    if (error == Error::None)
      firmware::set_progress(100);
    return error;
  }

  bool local_minutes(uint16_t &minutes) override
  {
    if (local_time < 0)
      return false;
    minutes = (uint16_t)local_time;
    return true;
  }

private:
  // Fetches the file, applies the injected corruption, cut and extra byte, checks the size against the manifest's,
  // and hands the bytes to `sink`, which writes them. A cut download is written and then fails.
  template <typename Sink>
  Error fetch(const std::string &url, bool allow_http, size_t expected_size, Download &result, Sink sink)
  {
    std::string path, body;
    if (Error e = serve(url, allow_http, path, body); e != Error::None)
      return e;
    if (injected(Failure::Corrupt, path) && !body.empty())
      body[0] = (char)(body[0] ^ 0x01);
    if (injected(Failure::TooLong, path))
      body += 'x';
    const bool cut = injected(Failure::Cut, path);
    if (cut)
      body.resize(body.size() / 2);
    if (body.size() > expected_size)
      return Error::ChecksumMismatch;
    if (Error e = sink(body); e != Error::None)
      return e;
    if (cut)
      return Error::NetworkError;
    pixelart::Sha256 hash;
    hash.update(body.data(), body.size());
    result.size = body.size();
    result.sha256 = hash.hex_digest();
    return Error::None;
  }
};

} // namespace

pixelart_update::Host &sim_host()
{
  static SimHost host;
  return host;
}

void sim_use_folder(const std::string &path)
{
  source = Source::Folder;
  folder = path;
}

void sim_use_files(const std::map<std::string, std::string> &table)
{
  source = Source::Files;
  files = table;
}

void sim_use_nothing() { source = Source::Nothing; }

bool sim_failure_from_name(const std::string &name, Failure &failure)
{
  static const struct
  {
    const char *name;
    Failure failure;
  } KINDS[] = {{"down", Failure::ServerDown}, {"tls", Failure::TlsError},    {"http", Failure::HttpError},
               {"cut", Failure::Cut},         {"corrupt", Failure::Corrupt}, {"too_long", Failure::TooLong}};
  for (const auto &k : KINDS)
    if (name == k.name)
    {
      failure = k.failure;
      return true;
    }
  return false;
}

void sim_inject(Failure failure, const std::string &path) { injections.push_back({failure, path}); }

void sim_clear_failures() { injections.clear(); }

void sim_set_local_minutes(int minutes) { local_time = minutes; }

void sim_reset()
{
  source = Source::Nothing;
  folder.clear();
  files.clear();
  injections.clear();
  local_time = -1;
}

} // namespace updates

#endif
