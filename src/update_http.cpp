// SPDX-License-Identifier: GPL-3.0-or-later

#ifndef PIXELART_SIM

#include "update_http.h"

#include <esp_crt_bundle.h>
#include <esp_http_client.h>
#include <esp_tls.h>
#include <mbedtls/x509.h>
#include <pixel_codec.h>
#include <update_manifest.h>

#include <algorithm>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <strings.h>

#include "firmware.h"
#include "platform.h"
#include "storage.h"
#include "task_sync.h"
#include "updates.h"

namespace updates
{

using pixelart_update::ByteBuffer;
using pixelart_update::Download;
using pixelart_update::Error;

namespace
{

// One socket operation. The network task holds the lock of the large allocations from the connection
// to the end of the body, so the connection and the manifest are kept short.
constexpr int TIMEOUT_MS = 5000;
constexpr int MAX_REDIRECTS = 3;
// Free heap a connection needs: a TLS connection takes up to about 70 KB (measured 67 KB on the
// ESP32-C3, and about 81 KB at worst over 31 downloads in a row), a plain one far less. Below this the
// board reports out_of_memory instead of starting.
constexpr size_t MIN_FREE_HTTPS = 80 * 1024;
constexpr size_t MIN_FREE_HTTP = 24 * 1024;
// Free heap left after the manifest buffer is reserved with a connection open.
constexpr size_t MIN_FREE_AFTER_RESERVE = 16 * 1024;
constexpr size_t LOCATION_MAX = 256;
// One flash block, so a block is written at once, right after a frame.
constexpr size_t FILE_BLOCK = 4096;
constexpr uint32_t MANIFEST_DEADLINE_MS = 15000;
// A download fails when no byte arrives for this long, or when it passes a total that grows with the
// size: the base plus the time at the slowest rate accepted. Writing to flash counts in the total only.
constexpr uint32_t DOWNLOAD_IDLE_MS = 30000;
constexpr uint32_t DOWNLOAD_BASE_MS = 30000;
constexpr uint32_t DOWNLOAD_MIN_RATE = 10 * 1024; // bytes per second
constexpr uint32_t WRITE_WAIT_MS = 2000;

struct Capture
{
  char location[LOCATION_MAX + 1] = "";
  bool too_long = false;
};

esp_err_t on_event(esp_http_client_event_t *event)
{
  if (event->event_id != HTTP_EVENT_ON_HEADER || !event->header_key || !event->header_value ||
      strcasecmp(event->header_key, "Location") != 0)
    return ESP_OK;
  Capture *capture = static_cast<Capture *>(event->user_data);
  const size_t length = strlen(event->header_value);
  if (length > LOCATION_MAX)
    capture->too_long = true;
  else
    memcpy(capture->location, event->header_value, length + 1);
  return ESP_OK;
}

bool is_redirect(int status)
{
  return status == 301 || status == 302 || status == 303 || status == 307 || status == 308;
}

// One response, with the redirects followed by hand so each hop is checked against the rules of the
// specification. The connection is closed by the destructor.
class Response
{
public:
  ~Response() { close(); }

  Error open(const std::string &first_url, bool allow_http)
  {
    std::string url = first_url;
    for (int followed = 0;; followed++)
    {
      pixelart_update::Url parsed;
      if (!pixelart_update::parse_url(url, parsed) || (!parsed.secure && !allow_http))
        return Error::NetworkError;
      if (platform::free_heap() < (parsed.secure ? MIN_FREE_HTTPS : MIN_FREE_HTTP))
        return Error::OutOfMemory;

      capture_ = Capture();
      const std::string agent = std::string("PixelArt/") + platform::firmware_version();
      esp_http_client_config_t config = {};
      config.url = url.c_str();
      config.user_agent = agent.c_str();
      config.timeout_ms = TIMEOUT_MS;
      config.disable_auto_redirect = true;
      config.buffer_size = 1536;
      config.buffer_size_tx = 1024;
      config.event_handler = on_event;
      config.user_data = &capture_;
      config.crt_bundle_attach = esp_crt_bundle_attach;
      client_ = esp_http_client_init(&config);
      if (!client_)
        return Error::OutOfMemory;
      const esp_err_t opened = esp_http_client_open(client_, 0);
      if (opened != ESP_OK)
        return open_error(opened);
      length_ = esp_http_client_fetch_headers(client_);
      if (length_ < 0)
        return Error::NetworkError;
      const int status = esp_http_client_get_status_code(client_);
      if (is_redirect(status))
      {
        std::string next;
        if (followed >= MAX_REDIRECTS || capture_.too_long ||
            !pixelart_update::resolve_redirect(url, capture_.location, allow_http, next))
          return Error::HttpError;
        close();
        url = next;
        continue;
      }
      status_ = status;
      return status == 200 ? Error::None : Error::HttpError;
    }
  }

