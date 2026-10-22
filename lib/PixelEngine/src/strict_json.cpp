// SPDX-License-Identifier: GPL-3.0-or-later

#include "strict_json.h"

#include <pixel_codec.h>

#include <cstdint>
#include <cstring>

namespace pixelart
{
namespace
{

enum class Expect
{
  Value,      // a value, at the top or after ':' or ','
  ValueOrEnd, // a value or ']', right after '['
  KeyOrEnd,   // a key or '}', right after '{'
  Key,        // a key, after ',' in an object
  Colon,
  AfterValue, // ',' or the closing bracket of the container, or the end at the top
};

bool is_digit(char c) { return c >= '0' && c <= '9'; }

bool is_hex(char c) { return is_digit(c) || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'); }

unsigned hex_value(const char *four)
{
  unsigned value = 0;
  for (int k = 0; k < 4; k++)
  {
    const char c = four[k];
    value = value * 16 + (unsigned)(is_digit(c) ? c - '0' : (c | 0x20) - 'a' + 10);
  }
  return value;
}

bool is_space(char c) { return c == ' ' || c == '\t' || c == '\n' || c == '\r'; }

} // namespace

bool check_strict_json(const char *json, size_t length, int max_depth, const char *&reason, size_t &offset)
{
  if (max_depth > 32)
    max_depth = 32;
  // One bit per open container: 1 for an object, 0 for an array.
  uint32_t is_object = 0;
  int depth = 0;
  Expect expect = Expect::Value;
  bool done = false;
  size_t i = 0;

#define FAIL(why)                                                                                                      \
  do                                                                                                                   \
  {                                                                                                                    \
    reason = (why);                                                                                                    \
    offset = i;                                                                                                        \
    return false;                                                                                                      \
  } while (0)

  while (i < length)
  {
    const char c = json[i];
    if (is_space(c))
    {
      i++;
      continue;
    }
    if (done)
      FAIL("data after the end of the document");

    if (expect == Expect::AfterValue)
    {
      const bool in_object = (is_object >> (depth - 1)) & 1u;
      if (c == ',')
      {
        expect = in_object ? Expect::Key : Expect::Value;
      }
      else if ((c == '}' && in_object) || (c == ']' && !in_object))
      {
        depth--;
        done = depth == 0;
      }
      else
        FAIL("unexpected character after a value");
      i++;
      continue;
    }

    if (expect == Expect::Colon)
    {
      if (c != ':')
        FAIL("expected ':' after a key");
      expect = Expect::Value;
      i++;
      continue;
    }

    if (expect == Expect::KeyOrEnd && c == '}')
    {
      depth--;
      done = depth == 0;
      expect = Expect::AfterValue;
      i++;
      continue;
    }
    if (expect == Expect::ValueOrEnd && c == ']')
    {
      depth--;
      done = depth == 0;
      expect = Expect::AfterValue;
      i++;
      continue;
    }

    const bool is_key = expect == Expect::Key || expect == Expect::KeyOrEnd;
    if (is_key && c != '"')
      FAIL("object keys must be double-quoted strings");

    if (c == '"')
    {
      i++;
      for (;; i++)
      {
        if (i >= length)
          FAIL("unterminated string");
        const unsigned char b = (unsigned char)json[i];
        if (b == '"')
          break;
        if (b < 0x20)
          FAIL("control character inside a string");
        if (b == '\\')
        {
          if (++i >= length)
            FAIL("unterminated string");
          const char e = json[i];
          if (e == 'u')
          {
            if (i + 4 >= length)
              FAIL("invalid escape");
            for (size_t k = 1; k <= 4; k++)
              if (!is_hex(json[i + k]))
                FAIL("invalid escape");
            if (json[i + 1] == '0' && json[i + 2] == '0' && json[i + 3] == '0' && json[i + 4] == '0')
              FAIL("U+0000 is not allowed in a string");
            const unsigned code = hex_value(json + i + 1);
            i += 4;
            if (code >= 0xDC00 && code <= 0xDFFF)
              FAIL("unpaired surrogate escape");
            if (code >= 0xD800 && code <= 0xDBFF)
            {
              // A high surrogate must be followed by the escape of a low one.
              if (i + 6 >= length || json[i + 1] != '\\' || json[i + 2] != 'u')
                FAIL("unpaired surrogate escape");
              for (size_t k = 3; k <= 6; k++)
                if (!is_hex(json[i + k]))
                  FAIL("invalid escape");
              const unsigned low = hex_value(json + i + 3);
              if (low < 0xDC00 || low > 0xDFFF)
                FAIL("unpaired surrogate escape");
              i += 6;
            }
          }
          else if (!(e == '"' || e == '\\' || e == '/' || e == 'b' || e == 'f' || e == 'n' || e == 'r' || e == 't'))
            FAIL("invalid escape");
        }
        else if (b >= 0x80)
        {
          const size_t n = utf8_sequence_length(json, length, i);
          if (n == 0)
            FAIL("invalid UTF-8");
          i += n - 1;
        }
      }
      i++;
      expect = is_key ? Expect::Colon : Expect::AfterValue;
      done = !is_key && depth == 0;
      continue;
    }

    if (c == '{' || c == '[')
    {
      if (depth >= max_depth)
        FAIL("nested too deeply");
      if (c == '{')
        is_object |= 1u << depth;
      else
        is_object &= ~(1u << depth);
      depth++;
      expect = c == '{' ? Expect::KeyOrEnd : Expect::ValueOrEnd;
      i++;
      continue;
    }

    // A literal or a number.
    if (c == 't' || c == 'f' || c == 'n')
    {
      const char *word = c == 't' ? "true" : c == 'f' ? "false" : "null";
      const size_t n = strlen(word);
      if (i + n > length || memcmp(json + i, word, n) != 0)
        FAIL("invalid literal");
      i += n;
    }
    else if (c == '-' || is_digit(c))
    {
      if (c == '-')
        i++;
      if (i >= length || !is_digit(json[i]))
        FAIL("invalid number");
      if (json[i] == '0')
        i++;
      else
        while (i < length && is_digit(json[i]))
          i++;
      if (i < length && json[i] == '.')
      {
        i++;
        if (i >= length || !is_digit(json[i]))
          FAIL("invalid number");
        while (i < length && is_digit(json[i]))
          i++;
      }
      if (i < length && (json[i] == 'e' || json[i] == 'E'))
      {
        i++;
        if (i < length && (json[i] == '+' || json[i] == '-'))
          i++;
        if (i >= length || !is_digit(json[i]))
          FAIL("invalid number");
        while (i < length && is_digit(json[i]))
          i++;
      }
    }
    else
      FAIL("unexpected character");
    expect = Expect::AfterValue;
    done = depth == 0;
  }
#undef FAIL

  if (!done)
  {
    reason = length == 0 ? "empty document" : "unexpected end of the document";
    offset = length;
    return false;
  }
  return true;
}

bool parse_document(const char *json, size_t length, size_t max_size, int max_depth, JsonDocument &doc,
                    const char *&code, std::string &message)
{
  if (length > max_size)
  {
    code = "limit_exceeded";
    message = "file larger than " + std::to_string(max_size / 1024) + " KiB";
    return false;
  }
  code = "structure";
  const char *reason = nullptr;
  size_t offset = 0;
  if (!check_strict_json(json, length, max_depth, reason, offset))
  {
    message = std::string("not valid JSON: ") + reason + " (byte " + std::to_string(offset) + ")";
    return false;
  }
  DeserializationError parse_error = deserializeJson(doc, json, length, DeserializationOption::NestingLimit(max_depth));
  if (parse_error)
  {
    message = std::string("not valid JSON: ") + parse_error.c_str();
    return false;
  }
  return true;
}

bool is_allowed_key(JsonString key, std::initializer_list<const char *> allowed)
{
  for (const char *name : allowed)
    if (key == name)
      return true;
  return false;
}

size_t utf8_code_points(const char *text)
{
  size_t count = 0;
  for (const unsigned char *p = (const unsigned char *)text; *p; p++)
    if ((*p & 0xC0) != 0x80)
      count++;
  return count;
}

} // namespace pixelart
