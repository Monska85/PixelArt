// SPDX-License-Identifier: GPL-3.0-or-later

#include "pixel_codec.h"

#include <cstring>

namespace pixelart
{

namespace
{

const uint32_t SHA256_K[64] = {
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2};

inline uint32_t rotr(uint32_t x, unsigned n) { return (x >> n) | (x << (32 - n)); }

const char BASE64_ALPHABET[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

int base64_value(char c)
{
  if (c >= 'A' && c <= 'Z')
    return c - 'A';
  if (c >= 'a' && c <= 'z')
    return c - 'a' + 26;
  if (c >= '0' && c <= '9')
    return c - '0' + 52;
  if (c == '+')
    return 62;
  if (c == '/')
    return 63;
  return -1;
}

} // namespace

uint32_t crc32(const void *data, size_t size, uint32_t crc)
{
  static uint32_t table[256];
  static bool ready = false;
  if (!ready)
  {
    for (uint32_t i = 0; i < 256; i++)
    {
      uint32_t c = i;
      for (int k = 0; k < 8; k++)
        c = (c & 1) ? 0xEDB88320u ^ (c >> 1) : c >> 1;
      table[i] = c;
    }
    ready = true;
  }
  const uint8_t *p = static_cast<const uint8_t *>(data);
  crc = ~crc;
  while (size--)
    crc = table[(crc ^ *p++) & 0xff] ^ (crc >> 8);
  return ~crc;
}

Sha256::Sha256()
{
  static const uint32_t initial[8] = {0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
                                      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19};
  memcpy(state_, initial, sizeof(state_));
  length_ = 0;
  buffered_ = 0;
}

void Sha256::block(const uint8_t *chunk)
{
  uint32_t w[64];
  for (int i = 0; i < 16; i++)
    w[i] = (uint32_t)chunk[i * 4] << 24 | (uint32_t)chunk[i * 4 + 1] << 16 | (uint32_t)chunk[i * 4 + 2] << 8 |
           chunk[i * 4 + 3];
  for (int i = 16; i < 64; i++)
  {
    uint32_t s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >> 3);
    uint32_t s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >> 10);
    w[i] = w[i - 16] + s0 + w[i - 7] + s1;
  }
  uint32_t a = state_[0], b = state_[1], c = state_[2], d = state_[3];
  uint32_t e = state_[4], f = state_[5], g = state_[6], h = state_[7];
  for (int i = 0; i < 64; i++)
  {
    uint32_t t1 = h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + SHA256_K[i] + w[i];
    uint32_t t2 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c));
    h = g;
    g = f;
    f = e;
    e = d + t1;
    d = c;
    c = b;
    b = a;
    a = t1 + t2;
  }
  state_[0] += a;
  state_[1] += b;
  state_[2] += c;
  state_[3] += d;
  state_[4] += e;
  state_[5] += f;
  state_[6] += g;
  state_[7] += h;
}

void Sha256::update(const void *data, size_t size)
{
  const uint8_t *p = static_cast<const uint8_t *>(data);
  length_ += size;
  while (size)
  {
    size_t take = 64 - buffered_;
    if (take > size)
      take = size;
    memcpy(buffer_ + buffered_, p, take);
    buffered_ += take;
    p += take;
    size -= take;
    if (buffered_ == 64)
    {
      block(buffer_);
      buffered_ = 0;
    }
  }
}

void Sha256::digest(uint8_t out[DIGEST_SIZE])
{
  uint64_t bits = length_ * 8;
  const uint8_t pad = 0x80;
  update(&pad, 1);
  const uint8_t zero = 0;
  while (buffered_ != 56)
    update(&zero, 1);
  uint8_t tail[8];
  for (int i = 0; i < 8; i++)
    tail[i] = (uint8_t)(bits >> (56 - 8 * i));
  update(tail, 8);

  for (int i = 0; i < 8; i++)
    for (int b = 0; b < 4; b++)
      out[i * 4 + b] = (uint8_t)(state_[i] >> (24 - 8 * b));
}

namespace
{

std::string to_hex(const uint8_t *bytes, size_t size)
{
  static const char hex[] = "0123456789abcdef";
  std::string out;
  out.reserve(size * 2);
  for (size_t i = 0; i < size; i++)
  {
    out += hex[bytes[i] >> 4];
    out += hex[bytes[i] & 15];
  }
  return out;
}

} // namespace

std::string Sha256::hex_digest()
{
  uint8_t bytes[DIGEST_SIZE];
  digest(bytes);
  return to_hex(bytes, DIGEST_SIZE);
}

