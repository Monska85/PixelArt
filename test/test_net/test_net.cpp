// SPDX-License-Identifier: GPL-3.0-or-later

// The decisions of the protocol over WiFi: the origin check, the WebSocket message rules and the
// network login (docs/board/wifi-and-updates-v1.md#protocol-over-wifi). Every expected value is
// worked out by hand from the specification; the HMAC values come from Python's hmac module, or from
// RFC 4231. Run with: pio test -e native_test (or make test)

#include <net_auth.h>
#include <net_handshake.h>
#include <net_holder.h>
#include <net_origin.h>
#include <net_page.h>
#include <net_watch.h>
#include <net_ws.h>
#include <pixel_codec.h>
#include <unity.h>

#include <algorithm>
#include <cstring>
#include <string>
#include <vector>

using pixelart_net::AuthSession;
using pixelart_net::ConnectionWatch;
using pixelart_net::FrameKind;
using pixelart_net::HeadScanner;
using pixelart_net::HolderCheck;
using pixelart_net::MessageAssembler;
using Result = MessageAssembler::Result;

void setUp() {}
void tearDown() {}

// ---- Silent connections ----

static size_t watch_check_generation(ConnectionWatch &w, std::vector<int> open, int slot, uint32_t generation,
                                     bool pending, uint32_t now, std::vector<int> &out)
{
  int expired[16];
  const size_t n = w.check(open.data(), open.size(), slot, generation, pending, now, expired, 16);
  out.assign(expired, expired + n);
  return n;
}

static size_t watch_check(ConnectionWatch &w, std::vector<int> open, int slot, bool pending, uint32_t now,
                          std::vector<int> &out)
{
  return watch_check_generation(w, open, slot, 0, pending, now, out);
}

static void test_a_socket_without_a_handshake_is_closed_after_10_seconds()
{
  ConnectionWatch w;
  std::vector<int> out;
  TEST_ASSERT_EQUAL(0, watch_check(w, {7}, -1, false, 1000, out));
  TEST_ASSERT_EQUAL(0, watch_check(w, {7}, -1, false, 10999, out));
  TEST_ASSERT_EQUAL(1, watch_check(w, {7}, -1, false, 11000, out));
  TEST_ASSERT_EQUAL(7, out[0]);
}

static void test_a_socket_that_left_is_forgotten()
{
  ConnectionWatch w;
  std::vector<int> out;
  watch_check(w, {7}, -1, false, 0, out);
  watch_check(w, {}, -1, false, 5000, out);
  // The same number again is a new connection with its own 10 seconds.
  TEST_ASSERT_EQUAL(0, watch_check(w, {7}, -1, false, 12000, out));
  TEST_ASSERT_EQUAL(0, watch_check(w, {7}, -1, false, 21999, out));
  TEST_ASSERT_EQUAL(1, watch_check(w, {7}, -1, false, 22000, out));
}

static void test_the_slot_is_not_a_handshake_timeout()
{
  ConnectionWatch w;
  std::vector<int> out;
  watch_check(w, {7, 8}, -1, false, 0, out);
  TEST_ASSERT_EQUAL(1, watch_check(w, {7, 8}, 8, false, 20000, out));
  TEST_ASSERT_EQUAL(7, out[0]);
}

static void test_each_socket_has_its_own_clock()
{
  ConnectionWatch w;
  std::vector<int> out;
  watch_check(w, {7}, -1, false, 0, out);
  watch_check(w, {7, 8}, -1, false, 6000, out);
  TEST_ASSERT_EQUAL(1, watch_check(w, {7, 8}, -1, false, 10000, out));
  TEST_ASSERT_EQUAL(7, out[0]);
  TEST_ASSERT_EQUAL(1, watch_check(w, {8}, -1, false, 16000, out));
  TEST_ASSERT_EQUAL(8, out[0]);
}

static void test_the_clock_wrapping_does_not_matter()
{
  ConnectionWatch w;
  std::vector<int> out;
  watch_check(w, {7}, -1, false, 0xFFFFFF00u, out);
  TEST_ASSERT_EQUAL(0, watch_check(w, {7}, -1, false, 5000, out));
  TEST_ASSERT_EQUAL(1, watch_check(w, {7}, -1, false, 10000, out));
}

static void test_a_slot_that_does_not_log_in_is_closed_after_30_seconds()
{
  ConnectionWatch w;
  std::vector<int> out;
  TEST_ASSERT_EQUAL(0, watch_check(w, {7}, 7, true, 0, out));
  TEST_ASSERT_EQUAL(0, watch_check(w, {7}, 7, true, 29999, out));
  TEST_ASSERT_EQUAL(1, watch_check(w, {7}, 7, true, 30000, out));
  TEST_ASSERT_EQUAL(7, out[0]);
}

static void test_a_login_resets_the_wait()
{
  ConnectionWatch w;
  std::vector<int> out;
  watch_check(w, {7}, 7, true, 0, out);
  TEST_ASSERT_EQUAL(0, watch_check(w, {7}, 7, false, 20000, out)); // logged in
  TEST_ASSERT_EQUAL(0, watch_check(w, {7}, 7, false, 3600000, out));
  // The login is asked for again (the setting went off and on): a new 30 seconds.
  TEST_ASSERT_EQUAL(0, watch_check(w, {7}, 7, true, 3601000, out));
  TEST_ASSERT_EQUAL(0, watch_check(w, {7}, 7, true, 3630999, out));
  TEST_ASSERT_EQUAL(1, watch_check(w, {7}, 7, true, 3631000, out));
}

static void test_without_the_login_the_slot_may_stay_idle()
{
  ConnectionWatch w;
  std::vector<int> out;
  watch_check(w, {7}, 7, false, 0, out);
  TEST_ASSERT_EQUAL(0, watch_check(w, {7}, 7, false, 86400000, out));
}

static void test_a_new_client_in_the_slot_gets_its_own_30_seconds()
{
  ConnectionWatch w;
  std::vector<int> out;
  watch_check(w, {7}, 7, true, 0, out);
  watch_check(w, {8}, 8, true, 20000, out);
  TEST_ASSERT_EQUAL(0, watch_check(w, {8}, 8, true, 40000, out));
  TEST_ASSERT_EQUAL(1, watch_check(w, {8}, 8, true, 50000, out));
  TEST_ASSERT_EQUAL(8, out[0]);
}

static void test_a_reused_slot_number_gets_a_new_login_wait()
{
  ConnectionWatch w;
  std::vector<int> out;
  watch_check(w, {7}, 7, true, 0, out);
  watch_check(w, {}, 7, true, 10000, out);  // the client left
  watch_check(w, {7}, 7, true, 20000, out); // the number came back as another client
  TEST_ASSERT_EQUAL(0, watch_check(w, {7}, 7, true, 49999, out));
  TEST_ASSERT_EQUAL(1, watch_check(w, {7}, 7, true, 50000, out));
}

