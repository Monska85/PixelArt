// SPDX-License-Identifier: GPL-3.0-or-later

// CRC-32, SHA-256 and base64 against published test vectors.
// Run with: pio test -e native_test (or make test)

#include <pixel_codec.h>
#include <unity.h>

#include <cstring>
#include <string>

using namespace pixelart;

static uint32_t crc_of(const std::string &text) { return crc32(text.data(), text.size()); }

static std::string sha_of(const std::string &text)
{
  Sha256 hash;
  hash.update(text.data(), text.size());
  return hash.hex_digest();
}

static void test_crc32_vectors()
{
  TEST_ASSERT_EQUAL_HEX32(0x00000000, crc_of(""));
  TEST_ASSERT_EQUAL_HEX32(0xcbf43926, crc_of("123456789")); // the CRC-32/IEEE check value
  TEST_ASSERT_EQUAL_HEX32(0x414fa339, crc_of("The quick brown fox jumps over the lazy dog"));
  TEST_ASSERT_EQUAL_HEX32(0xe8b7be43, crc_of("a"));
}

static void test_crc32_continues()
{
  const std::string text = "123456789";
  uint32_t crc = crc32(text.data(), 4);
  crc = crc32(text.data() + 4, text.size() - 4, crc);
  TEST_ASSERT_EQUAL_HEX32(0xcbf43926, crc);
}

static void test_sha256_fips_vectors()
{
  TEST_ASSERT_EQUAL_STRING("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", sha_of("").c_str());
  TEST_ASSERT_EQUAL_STRING("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", sha_of("abc").c_str());
  TEST_ASSERT_EQUAL_STRING("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
                           sha_of("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq").c_str());
  TEST_ASSERT_EQUAL_STRING(
      "cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1",
      sha_of("abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrl"
             "mnopqrsmnopqrstnopqrstu")
          .c_str());
}

static void test_sha256_million_a_in_pieces()
{
  Sha256 hash;
  const std::string piece(1000, 'a');
  for (int i = 0; i < 1000; i++)
    hash.update(piece.data(), piece.size());
  TEST_ASSERT_EQUAL_STRING("cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0",
                           hash.hex_digest().c_str());
}

static void test_sha256_split_anywhere()
{
  // Padding edge cases: lengths around the 55, 56 and 64 byte boundaries, fed in uneven pieces.
  for (size_t length : {54, 55, 56, 57, 63, 64, 65, 119, 120, 128})
  {
    std::string text(length, 'x');
    Sha256 split;
    split.update(text.data(), 7);
    split.update(text.data() + 7, length - 7);
    TEST_ASSERT_EQUAL_STRING(sha_of(text).c_str(), split.hex_digest().c_str());
  }
  // Known values for 55 and 56 bytes of 'a' (one and two blocks).
  TEST_ASSERT_EQUAL_STRING("9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318",
                           sha_of(std::string(55, 'a')).c_str());
  TEST_ASSERT_EQUAL_STRING("b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a",
                           sha_of(std::string(56, 'a')).c_str());
}

static void test_base64_rfc4648_vectors()
{
  const char *plain[] = {"", "f", "fo", "foo", "foob", "fooba", "foobar"};
  const char *coded[] = {"", "Zg==", "Zm8=", "Zm9v", "Zm9vYg==", "Zm9vYmE=", "Zm9vYmFy"};
  for (int i = 0; i < 7; i++)
  {
    TEST_ASSERT_EQUAL_STRING(coded[i], base64_encode(plain[i], strlen(plain[i])).c_str());
    std::string out;
    TEST_ASSERT_TRUE(base64_decode(coded[i], strlen(coded[i]), 64, out));
    TEST_ASSERT_EQUAL_STRING(plain[i], out.c_str());
  }
}

static void test_base64_round_trip_all_bytes()
{
  std::string bytes;
  for (int i = 0; i < 256; i++)
    bytes += (char)i;
  std::string coded = base64_encode(bytes.data(), bytes.size());
  std::string out;
  TEST_ASSERT_TRUE(base64_decode(coded.data(), coded.size(), 256, out));
  TEST_ASSERT_TRUE(bytes == out);
}

static void test_base64_rejects_invalid_text()
{
  std::string out;
  const char *invalid[] = {"Zg=",    "Zg",   "Zm9",  "=Zg=", "Z===", "Zg=a", "Zg==Zg==", "Zg ==", "Zg\n=",
                           "Zm9v\n", "Zm9!", "Zm-v", "Zm_v", "QR==", "Zm9=", "ZZ==",     "Zh==",  "Zg==="};
  for (const char *text : invalid)
  {
    TEST_ASSERT_FALSE_MESSAGE(base64_decode(text, strlen(text), 64, out), text);
    TEST_ASSERT_TRUE(out.empty());
  }
}

static void test_base64_respects_size_limit()
{
  std::string out;
  TEST_ASSERT_TRUE(base64_decode("Zm9vYmFy", 8, 6, out));
  TEST_ASSERT_FALSE(base64_decode("Zm9vYmFy", 8, 5, out));
  TEST_ASSERT_TRUE(base64_decode("Zm9vYg==", 8, 4, out));
  TEST_ASSERT_FALSE(base64_decode("Zm9vYg==", 8, 3, out));
}

static size_t utf8_length(const std::string &text, size_t index = 0)
{
  return utf8_sequence_length(text.data(), text.size(), index);
}

static void test_utf8_sequence_length()
{
  TEST_ASSERT_EQUAL(1, utf8_length("a"));
  TEST_ASSERT_EQUAL(2, utf8_length("\xC3\xA9"));
  TEST_ASSERT_EQUAL(3, utf8_length("\xE2\x82\xAC"));
  TEST_ASSERT_EQUAL(4, utf8_length("\xF0\x9F\x98\x80"));
  TEST_ASSERT_EQUAL(2, utf8_length("a\xC3\xA9", 1));     // starts at the index
  TEST_ASSERT_EQUAL(3, utf8_length("\xED\x9F\xBF"));     // U+D7FF, the last before the surrogates
  TEST_ASSERT_EQUAL(4, utf8_length("\xF4\x8F\xBF\xBF")); // U+10FFFF

  const char *ill_formed[] = {"\x80",
                              "\xBF",
                              "\xC0\x80",
                              "\xC1\xBF",
                              "\xE0\x80\x80",
                              "\xE0\x9F\xBF",
                              "\xED\xA0\x80",
                              "\xF0\x80\x80\x80",
                              "\xF4\x90\x80\x80",
                              "\xF5\x80\x80\x80",
                              "\xFF",
                              "\xC3",
                              "\xE2\x82",
                              "\xF0\x9F\x98",
                              "\xC3\x28",
                              "\xE2\x28\xA1",
                              "\xF0\x9F\x28\x80"};
  for (const char *text : ill_formed)
    TEST_ASSERT_EQUAL_MESSAGE(0, utf8_length(text), text);
}

void setUp() {}
void tearDown() {}

int main(int, char **)
{
  UNITY_BEGIN();
  RUN_TEST(test_crc32_vectors);
  RUN_TEST(test_crc32_continues);
  RUN_TEST(test_sha256_fips_vectors);
  RUN_TEST(test_sha256_million_a_in_pieces);
  RUN_TEST(test_sha256_split_anywhere);
  RUN_TEST(test_base64_rfc4648_vectors);
  RUN_TEST(test_base64_round_trip_all_bytes);
  RUN_TEST(test_base64_rejects_invalid_text);
  RUN_TEST(test_base64_respects_size_limit);
  RUN_TEST(test_utf8_sequence_length);
  return UNITY_END();
}
