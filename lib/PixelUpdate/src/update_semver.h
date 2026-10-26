// SPDX-License-Identifier: GPL-3.0-or-later

// Semantic Versioning 2.0.0 precedence, for the firmware updates: a release is an
// update for a development build of the same number
// (docs/board/wifi-and-updates-v1.md#firmware-updates).

#pragma once

#include <string>
#include <vector>

namespace pixelart_update
{

struct Version
{
  unsigned long long major = 0, minor = 0, patch = 0;
  std::vector<std::string> pre_release; // identifiers after '-', empty for a release
};

// Parses MAJOR.MINOR.PATCH[-PRE][+BUILD]. Numbers have no leading zeros, identifiers hold only
// [0-9A-Za-z-] and are not empty, and a numeric pre-release identifier has no leading zero. The
// build part is checked and dropped. Returns false for anything else.
bool parse_version(const std::string &text, Version &out);

// Precedence of SemVer 2.0.0 section 11: -1, 0 or 1. Build metadata does not count.
int compare_versions(const Version &a, const Version &b);

// Whether `candidate` is higher than `running` by precedence. False when either one does not parse.
bool is_newer_version(const std::string &candidate, const std::string &running);

} // namespace pixelart_update