static void test_the_same_socket_number_for_a_new_client_starts_the_wait_again()
{
  ConnectionWatch w;
  std::vector<int> out;
  // The reaper never saw the slot empty between the two clients: only the generation tells them apart.
  watch_check_generation(w, {7}, 7, 1, true, 0, out);
  TEST_ASSERT_EQUAL(0, watch_check_generation(w, {7}, 7, 1, true, 25000, out));
  TEST_ASSERT_EQUAL(0, watch_check_generation(w, {7}, 7, 2, true, 29000, out));
  TEST_ASSERT_EQUAL(0, watch_check_generation(w, {7}, 7, 2, true, 58999, out));
  TEST_ASSERT_EQUAL(1, watch_check_generation(w, {7}, 7, 2, true, 59000, out));
  TEST_ASSERT_EQUAL(7, out[0]);
}

static void test_the_same_generation_keeps_the_wait_running()
{
  ConnectionWatch w;
  std::vector<int> out;
  watch_check_generation(w, {7}, 7, 5, true, 0, out);
  TEST_ASSERT_EQUAL(0, watch_check_generation(w, {7}, 7, 5, true, 29999, out));
  TEST_ASSERT_EQUAL(1, watch_check_generation(w, {7}, 7, 5, true, 30000, out));
}

static void test_no_slot_means_no_login_wait()
{
  ConnectionWatch w;
  std::vector<int> out;
  watch_check(w, {}, -1, true, 0, out);
  TEST_ASSERT_EQUAL(0, watch_check(w, {}, -1, true, 100000, out));
}

// ---- Holder of the slot ----

using Action = HolderCheck::Action;

static void test_the_first_refusal_pings_the_holder()
{
  HolderCheck c;
  TEST_ASSERT_EQUAL(Action::Ping, c.refused(5000));
}

static void test_a_refusal_during_the_wait_waits()
{
  HolderCheck c;
  c.refused(5000);
  TEST_ASSERT_EQUAL(Action::Wait, c.refused(5200));
  TEST_ASSERT_EQUAL(Action::Wait, c.refused(7999));
}

static void test_a_silent_holder_is_closed_after_3_seconds()
{
  HolderCheck c;
  c.refused(5000);
  TEST_ASSERT_EQUAL(Action::Close, c.refused(8000));
}

static void test_the_check_ends_after_the_close()
{
  HolderCheck c;
  c.refused(0);
  TEST_ASSERT_EQUAL(Action::Close, c.refused(3000));
  TEST_ASSERT_EQUAL(Action::Ping, c.refused(3100)); // a holder that is still there starts a new check
}

static void test_hearing_the_holder_ends_the_check()
{
  HolderCheck c;
  c.refused(0);
  c.heard();
  TEST_ASSERT_EQUAL(Action::Ping, c.refused(3000)); // not a close: the holder answered
  TEST_ASSERT_EQUAL(Action::Wait, c.refused(3100));
}

static void test_hearing_without_a_check_changes_nothing()
{
  HolderCheck c;
  c.heard();
  TEST_ASSERT_EQUAL(Action::Ping, c.refused(0));
  TEST_ASSERT_EQUAL(Action::Close, c.refused(3000));
}

static void test_a_new_holder_starts_without_a_check()
{
  HolderCheck c;
  c.refused(0);
  c.reset();
  TEST_ASSERT_EQUAL(Action::Ping, c.refused(3500));
}

static void test_the_holder_check_survives_the_clock_wrapping()
{
  HolderCheck c;
  TEST_ASSERT_EQUAL(Action::Ping, c.refused(0xFFFFFF00u));
  TEST_ASSERT_EQUAL(Action::Wait, c.refused(0x000000FFu)); // 511 ms later
  TEST_ASSERT_EQUAL(Action::Close, c.refused(0x000000FFu + 2489u));
}

// ---- Origin ----

static void expect_origin(bool allowed, const char *origin)
{
  const std::string label = std::string(allowed ? "accepted: " : "refused: ") + origin;
  TEST_ASSERT_EQUAL_MESSAGE(allowed, pixelart_net::origin_allowed(origin), label.c_str());
}

static void test_origin_missing_header_is_accepted() { TEST_ASSERT_TRUE(pixelart_net::origin_allowed(nullptr)); }

static void test_origin_the_project_site_only_as_written()
{
  expect_origin(true, "https://monska85.github.io");
  expect_origin(false, "http://monska85.github.io");
  expect_origin(false, "https://monska85.github.io:443");
  expect_origin(false, "https://monska85.github.io/");
  expect_origin(false, "https://MONSKA85.github.io");
  expect_origin(false, "https://monska85.github.io.evil.example");
  expect_origin(false, "https://evil.example/monska85.github.io");
  expect_origin(false, "https://github.io");
}

static void test_origin_localhost_with_any_port()
{
  expect_origin(true, "http://localhost");
  expect_origin(true, "https://localhost");
  expect_origin(true, "http://localhost:5173");
  expect_origin(true, "https://localhost:8443");
  expect_origin(true, "http://localhost:0");
  expect_origin(true, "http://localhost:65535");
  expect_origin(false, "http://localhost:65536");
  expect_origin(false, "http://localhost:");
  expect_origin(false, "http://localhost:80a");
  expect_origin(false, "http://localhost:123456");
  expect_origin(false, "http://localhost:-1");
  expect_origin(false, "http://localhost:80:80");
}

static void test_origin_local_names()
{
  expect_origin(true, "http://pixelart-118c.local");
  expect_origin(true, "https://pixelart-118c.local:8080");
  expect_origin(true, "http://printer.office.local");
  expect_origin(true, "http://a.local");
  expect_origin(false, "http://.local");
  expect_origin(false, "http://local");
  expect_origin(false, "http://a..local");
  expect_origin(false, "http://-a.local");
  expect_origin(false, "http://a-.local");
  expect_origin(false, "http://pixelart.local.");
  expect_origin(false, "http://pixelart.local.evil.example");
  expect_origin(false, "http://evil.example/.local");
  expect_origin(false, "http://evil.example#.local");
  expect_origin(false, "http://evil.example?.local");
  expect_origin(false, "http://evil.example\\.local");
  expect_origin(false, "http://pixelart_1.local");
  expect_origin(false, "http://nas.lan");
  expect_origin(false, "http://nas");
}

static void test_origin_uppercase_is_refused()
{
  expect_origin(false, "HTTP://localhost");
  expect_origin(false, "http://LOCALHOST");
  expect_origin(false, "http://Localhost");
  expect_origin(false, "http://Pixelart.local");
  expect_origin(false, "http://pixelart.LOCAL");
}

static void test_origin_trailing_dot_is_refused()
{
  expect_origin(false, "http://localhost.");
  expect_origin(false, "http://192.168.1.1.");
  expect_origin(false, "http://pixelart.local.");
}

static void test_origin_user_information_is_refused()
{
  expect_origin(false, "http://user@localhost");
  expect_origin(false, "http://user:pass@localhost");
  expect_origin(false, "http://evil.example@localhost");
  expect_origin(false, "http://localhost@evil.example");
  expect_origin(false, "http://192.168.1.1@evil.example");
  expect_origin(false, "http://localhost:80@evil.example");
}

