// SPDX-License-Identifier: GPL-3.0-or-later

#include "net_auth.h"

#include <pixel_codec.h>

namespace pixelart_net
{

bool is_hmac_text(const std::string &text)
{
  if (text.size() != HMAC_DIGITS)
    return false;
  for (char c : text)
    if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')))
      return false;
  return true;
}

std::string auth_hmac(const std::string &token, const std::string &nonce)
{
  return pixelart::hmac_sha256_hex(token.data(), token.size(), nonce.data(), nonce.size());
}

void AuthSession::reset()
{
  nonce_.clear();
  has_nonce_ = false;
  authenticated_ = false;
  failures_ = 0;
}

const std::string &AuthSession::challenge(const uint8_t random[NONCE_BYTES])
{
  static const char HEX[] = "0123456789abcdef";
  nonce_.clear();
  for (size_t i = 0; i < NONCE_BYTES; i++)
  {
    nonce_ += HEX[random[i] >> 4];
    nonce_ += HEX[random[i] & 15];
  }
  has_nonce_ = true;
  return nonce_;
}

AuthSession::Verdict AuthSession::attempt(const std::string &token, const std::string &hmac)
{
  bool accepted = false;
  if (has_nonce_ && is_hmac_text(hmac) && !token.empty())
  {
    const std::string expected = auth_hmac(token, nonce_);
    accepted = pixelart::constant_time_equal(expected.data(), hmac.data(), HMAC_DIGITS);
  }
  has_nonce_ = false;
  nonce_.clear();
  if (accepted)
  {
    authenticated_ = true;
    return Verdict::Accepted;
  }
  return ++failures_ >= MAX_AUTH_FAILURES ? Verdict::RefusedAndClose : Verdict::Refused;
}

} // namespace pixelart_net
