// SPDX-License-Identifier: GPL-3.0-or-later

// The board's HTTP client for the updates: esp_http_client with the certificate bundle of certs/,
// run by the network task. Not built for the simulator, which reads a folder instead.

#pragma once

#ifndef PIXELART_SIM

#include <updater.h>

#include <string>

namespace updates
{

// Reads the manifest at `url` into `out`. Follows at most 3 redirects and never from https to
// http; `http://` URLs only when `allow_http`. A manifest over its limit is `bad_manifest`.
pixelart_update::Error http_fetch_manifest(const std::string &url, bool allow_http, pixelart_update::ByteBuffer &out);

// Downloads the file at `url` to the temporary file, stopping when the body passes
// `expected_size`. Every write to flash follows a frame that was just shown.
pixelart_update::Error http_download(const std::string &url, bool allow_http, size_t expected_size,
                                     pixelart_update::Download &result);

// Streams the firmware at `url` into the inactive slot (HTTPS only unless `allow_http`, which only a test
// build sets), stopping when the body passes
// `expected_size`, and reports the progress as it goes. The image stays open for the host to close.
pixelart_update::Error http_download_firmware(const std::string &url, bool allow_http, size_t expected_size,
                                              pixelart_update::Download &result);

} // namespace updates

#endif