static void test_origin_ipv6_is_refused()
{
  expect_origin(false, "http://[::1]");
  expect_origin(false, "http://[::1]:8080");
  expect_origin(false, "http://[fe80::1]");
  expect_origin(false, "http://[::ffff:192.168.1.1]");
}

static void test_origin_private_ipv4_ranges()
{
  expect_origin(true, "http://10.0.0.1");
  expect_origin(true, "http://10.255.255.255");
  expect_origin(true, "http://127.0.0.1");
  expect_origin(true, "https://127.255.0.3:8765");
  expect_origin(true, "http://172.16.0.1");
  expect_origin(true, "http://172.31.255.255");
  expect_origin(true, "http://192.168.0.0");
  expect_origin(true, "http://192.168.1.42:80");
  expect_origin(true, "http://169.254.10.20");
  expect_origin(false, "http://11.0.0.1");
  expect_origin(false, "http://9.255.255.255");
  expect_origin(false, "http://172.15.255.255");
  expect_origin(false, "http://172.32.0.1");
  expect_origin(false, "http://172.32.1.1:80");
  expect_origin(false, "http://192.167.1.1");
  expect_origin(false, "http://192.169.1.1");
  expect_origin(false, "http://169.253.1.1");
  expect_origin(false, "http://169.255.1.1");
  expect_origin(false, "http://128.0.0.1");
  expect_origin(false, "http://126.0.0.1");
  expect_origin(false, "http://8.8.8.8");
  expect_origin(false, "http://0.0.0.0");
  expect_origin(false, "http://255.255.255.255");
}

static void test_origin_ipv4_must_be_four_plain_decimal_numbers()
{
  expect_origin(false, "http://192.168.001.1");
  expect_origin(false, "http://010.0.0.1");
  expect_origin(false, "http://10.0.0.01");
  expect_origin(false, "http://10.0.0.256");
  expect_origin(false, "http://10.0.0.999");
  expect_origin(false, "http://10.0.0");
  expect_origin(false, "http://10.0.0.0.1");
  expect_origin(false, "http://10.0.0.");
  expect_origin(false, "http://10..0.1");
  expect_origin(false, "http://10.0.0.1a");
  expect_origin(false, "http://0x0a.0.0.1");
  expect_origin(false, "http://167772161");
  expect_origin(false, "http://192.168.1");
  expect_origin(false, "http://192.168.1.1.1");
  expect_origin(false, "http://+10.0.0.1");
  expect_origin(false, "http://10.0.0.1 ");
}

static void test_origin_needs_a_scheme_and_nothing_after_the_port()
{
  expect_origin(false, "localhost");
  expect_origin(false, "192.168.1.1");
  expect_origin(false, "//localhost");
  expect_origin(false, "ws://localhost");
  expect_origin(false, "wss://localhost");
  expect_origin(false, "file://localhost");
  expect_origin(false, "null");
  expect_origin(false, "");
  expect_origin(false, "http://");
  expect_origin(false, "https://");
  expect_origin(false, "http://localhost/");
  expect_origin(false, "http://localhost/path");
  expect_origin(false, "http://localhost:8080/");
  expect_origin(false, "http://192.168.1.1/ws");
  expect_origin(false, "http://localhost?x=1");
  expect_origin(false, "http://localhost#x");
  expect_origin(false, "http://localhost ");
  expect_origin(false, " http://localhost");
  expect_origin(false, "http://local host");
  expect_origin(false, "http:/localhost");
  expect_origin(false, "http:localhost");
  expect_origin(false, "http:///localhost");
  expect_origin(false, "http://localhost,http://localhost");
}

static void test_origin_other_sites_are_refused()
{
  expect_origin(false, "https://example.org");
  expect_origin(false, "http://example.org:80");
  expect_origin(false, "https://evil.example");
  expect_origin(false, "https://localhost.evil.example");
  expect_origin(false, "https://192.168.1.1.evil.example");
  expect_origin(false, "https://github.io");
  expect_origin(false, "https://monska85.github.io.example");
}

static void test_origin_too_long_is_refused()
{
  expect_origin(false, ("http://" + std::string(300, 'a') + ".local").c_str());
}

// ---- HMAC-SHA256 ----

static std::string hmac(const std::string &key, const std::string &message)
{
  return pixelart::hmac_sha256_hex(key.data(), key.size(), message.data(), message.size());
}

static void test_hmac_rfc_4231_vectors()
{
  TEST_ASSERT_EQUAL_STRING("b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7",
                           hmac(std::string(20, '\x0b'), "Hi There").c_str());
  TEST_ASSERT_EQUAL_STRING("5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
                           hmac("Jefe", "what do ya want for nothing?").c_str());
  // A key longer than the block is hashed first.
  TEST_ASSERT_EQUAL_STRING(
      "60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54",
      hmac(std::string(131, '\xaa'), "Test Using Larger Than Block-Size Key - Hash Key First").c_str());
  TEST_ASSERT_EQUAL_STRING("b613679a0814d9ec772f95d778c35fc5ff1697c493715653c6c712144292c5ad", hmac("", "").c_str());
}

static void test_hmac_of_the_login()
{
  TEST_ASSERT_EQUAL_STRING("8a2422fe7ca97df26f5b82ca480c6f0362cb0e3eb9ebc9e8c0dd7467c28ffe23",
                           pixelart_net::auth_hmac("k3j9x0q7w2m5z8a1", "000102030405060708090a0b0c0d0e0f").c_str());
}

static void test_constant_time_equal()
{
  TEST_ASSERT_TRUE(pixelart::constant_time_equal("abcd", "abcd", 4));
  TEST_ASSERT_FALSE(pixelart::constant_time_equal("abcd", "abce", 4));
  TEST_ASSERT_FALSE(pixelart::constant_time_equal("abcd", "bbcd", 4));
  TEST_ASSERT_TRUE(pixelart::constant_time_equal("abcd", "abce", 3));
  TEST_ASSERT_TRUE(pixelart::constant_time_equal("", "", 0));
}

// ---- Network login ----

static const uint8_t NONCE_ONE[16] = {0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15};
static const uint8_t NONCE_TWO[16] = {0xff, 0xee, 0xdd, 0xcc, 0xbb, 0xaa, 0x99, 0x88,
                                      0x77, 0x66, 0x55, 0x44, 0x33, 0x22, 0x11, 0x00};
static const char TOKEN[] = "k3j9x0q7w2m5z8a1";
static const char NONCE_ONE_HMAC[] = "8a2422fe7ca97df26f5b82ca480c6f0362cb0e3eb9ebc9e8c0dd7467c28ffe23";
static const char NONCE_TWO_HMAC[] = "946f681804cafe5398415149e0c67c04f19bc6fdfed76cb6554ed63a130e85c8";

