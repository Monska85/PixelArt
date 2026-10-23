// SPDX-License-Identifier: GPL-3.0-or-later

// The network login of a WiFi connection (docs/protocol/protocol-v1.md#authentication): a nonce
// the board hands out, and the HMAC-SHA256 of it under the token that the client must answer with.
// Plain C++: the nonce comes from the caller, so the rules have native tests.

#pragma once

#include <cstddef>
#include <cstdint>
#include <string>

namespace pixelart_net
{

constexpr size_t NONCE_BYTES = 16;
constexpr size_t NONCE_DIGITS = NONCE_BYTES * 2;
constexpr size_t HMAC_DIGITS = 64;
constexpr int MAX_AUTH_FAILURES = 3;

// 64 lowercase hexadecimal digits, the form of `hmac` in an `auth` request.
bool is_hmac_text(const std::string &text);

// What a client has to send for `nonce` (32 hex digits) when the token is `token`.
std::string auth_hmac(const std::string &token, const std::string &nonce);

// The login state of one connection.
class AuthSession
{
public:
  enum class Verdict : uint8_t
  {
    Accepted,
    Refused,
    RefusedAndClose // refused, and it was the last failure allowed: close the connection
  };

  // Forgets everything: a new connection.
  void reset();

  // Makes a nonce from 16 random bytes, replacing any waiting one, and returns it as 32 lowercase
  // hexadecimal digits.
  const std::string &challenge(const uint8_t random[NONCE_BYTES]);

  // Checks `hmac` (64 lowercase hex digits, see is_hmac_text) against the waiting nonce and the token.
  // The nonce serves this one attempt, right or wrong.
  Verdict attempt(const std::string &token, const std::string &hmac);

  bool authenticated() const { return authenticated_; }

private:
  std::string nonce_;
  bool has_nonce_ = false;
  bool authenticated_ = false;
  int failures_ = 0;
};

} // namespace pixelart_net
