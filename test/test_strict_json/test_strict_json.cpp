// The strict JSON pre-scan: grammar, UTF-8 boundaries, escapes and depth.
// Run with: pio test -e native_test (or make test)

#include <strict_json.h>
#include <unity.h>

#include <string>

using pixelart::check_strict_json;

static bool accepts(const std::string &json, int depth = 32)
{
  const char *reason;
  size_t offset;
  return check_strict_json(json.data(), json.size(), depth, reason, offset);
}

static void expect_accepted(const std::string &json) { TEST_ASSERT_TRUE_MESSAGE(accepts(json), json.c_str()); }

static void expect_rejected(const std::string &json) { TEST_ASSERT_FALSE_MESSAGE(accepts(json), json.c_str()); }

static void test_accepts_json_values()
{
  for (const char *json : {"{}", "[]", "0", "-0", "1", "-12.5e+3", "1E-2", "0.5", "true", "false", "null", "\"\"",
                           " \t\r\n{ \"a\" : [ 1 , 2 , { } ] , \"b\" : null }\n", "[[],[[]],{\"a\":{}}]",
                           "\"\\\" \\\\ \\/ \\b \\f \\n \\r \\t \\u00e9 \\uD83D\\uDE00\""})
    expect_accepted(json);
}

static void test_rejects_bad_structure()
{
  for (const char *json : {"",           " ",          "{",    "[",     "{\"a\"}",   "{\"a\":}",
                           "{\"a\":1,}", "[1,]",       "[,1]", "[1 2]", "{\"a\" 1}", "{\"a\":1 \"b\":2}",
                           "{1:2}",      "[}",         "{]",   "]",     "}",         ",",
                           ":",          "{\"a\":1}}", "[1]]"})
    expect_rejected(json);
}

static void test_rejects_non_json_syntax()
{
  for (const char *json : {"{'a':1}", "{a:1}", "[1] // c", "/* c */ [1]", "[1] x", "[1][2]", "{} {}", "NaN", "Infinity",
                           "-Infinity", "[NaN]", "tru", "truee", "nul", "True", "undefined", "\"abc", "\"abc\\"})
    expect_rejected(json);
  expect_rejected("\xEF\xBB\xBF{}");
}

static void test_rejects_numbers_outside_the_grammar()
{
  for (const char *json : {"+1", "01", "-01", "00", ".5", "-.5", "1.", "1.e2", "1e", "1e+", "-", "- 1", "0x10", "1_0",
                           "[01]", "[1.]", "{\"a\":+1}", "1.5.2", "--1"})
    expect_rejected(json);
}

static void test_rejects_control_characters_in_strings()
{
  for (int c = 0; c < 0x20; c++)
    expect_rejected(std::string("\"a") + (char)c + "b\"");
  expect_accepted("\"\x7f\"");
}

static void test_escapes()
{
  for (const char *json :
       {"\"\\a\"", "\"\\x41\"", "\"\\'\"", "\"\\u12\"", "\"\\u12G4\"", "\"\\u\"", "\"\\U0041\"", "\"\\u123\""})
    expect_rejected(json);
  expect_rejected("\"\\u0000\"");
  expect_rejected("{\"a\\u0000b\":1}");
  expect_rejected("\"x\\u0000\"");
  expect_accepted("\"\\u0001\"");
  expect_rejected("\"\\u00000\"");
  expect_accepted("\"\\u0010\"");
  expect_accepted("\"\\u1000\"");
}

static void test_surrogate_escapes()
{
  expect_accepted("\"\\uD83D\\uDE00\"");
  expect_accepted("\"\\ud800\\udc00\\udbff\\udfff\"");
  expect_accepted("\"\\uD7FF\\uE000\"");
  for (const char *json : {"\"\\ud800\"", "\"\\udbff\"", "\"\\udc00\"", "\"\\udfff\"", "\"\\ud800x\"", "\"\\ud800\\n\"",
                           "\"\\ud800\\u0041\"", "\"\\ud800\\ud800\"", "\"\\ud800\\ud83d\\ude00\"", "\"\\ud800\\u12\"",
                           "\"\\ude00\\ud83d\"", "\"\\ud83d", "\"\\ud83d\\ude0"})
    expect_rejected(json);
}