static void test_nonce_is_32_lowercase_hex_digits()
{
  AuthSession session;
  TEST_ASSERT_EQUAL_STRING("000102030405060708090a0b0c0d0e0f", session.challenge(NONCE_ONE).c_str());
  TEST_ASSERT_EQUAL_STRING("ffeeddccbbaa99887766554433221100", session.challenge(NONCE_TWO).c_str());
}

static void test_login_accepts_the_right_hmac_once()
{
  AuthSession session;
  TEST_ASSERT_FALSE(session.authenticated());
  session.challenge(NONCE_ONE);
  TEST_ASSERT_TRUE(session.attempt(TOKEN, NONCE_ONE_HMAC) == AuthSession::Verdict::Accepted);
  TEST_ASSERT_TRUE(session.authenticated());
}

static void test_a_nonce_serves_one_attempt()
{
  AuthSession session;
  session.challenge(NONCE_ONE);
  TEST_ASSERT_TRUE(session.attempt(TOKEN, std::string(64, '0')) == AuthSession::Verdict::Refused);
  // The right answer to the same nonce comes too late.
  TEST_ASSERT_TRUE(session.attempt(TOKEN, NONCE_ONE_HMAC) == AuthSession::Verdict::Refused);
  TEST_ASSERT_FALSE(session.authenticated());
}

static void test_a_new_challenge_replaces_the_nonce()
{
  AuthSession session;
  session.challenge(NONCE_ONE);
  session.challenge(NONCE_TWO);
  TEST_ASSERT_TRUE(session.attempt(TOKEN, NONCE_ONE_HMAC) == AuthSession::Verdict::Refused);
  session.challenge(NONCE_TWO);
  TEST_ASSERT_TRUE(session.attempt(TOKEN, NONCE_TWO_HMAC) == AuthSession::Verdict::Accepted);
}

static void test_the_answer_to_another_token_is_refused()
{
  AuthSession session;
  session.challenge(NONCE_ONE);
  TEST_ASSERT_TRUE(session.attempt("a1z8m5w2q7x0j9k3", NONCE_ONE_HMAC) == AuthSession::Verdict::Refused);
  TEST_ASSERT_FALSE(session.authenticated());
}

static void test_auth_without_a_nonce_is_refused()
{
  AuthSession session;
  TEST_ASSERT_TRUE(session.attempt(TOKEN, NONCE_ONE_HMAC) == AuthSession::Verdict::Refused);
}

static void test_the_third_failure_closes()
{
  AuthSession session;
  for (int i = 0; i < 2; i++)
  {
    session.challenge(NONCE_ONE);
    TEST_ASSERT_TRUE(session.attempt(TOKEN, std::string(64, 'f')) == AuthSession::Verdict::Refused);
  }
  session.challenge(NONCE_ONE);
  TEST_ASSERT_TRUE(session.attempt(TOKEN, std::string(64, 'f')) == AuthSession::Verdict::RefusedAndClose);
}

static void test_a_success_does_not_reset_the_failures()
{
  AuthSession session;
  session.challenge(NONCE_ONE);
  session.attempt(TOKEN, std::string(64, 'f'));
  session.challenge(NONCE_ONE);
  session.attempt(TOKEN, std::string(64, 'f'));
  session.challenge(NONCE_ONE);
  TEST_ASSERT_TRUE(session.attempt(TOKEN, NONCE_ONE_HMAC) == AuthSession::Verdict::Accepted);
  session.challenge(NONCE_ONE);
  TEST_ASSERT_TRUE(session.attempt(TOKEN, std::string(64, 'f')) == AuthSession::Verdict::RefusedAndClose);
  TEST_ASSERT_TRUE(session.authenticated()); // the connection closes: nothing else changes
}

static void test_reset_forgets_the_login()
{
  AuthSession session;
  session.challenge(NONCE_ONE);
  session.attempt(TOKEN, NONCE_ONE_HMAC);
  session.reset();
  TEST_ASSERT_FALSE(session.authenticated());
  TEST_ASSERT_TRUE(session.attempt(TOKEN, NONCE_ONE_HMAC) == AuthSession::Verdict::Refused); // nonce gone too
}

static void test_hmac_text_is_64_lowercase_hex_digits()
{
  TEST_ASSERT_TRUE(pixelart_net::is_hmac_text(NONCE_ONE_HMAC));
  TEST_ASSERT_FALSE(pixelart_net::is_hmac_text(""));
  TEST_ASSERT_FALSE(pixelart_net::is_hmac_text(std::string(63, 'a')));
  TEST_ASSERT_FALSE(pixelart_net::is_hmac_text(std::string(65, 'a')));
  TEST_ASSERT_FALSE(pixelart_net::is_hmac_text(std::string(64, 'A')));
  TEST_ASSERT_FALSE(pixelart_net::is_hmac_text(std::string(63, 'a') + "g"));
}

// ---- WebSocket messages ----

static Result frame(MessageAssembler &assembler, FrameKind kind, bool final, const std::string &data)
{
  Result r = assembler.begin_frame(kind, data.size());
  if (r != Result::More)
    return r;
  return assembler.end_frame(final, reinterpret_cast<const uint8_t *>(data.data()), data.size());
}

static void test_a_text_message_is_a_line()
{
  MessageAssembler assembler;
  TEST_ASSERT_TRUE(frame(assembler, FrameKind::Text, true, "@PR 3c250228 {\"seq\":1,\"cmd\":\"info\"}") ==
                   Result::Line);
  TEST_ASSERT_EQUAL_STRING("@PR 3c250228 {\"seq\":1,\"cmd\":\"info\"}", assembler.line());
  TEST_ASSERT_EQUAL(35, assembler.line_size());
}

// RFC 6455 section 5.2: the first byte is FIN (0x80) plus opcode 9 (ping), the second the mask bit (0, a server
// does not mask) plus the payload length (0).
static void test_the_server_ping_is_fin_ping_unmasked_and_empty()
{
  const uint8_t expected[2] = {0x89, 0x00};
  TEST_ASSERT_EQUAL(2, sizeof(pixelart_net::PING_FRAME));
  TEST_ASSERT_EQUAL_HEX8_ARRAY(expected, pixelart_net::PING_FRAME, 2);
}

static void test_an_empty_text_message_is_an_empty_line()
{
  MessageAssembler assembler;
  TEST_ASSERT_TRUE(frame(assembler, FrameKind::Text, true, "") == Result::Line);
  TEST_ASSERT_EQUAL(0, assembler.line_size());
}

static void test_fragments_are_joined()
{
  MessageAssembler assembler;
  TEST_ASSERT_TRUE(frame(assembler, FrameKind::Text, false, "@PR ") == Result::More);
  TEST_ASSERT_TRUE(frame(assembler, FrameKind::Continuation, false, "abcd") == Result::More);
  TEST_ASSERT_TRUE(frame(assembler, FrameKind::Continuation, true, " end") == Result::Line);
  TEST_ASSERT_EQUAL_STRING("@PR abcd end", assembler.line());
  // The next message starts afresh.
  TEST_ASSERT_TRUE(frame(assembler, FrameKind::Text, true, "x") == Result::Line);
  TEST_ASSERT_EQUAL_STRING("x", assembler.line());
}