std::string hmac_sha256_hex(const void *key, size_t key_size, const void *message, size_t message_size)
{
  constexpr size_t BLOCK = 64;
  uint8_t block[BLOCK] = {};
  if (key_size > BLOCK)
  {
    Sha256 hashed_key;
    hashed_key.update(key, key_size);
    hashed_key.digest(block);
  }
  else if (key_size > 0)
    memcpy(block, key, key_size);

  uint8_t pad[BLOCK];
  for (size_t i = 0; i < BLOCK; i++)
    pad[i] = block[i] ^ 0x36;
  Sha256 inner;
  inner.update(pad, BLOCK);
  inner.update(message, message_size);
  uint8_t inner_digest[Sha256::DIGEST_SIZE];
  inner.digest(inner_digest);

  for (size_t i = 0; i < BLOCK; i++)
    pad[i] = block[i] ^ 0x5c;
  Sha256 outer;
  outer.update(pad, BLOCK);
  outer.update(inner_digest, sizeof(inner_digest));
  uint8_t mac[Sha256::DIGEST_SIZE];
  outer.digest(mac);
  return to_hex(mac, sizeof(mac));
}

bool constant_time_equal(const void *a, const void *b, size_t size)
{
  const volatile uint8_t *x = static_cast<const volatile uint8_t *>(a);
  const volatile uint8_t *y = static_cast<const volatile uint8_t *>(b);
  uint8_t difference = 0;
  for (size_t i = 0; i < size; i++)
    difference |= (uint8_t)(x[i] ^ y[i]);
  return difference == 0;
}

std::string base64_encode(const void *data, size_t size)
{
  const uint8_t *p = static_cast<const uint8_t *>(data);
  std::string out;
  out.reserve((size + 2) / 3 * 4);
  for (size_t i = 0; i < size; i += 3)
  {
    uint32_t chunk = (uint32_t)p[i] << 16;
    if (i + 1 < size)
      chunk |= (uint32_t)p[i + 1] << 8;
    if (i + 2 < size)
      chunk |= p[i + 2];
    out += BASE64_ALPHABET[(chunk >> 18) & 63];
    out += BASE64_ALPHABET[(chunk >> 12) & 63];
    out += i + 1 < size ? BASE64_ALPHABET[(chunk >> 6) & 63] : '=';
    out += i + 2 < size ? BASE64_ALPHABET[chunk & 63] : '=';
  }
  return out;
}

bool base64_decode(const char *text, size_t length, size_t max_size, std::string &out)
{
  out.clear();
  auto fail = [&out]()
  {
    out.clear();
    return false;
  };
  if (length % 4 != 0 || length / 4 * 3 > max_size + 2)
    return fail();
  for (size_t i = 0; i < length; i += 4)
  {
    bool last = i + 4 == length;
    int v[4];
    int pad = 0;
    for (int k = 0; k < 4; k++)
    {
      char c = text[i + k];
      if (c == '=')
      {
        // Padding only ends the text: "xx==" or "xxx=".
        if (!last || k < 2)
          return fail();
        pad++;
        v[k] = 0;
      }
      else if (pad || (v[k] = base64_value(c)) < 0)
        return fail();
    }
    uint32_t chunk = (uint32_t)v[0] << 18 | (uint32_t)v[1] << 12 | (uint32_t)v[2] << 6 | (uint32_t)v[3];
    // Bits under the padding must be zero, so each text has one encoding.
    if ((pad == 2 && (chunk & 0xffff)) || (pad == 1 && (chunk & 0xff)))
      return fail();
    out += (char)(chunk >> 16);
    if (pad < 2)
      out += (char)(chunk >> 8);
    if (pad < 1)
      out += (char)chunk;
    if (out.size() > max_size)
      return fail();
  }
  return true;
}

size_t utf8_sequence_length(const char *text, size_t size, size_t index)
{
  const unsigned char lead = (unsigned char)text[index];
  if (lead < 0x80)
    return 1;
  size_t length;
  unsigned char low = 0x80, high = 0xBF; // range of the second byte
  if (lead >= 0xC2 && lead <= 0xDF)
    length = 2;
  else if (lead >= 0xE0 && lead <= 0xEF)
  {
    length = 3;
    if (lead == 0xE0)
      low = 0xA0;
    else if (lead == 0xED)
      high = 0x9F;
  }
  else if (lead >= 0xF0 && lead <= 0xF4)
  {
    length = 4;
    if (lead == 0xF0)
      low = 0x90;
    else if (lead == 0xF4)
      high = 0x8F;
  }
  else
    return 0;
  if (index + length > size)
    return 0;
  const unsigned char second = (unsigned char)text[index + 1];
  if (second < low || second > high)
    return 0;
  for (size_t k = 2; k < length; k++)
    if (((unsigned char)text[index + k] & 0xC0) != 0x80)
      return 0;
  return length;
}

std::string utf8_lossy(const char *text, size_t size)
{
  std::string out;
  out.reserve(size);
  for (size_t i = 0; i < size;)
  {
    const size_t length = utf8_sequence_length(text, size, i);
    if (length == 0)
    {
      out += "\xEF\xBF\xBD";
      i++;
    }
    else
    {
      out.append(text + i, length);
      i += length;
    }
  }
  return out;
}

} // namespace pixelart