static void test_utf8_boundaries()
{
  // Last and first valid sequences of each length.
  for (const char *text : {"\x7f", "\xC2\x80", "\xDF\xBF", "\xE0\xA0\x80", "\xED\x9F\xBF", "\xEE\x80\x80",
                           "\xEF\xBF\xBF", "\xF0\x90\x80\x80", "\xF4\x8F\xBF\xBF"})
    expect_accepted(std::string("\"") + text + "\"");
  for (const char *text : {"\x80", "\xBF", "\xC0\x80", "\xC1\xBF", "\xC2", "\xC2\x20", "\xE0\x80\x80", "\xE0\x9F\xBF",
                           "\xE0\xA0", "\xED\xA0\x80", "\xED\xBF\xBF", "\xF0\x80\x80\x80", "\xF0\x8F\xBF\xBF",
                           "\xF4\x90\x80\x80", "\xF5\x80\x80\x80", "\xF8\x88\x80\x80\x80", "\xFE", "\xFF"})
    expect_rejected(std::string("\"") + text + "\"");
  // A truncated sequence right before the end of the data.
  expect_rejected(std::string("\"\xE2\x82", 4));
  // Non-ASCII outside a string is not JSON.
  expect_rejected("[\xC3\xA9]");
}

static void test_depth_limit()
{
  for (int limit : {1, 10, 32})
  {
    expect_accepted(std::string(limit, '[') + std::string(limit, ']'));
    TEST_ASSERT_TRUE(accepts(std::string(limit, '[') + std::string(limit, ']'), limit));
    TEST_ASSERT_FALSE(accepts(std::string(limit + 1, '[') + std::string(limit + 1, ']'), limit));
  }
  TEST_ASSERT_FALSE(accepts(std::string(100, '[') + std::string(100, ']')));
  std::string objects;
  for (int i = 0; i < 10; i++)
    objects += "{\"a\":";
  objects += "1" + std::string(10, '}');
  TEST_ASSERT_TRUE(accepts(objects, 10));
  TEST_ASSERT_FALSE(accepts(objects, 9));
}

static void test_mixed_brackets_are_matched()
{
  expect_rejected("[{]}");
  expect_rejected("{\"a\":[}]");
  expect_accepted("{\"a\":[{\"b\":[]}],\"c\":{}}");
}

static void test_error_message_and_offset()
{
  const std::string json = "[1, +2]";
  JsonDocument doc;
  const char *code = nullptr;
  std::string message;
  TEST_ASSERT_FALSE(pixelart::parse_document(json.data(), json.size(), 1024, 32, doc, code, message));
  TEST_ASSERT_EQUAL_STRING("structure", code);
  TEST_ASSERT_EQUAL_STRING("not valid JSON: unexpected character (byte 4)", message.c_str());
  TEST_ASSERT_TRUE(pixelart::parse_document("[1]", 3, 1024, 32, doc, code, message));
}

static void test_code_points()
{
  TEST_ASSERT_EQUAL(0, pixelart::utf8_code_points(""));
  TEST_ASSERT_EQUAL(3, pixelart::utf8_code_points("abc"));
  TEST_ASSERT_EQUAL(4, pixelart::utf8_code_points("a\xC3\xA9\xE2\x82\xAC\xF0\x9F\x98\x80"));
}

void setUp() {}
void tearDown() {}

int main(int, char **)
{
  UNITY_BEGIN();
  RUN_TEST(test_accepts_json_values);
  RUN_TEST(test_rejects_bad_structure);
  RUN_TEST(test_rejects_non_json_syntax);
  RUN_TEST(test_rejects_numbers_outside_the_grammar);
  RUN_TEST(test_rejects_control_characters_in_strings);
  RUN_TEST(test_escapes);
  RUN_TEST(test_surrogate_escapes);
  RUN_TEST(test_utf8_boundaries);
  RUN_TEST(test_depth_limit);
  RUN_TEST(test_mixed_brackets_are_matched);
  RUN_TEST(test_error_message_and_offset);
  RUN_TEST(test_code_points);
  return UNITY_END();
}