static void test_1024_bytes_are_accepted_and_1025_are_too_big()
{
  MessageAssembler assembler;
  TEST_ASSERT_TRUE(frame(assembler, FrameKind::Text, true, std::string(1024, 'a')) == Result::Line);
  TEST_ASSERT_EQUAL(1024, assembler.line_size());
  TEST_ASSERT_TRUE(frame(assembler, FrameKind::Text, true, std::string(1025, 'a')) == Result::Close);
  TEST_ASSERT_EQUAL(1009, assembler.code());
}

static void test_the_limit_counts_the_reassembled_message()
{
  MessageAssembler assembler;
  TEST_ASSERT_TRUE(frame(assembler, FrameKind::Text, false, std::string(600, 'a')) == Result::More);
  TEST_ASSERT_TRUE(frame(assembler, FrameKind::Continuation, false, std::string(424, 'a')) == Result::More);
  TEST_ASSERT_TRUE(frame(assembler, FrameKind::Continuation, true, "b") == Result::Close);
  TEST_ASSERT_EQUAL(1009, assembler.code());
}

static void test_a_message_that_goes_too_long_is_refused_before_its_payload_is_read()
{
  MessageAssembler assembler;
  TEST_ASSERT_TRUE(assembler.begin_frame(FrameKind::Text, 100000) == Result::Close);
  TEST_ASSERT_EQUAL(1009, assembler.code());
  assembler.reset();
  TEST_ASSERT_TRUE(frame(assembler, FrameKind::Text, false, std::string(1000, 'a')) == Result::More);
  TEST_ASSERT_TRUE(assembler.begin_frame(FrameKind::Continuation, 25) == Result::Close);
  TEST_ASSERT_EQUAL(1009, assembler.code());
}

static void test_a_binary_message_is_unsupported()
{
  MessageAssembler assembler;
  TEST_ASSERT_TRUE(frame(assembler, FrameKind::Binary, true, "abc") == Result::Close);
  TEST_ASSERT_EQUAL(1003, assembler.code());
  assembler.reset();
  TEST_ASSERT_TRUE(frame(assembler, FrameKind::Binary, false, "ab") == Result::More);
  TEST_ASSERT_TRUE(frame(assembler, FrameKind::Continuation, true, "c") == Result::Close);
  TEST_ASSERT_EQUAL(1003, assembler.code());
}

static void test_a_too_long_binary_message_is_too_big_first()
{
  MessageAssembler assembler;
  TEST_ASSERT_TRUE(frame(assembler, FrameKind::Binary, true, std::string(1025, 'a')) == Result::Close);
  TEST_ASSERT_EQUAL(1009, assembler.code());
}

static void test_a_newline_closes_with_policy()
{
  MessageAssembler assembler;
  TEST_ASSERT_TRUE(frame(assembler, FrameKind::Text, true, "one\ntwo") == Result::Close);
  TEST_ASSERT_EQUAL(1008, assembler.code());
  assembler.reset();
  TEST_ASSERT_TRUE(frame(assembler, FrameKind::Text, true, "line\n") == Result::Close);
  TEST_ASSERT_EQUAL(1008, assembler.code());
  assembler.reset();
  // A carriage return is not a newline.
  TEST_ASSERT_TRUE(frame(assembler, FrameKind::Text, true, "line\r") == Result::Line);
}

static void test_invalid_utf8_closes_with_invalid_payload()
{
  const char *bad[] = {"\xff", "\xc0\x80", "\xed\xa0\x80", "\xf4\x90\x80\x80", "\xe2\x82", "ok \x80"};
  for (const char *text : bad)
  {
    MessageAssembler assembler;
    TEST_ASSERT_TRUE_MESSAGE(frame(assembler, FrameKind::Text, true, text) == Result::Close, text);
    TEST_ASSERT_EQUAL(1007, assembler.code());
  }
  MessageAssembler assembler;
  TEST_ASSERT_TRUE(frame(assembler, FrameKind::Text, true, "caf\xc3\xa9 \xe2\x82\xac \xf0\x9f\x98\x80") ==
                   Result::Line);
}

static void test_invalid_utf8_is_checked_before_the_newline()
{
  MessageAssembler assembler;
  TEST_ASSERT_TRUE(frame(assembler, FrameKind::Text, true, "\xff\n") == Result::Close);
  TEST_ASSERT_EQUAL(1007, assembler.code());
}

static void test_utf8_split_between_fragments_is_checked_on_the_whole()
{
  MessageAssembler assembler;
  TEST_ASSERT_TRUE(frame(assembler, FrameKind::Text, false, "\xe2\x82") == Result::More);
  TEST_ASSERT_TRUE(frame(assembler, FrameKind::Continuation, true, "\xac") == Result::Line);
}

static void test_fragments_out_of_order_close_with_protocol_error()
{
  MessageAssembler assembler;
  TEST_ASSERT_TRUE(assembler.begin_frame(FrameKind::Continuation, 1) == Result::Close);
  TEST_ASSERT_EQUAL(1002, assembler.code());
  assembler.reset();
  TEST_ASSERT_TRUE(frame(assembler, FrameKind::Text, false, "a") == Result::More);
  TEST_ASSERT_TRUE(assembler.begin_frame(FrameKind::Text, 1) == Result::Close);
  TEST_ASSERT_EQUAL(1002, assembler.code());
  assembler.reset();
  TEST_ASSERT_TRUE(frame(assembler, FrameKind::Binary, false, "a") == Result::More);
  TEST_ASSERT_TRUE(assembler.begin_frame(FrameKind::Text, 1) == Result::Close);
  TEST_ASSERT_EQUAL(1002, assembler.code());
}

// ---- The handshake ----

// The ESP-IDF server answers a handshake without calling the board's handler, so the board reads the
// origin from the bytes of the head.

static HeadScanner scan(const std::string &head, size_t piece = 0)
{
  HeadScanner s;
  if (piece == 0)
    s.feed(head.data(), head.size());
  else
    for (size_t i = 0; i < head.size(); i += piece)
      s.feed(head.data() + i, std::min(piece, head.size() - i));
  return s;
}

static std::string head_with(const std::string &lines)
{
  return "GET /ws HTTP/1.1\r\nHost: pixelart-118c.local\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
         "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n" +
         lines + "\r\n";
}

static void test_handshake_without_origin_is_accepted()
{
  const HeadScanner s = scan(head_with(""));
  TEST_ASSERT_TRUE(s.complete());
  TEST_ASSERT_TRUE(s.origin_allowed());
}

static void test_handshake_origin_is_read_from_the_head()
{
  TEST_ASSERT_TRUE(scan(head_with("Origin: https://monska85.github.io\r\n")).origin_allowed());
  TEST_ASSERT_TRUE(scan(head_with("Origin: http://192.168.1.20:5173\r\n")).origin_allowed());
  TEST_ASSERT_FALSE(scan(head_with("Origin: https://evil.example\r\n")).origin_allowed());
  TEST_ASSERT_FALSE(scan(head_with("Origin: http://nas.lan\r\n")).origin_allowed());
}

