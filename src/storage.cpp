// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

#include "storage.h"

#include <algorithm>
#include <new>

#ifdef PIXELART_SIM

#include <sim.h>

#include <filesystem>
#include <fstream>

namespace fs = std::filesystem;

namespace storage
{

bool begin() { return true; }

ReadResult read(const std::string &path, Buffer &out, size_t max_size)
{
  fs::path file = fs::path(sim::data_dir()) / path.substr(path.find_first_not_of('/'));
  std::error_code ec;
  if (!fs::is_regular_file(file, ec))
    return ReadResult::Missing;
  size_t size = (size_t)fs::file_size(file, ec);
  if (ec)
    return ReadResult::Unreadable;
  if (size > max_size)
    return ReadResult::TooLarge;
  out.data.reset(new (std::nothrow) char[size ? size : 1]);
  if (!out.data)
    return ReadResult::OutOfMemory;
  std::ifstream in(file, std::ios::binary);
  in.read(out.data.get(), (std::streamsize)size);
  out.size = (size_t)in.gcount();
  return out.size == size ? ReadResult::Ok : ReadResult::Unreadable;
}

std::vector<std::string> list(const std::string &folder)
{
  std::vector<std::string> names;
  std::error_code ec;
  fs::path dir = fs::path(sim::data_dir()) / folder.substr(folder.find_first_not_of('/'));
  for (const auto &entry : fs::directory_iterator(dir, ec))
    if (entry.is_regular_file())
      names.push_back(entry.path().filename().string());
  std::sort(names.begin(), names.end());
  return names;
}

} // namespace storage

#else

#include <LittleFS.h>

namespace storage
{

bool begin() { return LittleFS.begin(true); }

ReadResult read(const std::string &path, Buffer &out, size_t max_size)
{
  if (!LittleFS.exists(path.c_str()))
    return ReadResult::Missing;
  File file = LittleFS.open(path.c_str(), "r");
  if (!file || file.isDirectory())
    return ReadResult::Unreadable;
  size_t size = file.size();
  if (size > max_size)
    return ReadResult::TooLarge;
  // nothrow: on a fragmented heap the board reports the file instead of aborting
  out.data.reset(new (std::nothrow) char[size ? size : 1]);
  if (!out.data)
    return ReadResult::OutOfMemory;
  out.size = file.read(reinterpret_cast<uint8_t *>(out.data.get()), size);
  return out.size == size ? ReadResult::Ok : ReadResult::Unreadable;
}

std::vector<std::string> list(const std::string &folder)
{
  std::vector<std::string> names;
  File dir = LittleFS.open(folder.c_str());
  if (!dir || !dir.isDirectory())
    return names;
  for (File file = dir.openNextFile(); file; file = dir.openNextFile())
    if (!file.isDirectory())
      names.push_back(file.name());
  std::sort(names.begin(), names.end());
  return names;
}

} // namespace storage

#endif
