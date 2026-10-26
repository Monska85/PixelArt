// SPDX-License-Identifier: GPL-3.0-or-later

// Checksums and encoding used by the command protocol: CRC-32 (zlib), SHA-256,
// HMAC-SHA256 for the network login, standard base64 and the UTF-8 sequence rule. Plain C++ with no Arduino
// dependency, so the firmware, the simulator and the tests share one
// implementation.

#pragma once

#include <cstddef>
#include <cstdint>
#include <string>

namespace pixelart
{

// CRC-32/IEEE as in zlib, PNG and Ethernet. Start with `crc` 0 and pass the
// result back to continue over more data.
uint32_t crc32(const void *data, size_t size, uint32_t crc = 0);

// Incremental SHA-256 (FIPS 180-4).
class Sha256
{
public:
  Sha256();
  void update(const void *data, size_t size);
  static constexpr size_t DIGEST_SIZE = 32;
  // Finishes the hash into `out`. Neither digest call can be followed by update().
  void digest(uint8_t out[DIGEST_SIZE]);
  // Finishes the hash and returns it as 64 lowercase hexadecimal digits.
  std::string hex_digest();

private:
  void block(const uint8_t *chunk);

  uint32_t state_[8];
  uint8_t buffer_[64];
  uint64_t length_; // bytes hashed so far
  size_t buffered_;
};

// HMAC-SHA256 (RFC 2104) as 64 lowercase hexadecimal digits.
std::string hmac_sha256_hex(const void *key, size_t key_size, const void *message, size_t message_size);

// Compares `size` bytes of both buffers in time that does not depend on where they differ.
bool constant_time_equal(const void *a, const void *b, size_t size);

// Standard base64 (RFC 4648 section 4) with padding.
std::string base64_encode(const void *data, size_t size);

// Strict decoder: padding is required, and whitespace, other characters and
// non-zero padding bits are rejected. Returns false when `text` is not valid
// or decodes to more than `max_size` bytes; `out` is then empty.
bool base64_decode(const char *text, size_t length, size_t max_size, std::string &out);

// Length of the well-formed UTF-8 sequence (RFC 3629) that starts at
// `text[index]`, or 0 when there is none: a stray continuation byte, a
// truncated sequence, an overlong form, a surrogate or a value over U+10FFFF.
// `index` must be below `size`.
size_t utf8_sequence_length(const char *text, size_t size, size_t index);

// `size` bytes as valid UTF-8: every byte that does not belong to a well-formed sequence (see
// utf8_sequence_length) becomes U+FFFD, one replacement per byte. Valid text is returned unchanged.
std::string utf8_lossy(const char *text, size_t size);

} // namespace pixelart