static void test_handshake_origin_name_in_any_case_and_value_without_spaces_around()
{
  TEST_ASSERT_TRUE(scan(head_with("origin:http://localhost:8080\r\n")).origin_allowed());
  TEST_ASSERT_TRUE(scan(head_with("ORIGIN: \thttp://localhost \t\r\n")).origin_allowed());
  TEST_ASSERT_FALSE(scan(head_with("OrIgIn: \thttps://evil.example \t\r\n")).origin_allowed());
}

static void test_handshake_origin_split_in_any_pieces()
{
  const std::string allowed = head_with("Origin: http://pixelart-118c.local\r\n");
  const std::string refused = head_with("Origin: https://evil.example\r\n");
  for (size_t piece = 1; piece <= 17; piece++)
  {
    TEST_ASSERT_TRUE(scan(allowed, piece).origin_allowed());
    TEST_ASSERT_FALSE(scan(refused, piece).origin_allowed());
  }
}

static void test_handshake_only_the_first_origin_counts()
{
  TEST_ASSERT_FALSE(scan(head_with("Origin: https://evil.example\r\nOrigin: http://localhost\r\n")).origin_allowed());
  TEST_ASSERT_TRUE(scan(head_with("Origin: http://localhost\r\nOrigin: https://evil.example\r\n")).origin_allowed());
}

static void test_handshake_other_headers_are_not_the_origin()
{
  // Names that start like it, or hold it, are other headers: the head has no origin.
  TEST_ASSERT_TRUE(scan(head_with("Origin-Agent-Cluster: ?1\r\nX-Origin: https://evil.example\r\n")).origin_allowed());
  TEST_ASSERT_TRUE(scan(head_with("Originx: https://evil.example\r\n")).origin_allowed());
  // The request line is not a header.
  TEST_ASSERT_TRUE(scan("GET /origin:https://evil.example HTTP/1.1\r\nHost: a\r\n\r\n").origin_allowed());
}

static void test_handshake_empty_origin_is_refused()
{
  TEST_ASSERT_FALSE(scan(head_with("Origin:\r\n")).origin_allowed());
  TEST_ASSERT_FALSE(scan(head_with("Origin:   \r\n")).origin_allowed());
}

static void test_handshake_origin_of_255_characters_is_read_and_256_is_refused()
{
  // An allowed origin of exactly 255 characters: "http://" (7), a name of 242, ".local" (6).
  std::string name = "ab";
  while (name.size() < 242)
    name += ".a";
  const std::string longest = "http://" + name + ".local";
  TEST_ASSERT_EQUAL(255, longest.size());
  TEST_ASSERT_TRUE(pixelart_net::origin_allowed(longest.c_str()));
  TEST_ASSERT_TRUE(scan(head_with("Origin: " + longest + "\r\n")).origin_allowed());
  // One character more is refused, although its first 255 characters are an allowed origin.
  TEST_ASSERT_FALSE(scan(head_with("Origin: " + longest + "a\r\n")).origin_allowed());
}

static void test_handshake_origin_with_a_nul_is_refused()
{
  const std::string line = std::string("Origin: http://localhost") + '\0' + ".evil.example\r\n";
  TEST_ASSERT_FALSE(scan(head_with(line)).origin_allowed());
}

static void test_handshake_head_that_is_not_complete_is_refused()
{
  const std::string head = head_with("");
  const HeadScanner s = scan(head.substr(0, head.size() - 2));
  TEST_ASSERT_FALSE(s.complete());
  TEST_ASSERT_FALSE(s.origin_allowed());
}

static void test_handshake_the_last_head_on_a_connection_counts()
{
  // A request answered before (here one without an origin) does not decide for the handshake after it.
  const std::string first = "GET /nothing HTTP/1.1\r\nHost: a\r\n\r\n";
  const std::string evil = head_with("Origin: https://evil.example\r\n");
  HeadScanner s = scan(first);
  TEST_ASSERT_TRUE(s.origin_allowed());
  s.feed(evil.data(), evil.size());
  TEST_ASSERT_FALSE(s.origin_allowed());
  // The same when both arrive in one piece.
  TEST_ASSERT_FALSE(scan(first + evil).origin_allowed());
  // And the next head is not judged before it is complete.
  HeadScanner t = scan(first);
  t.feed(evil.data(), 10);
  TEST_ASSERT_FALSE(t.complete());
  TEST_ASSERT_FALSE(t.origin_allowed());
  const std::string good = head_with("Origin: http://localhost\r\n");
  TEST_ASSERT_TRUE(scan(evil + good).origin_allowed());
}

static void test_handshake_reset_forgets_the_head()
{
  HeadScanner s = scan(head_with("Origin: https://evil.example\r\n"));
  s.reset();
  TEST_ASSERT_FALSE(s.complete());
  const std::string head = head_with("Origin: http://localhost\r\n");
  s.feed(head.data(), head.size());
  TEST_ASSERT_TRUE(s.origin_allowed());
}

static void test_handshake_answer_is_the_101_status_line()
{
  const char answer[] = "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n";
  TEST_ASSERT_TRUE(pixelart_net::is_handshake_answer(answer, sizeof(answer) - 1));
  const char refused[] = "HTTP/1.1 503 Service Unavailable\r\n";
  TEST_ASSERT_FALSE(pixelart_net::is_handshake_answer(refused, sizeof(refused) - 1));
  const char bad[] = "HTTP/1.1 400 Bad Request\r\n";
  TEST_ASSERT_FALSE(pixelart_net::is_handshake_answer(bad, sizeof(bad) - 1));
  TEST_ASSERT_FALSE(pixelart_net::is_handshake_answer("HTTP/1.1 101", 12)); // too short to be the status line
  const uint8_t frame[] = {0x81, 0x01, 'a'};
  TEST_ASSERT_FALSE(pixelart_net::is_handshake_answer(reinterpret_cast<const char *>(frame), sizeof(frame)));
  TEST_ASSERT_FALSE(pixelart_net::is_handshake_answer(nullptr, 0));
}

// ---- The page at `/`, the 404 and the 405 ----

static std::string page_for(const std::string &site)
{
  char out[pixelart_net::PAGE_CAPACITY];
  const size_t size = pixelart_net::render_page(out, sizeof(out), site.c_str());
  TEST_ASSERT_EQUAL(strlen(out), size);
  return std::string(out, size);
}

