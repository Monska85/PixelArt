// SPDX-License-Identifier: GPL-3.0-or-later

// Reading a release manifest the way a board does (docs/board/wifi-and-updates-v1.md#checks,
// docs/format/manifest-v1.md): strict, bounded, and with every path relative to the manifest's
// own URL. Also the "server wins" plan of docs/board/wifi-and-updates-v1.md#animation-updates.
// A manifest comes from a network server and is never trusted.

#pragma once

#include <cstddef>
#include <functional>
#include <string>
#include <vector>

namespace pixelart_update
{

constexpr size_t MAX_MANIFEST_SIZE = 64 * 1024;
constexpr size_t MAX_FILE_PATH = 160;
// Animations and playlists a manifest may list. The data partition holds fewer files than this.
constexpr size_t MAX_MANIFEST_FILES = 200;
constexpr const char *MANIFEST_FORMAT = "pixelart-manifest/1";

enum class Kind
{
  Animation,
  Playlist
};

// The largest file of a kind, as the protocol limits it.
size_t size_limit(Kind kind);

// One animation or playlist the manifest lists.
struct FileEntry
{
  std::string id;
  std::string file; // relative path, checked by is_safe_relative_path()
  size_t size = 0;
  std::string sha256; // 64 lowercase hexadecimal digits
};

// The `app` file of one board, the only firmware part a board installs over the network.
struct FirmwareEntry
{
  std::string board;
  std::string file;
  size_t size = 0;
  std::string sha256;
};

struct Manifest
{
  std::string version;
  std::vector<FileEntry> animations;
  std::vector<FileEntry> playlists;
  std::vector<FirmwareEntry> firmware; // entries with part `app`
};

// Reads a manifest. On failure, returns false and `reason` says why (short plain text, for logs).
// Refused: more than MAX_MANIFEST_SIZE bytes, text that is not strict JSON, a `format` other than
// MANIFEST_FORMAT, a missing or mistyped `version` (not a Semantic Version), `animations` or
// `playlists`, more than MAX_MANIFEST_FILES animations and playlists in all, an entry without a valid `id`, `file`,
// `size` of at least 1 or `sha256`, an ID listed twice in one kind, and a file path that is_safe_relative_path()
// refuses. A `firmware` list is optional and counts as absent when it is not a list; its entries need `board` and
// `part`, and an `app` entry the file fields as well. Other fields are ignored. A size over the limit of its kind is
// not refused here: that file fails on its own when it is installed.
bool parse_manifest(const char *json, size_t length, Manifest &out, std::string &reason);

// The memory a manifest may take while it is read. A board has little heap, and an allocation that
// fails inside a std::string or a std::vector stops the firmware, so the reader asks before it allocates.
struct ManifestMemory
{
  // Whether `total` bytes more, the largest of them in one block of `block` bytes, can be allocated
  // with room to spare. Empty: always.
  std::function<bool(size_t total, size_t block)> affordable;
  // Called once the input is no longer needed, when the parsed document holds its own copy of what it
  // keeps, so the input's memory can be freed before the lists are built. Empty: nothing is called.
  std::function<void()> release_input;
  // Set when the manifest was refused because `affordable` said no.
  bool out_of_memory = false;
};

// parse_manifest() within `memory`: the parsed document and the lists of the manifest are allocated
// only as far as `memory.affordable` allows, and a manifest that does not fit is refused with
// `memory.out_of_memory` set.
bool parse_manifest(const char *json, size_t length, Manifest &out, std::string &reason, ManifestMemory &memory);

// Whether a manifest path is acceptable: not empty, at most MAX_FILE_PATH characters of
// [A-Za-z0-9._-] and `/` between non-empty parts, none of which is `.` or `..`. A leading `/`
// (absolute path or another host), a scheme, a backslash, `%`, `?` and `#` are all refused, so the
// path can only name a file below the folder of the manifest.
bool is_safe_relative_path(const std::string &path);

// Splits an http or https URL: `https://[user@]host[:port]/path`. The authority is not empty and
// does not end with `@`, and the URL holds no space or non-ASCII character. The path starts with `/` ("/" when the URL
// has none) and keeps no query or fragment.
struct Url
{
  bool secure = false;
  std::string authority; // host and port
  std::string path;
};
bool parse_url(const std::string &text, Url &out);

// The URL of a file listed in the manifest at `manifest_url`: the folder of the manifest, then
// `relative`. False when the manifest URL is not an http or https URL or the path is not safe.
bool resolve_file_url(const std::string &manifest_url, const std::string &relative, std::string &out);

// Where a redirect from `current_url` leads: `location` is an absolute URL, a URL without scheme
// (`//host/path`), an absolute path or a path relative to the folder of `current_url`. False when
// the target is not an http or https URL, is `http://` and `allow_http` is false, or would leave
// https for http.
bool resolve_redirect(const std::string &current_url, const std::string &location, bool allow_http, std::string &next);

// What the board has to do for one file.
struct PlanItem
{
  Kind kind = Kind::Animation;
  std::string id;
  std::string file;
  size_t size = 0;
  std::string sha256;
  bool replace = false; // true: a stored file with another SHA-256 is replaced; false: a new file
};

// Finds the SHA-256 of a stored file: true and the digest when the file is stored, false when not.
using StoredDigest = std::function<bool(Kind kind, const std::string &id, std::string &sha256)>;

// The sync plan, server wins: every animation of the manifest and then every playlist that is not
// stored (add) or is stored with another SHA-256 (replace). A stored file with the same SHA-256 and
// every stored file the manifest does not list are left out.
std::vector<PlanItem> plan_sync(const Manifest &manifest, const StoredDigest &stored);
// The same, moving the strings of the planned entries out of the manifest's lists of files instead of
// copying them, so the plan takes no more memory than its own vector. The version and the firmware stay.
std::vector<PlanItem> plan_sync(Manifest &manifest, const StoredDigest &stored);
// The size of the one block a plan of `manifest` takes at most: every animation and playlist planned.
size_t plan_block(const Manifest &manifest);

// The `app` entry of `board`, or nullptr.
const FirmwareEntry *find_firmware(const Manifest &manifest, const std::string &board);

// Whether the manifest holds a firmware for `board` that is newer than `running` by Semantic
// Versioning precedence and is not `skipped` (empty: nothing is skipped). `force` ignores the skip.
// A lower or equal version is never newer.
bool firmware_available(const Manifest &manifest, const std::string &board, const std::string &running,
                        const std::string &skipped, bool force);

} // namespace pixelart_update
