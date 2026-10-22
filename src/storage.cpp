// SPDX-License-Identifier: GPL-3.0-or-later

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

namespace
{
fs::path host_path(const std::string &path)
{
  return fs::path(sim::data_dir()) / path.substr(path.find_first_not_of('/'));
}

// Host files that a Writer holds open. The board's file system needs a file
// closed before it is read or renamed, so the simulator refuses both.
// Built on first use and never destroyed, so a static Writer can still
// unregister itself at process exit.
std::vector<fs::path> &open_files()
{
  static auto *files = new std::vector<fs::path>;
  return *files;
}

bool is_open_for_writing(const fs::path &file)
{
  return std::find(open_files().begin(), open_files().end(), file) != open_files().end();
}
} // namespace

bool begin() { return true; }

std::vector<std::string> list(const std::string &folder)
{
  std::vector<std::string> names;
  std::error_code ec;
  fs::path dir = host_path(folder);
  for (const auto &entry : fs::directory_iterator(dir, ec))
    if (entry.is_regular_file())
      names.push_back(entry.path().filename().string());
  std::sort(names.begin(), names.end());
  return names;
}

namespace
{
size_t capacity_bytes = DEFAULT_CAPACITY;
} // namespace

bool exists(const std::string &path)
{
  std::error_code ec;
  return fs::is_regular_file(host_path(path), ec);
}

bool file_size(const std::string &path, size_t &size)
{
  std::error_code ec;
  fs::path file = host_path(path);
  if (!fs::is_regular_file(file, ec))
    return false;
  size = (size_t)fs::file_size(file, ec);
  return !ec;
}

bool remove(const std::string &path)
{
  std::error_code ec;
  fs::path file = host_path(path);
  if (!fs::exists(file, ec))
    return !ec;
  if (!fs::is_regular_file(file, ec))
    return false;
  fs::remove(file, ec);
  return !ec;
}

bool rename(const std::string &from, const std::string &to)
{
  fs::path target = host_path(to);
  if (is_open_for_writing(target) || is_open_for_writing(host_path(from)))
    return false;
  std::error_code ec;
  fs::create_directories(target.parent_path(), ec);
  fs::rename(host_path(from), target, ec);
  return !ec;
}

size_t total_bytes() { return capacity_bytes; }

size_t used_bytes()
{
  size_t used = 0;
  std::error_code ec;
  for (fs::recursive_directory_iterator it(sim::data_dir(), ec), end; !ec && it != end; it.increment(ec))
    if (it->is_regular_file(ec))
      used += (size_t)(it->file_size(ec) + BLOCK_SIZE - 1) / BLOCK_SIZE * BLOCK_SIZE;
  return used;
}

void set_capacity(size_t bytes) { capacity_bytes = bytes; }

namespace
{
bool fail_writes = false;
}

void set_fail_writes(bool fail) { fail_writes = fail; }

struct Writer::Impl
{
  std::ofstream out;
  fs::path file;
  ~Impl()
  {
    if (!out.is_open())
      return;
    open_files().erase(std::find(open_files().begin(), open_files().end(), file));
  }
};

size_t open_writers() { return open_files().size(); }

bool Writer::open(const std::string &path)
{
  close();
  fs::path file = host_path(path);
  std::error_code ec;
  fs::create_directories(file.parent_path(), ec);
  std::unique_ptr<Impl> impl(new Impl);
  impl->out.open(file, std::ios::binary | std::ios::trunc);
  if (!impl->out)
    return false;
  impl->file = file;
  open_files().push_back(file);
  impl_ = std::move(impl);
  return true;
}

bool Writer::write(const void *data, size_t size)
{
  if (!impl_ || fail_writes)
    return false;
  impl_->out.write(static_cast<const char *>(data), (std::streamsize)size);
  impl_->out.flush();
  return (bool)impl_->out;
}

void Writer::close() { impl_.reset(); }

struct Reader::Impl
{
  std::ifstream in;
};

ReadResult Reader::open(const std::string &path)
{
  impl_.reset(new Impl);
  size_ = 0;
  fs::path file = host_path(path);
  if (!exists(path))
    return ReadResult::Missing;
  if (is_open_for_writing(file) || !file_size(path, size_))
    return ReadResult::Unreadable;
  impl_->in.open(file, std::ios::binary);
  return impl_->in ? ReadResult::Ok : ReadResult::Unreadable;
}

size_t Reader::read_at(size_t offset, void *out, size_t length)
{
  if (!impl_ || offset >= size_)
    return 0;
  impl_->in.clear();
  impl_->in.seekg((std::streamoff)offset);
  impl_->in.read(static_cast<char *>(out), (std::streamsize)length);
  return (size_t)impl_->in.gcount();
}

} // namespace storage

#else

#include <LittleFS.h>
#include <sys/stat.h>