static void test_the_page_links_to_the_site_and_loads_nothing()
{
  const std::string page = page_for("https://monska85.github.io/PixelArt/");
  TEST_ASSERT_TRUE(page.size() > 200 && page.size() < 600);
  TEST_ASSERT_NOT_EQUAL(std::string::npos, page.find("<a href=\"https://monska85.github.io/PixelArt/\""));
  TEST_ASSERT_NOT_EQUAL(std::string::npos, page.find("PixelArt board"));
  // Nothing that runs or loads: no script, style, image, frame, form, stylesheet link or other resource.
  for (const char *word : {"<script", "<style", "style=", "src=", "<img", "<iframe", "<link", "<form", "<object",
                           "<embed", "onerror", "onload", "javascript:", "url("})
    TEST_ASSERT_EQUAL_MESSAGE(std::string::npos, page.find(word), word);
  // The only address in it is the site's.
  TEST_ASSERT_EQUAL(page.find("https://"), page.rfind("https://"));
  TEST_ASSERT_EQUAL(std::string::npos, page.find("http://"));
}

static void test_the_page_follows_the_site_of_the_build_and_escapes_it()
{
  const std::string fork = page_for("https://example-owner.github.io/Fork/");
  TEST_ASSERT_NOT_EQUAL(std::string::npos, fork.find("<a href=\"https://example-owner.github.io/Fork/\""));
  TEST_ASSERT_EQUAL(std::string::npos, fork.find("monska85"));
  const std::string odd = page_for("https://example.test/\"><script>&'");
  TEST_ASSERT_EQUAL(std::string::npos, odd.find("<script"));
  TEST_ASSERT_NOT_EQUAL(std::string::npos, odd.find("https://example.test/&quot;&gt;&lt;script&gt;&amp;&#39;"));
}

static void test_the_page_refuses_what_does_not_fit_or_is_missing()
{
  char out[pixelart_net::PAGE_CAPACITY];
  TEST_ASSERT_EQUAL(0, pixelart_net::render_page(out, sizeof(out), ""));
  TEST_ASSERT_EQUAL(0, pixelart_net::render_page(out, sizeof(out), nullptr));
  TEST_ASSERT_EQUAL(0, pixelart_net::render_page(nullptr, sizeof(out), "https://a.example/"));
  char tiny[64];
  TEST_ASSERT_EQUAL(0, pixelart_net::render_page(tiny, sizeof(tiny), "https://a.example/"));
  // The longest address a build accepts, 499 characters, fits.
  const std::string longest = "https://example.test/" + std::string(pixelart_net::MAX_SITE_URL - 21, 'a');
  TEST_ASSERT_EQUAL(pixelart_net::MAX_SITE_URL, longest.size());
  char out_longest[pixelart_net::PAGE_CAPACITY];
  const size_t longest_size = pixelart_net::render_page(out_longest, sizeof(out_longest), longest.c_str());
  TEST_ASSERT_TRUE(longest_size > pixelart_net::MAX_SITE_URL && longest_size < pixelart_net::PAGE_CAPACITY);
  // An address that grows past the buffer when escaped is refused, never cut.
  TEST_ASSERT_EQUAL(0, pixelart_net::render_page(out, sizeof(out), std::string(499, '&').c_str()));
}

static bool has_header(const char *name, const char *value)
{
  for (const pixelart_net::Header &h : pixelart_net::INERT_HEADERS)
    if (!strcmp(h.name, name) && !strcmp(h.value, value))
      return true;
  return false;
}

