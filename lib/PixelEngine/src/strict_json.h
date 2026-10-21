// Strict JSON check run before ArduinoJson parses a file. ArduinoJson accepts
// more than RFC 8259 (comments, single quotes, unquoted keys, a leading +, and
// more), and the format requires strict JSON, so this scan rejects the rest.

#pragma once

#include <cstddef>
#include <string>

namespace pixelart
{

// Checks that `json` is one strict JSON value (RFC 8259) in valid UTF-8
// (RFC 3629) and nothing else: no byte order mark, no data after the value, no
// raw control character in a string, no invalid escape, and no U+0000 in a
// string, raw or written as \u0000. Containers may nest `max_depth` levels
// deep, at most 32. Runs in linear time and allocates nothing. On failure it
// returns false and sets `reason` and `offset` (the byte where it was found).
bool check_strict_json(const char *json, size_t length, int max_depth, const char *&reason, size_t &offset);

// The same check, with the message of a `structure` diagnostic as the result.
// Returns an empty string when the document is accepted.
std::string strict_json_error(const char *json, size_t length, int max_depth);

// Number of code points of a UTF-8 string: the bytes that are not continuation bytes.
size_t utf8_code_points(const char *text);

} // namespace pixelart