  // The status of the last response, 0 before one arrived.
  int status() const { return status_; }

  // Content-Length, 0 when the server did not give one (chunked answers).
  int64_t length() const { return length_; }
  // Bytes read, 0 at the end of the body, negative on an error.
  int read(void *buffer, size_t size) { return esp_http_client_read(client_, static_cast<char *>(buffer), (int)size); }
  bool complete() const { return esp_http_client_is_complete_data_received(client_); }

private:
  void close()
  {
    if (!client_)
      return;
    esp_http_client_close(client_);
    esp_http_client_cleanup(client_);
    client_ = nullptr;
  }

  Error open_error(esp_err_t opened)
  {
    int tls_code = 0, tls_flags = 0;
    const esp_err_t tls = esp_http_client_get_and_clear_last_tls_error(client_, &tls_code, &tls_flags);
    if (tls_flags != 0 || tls_code == MBEDTLS_ERR_X509_CERT_VERIFY_FAILED ||
        tls == ESP_ERR_MBEDTLS_SSL_HANDSHAKE_FAILED)
      return Error::TlsError;
    return opened == ESP_ERR_NO_MEM ? Error::OutOfMemory : Error::NetworkError;
  }

  esp_http_client_handle_t client_ = nullptr;
  Capture capture_;
  int64_t length_ = 0;
  int status_ = 0;
};

uint32_t now_ms() { return (uint32_t)(platform::now_us() / 1000); }

// A read that found no data yet within the socket timeout: the caller decides how long to wait.
bool no_data_yet(int got) { return got == -ESP_ERR_HTTP_EAGAIN; }

uint32_t download_deadline_ms(size_t expected_size)
{
  const uint64_t body_ms = (uint64_t)expected_size * 1000 / DOWNLOAD_MIN_RATE;
  return (uint32_t)std::min<uint64_t>(DOWNLOAD_BASE_MS + body_ms, UINT32_MAX);
}

Error from_append(ByteBuffer::Append result)
{
  switch (result)
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

struct Block
{
  uint8_t *data = static_cast<uint8_t *>(malloc(FILE_BLOCK));
  ~Block() { free(data); }
};

} // namespace

Error http_fetch_manifest(const std::string &url, bool allow_http, ByteBuffer &out)
{
  Response response;
  if (Error e = response.open(url, allow_http); e != Error::None)
    return e == Error::HttpError && response.status() == 404 ? Error::ManifestNotFound : e;
  if (response.length() > (int64_t)pixelart_update::MAX_MANIFEST_SIZE)
    return Error::BadManifest;
  if (response.length() > 0)
  {
    // The connection is open: the buffer must not take what the TLS session still needs.
    if (platform::free_heap() < (size_t)response.length() + MIN_FREE_AFTER_RESERVE)
      return Error::OutOfMemory;
    if (Error e = from_append(out.reserve((size_t)response.length())); e != Error::None)
      return e;
  }
  const uint32_t start = now_ms();
  uint8_t chunk[512];
  for (;;)
  {
    const int got = response.read(chunk, sizeof(chunk));
    if ((got < 0 && !no_data_yet(got)) || now_ms() - start > MANIFEST_DEADLINE_MS)
      return Error::NetworkError;
    if (no_data_yet(got))
      continue;
    if (got == 0)
      break;
    if (Error e = from_append(out.append(chunk, (size_t)got)); e != Error::None)
      return e;
  }
  return response.complete() ? Error::None : Error::NetworkError;
}

namespace
{

// Where a download goes: a temporary file for animations and playlists, the inactive slot for a firmware.
class Sink
{
public:
  virtual ~Sink() = default;
  virtual bool write(const uint8_t *data, size_t size) = 0;
  // Called once the whole body arrived and is complete.
  virtual bool finish() = 0;
  virtual Error failure() const = 0;
  virtual void progress(size_t, size_t) {}
};

class FileSink : public Sink
{
public:
  bool write(const uint8_t *data, size_t size) override
  {
    return (writer_.is_open() || writer_.open(TEMP_FILE)) && writer_.write(data, size);
  }
  bool finish() override
  {
    writer_.close(); // the close commits the file to flash
    return true;
  }
  Error failure() const override { return Error::StorageError; }

private:
  storage::Writer writer_;
};

class FirmwareSink : public Sink
{
public:
  explicit FirmwareSink(size_t expected_size) : expected_(expected_size) { firmware::set_progress(0); }
  bool write(const uint8_t *data, size_t size) override
  {
    if (!opened_)
      opened_ = firmware::begin_image(expected_);
    return opened_ && firmware::write_image(data, size);
  }
  // The image is closed by the host once its SHA-256 was compared with the manifest's.
  bool finish() override { return true; }
  Error failure() const override { return Error::FlashError; }
  void progress(size_t written, size_t expected) override
  {
    firmware::set_progress(expected ? (uint8_t)(written * 100 / expected) : 0);
  }

private:
  size_t expected_;
  bool opened_ = false;
};

Error stream_body(Response &response, size_t expected_size, Download &result, Sink &sink)
{
  if (response.length() > (int64_t)expected_size)
    return Error::ChecksumMismatch;
  Block block;
  if (!block.data)
    return Error::OutOfMemory;

  pixelart::Sha256 hash;
  size_t total = 0;
  const uint32_t start = now_ms(), deadline = download_deadline_ms(expected_size);
  uint32_t last_data = start;
  // The last block and the closing of the file share one wait for a shown frame, so a small file waits once.
  bool finish_covered = false;
  for (bool end = false; !end;)
  {
    size_t filled = 0;
    while (filled < FILE_BLOCK)
    {
      const int got = response.read(block.data + filled, FILE_BLOCK - filled);
      const uint32_t now = now_ms();
      if ((got < 0 && !no_data_yet(got)) || now - start > deadline || now - last_data > DOWNLOAD_IDLE_MS)
        return Error::NetworkError;
      if (no_data_yet(got))
        continue;
      last_data = now;
      if (got == 0)
      {
        end = true;
        break;
      }
      filled += (size_t)got;
      total += (size_t)got;
      if (total > expected_size)
        return Error::ChecksumMismatch;
    }
    if (filled == 0)
      break;
    hash.update(block.data, filled);
    task_sync::wait_for_safe_write(WRITE_WAIT_MS);
    if (!sink.write(block.data, filled))
      return sink.failure();
    sink.progress(total, expected_size);
    last_data = now_ms(); // the flash wait is not the link's silence
    finish_covered = end;
  }
  if (!response.complete())
    return Error::NetworkError;
  if (!finish_covered)
    task_sync::wait_for_safe_write(WRITE_WAIT_MS);
  if (!sink.finish())
    return sink.failure();
  result.size = total;
  result.sha256 = hash.hex_digest();
  return Error::None;
}

} // namespace

Error http_download(const std::string &url, bool allow_http, size_t expected_size, Download &result)
{
  Response response;
  if (Error e = response.open(url, allow_http); e != Error::None)
    return e;
  FileSink sink;
  return stream_body(response, expected_size, result, sink);
}

Error http_download_firmware(const std::string &url, bool allow_http, size_t expected_size, Download &result)
{
  Response response;
  if (Error e = response.open(url, allow_http); e != Error::None)
    return e;
  FirmwareSink sink(expected_size);
  return stream_body(response, expected_size, result, sink);
}

} // namespace updates

#endif