namespace storage
{

namespace
{
// Where LittleFS is mounted in the C library's file system.
constexpr const char *MOUNT_POINT = "/littlefs";

// Probes a path with stat(). LittleFS.exists, open and remove log an error
// for a file that is not there, so they are only called after a probe.
bool probe(const std::string &path, struct stat &info) { return ::stat((MOUNT_POINT + path).c_str(), &info) == 0; }

bool is_file(const std::string &path)
{
  struct stat info;
  return probe(path, info) && S_ISREG(info.st_mode);
}

bool is_folder(const std::string &path)
{
  struct stat info;
  return probe(path, info) && S_ISDIR(info.st_mode);
}

// Creates the folders above `path`: LittleFS does not on its own.
void make_parents(const std::string &path)
{
  for (size_t slash = path.find('/', 1); slash != std::string::npos; slash = path.find('/', slash + 1))
    LittleFS.mkdir(path.substr(0, slash).c_str());
}
} // namespace

bool begin() { return LittleFS.begin(true, MOUNT_POINT); }

// Lists names without opening the files, which costs one open per file.
std::vector<std::string> list(const std::string &folder)
{
  std::vector<std::string> names;
  if (!is_folder(folder))
    return names;
  File dir = LittleFS.open(folder.c_str());
  if (!dir || !dir.isDirectory())
    return names;
  bool is_directory = false;
  for (String path = dir.getNextFileName(&is_directory); path.length(); path = dir.getNextFileName(&is_directory))
    if (!is_directory)
      names.push_back(path.substring(path.lastIndexOf('/') + 1).c_str());
  std::sort(names.begin(), names.end());
  return names;
}

bool exists(const std::string &path) { return is_file(path); }

bool file_size(const std::string &path, size_t &size)
{
  struct stat info;
  if (!probe(path, info) || !S_ISREG(info.st_mode))
    return false;
  size = (size_t)info.st_size;
  return true;
}

bool remove(const std::string &path)
{
  struct stat info;
  if (!probe(path, info))
    return true;
  return S_ISREG(info.st_mode) && LittleFS.remove(path.c_str());
}

bool rename(const std::string &from, const std::string &to)
{
  make_parents(to);
  return LittleFS.rename(from.c_str(), to.c_str());
}

size_t total_bytes() { return LittleFS.totalBytes(); }

size_t used_bytes() { return LittleFS.usedBytes(); }

struct Writer::Impl
{
  File file;
};

bool Writer::open(const std::string &path)
{
  close();
  make_parents(path);
  std::unique_ptr<Impl> impl(new Impl);
  impl->file = LittleFS.open(path.c_str(), "w");
  if (!impl->file)
    return false;
  impl_ = std::move(impl);
  return true;
}

bool Writer::write(const void *data, size_t size)
{
  return impl_ && impl_->file.write(static_cast<const uint8_t *>(data), size) == size;
}

void Writer::close()
{
  if (impl_)
    impl_->file.close();
  impl_.reset();
}

struct Reader::Impl
{
  File file;
};

ReadResult Reader::open(const std::string &path)
{
  impl_.reset(new Impl);
  size_ = 0;
  struct stat info;
  if (!probe(path, info) || !S_ISREG(info.st_mode))
    return ReadResult::Missing;
  impl_->file = LittleFS.open(path.c_str(), "r");
  if (!impl_->file || impl_->file.isDirectory())
    return ReadResult::Unreadable;
  size_ = impl_->file.size();
  return ReadResult::Ok;
}

size_t Reader::read_at(size_t offset, void *out, size_t length)
{
  if (!impl_ || !impl_->file || offset >= size_)
    return 0;
  if (!impl_->file.seek(offset))
    return 0;
  return impl_->file.read(static_cast<uint8_t *>(out), length);
}

} // namespace storage

#endif

namespace storage
{

#ifdef PIXELART_SIM
namespace
{
ReadResult read_all_failure = ReadResult::Ok;
} // namespace

void set_read_all_failure(ReadResult result) { read_all_failure = result; }
#endif

ReadResult read(const std::string &path, Buffer &out, size_t max_size)
{
  Reader file;
  ReadResult opened = file.open(path);
  return opened == ReadResult::Ok ? file.read_all(out, max_size) : opened;
}

Writer::Writer() = default;
Writer::~Writer() = default;
Writer::Writer(Writer &&) noexcept = default;
Writer &Writer::operator=(Writer &&) noexcept = default;

Reader::Reader() = default;
Reader::~Reader() = default;

ReadResult Reader::read_all(Buffer &out, size_t max_size)
{
  if (size_ > max_size)
    return ReadResult::TooLarge;
#ifdef PIXELART_SIM
  if (read_all_failure == ReadResult::OutOfMemory)
    return ReadResult::OutOfMemory;
#endif
  // nothrow: on a fragmented heap the board reports the file instead of aborting
  out.data.reset(new (std::nothrow) char[size_ ? size_ : 1]);
  if (!out.data)
    return ReadResult::OutOfMemory;
  out.size = read_at(0, out.data.get(), size_);
#ifdef PIXELART_SIM
  if (read_all_failure == ReadResult::Unreadable)
    return ReadResult::Unreadable;
#endif
  return out.size == size_ ? ReadResult::Ok : ReadResult::Unreadable;
}

} // namespace storage