static void test_every_answer_carries_the_inert_headers()
{
  TEST_ASSERT_EQUAL(4, pixelart_net::INERT_HEADER_COUNT);
  TEST_ASSERT_TRUE(has_header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'"));
  TEST_ASSERT_TRUE(has_header("X-Content-Type-Options", "nosniff"));
  TEST_ASSERT_TRUE(has_header("Cache-Control", "no-store"));
  TEST_ASSERT_TRUE(has_header("Connection", "close"));
}

static void test_the_responses_have_their_status_type_and_body()
{
  using pixelart_net::Answer;
  const pixelart_net::Response &page = pixelart_net::response_for(Answer::Page);
  TEST_ASSERT_EQUAL_STRING("200 OK", page.status);
  TEST_ASSERT_EQUAL_STRING("text/html; charset=utf-8", page.content_type);
  TEST_ASSERT_NULL(page.body);
  TEST_ASSERT_NULL(page.allow);
  const pixelart_net::Response &missing = pixelart_net::response_for(Answer::NotFound);
  TEST_ASSERT_EQUAL_STRING("404 Not Found", missing.status);
  TEST_ASSERT_EQUAL_STRING("text/plain; charset=utf-8", missing.content_type);
  TEST_ASSERT_EQUAL_STRING("Not found", missing.body); // no newline
  TEST_ASSERT_NULL(missing.allow);
  const pixelart_net::Response &method = pixelart_net::response_for(Answer::MethodNotAllowed);
  TEST_ASSERT_EQUAL_STRING("405 Method Not Allowed", method.status);
  TEST_ASSERT_EQUAL_STRING("text/plain; charset=utf-8", method.content_type);
  TEST_ASSERT_EQUAL_STRING("Method not allowed", method.body);
  TEST_ASSERT_EQUAL_STRING("GET", method.allow);
}

static void test_the_site_origin_is_the_scheme_and_host_of_the_site_address()
{
  TEST_ASSERT_EQUAL_STRING("https://monska85.github.io",
                           pixelart_net::site_origin_of("https://monska85.github.io/PixelArt/").c_str());
  TEST_ASSERT_EQUAL_STRING("https://owner.github.io", pixelart_net::site_origin_of("https://owner.github.io/").c_str());
  TEST_ASSERT_EQUAL_STRING("https://example.org:8443",
                           pixelart_net::site_origin_of("https://example.org:8443/a/").c_str());
  // As a browser writes an origin: the host in lowercase and no explicit port 443.
  TEST_ASSERT_EQUAL_STRING("https://art.example.com", pixelart_net::site_origin_of("https://Art.Example.com/").c_str());
  TEST_ASSERT_EQUAL_STRING("https://art.example.com",
                           pixelart_net::site_origin_of("https://art.example.com:443/").c_str());
  TEST_ASSERT_EQUAL_STRING("https://art.example.com:8443",
                           pixelart_net::site_origin_of("https://ART.example.com:8443/x/").c_str());
  // A port with a leading zero is no spelling of 443: the build refuses it, and the origin does not drop it.
  TEST_ASSERT_EQUAL_STRING("https://x:0443", pixelart_net::site_origin_of("https://x:0443/").c_str());
  for (const char *bad : {"", "http://example.org/", "https://", "https:///x", "example.org/"})
    TEST_ASSERT_EQUAL_STRING_MESSAGE("", pixelart_net::site_origin_of(bad).c_str(), bad);
  TEST_ASSERT_EQUAL_STRING("", pixelart_net::site_origin_of(nullptr).c_str());
}

static void test_a_fork_site_is_the_origin_the_board_accepts()
{
  TEST_ASSERT_TRUE(pixelart_net::origin_allowed("https://example-owner.github.io", "https://example-owner.github.io"));
  TEST_ASSERT_FALSE(pixelart_net::origin_allowed("https://monska85.github.io", "https://example-owner.github.io"));
  TEST_ASSERT_FALSE(
      pixelart_net::origin_allowed("https://example-owner.github.io.evil.example", "https://example-owner.github.io"));
  TEST_ASSERT_FALSE(pixelart_net::origin_allowed("http://example-owner.github.io", "https://example-owner.github.io"));
  // Local pages and a missing header are accepted whatever the site is.
  TEST_ASSERT_TRUE(pixelart_net::origin_allowed("http://localhost:5173", "https://example-owner.github.io"));
  TEST_ASSERT_TRUE(pixelart_net::origin_allowed(nullptr, "https://example-owner.github.io"));
  // The head scanner passes the site on.
  HeadScanner s;
  const std::string head = "GET /ws HTTP/1.1\r\nHost: a\r\nOrigin: https://example-owner.github.io\r\n\r\n";
  s.feed(head.data(), head.size());
  TEST_ASSERT_TRUE(s.origin_allowed("https://example-owner.github.io"));
  TEST_ASSERT_FALSE(s.origin_allowed());
}

int main(int, char **)
{
  UNITY_BEGIN();
  RUN_TEST(test_a_socket_without_a_handshake_is_closed_after_10_seconds);
  RUN_TEST(test_a_socket_that_left_is_forgotten);
  RUN_TEST(test_the_slot_is_not_a_handshake_timeout);
  RUN_TEST(test_each_socket_has_its_own_clock);
  RUN_TEST(test_the_clock_wrapping_does_not_matter);
  RUN_TEST(test_a_slot_that_does_not_log_in_is_closed_after_30_seconds);
  RUN_TEST(test_a_login_resets_the_wait);
  RUN_TEST(test_without_the_login_the_slot_may_stay_idle);
  RUN_TEST(test_a_new_client_in_the_slot_gets_its_own_30_seconds);
  RUN_TEST(test_a_reused_slot_number_gets_a_new_login_wait);
  RUN_TEST(test_the_same_socket_number_for_a_new_client_starts_the_wait_again);
  RUN_TEST(test_the_same_generation_keeps_the_wait_running);
  RUN_TEST(test_the_first_refusal_pings_the_holder);
  RUN_TEST(test_a_refusal_during_the_wait_waits);
  RUN_TEST(test_a_silent_holder_is_closed_after_3_seconds);
  RUN_TEST(test_the_check_ends_after_the_close);
  RUN_TEST(test_hearing_the_holder_ends_the_check);
  RUN_TEST(test_hearing_without_a_check_changes_nothing);
  RUN_TEST(test_a_new_holder_starts_without_a_check);
  RUN_TEST(test_the_holder_check_survives_the_clock_wrapping);
  RUN_TEST(test_the_server_ping_is_fin_ping_unmasked_and_empty);
  RUN_TEST(test_no_slot_means_no_login_wait);
  RUN_TEST(test_origin_missing_header_is_accepted);
  RUN_TEST(test_origin_the_project_site_only_as_written);
  RUN_TEST(test_origin_localhost_with_any_port);
  RUN_TEST(test_origin_local_names);
  RUN_TEST(test_origin_uppercase_is_refused);
  RUN_TEST(test_origin_trailing_dot_is_refused);
  RUN_TEST(test_origin_user_information_is_refused);
  RUN_TEST(test_origin_ipv6_is_refused);
  RUN_TEST(test_origin_private_ipv4_ranges);
  RUN_TEST(test_origin_ipv4_must_be_four_plain_decimal_numbers);
  RUN_TEST(test_origin_needs_a_scheme_and_nothing_after_the_port);
  RUN_TEST(test_origin_other_sites_are_refused);
  RUN_TEST(test_origin_too_long_is_refused);
  RUN_TEST(test_hmac_rfc_4231_vectors);
  RUN_TEST(test_hmac_of_the_login);
  RUN_TEST(test_constant_time_equal);
  RUN_TEST(test_nonce_is_32_lowercase_hex_digits);
  RUN_TEST(test_login_accepts_the_right_hmac_once);
  RUN_TEST(test_a_nonce_serves_one_attempt);
  RUN_TEST(test_a_new_challenge_replaces_the_nonce);
  RUN_TEST(test_the_answer_to_another_token_is_refused);
  RUN_TEST(test_auth_without_a_nonce_is_refused);
  RUN_TEST(test_the_third_failure_closes);
  RUN_TEST(test_a_success_does_not_reset_the_failures);
  RUN_TEST(test_reset_forgets_the_login);
  RUN_TEST(test_hmac_text_is_64_lowercase_hex_digits);
  RUN_TEST(test_a_text_message_is_a_line);
  RUN_TEST(test_an_empty_text_message_is_an_empty_line);
  RUN_TEST(test_fragments_are_joined);
  RUN_TEST(test_1024_bytes_are_accepted_and_1025_are_too_big);
  RUN_TEST(test_the_limit_counts_the_reassembled_message);
  RUN_TEST(test_a_message_that_goes_too_long_is_refused_before_its_payload_is_read);
  RUN_TEST(test_a_binary_message_is_unsupported);
  RUN_TEST(test_a_too_long_binary_message_is_too_big_first);
  RUN_TEST(test_a_newline_closes_with_policy);
  RUN_TEST(test_invalid_utf8_closes_with_invalid_payload);
  RUN_TEST(test_invalid_utf8_is_checked_before_the_newline);
  RUN_TEST(test_utf8_split_between_fragments_is_checked_on_the_whole);
  RUN_TEST(test_fragments_out_of_order_close_with_protocol_error);
  RUN_TEST(test_handshake_without_origin_is_accepted);
  RUN_TEST(test_handshake_origin_is_read_from_the_head);
  RUN_TEST(test_handshake_origin_name_in_any_case_and_value_without_spaces_around);
  RUN_TEST(test_handshake_origin_split_in_any_pieces);
  RUN_TEST(test_handshake_only_the_first_origin_counts);
  RUN_TEST(test_handshake_other_headers_are_not_the_origin);
  RUN_TEST(test_handshake_empty_origin_is_refused);
  RUN_TEST(test_handshake_origin_of_255_characters_is_read_and_256_is_refused);
  RUN_TEST(test_handshake_origin_with_a_nul_is_refused);
  RUN_TEST(test_handshake_head_that_is_not_complete_is_refused);
  RUN_TEST(test_handshake_the_last_head_on_a_connection_counts);
  RUN_TEST(test_handshake_reset_forgets_the_head);
  RUN_TEST(test_handshake_answer_is_the_101_status_line);
  RUN_TEST(test_the_page_links_to_the_site_and_loads_nothing);
  RUN_TEST(test_the_page_follows_the_site_of_the_build_and_escapes_it);
  RUN_TEST(test_the_page_refuses_what_does_not_fit_or_is_missing);
  RUN_TEST(test_every_answer_carries_the_inert_headers);
  RUN_TEST(test_the_responses_have_their_status_type_and_body);
  RUN_TEST(test_the_site_origin_is_the_scheme_and_host_of_the_site_address);
  RUN_TEST(test_a_fork_site_is_the_origin_the_board_accepts);
  return UNITY_END();
}
