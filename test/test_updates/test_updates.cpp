// SPDX-License-Identifier: GPL-3.0-or-later

// The update logic (lib/PixelUpdate): versions, manifest reading, URL rules, the sync plan, the
// schedule, the install window and the updater's state machine against a fake host, then whole
// updates in the simulator against its update source with every injected failure.
// Run with: pio test -e native_test (or make test)

#include <ArduinoJson.h>
#include <sim.h>
#include <sim_internal.h>
#include <unity.h>
#include <update_manifest.h>
#include <update_schedule.h>
#include <update_semver.h>
#include <updater.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <map>
#include <string>
#include <thread>
#include <vector>

#include "app.h"
#include "firmware.h"
#include "network.h"
#include "platform.h"
#include "protocol.h"
#include "settings.h"
#include "storage.h"
#include "update_icon.h"
#include "updates.h"
#include "pixelart_test.h"

using namespace pixelart_update;
using pixelart_test::DOT;
using pixelart_test::protocol_frame;
using pixelart_test::sha256_hex;
using pixelart_test::TempData;

void setUp() {}
void tearDown() {}

static const std::string HEX_A(64, 'a');

// ---- Versions ----

static bool newer(const char *candidate, const char *running) { return is_newer_version(candidate, running); }

static void test_versions_follow_semver_precedence()
{
  // The ordered list of section 11 of the Semantic Versioning specification, then the next release.
  const char *ordered[] = {"1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-alpha.beta",
                           "1.0.0-beta",  "1.0.0-beta.2",  "1.0.0-beta.11",
                           "1.0.0-rc.1",  "1.0.0",         "1.0.1",
                           "1.1.0",       "2.0.0"};
  const size_t n = sizeof(ordered) / sizeof(ordered[0]);
  for (size_t i = 0; i < n; i++)
    for (size_t j = 0; j < n; j++)
    {
      Version a, b;
      TEST_ASSERT_TRUE(parse_version(ordered[i], a) && parse_version(ordered[j], b));
      const int want = i < j ? -1 : (i > j ? 1 : 0);
      TEST_ASSERT_EQUAL_MESSAGE(want, compare_versions(a, b),
                                (std::string(ordered[i]) + " against " + ordered[j]).c_str());
    }
  // Numbers are compared as numbers, not as text.
  TEST_ASSERT_TRUE(newer("1.10.0", "1.9.0"));
  TEST_ASSERT_TRUE(newer("1.0.0-rc.10", "1.0.0-rc.9"));
  // Build metadata does not count.
  TEST_ASSERT_FALSE(newer("1.0.0+b2", "1.0.0+b1"));
  TEST_ASSERT_FALSE(newer("1.0.0+b1", "1.0.0+b2"));
}

static void test_a_release_is_an_update_for_its_development_build()
{
  TEST_ASSERT_TRUE(newer("1.2.0", "1.2.0-dev.3+gabc1234"));
  TEST_ASSERT_TRUE(newer("1.2.0-dev.4", "1.2.0-dev.3+gabc1234"));
  TEST_ASSERT_FALSE(newer("1.2.0-dev.3", "1.2.0-dev.3+gabc1234"));
  TEST_ASSERT_FALSE(newer("1.1.9", "1.2.0-dev.3"));
  TEST_ASSERT_FALSE(newer("1.2.0", "1.2.0"));
  TEST_ASSERT_FALSE(newer("1.1.0", "1.2.0"));
}

static void test_versions_that_are_not_semver_do_not_parse()
{
  const char *bad[] = {"",          "1",      "1.2",        "1.2.3.4",  "v1.2.3", "01.2.3",     "1.02.3",
                       "1.2.03",    "1.2.3-", "1.2.3-a..b", "1.2.3-01", "1.2.3+", "1.2.3+a..b", "1.2.x",
                       "1.2.3-a_b", " 1.2.3", "1.2.3 ",     "-1.2.3",   "1.2.-3", "1.2.3-é",    "1,2,3"};
  for (const char *text : bad)
  {
    Version v;
    TEST_ASSERT_FALSE_MESSAGE(parse_version(text, v), text);
    TEST_ASSERT_FALSE_MESSAGE(newer(text, "0.0.1") || newer("9.9.9", text), text);
  }
  Version v;
  TEST_ASSERT_TRUE(parse_version("0.0.0", v));
  TEST_ASSERT_TRUE(parse_version("1.2.3-0.0a-b.c+x.y-z", v));
}

// ---- The manifest ----

static std::string anim_entry(const std::string &id, const std::string &file, const std::string &size,
                              const std::string &sha)
{
  return "{\"id\":\"" + id + "\",\"name\":\"N\",\"version\":1,\"file\":\"" + file + "\",\"size\":" + size +
         ",\"sha256\":\"" + sha + "\"}";
}

// A manifest like the published one, with parts a test can replace.
static std::string manifest(const std::string &animations, const std::string &playlists,
                            const std::string &firmware = "", const std::string &version = "1.2.0")
{
  return "{\"format\":\"pixelart-manifest/1\",\"version\":\"" + version + "\",\"released\":\"2026-11-02\"" +
         (firmware.empty() ? "" : ",\"firmware\":[" + firmware + "]") + ",\"animations\":[" + animations +
         "],\"playlists\":[" + playlists + "]}";
}

static const std::string FIRMWARE_APP = "{\"board\":\"esp32c3\",\"chip\":\"ESP32-C3\",\"part\":\"app\",\"offset\":"
                                        "65536,\"file\":\"firmware/esp32c3/app-1.2.0.bin\","
                                        "\"size\":365568,\"sha256\":\"" +
                                        HEX_A + "\"}";
static const std::string FIRMWARE_BOOTLOADER =
    "{\"board\":\"esp32c3\",\"chip\":\"ESP32-C3\",\"part\":\"bootloader\",\"offset\":0}";

static std::string good_manifest()
{
  return manifest(anim_entry("dot", "animations/dot.json", "147", HEX_A) + "," +
                      anim_entry("tree", "animations/tree.json", "1834", std::string(64, 'b')),
                  "{\"id\":\"default\",\"file\":\"playlists/default.json\",\"size\":912,\"sha256\":\"" +
                      std::string(64, 'c') + "\"}",
                  FIRMWARE_BOOTLOADER + "," + FIRMWARE_APP);
}

static bool reads(const std::string &json, Manifest &out)
{
  std::string reason;
  return parse_manifest(json.data(), json.size(), out, reason);
}

static void expect_refused(const std::string &json, const std::string &label)
{
  Manifest m;
  std::string reason;
  TEST_ASSERT_FALSE_MESSAGE(parse_manifest(json.data(), json.size(), m, reason), label.c_str());
  TEST_ASSERT_FALSE_MESSAGE(reason.empty(), (label + ": no reason").c_str());
}

static void test_a_valid_manifest_is_read()
{
  Manifest m;
  TEST_ASSERT_TRUE(reads(good_manifest(), m));
  TEST_ASSERT_EQUAL_STRING("1.2.0", m.version.c_str());
  TEST_ASSERT_EQUAL(2, m.animations.size());
  TEST_ASSERT_EQUAL_STRING("tree", m.animations[1].id.c_str());
  TEST_ASSERT_EQUAL_STRING("animations/tree.json", m.animations[1].file.c_str());
  TEST_ASSERT_EQUAL(1834, m.animations[1].size);
  TEST_ASSERT_EQUAL_STRING(std::string(64, 'b').c_str(), m.animations[1].sha256.c_str());
  TEST_ASSERT_EQUAL(1, m.playlists.size());
  TEST_ASSERT_EQUAL_STRING("playlists/default.json", m.playlists[0].file.c_str());
  // Only the `app` parts of the firmware list are kept.
  TEST_ASSERT_EQUAL(1, m.firmware.size());
  TEST_ASSERT_EQUAL_STRING("esp32c3", m.firmware[0].board.c_str());
  TEST_ASSERT_EQUAL(365568, m.firmware[0].size);
}

static void test_a_manifest_needs_no_firmware_and_ignores_fields_it_does_not_know()
{
  Manifest m;
  TEST_ASSERT_TRUE(reads(manifest("", ""), m));
  TEST_ASSERT_EQUAL(0, m.animations.size() + m.playlists.size() + m.firmware.size());
  std::string extra = good_manifest();
  extra.insert(1, "\"future\":{\"a\":[1,2,3]},");
  TEST_ASSERT_TRUE(reads(extra, m));
}

static void test_the_manifest_size_limit_is_64_kib()
{
  std::string json = good_manifest();
  Manifest m;
  std::string at_limit = json + std::string(MAX_MANIFEST_SIZE - json.size(), ' ');
  TEST_ASSERT_EQUAL(65536, at_limit.size());
  TEST_ASSERT_TRUE(reads(at_limit, m));
  expect_refused(at_limit + " ", "65537 bytes");
}

static void test_a_manifest_that_is_not_strict_json_is_refused()
{
  const std::string good = good_manifest();
  expect_refused("", "empty");
  expect_refused("[]", "an array");
  expect_refused("\"text\"", "a string");
  expect_refused(good + "x", "data after the value");
  expect_refused("\xEF\xBB\xBF" + good, "byte order mark");
  expect_refused("/* c */" + good, "comment");
  std::string single = good;
  single.replace(single.find("\"format\""), 8, "'format'");
  expect_refused(single, "single quotes");
  std::string trailing = good;
  trailing.insert(trailing.rfind('}'), ",");
  expect_refused(trailing, "trailing comma");
  std::string control = good;
  control.insert(control.find("N\""), "\n");
  expect_refused(control, "raw control character in a string");
  std::string deep = "{\"a\":" + std::string(10, '[') + std::string(10, ']') + "}";
  expect_refused(deep, "nested too deeply");
}

static void test_the_format_and_the_version_are_checked()
{
  const std::string good = good_manifest();
  auto replaced = [&](const std::string &from, const std::string &to)
  {
    std::string text = good;
    text.replace(text.find(from), from.size(), to);
    return text;
  };
  expect_refused(replaced("pixelart-manifest/1", "pixelart-manifest/2"), "format 2");
  expect_refused(replaced("\"format\":\"pixelart-manifest/1\",", ""), "no format");
  expect_refused(replaced("\"pixelart-manifest/1\"", "1"), "format not a string");
  expect_refused(replaced("\"version\":\"1.2.0\",", ""), "no version");
  expect_refused(replaced("\"1.2.0\",\"released", "\"1.2\",\"released"), "version without patch");
  expect_refused(replaced("\"1.2.0\",\"released", "\"v1.2.0\",\"released"), "version with v");
  expect_refused(replaced("\"1.2.0\",\"released", "120,\"released"), "version a number");
  expect_refused(replaced("\"animations\":[", "\"animations_\":["), "no animations");
  expect_refused(replaced("\"playlists\":[", "\"playlists_\":["), "no playlists");
  expect_refused(replaced("\"animations\":[", "\"animations\":{\"x\":["), "animations not a list");
}

static void test_a_manifest_entry_needs_a_valid_id_path_size_and_checksum()
{
  struct Case
  {
    const char *label;
    std::string entry;
  };
  const std::string ok_file = "animations/a.json";
  const std::vector<Case> cases = {
      {"uppercase id", anim_entry("Dot", ok_file, "10", HEX_A)},
      {"empty id", anim_entry("", ok_file, "10", HEX_A)},
      {"id with a slash", anim_entry("a/b", ok_file, "10", HEX_A)},
      {"id of 33 characters", anim_entry(std::string(33, 'a'), ok_file, "10", HEX_A)},
      {"size 0", anim_entry("a", ok_file, "0", HEX_A)},
      {"negative size", anim_entry("a", ok_file, "-1", HEX_A)},
      {"size as text", anim_entry("a", ok_file, "\"10\"", HEX_A)},
      {"fractional size", anim_entry("a", ok_file, "1.5", HEX_A)},
      {"size over 32 bits", anim_entry("a", ok_file, "4294967296", HEX_A)},
      {"uppercase checksum", anim_entry("a", ok_file, "10", std::string(64, 'A'))},
      {"short checksum", anim_entry("a", ok_file, "10", std::string(63, 'a'))},
      {"long checksum", anim_entry("a", ok_file, "10", std::string(65, 'a'))},
      {"non-hex checksum", anim_entry("a", ok_file, "10", std::string(63, 'a') + "g")},
      {"absolute path", anim_entry("a", "/animations/a.json", "10", HEX_A)},
      {"parent folder", anim_entry("a", "../a.json", "10", HEX_A)},
      {"parent folder inside", anim_entry("a", "animations/../a.json", "10", HEX_A)},
      {"other host", anim_entry("a", "https://evil.example/a.json", "10", HEX_A)},
      {"other host without scheme", anim_entry("a", "//evil.example/a.json", "10", HEX_A)},
      {"scheme without slashes", anim_entry("a", "http:evil/a.json", "10", HEX_A)},
      {"backslash", anim_entry("a", "animations\\\\a.json", "10", HEX_A)},
      {"percent escape", anim_entry("a", "animations/%2e%2e/a.json", "10", HEX_A)},
      {"query", anim_entry("a", "animations/a.json?x=1", "10", HEX_A)},
      {"fragment", anim_entry("a", "animations/a.json#x", "10", HEX_A)},
      {"empty path", anim_entry("a", "", "10", HEX_A)},
      {"dot", anim_entry("a", ".", "10", HEX_A)},
      {"empty part", anim_entry("a", "animations//a.json", "10", HEX_A)},
      {"trailing slash", anim_entry("a", "animations/", "10", HEX_A)},
      {"space in path", anim_entry("a", "animations/a b.json", "10", HEX_A)},
      {"path of 161 characters", anim_entry("a", std::string(161, 'a'), "10", HEX_A)},
      {"no id", "{\"file\":\"animations/a.json\",\"size\":10,\"sha256\":\"" + HEX_A + "\"}"},
      {"no file", "{\"id\":\"a\",\"size\":10,\"sha256\":\"" + HEX_A + "\"}"},
      {"no size", "{\"id\":\"a\",\"file\":\"animations/a.json\",\"sha256\":\"" + HEX_A + "\"}"},
      {"no checksum", "{\"id\":\"a\",\"file\":\"animations/a.json\",\"size\":10}"},
      {"entry not an object", "3"},
      {"the same id twice",
       anim_entry("a", ok_file, "10", HEX_A) + "," + anim_entry("a", "animations/b.json", "10", HEX_A)},
  };
  for (const Case &c : cases)
  {
    expect_refused(manifest(c.entry, ""), std::string("animation: ") + c.label);
    // Playlists follow the same rules.
    expect_refused(manifest("", c.entry), std::string("playlist: ") + c.label);
  }
  Manifest m;
  TEST_ASSERT_TRUE(
      reads(manifest(anim_entry(std::string(32, 'a'), "animations/sub/a-b_c.v2.json", "10", HEX_A), ""), m));
  TEST_ASSERT_TRUE(reads(manifest(anim_entry("a", std::string(160, 'a'), "10", HEX_A), ""), m));
  // The same ID in an animation and a playlist is two files.
  TEST_ASSERT_TRUE(reads(
      manifest(anim_entry("a", "animations/a.json", "10", HEX_A), anim_entry("a", "playlists/a.json", "10", HEX_A)),
      m));
}

static void test_a_manifest_lists_at_most_200_files()
{
  auto list = [](int count, const char *prefix)
  {
    std::string out;
    for (int i = 0; i < count; i++)
      out += (i ? "," : "") + anim_entry(prefix + std::to_string(i), "animations/f.json", "10", HEX_A);
    return out;
  };
  Manifest m;
  TEST_ASSERT_TRUE(reads(manifest(list(200, "a"), ""), m));
  TEST_ASSERT_TRUE(reads(manifest(list(100, "a"), list(100, "p")), m));
  expect_refused(manifest(list(201, "a"), ""), "201 animations");
  expect_refused(manifest(list(100, "a"), list(101, "p")), "201 files in all");
}

static void test_the_firmware_list_is_checked_only_for_what_the_board_uses()
{
  Manifest m;
  // A firmware that is not a list counts as no firmware.
  TEST_ASSERT_TRUE(reads(
      "{\"format\":\"pixelart-manifest/1\",\"version\":\"1.0.0\",\"firmware\":{},\"animations\":[],\"playlists\":[]}",
      m));
  TEST_ASSERT_EQUAL(0, m.firmware.size());
  expect_refused(manifest("", "", "{\"part\":\"app\"}"), "firmware entry without board");
  expect_refused(manifest("", "", "{\"board\":\"esp32c3\"}"), "firmware entry without part");
  expect_refused(manifest("", "",
                          "{\"board\":\"esp32c3\",\"part\":\"app\",\"file\":\"../x.bin\",\"size\":1,\"sha256\":\"" +
                              HEX_A + "\"}"),
                 "app entry with a bad path");
  expect_refused(manifest("", "", "{\"board\":\"esp32c3\",\"part\":\"app\",\"size\":1,\"sha256\":\"" + HEX_A + "\"}"),
                 "app entry without a file");
  TEST_ASSERT_TRUE(reads(manifest("", "", FIRMWARE_BOOTLOADER), m));
  TEST_ASSERT_EQUAL(0, m.firmware.size());
}

// ---- URLs ----

static std::string resolved(const std::string &base, const std::string &relative)
{
  std::string out;
  return resolve_file_url(base, relative, out) ? out : "<refused>";
}

static void test_file_urls_resolve_against_the_manifest_url()
{
  TEST_ASSERT_EQUAL_STRING("https://monska85.github.io/PixelArt/animations/a.json",
                           resolved("https://monska85.github.io/PixelArt/manifest.json", "animations/a.json").c_str());
  TEST_ASSERT_EQUAL_STRING("http://localhost:8000/animations/a.json",
                           resolved("http://localhost:8000/manifest.json?x=1#top", "animations/a.json").c_str());
  TEST_ASSERT_EQUAL_STRING("https://host.example/animations/a.json",
                           resolved("https://host.example", "animations/a.json").c_str());
  TEST_ASSERT_EQUAL_STRING("https://host.example/animations/a.json",
                           resolved("https://host.example/?q=1", "animations/a.json").c_str());
  TEST_ASSERT_EQUAL_STRING("https://h.example/a/b/animations/a.json",
                           resolved("https://h.example/a/b/", "animations/a.json").c_str());
  TEST_ASSERT_EQUAL_STRING("https://h.example:8443/x/f.json",
                           resolved("https://h.example:8443/x/m.json", "f.json").c_str());
}

static void test_a_manifest_shaped_like_release_py_output_is_accepted()
{
  // tools/release.py names a file with the full version, which has a `+` before the commit of a build
  // from an untagged checkout, and `.dirty` after it for a modified tree.
  const std::string version = "0.0.0-dev.42+gabc1234.dirty";
  const std::string firmware =
      "{\"board\":\"esp32c3\",\"chip\":\"ESP32-C3\",\"part\":\"app\",\"offset\":65536,\"file\":\"firmware/esp32c3/"
      "app-" +
      version + ".bin\",\"size\":365568,\"sha256\":\"" + HEX_A + "\"}";
  Manifest m;
  TEST_ASSERT_TRUE(reads(manifest(anim_entry("dot", "animations/dot.json", "147", HEX_A), "", firmware, version), m));
  TEST_ASSERT_EQUAL_STRING(("firmware/esp32c3/app-" + version + ".bin").c_str(), m.firmware[0].file.c_str());
  TEST_ASSERT_EQUAL_STRING("https://h.example/a/firmware/esp32c3/app-0.0.0-dev.42+gabc1234.dirty.bin",
                           resolved("https://h.example/a/manifest.json", m.firmware[0].file).c_str());
  TEST_ASSERT_EQUAL(1, m.animations.size());
}

static void test_file_urls_are_refused_when_they_could_leave_the_manifests_folder()
{
  const std::string base = "https://h.example/a/manifest.json";
  for (const char *bad : {"/etc/x", "../x", "a/../x", "https://evil.example/x", "//evil.example/x", "", "a?b", "a#b"})
    TEST_ASSERT_EQUAL_STRING_MESSAGE("<refused>", resolved(base, bad).c_str(), bad);
  for (const char *bad_base : {"ftp://h.example/m.json", "h.example/m.json", "https://", "https:///m.json",
                               "https://h.example/a b", "", "file:///etc/passwd", "https://u@h.example/m.json",
                               "https://u:p@h.example/m.json", "https://h.example@evil.example/m.json"})
    TEST_ASSERT_EQUAL_STRING_MESSAGE("<refused>", resolved(bad_base, "a.json").c_str(), bad_base);
}

static std::string redirected(const std::string &from, const std::string &location, bool allow_http)
{
  std::string out;
  return resolve_redirect(from, location, allow_http, out) ? out : "<refused>";
}

static void test_redirects_never_leave_https_for_http_and_http_needs_permission()
{
  const std::string from = "https://a.example/dir/m.json";
  TEST_ASSERT_EQUAL_STRING("https://b.example/x.json", redirected(from, "https://b.example/x.json", false).c_str());
  TEST_ASSERT_EQUAL_STRING("https://b.example/x.json", redirected(from, "//b.example/x.json", false).c_str());
  TEST_ASSERT_EQUAL_STRING("https://a.example/x.json", redirected(from, "/x.json", false).c_str());
  TEST_ASSERT_EQUAL_STRING("https://a.example/dir/x.json", redirected(from, "x.json", false).c_str());
  TEST_ASSERT_EQUAL_STRING("<refused>", redirected(from, "http://b.example/x.json", true).c_str());
  TEST_ASSERT_EQUAL_STRING("<refused>", redirected(from, "ftp://b.example/x", true).c_str());
  TEST_ASSERT_EQUAL_STRING("<refused>", redirected(from, "", true).c_str());

  const std::string plain = "http://local.example:8000/m.json";
  TEST_ASSERT_EQUAL_STRING("http://local.example:8000/x.json", redirected(plain, "/x.json", true).c_str());
  TEST_ASSERT_EQUAL_STRING("<refused>", redirected(plain, "/x.json", false).c_str());
  // From http, a redirect to https is fine, with or without permission for http.
  TEST_ASSERT_EQUAL_STRING("https://b.example/x.json", redirected(plain, "https://b.example/x.json", false).c_str());
}

// ---- The sync plan ----

static void test_the_plan_adds_replaces_and_skips_with_animations_first()
{
  Manifest m;
  const std::string json =
      manifest(anim_entry("same", "animations/same.json", "10", HEX_A) + "," +
                   anim_entry("changed", "animations/changed.json", "20", std::string(64, 'b')) + "," +
                   anim_entry("new", "animations/new.json", "30", std::string(64, 'c')),
               anim_entry("p_new", "playlists/p_new.json", "40", std::string(64, 'd')) + "," +
                   anim_entry("p_same", "playlists/p_same.json", "50", std::string(64, 'e')) + "," +
                   anim_entry("p_changed", "playlists/p_changed.json", "60", std::string(64, 'f')));
  TEST_ASSERT_TRUE(reads(json, m));
  std::map<std::string, std::string> stored = {{"a:same", HEX_A},
                                               {"a:changed", std::string(64, '1')},
                                               {"a:unlisted", std::string(64, '2')},
                                               {"p:p_same", std::string(64, 'e')},
                                               {"p:p_changed", std::string(64, '3')},
                                               {"p:p_unlisted", std::string(64, '4')}};
  std::vector<PlanItem> plan = plan_sync(m,
                                         [&](Kind kind, const std::string &id, std::string &sha)
                                         {
                                           auto it =
                                               stored.find(std::string(kind == Kind::Animation ? "a:" : "p:") + id);
                                           if (it == stored.end())
                                             return false;
                                           sha = it->second;
                                           return true;
                                         });
  TEST_ASSERT_EQUAL(4, plan.size());
  // Animations first, each kind in manifest order.
  TEST_ASSERT_EQUAL_STRING("changed", plan[0].id.c_str());
  TEST_ASSERT_TRUE(plan[0].kind == Kind::Animation && plan[0].replace);
  TEST_ASSERT_EQUAL(20, plan[0].size);
  TEST_ASSERT_EQUAL_STRING("new", plan[1].id.c_str());
  TEST_ASSERT_TRUE(plan[1].kind == Kind::Animation && !plan[1].replace);
  TEST_ASSERT_EQUAL_STRING("p_new", plan[2].id.c_str());
  TEST_ASSERT_TRUE(plan[2].kind == Kind::Playlist && !plan[2].replace);
  TEST_ASSERT_EQUAL_STRING("p_changed", plan[3].id.c_str());
  TEST_ASSERT_TRUE(plan[3].kind == Kind::Playlist && plan[3].replace);
  TEST_ASSERT_EQUAL_STRING("playlists/p_changed.json", plan[3].file.c_str());
  // The same ID in both kinds is looked up by kind.
  TEST_ASSERT_EQUAL(0, plan_sync(Manifest(),
                                 [](Kind, const std::string &, std::string &)
                                 {
                                   return false;
                                 })
                           .size());
}

// ---- Firmware availability ----

static void test_a_firmware_is_available_when_newer_for_this_board_and_not_skipped()
{
  Manifest m;
  TEST_ASSERT_TRUE(reads(good_manifest(), m)); // version 1.2.0, esp32c3 app
  TEST_ASSERT_TRUE(firmware_available(m, "esp32c3", "1.1.0", "", false));
  TEST_ASSERT_TRUE(firmware_available(m, "esp32c3", "1.2.0-dev.3+gabc1234", "", false));
  TEST_ASSERT_FALSE(firmware_available(m, "esp32c3", "1.2.0", "", false));
  TEST_ASSERT_FALSE(firmware_available(m, "esp32c3", "1.3.0", "", false));
  TEST_ASSERT_FALSE(firmware_available(m, "esp32", "1.1.0", "", false)); // no entry for that board
  TEST_ASSERT_FALSE(firmware_available(m, "esp32c3", "not a version", "", false));
  // The skip list holds a version the board rolled back from; force installs it anyway.
  TEST_ASSERT_FALSE(firmware_available(m, "esp32c3", "1.1.0", "1.2.0", false));
  TEST_ASSERT_TRUE(firmware_available(m, "esp32c3", "1.1.0", "1.2.0", true));
  TEST_ASSERT_TRUE(firmware_available(m, "esp32c3", "1.1.0", "1.1.5", false));
  TEST_ASSERT_TRUE(find_firmware(m, "esp32c3") != nullptr);
  TEST_ASSERT_TRUE(find_firmware(m, "esp32s3") == nullptr);
}

// ---- The schedule ----

static void test_the_first_check_comes_5_minutes_after_the_first_address()
{
  Schedule s;
  TEST_ASSERT_FALSE(s.due(1000000));
  TEST_ASSERT_TRUE(s.wait_ms(0) == UINT64_MAX);
  s.on_address(1000);
  TEST_ASSERT_EQUAL_UINT64(301000, s.next_at()); // 1,000 + 5 * 60 * 1,000
  TEST_ASSERT_EQUAL_UINT64(300000, s.wait_ms(1000));
  TEST_ASSERT_FALSE(s.due(300999));
  TEST_ASSERT_TRUE(s.due(301000));
  TEST_ASSERT_EQUAL_UINT64(1, s.wait_ms(300999));
  TEST_ASSERT_EQUAL_UINT64(0, s.wait_ms(400000));
  // A later address (the connection came back) leaves the time as it was.
  s.on_address(900000);
  TEST_ASSERT_EQUAL_UINT64(301000, s.next_at());
}

static void test_the_next_check_follows_check_hours_with_up_to_10_minutes_of_delay()
{
  Schedule s;
  s.on_address(0);
  s.on_check_done(301000, true, 6, 0);
  TEST_ASSERT_EQUAL_UINT64(21901000, s.next_at()); // 301,000 + 6 * 3,600,000
  s.on_check_done(301000, true, 1, 123456);
  TEST_ASSERT_EQUAL_UINT64(301000 + 3600000 + 123456, s.next_at());
  s.on_check_done(301000, true, 168, MAX_JITTER_MS);
  TEST_ASSERT_EQUAL_UINT64(301000 + 168ULL * 3600000 + 600000, s.next_at());
  s.on_check_done(301000, true, 24, 700000); // more than the maximum is cut
  TEST_ASSERT_EQUAL_UINT64(301000 + 24ULL * 3600000 + 600000, s.next_at());
}

static void test_a_failed_check_is_retried_after_30_minutes_then_the_schedule_goes_on()
{
  Schedule s;
  s.on_address(0);
  s.on_check_done(301000, false, 6, 500000);
  TEST_ASSERT_EQUAL_UINT64(2101000, s.next_at()); // 301,000 + 1,800,000, no delay
  s.on_check_done(2101000, true, 6, 0);
  TEST_ASSERT_EQUAL_UINT64(2101000 + 21600000, s.next_at());
  // A check on request before any address also starts the schedule.
  Schedule late;
  late.on_check_done(10, false, 6, 0);
  TEST_ASSERT_TRUE(late.armed());
  TEST_ASSERT_EQUAL_UINT64(1800010, late.next_at());
}

static void test_the_schedule_does_not_wrap_after_a_long_run()
{
  Schedule s;
  const uint64_t two_months = 61ULL * 24 * 3600 * 1000; // past the 49 days of a 32-bit millisecond counter
  s.on_address(two_months);
  TEST_ASSERT_EQUAL_UINT64(two_months + 300000, s.next_at());
  TEST_ASSERT_FALSE(s.due(two_months + 299999));
}

// ---- The install window ----

static WindowState window(uint16_t start, uint16_t end, bool known, uint16_t minutes)
{
  return window_state(start, end, known, minutes);
}

static void test_equal_start_and_end_is_the_whole_day_even_without_the_time()
{
  for (uint16_t v : {0, 1, 300, 1439})
  {
    TEST_ASSERT_TRUE(window(v, v, false, 0) == WindowState::Open);
    TEST_ASSERT_TRUE(window(v, v, true, 0) == WindowState::Open);
    TEST_ASSERT_TRUE(window(v, v, true, 1439) == WindowState::Open);
  }
}

static void test_a_window_inside_the_day_includes_its_start_and_not_its_end()
{
  // 08:00 to 17:00 is minutes 480 to 1020.
  TEST_ASSERT_TRUE(window(480, 1020, true, 479) == WindowState::Closed);
  TEST_ASSERT_TRUE(window(480, 1020, true, 480) == WindowState::Open);
  TEST_ASSERT_TRUE(window(480, 1020, true, 1019) == WindowState::Open);
  TEST_ASSERT_TRUE(window(480, 1020, true, 1020) == WindowState::Closed);
  TEST_ASSERT_TRUE(window(480, 1020, true, 0) == WindowState::Closed);
  TEST_ASSERT_TRUE(window(480, 1020, true, 1439) == WindowState::Closed);
  TEST_ASSERT_TRUE(window(0, 1, true, 0) == WindowState::Open);
  TEST_ASSERT_TRUE(window(0, 1, true, 1) == WindowState::Closed);
}

static void test_a_window_whose_end_is_before_its_start_runs_over_midnight()
{
  // 22:00 to 06:00 is minutes 1320 to 360.
  TEST_ASSERT_TRUE(window(1320, 360, true, 1319) == WindowState::Closed);
  TEST_ASSERT_TRUE(window(1320, 360, true, 1320) == WindowState::Open);
  TEST_ASSERT_TRUE(window(1320, 360, true, 1439) == WindowState::Open);
  TEST_ASSERT_TRUE(window(1320, 360, true, 0) == WindowState::Open);
  TEST_ASSERT_TRUE(window(1320, 360, true, 359) == WindowState::Open);
  TEST_ASSERT_TRUE(window(1320, 360, true, 360) == WindowState::Closed);
  TEST_ASSERT_TRUE(window(1320, 360, true, 720) == WindowState::Closed);
  // From 23:59 to midnight is one minute.
  TEST_ASSERT_TRUE(window(1439, 0, true, 1438) == WindowState::Closed);
  TEST_ASSERT_TRUE(window(1439, 0, true, 1439) == WindowState::Open);
  TEST_ASSERT_TRUE(window(1439, 0, true, 0) == WindowState::Closed);
}

static void test_a_narrow_window_waits_for_the_time_when_it_is_not_known()
{
  TEST_ASSERT_TRUE(window(480, 1020, false, 600) == WindowState::WaitingForTime);
  TEST_ASSERT_TRUE(window(1320, 360, false, 0) == WindowState::WaitingForTime);
}

// ---- The updater against a fake host ----

class FakeHost : public Host
{
public:
  bool is_online = true;
  Error manifest_error = Error::None;
  std::string manifest_text;
  std::map<std::string, std::string> bodies;    // URL to content
  std::map<std::string, std::string> manifests; // URL to manifest, for the URLs that differ from manifest_text
  std::map<std::string, Error> download_errors;
  std::map<std::string, std::string> stored; // "a:id" or "p:id" to SHA-256
  std::map<std::string, Error> install_errors;
  size_t free_bytes = 100000;
  bool time_known = false;
  uint16_t minutes = 0;
  uint32_t jitter = 0;
  // The firmware side: what the board runs, its slot, and what the fake slot does.
  std::string running = "1.2.0", board = "esp32c3", skipped;
  size_t slot = 1000;
  Error firmware_download_error = Error::None, activate_error = Error::None;
  std::string firmware_body = "FIRMWARE";
  std::string firmware_url;
  std::vector<bool> http_allowed;          // per fetched manifest
  std::vector<bool> firmware_http_allowed; // per firmware download
  uint8_t progress = 0;
  int cleared = 0, activations = 0, restarts = 0, firmware_discards = 0;
  std::string activated;
  std::vector<std::string> events;
  bool needs_time = false;
  std::string zone;

  std::vector<std::string> fetched, downloaded, installed;
  const Updater *watched = nullptr; // when set, how many files its plan holds is noted at every manifest read
  std::vector<size_t> planned_at_fetch;
  size_t memory_budget = SIZE_MAX; // what memory_available() grants a manifest parse, in bytes at once
  int memory_asks = 0;
  int discards = 0, work_depth = 0, max_work_depth = 0;
  size_t install_calls_in_work = 0;

  bool online() override { return is_online; }
  void begin_large_work() override { max_work_depth = std::max(max_work_depth, ++work_depth); }
  void end_large_work() override { work_depth--; }
  Error fetch_manifest(const std::string &url, bool allow_http, ByteBuffer &out) override
  {
    TEST_ASSERT_TRUE(allow_http || url == firmware_url); // only the firmware manifest is HTTPS only
    http_allowed.push_back(allow_http);
    TEST_ASSERT_EQUAL(1, work_depth);
    fetched.push_back(url);
    if (watched)
      planned_at_fetch.push_back(watched->status().files);
    if (manifest_error != Error::None)
      return manifest_error;
    const std::string &text = manifests.count(url) ? manifests[url] : manifest_text;
    return out.append(text.data(), text.size()) == ByteBuffer::Append::Ok ? Error::None : Error::BadManifest;
  }
  Error download(const std::string &url, bool, size_t, Download &result) override
  {
    TEST_ASSERT_EQUAL(1, work_depth);
    downloaded.push_back(url);
    if (download_errors.count(url))
      return download_errors[url];
    const std::string &body = bodies[url];
    result.size = body.size();
    result.sha256 = sha256_hex(body);
    return Error::None;
  }
  Error install(Kind kind, const std::string &id) override
  {
    events.push_back("install");
    install_calls_in_work += work_depth; // a download is finished before the file is handed over
    const std::string key = std::string(kind == Kind::Animation ? "a:" : "p:") + id;
    if (install_errors.count(key))
      return install_errors[key];
    installed.push_back(key);
    stored[key] = "new";
    return Error::None;
  }
  std::function<bool(size_t, size_t)> memory_rule; // replaces the budget when set
  bool memory_available(size_t total, size_t block) override
  {
    memory_asks++;
    return memory_rule ? memory_rule(total, block) : total <= memory_budget;
  }
  void discard_download() override { discards++; }
  bool stored_digest(Kind kind, const std::string &id, std::string &sha256) override
  {
    auto it = stored.find(std::string(kind == Kind::Animation ? "a:" : "p:") + id);
    if (it == stored.end())
      return false;
    sha256 = it->second;
    return true;
  }
  bool free_space(size_t &bytes) override
  {
    bytes = free_bytes;
    return true;
  }
  bool local_minutes(uint16_t &m) override
  {
    m = minutes;
    return time_known;
  }
  uint32_t random_below(uint32_t bound) override { return jitter < bound ? jitter : bound - 1; }

  std::string running_firmware() override { return running; }
  std::string firmware_board() override { return board; }
  std::string skipped_firmware() override { return skipped; }
  void clear_skipped_firmware() override
  {
    skipped.clear();
    cleared++;
  }
  bool firmware_slot_size(size_t &bytes) override
  {
    bytes = slot;
    return true;
  }
  Error download_firmware(const std::string &url, bool allow_http, size_t, Download &result) override
  {
    firmware_http_allowed.push_back(allow_http);
    TEST_ASSERT_EQUAL(1, work_depth);
    events.push_back("download");
    downloaded.push_back(url);
    if (firmware_download_error != Error::None)
      return firmware_download_error;
    progress = 100;
    result.size = firmware_body.size();
    result.sha256 = sha256_hex(firmware_body);
    return Error::None;
  }
  Error activate_firmware(const std::string &version) override
  {
    events.push_back("activate");
    activations++;
    if (activate_error != Error::None)
      return activate_error;
    activated = version;
    return Error::None;
  }
  void discard_firmware() override
  {
    events.push_back("discard");
    firmware_discards++;
  }
  void restart_firmware() override
  {
    events.push_back("restart");
    restarts++;
  }
  uint8_t firmware_progress() override { return progress; }
  void time_config(bool needed, const std::string &timezone) override
  {
    needs_time = needed;
    zone = timezone;
  }
};

static const char *SOURCE = "https://example.test/pixelart/manifest.json";
static const std::string BASE = "https://example.test/pixelart/";

// A host serving the manifest and files for these (id, content) pairs.
static void serve(FakeHost &host, const std::vector<std::pair<std::string, std::string>> &animations,
                  const std::vector<std::pair<std::string, std::string>> &playlists = {})
{
  std::string a, p;
  for (const auto &[id, body] : animations)
  {
    a += (a.empty() ? "" : ",") +
         anim_entry(id, "animations/" + id + ".json", std::to_string(body.size()), sha256_hex(body));
    host.bodies[BASE + "animations/" + id + ".json"] = body;
  }
  for (const auto &[id, body] : playlists)
  {
    p += (p.empty() ? "" : ",") +
         anim_entry(id, "playlists/" + id + ".json", std::to_string(body.size()), sha256_hex(body));
    host.bodies[BASE + "playlists/" + id + ".json"] = body;
  }
  host.manifest_text = manifest(a, p);
}

static Config config(bool automatic = false)
{
  Config c;
  c.enabled = true;
  c.automatic = automatic;
  c.animation_source = SOURCE;
  return c;
}

// Ticks until the updater has nothing more to do right now, at time `now`.
static void settle(Updater &u, uint64_t now)
{
  u.tick(now);
  for (int i = 0; i < 100 && u.wait_ms(now) == 0; i++)
    u.tick(now);
  // A board that is about to restart stays busy, but has nothing more to do.
  TEST_ASSERT_EQUAL_UINT64_MESSAGE(0, u.busy() && u.wait_ms(now) == 0 ? 1 : 0, "still busy");
}

static void test_the_first_check_runs_5_minutes_after_the_first_address()
{
  FakeHost host;
  serve(host, {{"a", "AAA"}, {"b", "BBBB"}});
  Updater u(host);
  u.configure(config());
  u.tick(1000); // the first tick with an address
  TEST_ASSERT_EQUAL_UINT64(300000, u.wait_ms(1000));
  settle(u, 300999);
  TEST_ASSERT_EQUAL(0, host.fetched.size());
  TEST_ASSERT_TRUE(u.wait_ms(301000) == 0);
  u.tick(301000); // starts the check
  TEST_ASSERT_TRUE(u.status().state == State::Checking);
  TEST_ASSERT_EQUAL(0, host.fetched.size());
  u.tick(301000); // runs it
  TEST_ASSERT_EQUAL(1, host.fetched.size());
  TEST_ASSERT_EQUAL_STRING(SOURCE, host.fetched[0].c_str());
  Status s = u.status();
  TEST_ASSERT_TRUE(s.state == State::Idle);
  TEST_ASSERT_TRUE(s.has_last_check && s.last_check_at == 301000);
  TEST_ASSERT_TRUE(s.has_result && s.result == Error::None);
  TEST_ASSERT_EQUAL(2, s.files);
  // Notify mode downloads nothing. The next check is 6 hours away.
  TEST_ASSERT_EQUAL(0, host.downloaded.size());
  TEST_ASSERT_EQUAL_UINT64(301000 + 6ULL * 3600000, u.schedule().next_at());
  TEST_ASSERT_EQUAL_UINT64(6ULL * 3600000, u.wait_ms(301000));
  TEST_ASSERT_EQUAL(0, host.max_work_depth - 1); // the manifest read is one bracket of large work, never nested
}

static void test_the_delay_after_a_check_is_random_and_a_failure_retries_after_30_minutes()
{
  FakeHost host;
  host.jitter = 123456;
  serve(host, {{"a", "AAA"}});
  Updater u(host);
  u.configure(config());
  u.tick(0);
  settle(u, 300000);
  TEST_ASSERT_EQUAL_UINT64(300000 + 6ULL * 3600000 + 123456, u.schedule().next_at());

  FakeHost down;
  down.manifest_error = Error::NetworkError;
  Updater v(down);
  v.configure(config());
  v.tick(0);
  settle(v, 300000);
  TEST_ASSERT_TRUE(v.status().has_result && v.status().result == Error::NetworkError);
  TEST_ASSERT_EQUAL_UINT64(300000 + 1800000, v.schedule().next_at());
  settle(v, 2099999);
  TEST_ASSERT_EQUAL(1, down.fetched.size());
  settle(v, 2100000); // the retry
  TEST_ASSERT_EQUAL(2, down.fetched.size());
  down.manifest_error = Error::None;
  serve(down, {{"a", "AAA"}});
  settle(v, 2100000 + 1800000);
  TEST_ASSERT_EQUAL(3, down.fetched.size());
  TEST_ASSERT_TRUE(v.status().result == Error::None);
  TEST_ASSERT_EQUAL_UINT64(2100000 + 1800000 + 6ULL * 3600000, v.schedule().next_at());
}

static void test_nothing_is_checked_when_updates_are_off_or_the_board_is_offline()
{
  FakeHost host;
  serve(host, {{"a", "AAA"}});
  Updater u(host);
  Config off = config();
  off.enabled = false;
  u.configure(off);
  u.tick(0);
  settle(u, 10000000);
  TEST_ASSERT_EQUAL(0, host.fetched.size());
  TEST_ASSERT_FALSE(u.request_check()); // not even on request
  TEST_ASSERT_TRUE(u.wait_ms(0) == UINT64_MAX);

  FakeHost offline;
  serve(offline, {{"a", "AAA"}});
  offline.is_online = false;
  Updater v(offline);
  v.configure(config());
  settle(v, 0);
  settle(v, 10000000);
  TEST_ASSERT_EQUAL(0, offline.fetched.size());
  TEST_ASSERT_TRUE(v.wait_ms(10000000) == UINT64_MAX); // nothing to wake for: no spinning
  offline.is_online = true;
  settle(v, 10000000); // the address arrives: the schedule starts then
  settle(v, 10000000 + 299999);
  TEST_ASSERT_EQUAL(0, offline.fetched.size());
  settle(v, 10000000 + 300000);
  TEST_ASSERT_EQUAL(1, offline.fetched.size());
}

static void test_a_check_on_request_runs_at_once_and_a_second_one_is_refused_while_busy()
{
  FakeHost host;
  serve(host, {{"a", "AAA"}});
  Updater u(host);
  u.configure(config());
  TEST_ASSERT_TRUE(u.request_check());
  TEST_ASSERT_FALSE(u.request_check());
  TEST_ASSERT_TRUE(u.busy());
  TEST_ASSERT_TRUE(u.status().state == State::Checking);
  TEST_ASSERT_EQUAL_UINT64(0, u.wait_ms(5));
  settle(u, 5);
  TEST_ASSERT_EQUAL(1, host.fetched.size());
  TEST_ASSERT_EQUAL(1, u.status().files);
  TEST_ASSERT_TRUE(u.request_check()); // idle again
}

static void test_an_installation_downloads_checks_and_stores_every_file_and_counts_failures()
{
  FakeHost host;
  serve(host, {{"a", "AAA"}, {"b", "BBBB"}, {"c", "CCCCC"}}, {{"p", "PPPPPP"}});
  host.stored["a:b"] = sha256_hex("old b");
  host.stored["a:unlisted"] = "x";
  Updater u(host);
  u.configure(config());
  TEST_ASSERT_FALSE(u.request_install()); // nothing found yet
  TEST_ASSERT_TRUE(u.request_check());
  settle(u, 0);
  TEST_ASSERT_EQUAL(4, u.status().files);

  host.download_errors[BASE + "animations/b.json"] = Error::NetworkError;
  host.install_errors["p:p"] = Error::InvalidFile;
  TEST_ASSERT_TRUE(u.request_install());
  TEST_ASSERT_TRUE(u.status().state == State::Downloading);
  u.tick(10); // starts
  TEST_ASSERT_TRUE(u.status().state == State::Downloading);
  TEST_ASSERT_EQUAL(0, u.status().progress);
  u.tick(10); // a
  TEST_ASSERT_EQUAL(25, u.status().progress);
  u.tick(10); // b fails
  TEST_ASSERT_EQUAL(50, u.status().progress);
  TEST_ASSERT_EQUAL(1, u.status().failed_files);
  settle(u, 10);
  Status s = u.status();
  TEST_ASSERT_TRUE(s.state == State::Idle);
  TEST_ASSERT_EQUAL(0, s.progress);
  TEST_ASSERT_EQUAL(2, s.failed_files);                              // b and the playlist
  TEST_ASSERT_EQUAL(2, s.files);                                     // they are still to do
  TEST_ASSERT_TRUE(s.has_result && s.result == Error::NetworkError); // the first failure
  // The update went on after the failure: a and c are stored, in the order of the plan.
  TEST_ASSERT_EQUAL(2, host.installed.size());
  TEST_ASSERT_EQUAL_STRING("a:a", host.installed[0].c_str());
  TEST_ASSERT_EQUAL_STRING("a:c", host.installed[1].c_str());
  TEST_ASSERT_EQUAL(4, host.downloaded.size());
  TEST_ASSERT_EQUAL_STRING((BASE + "playlists/p.json").c_str(), host.downloaded[3].c_str());
  TEST_ASSERT_EQUAL(1, host.discards); // the failed download; the host itself removes a file the install refuses
  // The files nobody listed stay.
  TEST_ASSERT_EQUAL_STRING("x", host.stored["a:unlisted"].c_str());
  TEST_ASSERT_EQUAL(0, host.install_calls_in_work);
  TEST_ASSERT_EQUAL(1, host.max_work_depth);
}

static void test_cancelling_stops_an_installation_without_counting_a_failure()
{
  FakeHost host;
  serve(host, {{"a", "AAA"}, {"b", "BBBB"}, {"c", "CCCCC"}}, {});
  Updater u(host);
  u.configure(config());
  u.request_check();
  settle(u, 0);
  TEST_ASSERT_EQUAL(3, u.status().files);

  // Between two files: the files not stored yet are skipped and the plan is forgotten.
  u.request_install();
  u.tick(10); // starts
  u.tick(10); // a
  TEST_ASSERT_EQUAL(1, host.installed.size());
  u.cancel_install();
  TEST_ASSERT_TRUE(u.status().state == State::Idle);
  TEST_ASSERT_FALSE(u.busy());
  settle(u, 10);
  TEST_ASSERT_EQUAL(1, host.installed.size());
  TEST_ASSERT_EQUAL(0, u.status().files);
  TEST_ASSERT_EQUAL(0, u.status().failed_files);
  TEST_ASSERT_TRUE(u.status().has_result && u.status().result == Error::None); // the check's result stays
  TEST_ASSERT_FALSE(u.request_install());
}

static void test_a_file_the_loop_task_discards_ends_the_installation_quietly()
{
  FakeHost host;
  serve(host, {{"a", "AAA"}, {"b", "BBBB"}}, {});
  host.install_errors["a:a"] = Error::Cancelled;
  Updater u(host);
  u.configure(config());
  u.request_check();
  settle(u, 0);
  u.request_install();
  settle(u, 10);
  TEST_ASSERT_TRUE(u.status().state == State::Idle);
  TEST_ASSERT_EQUAL(1, host.downloaded.size()); // b was never fetched
  TEST_ASSERT_EQUAL(0, u.status().files);
  TEST_ASSERT_EQUAL(0, u.status().failed_files);
  TEST_ASSERT_TRUE(u.status().has_result && u.status().result == Error::None);
}

static void test_an_installation_that_was_asked_for_does_not_start_after_a_cancel()
{
  FakeHost host;
  serve(host, {{"a", "AAA"}}, {});
  Updater u(host);
  u.configure(config());
  u.request_check();
  settle(u, 0);
  TEST_ASSERT_TRUE(u.request_install());
  u.cancel_install();
  TEST_ASSERT_FALSE(u.busy());
  settle(u, 10);
  TEST_ASSERT_EQUAL(0, host.installed.size());
  TEST_ASSERT_EQUAL(0, u.status().files);
}

static void test_a_file_is_refused_for_its_size_checksum_or_the_free_space_without_stopping_the_update()
{
  FakeHost host;
  const std::string big(pixelart_update::size_limit(Kind::Playlist) + 1, 'x');
  // The manifest says 16,385 bytes for a playlist: over the limit of its kind, so it is never downloaded.
  host.manifest_text = manifest(anim_entry("ok", "animations/ok.json", "3", sha256_hex("OKK")) + "," +
                                    anim_entry("wrongsize", "animations/wrongsize.json", "9", sha256_hex("SSS")) + "," +
                                    anim_entry("wronghash", "animations/wronghash.json", "3", std::string(64, '0')),
                                anim_entry("huge", "playlists/huge.json", std::to_string(big.size()), sha256_hex(big)));
  host.bodies[BASE + "animations/ok.json"] = "OKK";
  host.bodies[BASE + "animations/wrongsize.json"] = "SSS";
  host.bodies[BASE + "animations/wronghash.json"] = "HHH";
  Updater u(host);
  u.configure(config());
  u.request_check();
  settle(u, 0);
  u.request_install();
  settle(u, 0);
  TEST_ASSERT_EQUAL(1, host.installed.size());
  TEST_ASSERT_EQUAL(3, u.status().failed_files);
  // Playlists never reached the network: the huge one failed on its size alone.
  TEST_ASSERT_EQUAL(3, host.downloaded.size());
  TEST_ASSERT_EQUAL(2, host.discards);
  // wrongsize comes first among the failures, in plan order: the first error is the one reported.
  TEST_ASSERT_TRUE(u.status().result == Error::ChecksumMismatch);

  // 4,096 bytes are free: a 4,097 byte file needs two blocks and does not fit, a 4,096 byte one does.
  FakeHost space;
  const std::string fits(4096, 'f'), too_big(4097, 'g');
  serve(space, {{"fits", fits}, {"toobig", too_big}});
  space.free_bytes = 4096;
  Updater v(space);
  v.configure(config());
  v.request_check();
  settle(v, 0);
  v.request_install();
  settle(v, 0);
  TEST_ASSERT_EQUAL(1, space.installed.size());
  TEST_ASSERT_EQUAL_STRING("a:fits", space.installed[0].c_str());
  TEST_ASSERT_TRUE(v.status().result == Error::NoSpace);
  TEST_ASSERT_EQUAL(1, v.status().failed_files);
  TEST_ASSERT_EQUAL(1, space.downloaded.size());
}

static void test_a_bad_manifest_is_a_failed_check_that_forgets_the_last_plan()
{
  FakeHost host;
  serve(host, {{"a", "AAA"}});
  Updater u(host);
  u.configure(config());
  u.request_check();
  settle(u, 0);
  TEST_ASSERT_EQUAL(1, u.status().files);
  host.manifest_text = "{\"format\":\"pixelart-manifest/2\"}";
  u.request_check();
  settle(u, 100);
  TEST_ASSERT_TRUE(u.status().result == Error::BadManifest);
  TEST_ASSERT_TRUE(u.last_reason().find("format") != std::string::npos);
  TEST_ASSERT_EQUAL(0, u.status().files);
  TEST_ASSERT_FALSE(u.request_install()); // nothing to install
  TEST_ASSERT_TRUE(u.status().has_last_check && u.status().last_check_at == 100);
}

static void test_a_manifest_that_answers_404_is_an_http_error_with_the_detail_no_release()
{
  TEST_ASSERT_EQUAL_STRING("http_error", pixelart_update::error_code(Error::ManifestNotFound));
  TEST_ASSERT_EQUAL_STRING("no_release", pixelart_update::error_detail(Error::ManifestNotFound));
  TEST_ASSERT_NULL(pixelart_update::error_detail(Error::HttpError));
  TEST_ASSERT_NULL(pixelart_update::error_detail(Error::None));
  TEST_ASSERT_NULL(pixelart_update::error_detail(Error::NetworkError));

  FakeHost host;
  serve(host, {{"a", "AAA"}});
  Updater u(host);
  u.configure(config());
  host.manifest_error = Error::ManifestNotFound;
  u.request_check();
  settle(u, 0);
  TEST_ASSERT_TRUE(u.status().result == Error::ManifestNotFound);
  TEST_ASSERT_TRUE(u.status().has_result && u.status().files == 0);
  // Another answer replaces it, and so does a check that works.
  host.manifest_error = Error::HttpError;
  u.request_check();
  settle(u, 100);
  TEST_ASSERT_TRUE(u.status().result == Error::HttpError);
  host.manifest_error = Error::None;
  u.request_check();
  settle(u, 200);
  TEST_ASSERT_TRUE(u.status().result == Error::None);
}

static void test_the_firmware_manifest_answering_404_is_reported_the_same_way()
{
  FakeHost host;
  serve(host, {{"a", "AAA"}});
  Updater u(host);
  Config c = config();
  c.firmware_manifest = "https://example.test/project/manifest.json";
  host.firmware_url = c.firmware_manifest;
  u.configure(c);
  host.manifest_error = Error::ManifestNotFound;
  u.request_check();
  settle(u, 0);
  TEST_ASSERT_TRUE(u.status().result == Error::ManifestNotFound);
}

static void test_automatic_mode_installs_after_a_check_inside_the_window()
{
  FakeHost host;
  serve(host, {{"a", "AAA"}});
  Updater u(host);
  Config c = config(true); // the whole day
  u.configure(c);
  u.request_check();
  settle(u, 0);
  TEST_ASSERT_EQUAL(1, host.installed.size());
  TEST_ASSERT_EQUAL(0, u.status().files);
  TEST_ASSERT_TRUE(u.status().result == Error::None);

  // Notify mode never installs by itself.
  FakeHost notify;
  serve(notify, {{"a", "AAA"}});
  Updater v(notify);
  v.configure(config(false));
  v.request_check();
  settle(v, 0);
  TEST_ASSERT_EQUAL(0, notify.installed.size());
}

static void test_automatic_mode_waits_for_the_window_and_checks_again_when_it_opens()
{
  FakeHost host;
  serve(host, {{"a", "AAA"}});
  host.time_known = true;
  host.minutes = 600; // 10:00
  Updater u(host);
  Config c = config(true);
  c.install_start = 1320; // 22:00 to 06:00
  c.install_end = 360;
  u.configure(c);
  u.request_check();
  settle(u, 0);
  TEST_ASSERT_EQUAL(0, host.installed.size());
  TEST_ASSERT_EQUAL(1, u.status().files);
  TEST_ASSERT_TRUE(u.status().state == State::Idle);
  TEST_ASSERT_EQUAL_UINT64(60000, u.wait_ms(0)); // it looks at the clock every minute

  host.minutes = 1319;
  settle(u, 60000);
  TEST_ASSERT_EQUAL(0, host.installed.size());
  host.minutes = 1320;
  TEST_ASSERT_EQUAL(1, host.fetched.size());
  settle(u, 120000);
  TEST_ASSERT_EQUAL(2, host.fetched.size()); // a fresh manifest first
  TEST_ASSERT_EQUAL(1, host.installed.size());
  TEST_ASSERT_EQUAL(0, u.status().files);
}

static void test_automatic_mode_reports_waiting_for_time_and_installs_when_the_time_is_known()
{
  FakeHost host;
  serve(host, {{"a", "AAA"}});
  Updater u(host);
  Config c = config(true);
  c.install_start = 60;
  c.install_end = 120; // 01:00 to 02:00
  u.configure(c);
  u.request_check();
  settle(u, 0);
  TEST_ASSERT_TRUE(u.status().state == State::WaitingForTime);
  TEST_ASSERT_EQUAL(1, u.status().files);
  TEST_ASSERT_EQUAL(0, host.installed.size());
  u.tick(60000);
  TEST_ASSERT_TRUE(u.status().state == State::WaitingForTime);
  host.time_known = true;
  host.minutes = 90;
  settle(u, 120000);
  TEST_ASSERT_EQUAL(1, host.installed.size());
  TEST_ASSERT_TRUE(u.status().state == State::Idle);
  // Checks run at any time, whatever the window.
  FakeHost closed;
  serve(closed, {{"a", "AAA"}});
  closed.time_known = true;
  closed.minutes = 600;
  Updater v(closed);
  v.configure(c);
  v.request_check();
  settle(v, 0);
  TEST_ASSERT_EQUAL(1, closed.fetched.size());
}

static void test_an_installation_on_request_ignores_the_window()
{
  FakeHost host;
  serve(host, {{"a", "AAA"}});
  Updater u(host);
  Config c = config(false);
  c.install_start = 60;
  c.install_end = 120;
  u.configure(c);
  u.request_check();
  settle(u, 0);
  TEST_ASSERT_TRUE(u.request_install());
  settle(u, 0);
  TEST_ASSERT_EQUAL(1, host.installed.size());
}

static void test_changing_the_source_or_turning_updates_off_forgets_what_was_found()
{
  FakeHost host;
  serve(host, {{"a", "AAA"}});
  Updater u(host);
  u.configure(config());
  u.request_check();
  settle(u, 0);
  TEST_ASSERT_EQUAL(1, u.status().files);
  Config other = config();
  other.animation_source = "https://other.test/manifest.json";
  u.configure(other);
  TEST_ASSERT_EQUAL(0, u.status().files);
  TEST_ASSERT_FALSE(u.request_install());
  u.configure(config());
  u.request_check();
  settle(u, 0);
  TEST_ASSERT_EQUAL(1, u.status().files);
  Config off = config();
  off.enabled = false;
  u.configure(off);
  TEST_ASSERT_EQUAL(0, u.status().files);
  Config no_animations = config();
  no_animations.animations = false;
  u.configure(config());
  u.request_check();
  settle(u, 0);
  u.configure(no_animations);
  TEST_ASSERT_EQUAL(0, u.status().files);
}

static void test_an_unusable_source_url_fails_the_check_without_a_request()
{
  FakeHost host;
  Updater u(host);
  Config c = config();
  c.animation_source = "ftp://nowhere/m.json";
  u.configure(c);
  u.request_check();
  settle(u, 0);
  TEST_ASSERT_EQUAL(0, host.fetched.size());
  TEST_ASSERT_TRUE(u.status().result == Error::NetworkError);
}

// ---- Firmware updates against a fake host ----

static const std::string PROJECT = "https://example.test/project/manifest.json";
static const std::string PROJECT_BASE = "https://example.test/project/";

static std::string firmware_entry(const std::string &board, const std::string &body)
{
  return "{\"board\":\"" + board +
         "\",\"chip\":\"ESP32-C3\",\"part\":\"app\",\"offset\":65536,\"file\":"
         "\"firmware/" +
         board + "/app.bin\",\"size\":" + std::to_string(body.size()) + ",\"sha256\":\"" + sha256_hex(body) + "\"}";
}

// A host whose project manifest offers `version` for its board, running 1.2.0.
static void serve_firmware(FakeHost &host, const std::string &version = "1.3.0", const std::string &board = "esp32c3")
{
  host.firmware_url = PROJECT;
  host.bodies[PROJECT_BASE + "firmware/" + board + "/app.bin"] = host.firmware_body;
  host.manifests[PROJECT] = manifest("", "", firmware_entry(board, host.firmware_body), version);
}

static Config firmware_config(bool automatic = false)
{
  Config c = config(automatic);
  c.animations = false;
  c.firmware_manifest = PROJECT;
  c.timezone = "CET-1CEST,M3.5.0,M10.5.0/3";
  return c;
}

static void check(Updater &u, uint64_t now = 0)
{
  TEST_ASSERT_TRUE(u.request_check());
  settle(u, now);
}

static void test_a_check_offers_the_firmware_for_this_board_when_it_is_newer()
{
  FakeHost host;
  serve_firmware(host);
  Updater u(host);
  u.configure(firmware_config());
  TEST_ASSERT_FALSE(u.request_firmware(false)); // nothing found yet
  check(u);
  TEST_ASSERT_EQUAL_STRING("1.3.0", u.status().firmware.c_str());
  TEST_ASSERT_FALSE(u.status().firmware_skipped);
  TEST_ASSERT_EQUAL(1, host.fetched.size());
  TEST_ASSERT_EQUAL_STRING(PROJECT.c_str(), host.fetched[0].c_str());
  TEST_ASSERT_FALSE(host.http_allowed[0]);

  // An equal or a lower version is no update, and neither is a firmware for another board.
  host.running = "1.3.0";
  check(u);
  TEST_ASSERT_TRUE(u.status().firmware.empty());
  TEST_ASSERT_FALSE(u.request_firmware(true));
  host.running = "1.4.0";
  check(u);
  TEST_ASSERT_TRUE(u.status().firmware.empty());
  host.running = "1.2.0";
  host.board = "esp32";
  check(u);
  TEST_ASSERT_TRUE(u.status().firmware.empty());
  // A development build of the release's number is older than the release.
  host.board = "esp32c3";
  host.running = "1.3.0-dev.2+gabc1234";
  check(u);
  TEST_ASSERT_EQUAL_STRING("1.3.0", u.status().firmware.c_str());
  // A version that is not Semantic Versioning never counts, and neither does one the records cannot hold.
  host.running = "unknown";
  check(u);
  TEST_ASSERT_TRUE(u.status().firmware.empty());
  host.running = "1.2.0";
  serve_firmware(host, "1.3.0-" + std::string(70, 'a'));
  check(u);
  TEST_ASSERT_TRUE(u.status().firmware.empty());
}

static void test_the_firmware_switch_off_never_reads_the_project_manifest()
{
  FakeHost host;
  serve_firmware(host);
  Updater u(host);
  Config c = firmware_config();
  c.firmware = false;
  c.animations = true;
  u.configure(c);
  host.manifests[SOURCE] = manifest("", "");
  check(u);
  TEST_ASSERT_EQUAL(1, host.fetched.size());
  TEST_ASSERT_EQUAL_STRING(SOURCE, host.fetched[0].c_str());
  TEST_ASSERT_TRUE(u.status().firmware.empty());
  TEST_ASSERT_FALSE(u.request_firmware(false));

  // Turning the switch off forgets what a check found.
  Updater v(host);
  v.configure(firmware_config());
  check(v);
  TEST_ASSERT_FALSE(v.status().firmware.empty());
  v.configure(c);
  TEST_ASSERT_TRUE(v.status().firmware.empty());
  Config none = firmware_config();
  none.firmware_manifest = "";
  FakeHost quiet;
  Updater w(quiet);
  w.configure(none);
  check(w);
  TEST_ASSERT_EQUAL(0, quiet.fetched.size());
}

static void test_a_manifest_that_is_both_sources_is_read_once()
{
  FakeHost host;
  serve_firmware(host);
  host.firmware_url = PROJECT;
  const std::string red = "RED";
  host.manifests[PROJECT] = manifest(anim_entry("red", "animations/red.json", "3", sha256_hex(red)), "",
                                     firmware_entry("esp32c3", host.firmware_body), "1.3.0");
  Updater u(host);
  Config c = firmware_config();
  c.animations = true;
  c.animation_source = PROJECT;
  u.configure(c);
  check(u);
  TEST_ASSERT_EQUAL(1, host.fetched.size());
  TEST_ASSERT_EQUAL(1, u.status().files);
  TEST_ASSERT_EQUAL_STRING("1.3.0", u.status().firmware.c_str());
}

static void test_each_manifest_that_fails_fails_the_check_but_the_other_result_stays()
{
  FakeHost host;
  serve_firmware(host);
  host.manifests[SOURCE] = manifest(anim_entry("red", "animations/red.json", "3", sha256_hex("RED")), "");
  Updater u(host);
  Config c = firmware_config();
  c.animations = true;
  u.configure(c);
  check(u);
  TEST_ASSERT_TRUE(u.status().result == Error::None);
  TEST_ASSERT_EQUAL(1, u.status().files);
  TEST_ASSERT_EQUAL_STRING("1.3.0", u.status().firmware.c_str());

  host.manifests[PROJECT] = "not json";
  check(u, 1);
  TEST_ASSERT_TRUE(u.status().result == Error::BadManifest);
  TEST_ASSERT_EQUAL(1, u.status().files);
  TEST_ASSERT_EQUAL_STRING("1.3.0", u.status().firmware.c_str()); // the last check's answer stays

  serve_firmware(host);
  host.manifests[SOURCE] = "not json";
  check(u, 2);
  TEST_ASSERT_TRUE(u.status().result == Error::BadManifest);
  TEST_ASSERT_EQUAL_STRING("1.3.0", u.status().firmware.c_str());
}

static void test_no_plan_is_held_while_a_manifest_is_read()
{
  FakeHost host;
  serve_firmware(host);
  host.manifests[SOURCE] = manifest(anim_entry("red", "animations/red.json", "3", sha256_hex("RED")) + "," +
                                        anim_entry("blue", "animations/blue.json", "4", sha256_hex("BLUE")),
                                    "");
  Updater u(host);
  host.watched = &u;
  Config c = firmware_config();
  c.animations = true;
  u.configure(c);
  check(u);
  TEST_ASSERT_EQUAL(2, u.status().files);
  // The firmware manifest of another address is read first, before the animations are planned.
  TEST_ASSERT_EQUAL(2, host.fetched.size());
  TEST_ASSERT_EQUAL_STRING(PROJECT.c_str(), host.fetched[0].c_str());
  TEST_ASSERT_EQUAL_STRING(SOURCE, host.fetched[1].c_str());

  // The next check forgets the plan before it reads anything, so a failed read leaves no files to install.
  host.manifests[SOURCE] = "not json";
  check(u, 1);
  TEST_ASSERT_EQUAL(4, host.planned_at_fetch.size());
  for (size_t files : host.planned_at_fetch)
    TEST_ASSERT_EQUAL(0, files);
  TEST_ASSERT_TRUE(u.status().result == Error::BadManifest);
  TEST_ASSERT_EQUAL(0, u.status().files);
  TEST_ASSERT_EQUAL_STRING("1.3.0", u.status().firmware.c_str());
}

static void test_a_skipped_version_is_reported_and_installs_only_by_force()
{
  FakeHost host;
  host.skipped = "1.3.0";
  serve_firmware(host);
  Updater u(host);
  u.configure(firmware_config());
  check(u);
  TEST_ASSERT_EQUAL_STRING("1.3.0", u.status().firmware.c_str());
  TEST_ASSERT_TRUE(u.status().firmware_skipped);
  TEST_ASSERT_FALSE(u.request_firmware(false));
  TEST_ASSERT_TRUE(u.request_firmware(true));
}

static void test_a_release_newer_than_the_skipped_version_ends_the_skip()
{
  FakeHost host;
  host.skipped = "1.3.0";
  serve_firmware(host, "1.4.0");
  Updater u(host);
  u.configure(firmware_config());
  check(u);
  TEST_ASSERT_EQUAL(1, host.cleared);
  TEST_ASSERT_FALSE(u.status().firmware_skipped);
  TEST_ASSERT_TRUE(u.request_firmware(false));

  // A release between the running firmware and the skipped version does not end it.
  FakeHost other;
  other.skipped = "1.4.0";
  serve_firmware(other, "1.3.0");
  Updater v(other);
  v.configure(firmware_config());
  check(v);
  TEST_ASSERT_EQUAL(0, other.cleared);
  TEST_ASSERT_EQUAL_STRING("1.4.0", other.skipped.c_str());
}

static void test_http_for_firmware_is_for_test_builds_only()
{
  // Without the flag the firmware manifest and the firmware are HTTPS only.
  FakeHost release;
  serve_firmware(release);
  Updater r(release);
  r.configure(firmware_config());
  check(r);
  TEST_ASSERT_TRUE(r.request_firmware(false));
  r.tick(10);
  r.tick(10);
  TEST_ASSERT_FALSE(release.http_allowed[0]);
  TEST_ASSERT_EQUAL(1, release.firmware_http_allowed.size());
  TEST_ASSERT_FALSE(release.firmware_http_allowed[0]);

  FakeHost test;
  serve_firmware(test);
  Updater t(test);
  Config c = firmware_config();
  c.firmware_allow_http = true;
  t.configure(c);
  check(t);
  TEST_ASSERT_TRUE(t.request_firmware(false));
  t.tick(10);
  t.tick(10);
  TEST_ASSERT_TRUE(test.http_allowed[0]);
  TEST_ASSERT_EQUAL(1, test.firmware_http_allowed.size());
  TEST_ASSERT_TRUE(test.firmware_http_allowed[0]);
}

static void test_a_firmware_install_downloads_checks_activates_and_restarts()
{
  FakeHost host;
  serve_firmware(host);
  Updater u(host);
  u.configure(firmware_config());
  check(u);
  TEST_ASSERT_TRUE(u.request_firmware(false));
  TEST_ASSERT_TRUE(u.status().state == State::Installing); // asked for: the matrix can show the icon
  u.tick(10);
  // The first tick only starts it, so the icon is on the matrix before the download.
  TEST_ASSERT_TRUE(u.status().state == State::Installing);
  TEST_ASSERT_EQUAL(0, host.events.size());
  host.progress = 40;
  TEST_ASSERT_EQUAL(40, u.status().progress);
  u.tick(10);
  const std::vector<std::string> want = {"download", "activate", "restart"};
  TEST_ASSERT_TRUE(host.events == want);
  TEST_ASSERT_EQUAL_STRING((PROJECT_BASE + "firmware/esp32c3/app.bin").c_str(), host.downloaded.back().c_str());
  TEST_ASSERT_EQUAL_STRING("1.3.0", host.activated.c_str());
  // The board is about to restart: it takes no more work and stays "installing".
  TEST_ASSERT_TRUE(u.status().state == State::Installing);
  TEST_ASSERT_EQUAL(100, u.status().progress);
  TEST_ASSERT_TRUE(u.busy());
  TEST_ASSERT_FALSE(u.request_check());
  TEST_ASSERT_FALSE(u.request_firmware(true));
  TEST_ASSERT_TRUE(u.wait_ms(20) == UINT64_MAX);
  u.tick(20);
  TEST_ASSERT_EQUAL(1, host.restarts);
}

static void test_a_firmware_install_that_fails_leaves_the_slot_alone_and_can_be_repeated()
{
  struct Case
  {
    const char *label;
    Error expected;
    std::vector<std::string> events;
    void (*arrange)(FakeHost &);
  };
  const Case cases[] = {
      {"the connection drops",
       Error::NetworkError,
       {"download", "discard"},
       [](FakeHost &h)
       {
         h.firmware_download_error = Error::NetworkError;
       }},
      {"the certificate is refused",
       Error::TlsError,
       {"download", "discard"},
       [](FakeHost &h)
       {
         h.firmware_download_error = Error::TlsError;
       }},
      {"the server answers an error",
       Error::HttpError,
       {"download", "discard"},
       [](FakeHost &h)
       {
         h.firmware_download_error = Error::HttpError;
       }},
      {"the slot cannot be written",
       Error::FlashError,
       {"download", "discard"},
       [](FakeHost &h)
       {
         h.firmware_download_error = Error::FlashError;
       }},
      {"the content is not the manifest's",
       Error::ChecksumMismatch,
       {"download", "discard"},
       [](FakeHost &h)
       {
         h.firmware_body = "OTHER000";
       }},
      {"the size is not the manifest's",
       Error::ChecksumMismatch,
       {"download", "discard"},
       [](FakeHost &h)
       {
         h.firmware_body = "FIRM";
       }},
      {"the image is larger than the slot",
       Error::FlashError,
       {},
       [](FakeHost &h)
       {
         h.slot = 7;
       }},
      {"the image is not a firmware",
       Error::FlashError,
       {"download", "activate", "discard"},
       [](FakeHost &h)
       {
         h.activate_error = Error::FlashError;
       }},
  };
  for (const Case &c : cases)
  {
    FakeHost host;
    serve_firmware(host);
    Updater u(host);
    u.configure(firmware_config());
    check(u);
    c.arrange(host);
    // The manifest was read with the good body: change what the host serves, not what it promised.
    TEST_ASSERT_TRUE_MESSAGE(u.request_firmware(false), c.label);
    settle(u, 5);
    TEST_ASSERT_TRUE_MESSAGE(host.events == c.events, c.label);
    TEST_ASSERT_EQUAL_MESSAGE(0, host.restarts, c.label);
    TEST_ASSERT_TRUE_MESSAGE(u.status().state == State::Idle, c.label);
    TEST_ASSERT_TRUE_MESSAGE(u.status().has_result && u.status().result == c.expected, c.label);
    TEST_ASSERT_EQUAL_STRING_MESSAGE("1.3.0", u.status().firmware.c_str(), c.label); // still offered
    TEST_ASSERT_TRUE_MESSAGE(u.request_firmware(false), c.label);                    // and can be tried again
  }
}

static void test_an_automatic_install_stores_the_animations_before_the_firmware()
{
  FakeHost host;
  serve_firmware(host);
  host.manifests[PROJECT] = manifest(anim_entry("red", "animations/red.json", "3", sha256_hex("RED")), "",
                                     firmware_entry("esp32c3", host.firmware_body), "1.3.0");
  host.bodies[PROJECT_BASE + "animations/red.json"] = "RED";
  Updater u(host);
  Config c = firmware_config(true);
  c.animations = true;
  c.animation_source = PROJECT;
  u.configure(c);
  check(u);
  const std::vector<std::string> want = {"install", "download", "activate", "restart"};
  TEST_ASSERT_TRUE(host.events == want);

  // Without animations to store, the firmware goes straight on.
  FakeHost only;
  serve_firmware(only);
  Updater v(only);
  v.configure(firmware_config(true));
  check(v);
  const std::vector<std::string> alone = {"download", "activate", "restart"};
  TEST_ASSERT_TRUE(only.events == alone);
}

static void test_an_automatic_install_waits_for_its_window_and_never_installs_a_skipped_version()
{
  FakeHost host;
  serve_firmware(host);
  Config narrow = firmware_config(true);
  narrow.install_start = 60;
  narrow.install_end = 120;
  Updater u(host);
  u.configure(narrow);
  host.time_known = true;
  host.minutes = 600;
  check(u);
  TEST_ASSERT_EQUAL(0, host.events.size());
  TEST_ASSERT_EQUAL_STRING("1.3.0", u.status().firmware.c_str());
  TEST_ASSERT_TRUE(u.status().state == State::Idle);
  host.minutes = 60; // the window opens: a fresh check, then the install
  u.tick(100);
  settle(u, 100);
  TEST_ASSERT_EQUAL(2, host.fetched.size());
  TEST_ASSERT_EQUAL(1, host.restarts);

  FakeHost without_time;
  serve_firmware(without_time);
  Updater v(without_time);
  v.configure(narrow);
  check(v);
  TEST_ASSERT_TRUE(v.status().state == State::WaitingForTime);
  TEST_ASSERT_EQUAL(0, without_time.events.size());

  FakeHost skipped;
  skipped.skipped = "1.3.0";
  serve_firmware(skipped);
  Updater w(skipped);
  w.configure(firmware_config(true));
  check(w);
  TEST_ASSERT_EQUAL(0, skipped.events.size());
  TEST_ASSERT_TRUE(w.status().firmware_skipped);
  // An install by request ignores the window and, with force, the skip.
  TEST_ASSERT_TRUE(w.request_firmware(true));
  settle(w, 1);
  TEST_ASSERT_EQUAL(1, skipped.restarts);
}

static void test_a_changed_animation_source_keeps_a_firmware_install_waiting_for_its_window()
{
  FakeHost host;
  serve_firmware(host);
  Config narrow = firmware_config(true);
  narrow.install_start = 60;
  narrow.install_end = 120;
  Updater u(host);
  u.configure(narrow);
  host.time_known = true;
  host.minutes = 600;
  check(u);
  TEST_ASSERT_EQUAL(0, host.events.size());
  narrow.animation_source = "https://other.test/manifest.json";
  u.configure(narrow);
  TEST_ASSERT_EQUAL_STRING("1.3.0", u.status().firmware.c_str());
  host.minutes = 60; // the window opens
  u.tick(100);
  settle(u, 100);
  TEST_ASSERT_EQUAL(1, host.restarts);
}

static void test_the_time_is_needed_only_for_a_window_narrower_than_the_day()
{
  FakeHost host;
  Updater u(host);
  Config c = firmware_config();
  u.configure(c);
  u.tick(0);
  TEST_ASSERT_FALSE(host.needs_time);
  c.install_start = 60;
  c.install_end = 120;
  u.configure(c);
  u.tick(0);
  TEST_ASSERT_TRUE(host.needs_time);
  TEST_ASSERT_EQUAL_STRING("CET-1CEST,M3.5.0,M10.5.0/3", host.zone.c_str());
  c.enabled = false;
  u.configure(c);
  u.tick(0);
  TEST_ASSERT_FALSE(host.needs_time);
  c.enabled = true;
  c.install_end = 60; // equal: the whole day
  u.configure(c);
  u.tick(0);
  TEST_ASSERT_FALSE(host.needs_time);
}

static void test_byte_buffer_stops_at_its_limit()
{
  ByteBuffer buffer(10);
  TEST_ASSERT_TRUE(buffer.append("12345", 5) == ByteBuffer::Append::Ok);
  TEST_ASSERT_TRUE(buffer.append("67890", 5) == ByteBuffer::Append::Ok);
  TEST_ASSERT_TRUE(buffer.append("x", 1) == ByteBuffer::Append::TooLarge);
  TEST_ASSERT_EQUAL(10, buffer.size());
  TEST_ASSERT_EQUAL_STRING_LEN("1234567890", buffer.data(), 10);
  ByteBuffer other(10);
  TEST_ASSERT_TRUE(other.reserve(11) == ByteBuffer::Append::TooLarge);
  TEST_ASSERT_TRUE(other.reserve(10) == ByteBuffer::Append::Ok);
  other.clear();
  TEST_ASSERT_EQUAL(0, other.size());
  TEST_ASSERT_EQUAL_STRING("ok", error_code(Error::None));
  TEST_ASSERT_EQUAL_STRING("flash_error", error_code(Error::FlashError));
  TEST_ASSERT_EQUAL_STRING("checksum_mismatch", error_code(Error::ChecksumMismatch));
}

// ---- The update icon ----

// The grid of docs/board/wifi-and-updates-v1.md#update-icon, written out by hand for 50 %.
static const char *const ICON_AT_HALF[16] = {
    "................", ".......AA.......", ".......AA.......", ".......AA.......",
    ".......AA.......", ".......AA.......", "....AAAAAAAA....", ".....AAAAAA.....",
    "......AAAA......", ".......AA.......", "................", "..T..........T..",
    "..T..........T..", "..TTTTTTTTTTTT..", "................", "PPPPPPPP........"};

static void test_the_update_icon_is_the_grid_of_the_specification()
{
  for (int y = 0; y < 16; y++)
    for (int x = 0; x < 16; x++)
    {
      uint32_t want = 0;
      switch (ICON_AT_HALF[y][x])
      {
      case 'A':
        want = 0x00FFFF;
        break;
      case 'T':
        want = 0x808080;
        break;
      case 'P':
        want = 0x00FF00;
        break;
      default:
        want = y == 15 ? 0x202020 : 0; // the rest of the bottom row is dark grey
      }
      TEST_ASSERT_EQUAL_HEX32_MESSAGE(want, update_icon::pixel(x, y, 50),
                                      ("pixel " + std::to_string(x) + "," + std::to_string(y)).c_str());
    }
  TEST_ASSERT_EQUAL_HEX32(0, update_icon::pixel(-1, 0, 0));
  TEST_ASSERT_EQUAL_HEX32(0, update_icon::pixel(16, 15, 0));
  TEST_ASSERT_EQUAL_HEX32(0, update_icon::pixel(0, 16, 0));
}

static int filled_pixels(uint8_t percent)
{
  int filled = 0;
  for (int x = 0; x < 16; x++)
    filled += update_icon::pixel(x, 15, percent) == 0x00FF00;
  return filled;
}

static void test_the_progress_bar_fills_a_sixteenth_per_6_and_a_quarter_percent()
{
  TEST_ASSERT_EQUAL(0, filled_pixels(0));
  TEST_ASSERT_EQUAL(0, filled_pixels(6));   // 6 * 16 / 100 = 0.96, rounded down
  TEST_ASSERT_EQUAL(1, filled_pixels(7));   // 1.12
  TEST_ASSERT_EQUAL(4, filled_pixels(25));  // 4
  TEST_ASSERT_EQUAL(8, filled_pixels(50));  // 8
  TEST_ASSERT_EQUAL(15, filled_pixels(99)); // 15.84
  TEST_ASSERT_EQUAL(16, filled_pixels(100));
  TEST_ASSERT_EQUAL(16, filled_pixels(250)); // clamped
  // The filled part is the left part.
  TEST_ASSERT_EQUAL_HEX32(0x00FF00, update_icon::pixel(3, 15, 25));
  TEST_ASSERT_EQUAL_HEX32(0x202020, update_icon::pixel(4, 15, 25));
}

// ---- Whole updates in the simulator ----

namespace
{

// Every request has its own `seq`: the board answers a repeated one from its cache.
JsonDocument ask(const std::string &fields)
{
  static unsigned seq = 0;
  const std::string reply =
      protocol::handle_line(protocol_frame("{\"seq\":" + std::to_string(++seq) + "," + fields + "}"));
  TEST_ASSERT_TRUE_MESSAGE(reply.rfind("@PR ", 0) == 0, reply.c_str());
  JsonDocument doc;
  TEST_ASSERT_FALSE_MESSAGE(deserializeJson(doc, reply.substr(13)), reply.c_str());
  return doc;
}

std::string error_of(const std::string &fields)
{
  JsonDocument doc = ask(fields);
  if (doc["ok"].as<bool>())
    return "";
  return doc["error"].as<std::string>();
}

JsonDocument status_update()
{
  JsonDocument doc = ask("\"cmd\":\"status\"");
  JsonDocument update;
  update.set(doc["update"]);
  return update;
}

// Lets the updater run until it has nothing to do.
void drive()
{
  for (int i = 0; i < 1000; i++)
  {
    updates::poll();
    const std::string state = updates::snapshot().state;
    if (state == "idle" || state == "waiting_for_time")
    {
      updates::poll();
      return;
    }
  }
  TEST_FAIL_MESSAGE("the update did not end");
}

const std::string PLAYLIST =
    R"({"format":"pixelart-playlist/1","canvas":{"width":16,"height":16},"name":"Default","items":[{"animation":"red"}]})";

struct Source
{
  std::map<std::string, std::string> files;

  void add_animation(const std::string &id, const std::string &body)
  {
    files["animations/" + id + ".json"] = body;
    animations.push_back(anim_entry(id, "animations/" + id + ".json", std::to_string(body.size()), sha256_hex(body)));
  }
  void add_playlist(const std::string &id, const std::string &body)
  {
    files["playlists/" + id + ".json"] = body;
    playlists.push_back(anim_entry(id, "playlists/" + id + ".json", std::to_string(body.size()), sha256_hex(body)));
  }
  void publish(const std::string &version = "1.2.0")
  {
    std::string a, p;
    for (const std::string &e : animations)
      a += (a.empty() ? "" : ",") + e;
    for (const std::string &e : playlists)
      p += (p.empty() ? "" : ",") + e;
    files["manifest.json"] = manifest(a, p, "", version);
    updates::sim_use_files(files);
  }

private:
  std::vector<std::string> animations, playlists;
};

// A fresh board with the update source `source` and these settings (a JSON object of settings_set fields).
struct Board
{
  TempData data;
  explicit Board(const char *name, const std::string &set = "") : data(name)
  {
    sim::reset();
    sim::detail::state().opts.max_us = UINT64_MAX; // the tests let hours pass
    updates::sim_reset();
    setup();
    updates::sim_use_nothing();
    if (!set.empty())
      TEST_ASSERT_TRUE(ask("\"cmd\":\"settings_set\"," + set)["ok"].as<bool>());
  }
  ~Board() { updates::sim_reset(); }
};

// The default mode is automatic: these tests are about what a check finds and reports.
const char *const NOTIFY = R"("update_mode":"notify")";

const std::string RED = DOT;
const std::string GREEN = pixelart_test::dot_animation("#00ff00");

} // namespace

static void test_update_check_and_install_download_and_store_what_the_manifest_lists()
{
  Board board("sim-update", NOTIFY);
  Source source;
  source.add_animation("red", RED);
  source.add_animation("green", GREEN);
  source.add_playlist("default", PLAYLIST);
  source.publish();
  board.data.write("animations/unlisted.json", "{}");
  board.data.write("animations/green.json", RED); // stored with other content: the server wins

  TEST_ASSERT_EQUAL_STRING("nothing_to_install",
                           error_of("\"cmd\":\"update_install\",\"target\":\"animations\"").c_str());
  JsonDocument before = status_update();
  TEST_ASSERT_EQUAL_STRING("idle", before["state"].as<const char *>());
  TEST_ASSERT_TRUE(before["last_check"].isNull());
  TEST_ASSERT_TRUE(before["last_result"].isNull());

  TEST_ASSERT_EQUAL_STRING("", error_of("\"cmd\":\"update_check\"").c_str());
  TEST_ASSERT_EQUAL_STRING("checking", status_update()["state"].as<const char *>());
  TEST_ASSERT_EQUAL_STRING("busy", error_of("\"cmd\":\"update_check\"").c_str());
  TEST_ASSERT_EQUAL_STRING("busy", error_of("\"cmd\":\"update_install\",\"target\":\"animations\"").c_str());
  drive();
  JsonDocument found = status_update();
  TEST_ASSERT_EQUAL_STRING("idle", found["state"].as<const char *>());
  TEST_ASSERT_EQUAL_STRING("ok", found["last_result"].as<const char *>());
  TEST_ASSERT_EQUAL(0, found["last_check"].as<int>());
  TEST_ASSERT_EQUAL(3, found["files"].as<int>()); // red and the playlist are new, green is replaced
  TEST_ASSERT_EQUAL(0, found["failed_files"].as<int>());
  TEST_ASSERT_TRUE(found["firmware"].isNull());
  // Notify mode installed nothing.
  TEST_ASSERT_FALSE(storage::exists("/animations/red.json"));

  sim::advance_us(125 * 1000000ULL);
  TEST_ASSERT_EQUAL(125, status_update()["last_check"].as<int>());

  TEST_ASSERT_EQUAL_STRING("", error_of("\"cmd\":\"update_install\",\"target\":\"animations\"").c_str());
  TEST_ASSERT_EQUAL_STRING("downloading", status_update()["state"].as<const char *>());
  drive();
  JsonDocument done = status_update();
  TEST_ASSERT_EQUAL_STRING("ok", done["last_result"].as<const char *>());
  TEST_ASSERT_EQUAL(0, done["files"].as<int>());
  TEST_ASSERT_EQUAL(0, done["failed_files"].as<int>());
  TEST_ASSERT_TRUE(pixelart_test::read_file(board.data.root / "animations/red.json") == RED);
  TEST_ASSERT_TRUE(pixelart_test::read_file(board.data.root / "animations/green.json") == GREEN);
  TEST_ASSERT_TRUE(pixelart_test::read_file(board.data.root / "playlists/default.json") == PLAYLIST);
  TEST_ASSERT_EQUAL_STRING("{}", pixelart_test::read_file(board.data.root / "animations/unlisted.json").c_str());
  TEST_ASSERT_FALSE(storage::exists(updates::TEMP_FILE));
  TEST_ASSERT_TRUE(playlist_reload_pending());

  // A second check finds the board in step with the server.
  TEST_ASSERT_EQUAL_STRING("", error_of("\"cmd\":\"update_check\"").c_str());
  drive();
  TEST_ASSERT_EQUAL(0, status_update()["files"].as<int>());
  TEST_ASSERT_EQUAL_STRING("nothing_to_install",
                           error_of("\"cmd\":\"update_install\",\"target\":\"animations\"").c_str());
}

static void test_the_update_commands_refuse_what_the_settings_and_the_network_do_not_allow()
{
  Board board("sim-update-errors", R"("update_mode":"off")");
  Source source;
  source.add_animation("red", RED);
  source.publish();
  TEST_ASSERT_EQUAL_STRING("updates_off", error_of("\"cmd\":\"update_check\"").c_str());
  TEST_ASSERT_EQUAL_STRING("updates_off", error_of("\"cmd\":\"update_install\",\"target\":\"animations\"").c_str());
  TEST_ASSERT_EQUAL_STRING("updates_off", error_of("\"cmd\":\"update_install\",\"target\":\"firmware\"").c_str());

  ask("\"cmd\":\"settings_set\",\"update_mode\":\"notify\",\"update_firmware\":false,\"update_animations\":false");
  TEST_ASSERT_EQUAL_STRING("updates_off", error_of("\"cmd\":\"update_check\"").c_str());

  ask("\"cmd\":\"settings_set\",\"update_animations\":true");
  TEST_ASSERT_EQUAL_STRING("updates_off", error_of("\"cmd\":\"update_install\",\"target\":\"firmware\"").c_str());
  TEST_ASSERT_EQUAL_STRING("", error_of("\"cmd\":\"update_check\"").c_str());
  drive();

  ask("\"cmd\":\"settings_set\",\"update_animations\":false,\"update_firmware\":true");
  TEST_ASSERT_EQUAL_STRING("updates_off", error_of("\"cmd\":\"update_install\",\"target\":\"animations\"").c_str());
  // The check found no firmware for the simulator: nothing to install, with or without force.
  TEST_ASSERT_EQUAL_STRING("nothing_to_install",
                           error_of("\"cmd\":\"update_install\",\"target\":\"firmware\"").c_str());
  TEST_ASSERT_EQUAL_STRING("nothing_to_install",
                           error_of("\"cmd\":\"update_install\",\"target\":\"firmware\",\"force\":true").c_str());

  ask("\"cmd\":\"settings_set\",\"update_animations\":true");
  network::Snapshot offline;
  offline.state = wifi_logic::State::Disconnected;
  network::sim_set_snapshot(offline);
  TEST_ASSERT_EQUAL_STRING("no_network", error_of("\"cmd\":\"update_check\"").c_str());
  network::Snapshot online;
  online.state = wifi_logic::State::Connected;
  online.has_ip = true;
  network::sim_set_snapshot(online);
  TEST_ASSERT_EQUAL_STRING("", error_of("\"cmd\":\"update_check\"").c_str());
  drive();
  network::sim_set_snapshot(offline);
  TEST_ASSERT_EQUAL_STRING("no_network", error_of("\"cmd\":\"update_install\",\"target\":\"animations\"").c_str());
  network::sim_set_snapshot(online);

  // Bad requests.
  TEST_ASSERT_EQUAL_STRING("bad_request", error_of("\"cmd\":\"update_install\"").c_str());
  TEST_ASSERT_EQUAL_STRING("bad_request", error_of("\"cmd\":\"update_install\",\"target\":\"all\"").c_str());
  TEST_ASSERT_EQUAL_STRING("bad_request", error_of("\"cmd\":\"update_install\",\"target\":7").c_str());
  TEST_ASSERT_EQUAL_STRING("bad_request",
                           error_of("\"cmd\":\"update_install\",\"target\":\"firmware\",\"force\":\"yes\"").c_str());
  TEST_ASSERT_EQUAL_STRING("bad_request",
                           error_of("\"cmd\":\"update_install\",\"target\":\"firmware\",\"x\":1").c_str());
  TEST_ASSERT_EQUAL_STRING("bad_request", error_of("\"cmd\":\"update_check\",\"force\":true").c_str());
}

// Runs one check and one installation against `source` with these failures injected and returns the status.
static JsonDocument run_update(Board &board, Source &source)
{
  (void)board;
  source.publish();
  TEST_ASSERT_EQUAL_STRING("", error_of("\"cmd\":\"update_check\"").c_str());
  drive();
  JsonDocument checked = status_update();
  if (checked["last_result"].as<std::string>() != "ok" || checked["files"].as<int>() == 0)
    return checked;
  TEST_ASSERT_EQUAL_STRING("", error_of("\"cmd\":\"update_install\",\"target\":\"animations\"").c_str());
  drive();
  return status_update();
}

static void test_every_failure_of_a_download_is_reported_and_leaves_the_other_files_installed()
{
  struct Case
  {
    updates::Failure failure;
    const char *path;
    const char *code;
  };
  const Case cases[] = {
      {updates::Failure::Cut, "animations/green.json", "network_error"},
      {updates::Failure::Corrupt, "animations/green.json", "checksum_mismatch"},
      {updates::Failure::TooLong, "animations/green.json", "checksum_mismatch"},
      {updates::Failure::HttpError, "animations/green.json", "http_error"},
      {updates::Failure::TlsError, "animations/green.json", "tls_error"},
  };
  for (const Case &c : cases)
  {
    Board board("sim-update-failure", NOTIFY);
    Source source;
    source.add_animation("red", RED);
    source.add_animation("green", GREEN);
    updates::sim_inject(c.failure, c.path);
    // The manifest itself is fine: only the file fails.
    source.publish();
    TEST_ASSERT_EQUAL_STRING("", error_of("\"cmd\":\"update_check\"").c_str());
    drive();
    TEST_ASSERT_EQUAL_STRING_MESSAGE("ok", status_update()["last_result"].as<const char *>(), c.code);
    TEST_ASSERT_EQUAL_STRING("", error_of("\"cmd\":\"update_install\",\"target\":\"animations\"").c_str());
    drive();
    JsonDocument s = status_update();
    TEST_ASSERT_EQUAL_STRING_MESSAGE(c.code, s["last_result"].as<const char *>(), c.code);
    TEST_ASSERT_EQUAL_MESSAGE(1, s["failed_files"].as<int>(), c.code);
    TEST_ASSERT_EQUAL_MESSAGE(1, s["files"].as<int>(), c.code);
    TEST_ASSERT_TRUE_MESSAGE(storage::exists("/animations/red.json"), c.code);
    TEST_ASSERT_FALSE_MESSAGE(storage::exists("/animations/green.json"), c.code);
    TEST_ASSERT_FALSE_MESSAGE(storage::exists(updates::TEMP_FILE), c.code);
    // The server comes back: the next installation finishes the job and clears the failure.
    updates::sim_clear_failures();
    TEST_ASSERT_EQUAL_STRING("", error_of("\"cmd\":\"update_install\",\"target\":\"animations\"").c_str());
    drive();
    s = status_update();
    TEST_ASSERT_EQUAL_STRING_MESSAGE("ok", s["last_result"].as<const char *>(), c.code);
    TEST_ASSERT_EQUAL_MESSAGE(0, s["failed_files"].as<int>(), c.code);
    TEST_ASSERT_TRUE_MESSAGE(pixelart_test::read_file(board.data.root / "animations/green.json") == GREEN, c.code);
  }
}

static void test_a_stored_file_stays_as_it_was_when_its_replacement_fails()
{
  Board board("sim-update-keep", NOTIFY);
  board.data.write("animations/green.json", RED);
  Source source;
  source.add_animation("green", GREEN);
  updates::sim_inject(updates::Failure::Cut, "animations/green.json");
  JsonDocument s = run_update(board, source);
  TEST_ASSERT_EQUAL_STRING("network_error", s["last_result"].as<const char *>());
  TEST_ASSERT_TRUE(pixelart_test::read_file(board.data.root / "animations/green.json") == RED);
  TEST_ASSERT_FALSE(storage::exists(updates::TEMP_FILE));
}

static void test_a_file_the_engine_rejects_is_not_stored()
{
  Board board("sim-update-invalid", NOTIFY);
  Source source;
  const std::string broken = R"({"format":"pixelart/1","name":"x","canvas":{"width":16,"height":16}})";
  source.add_animation("good", GREEN);
  source.add_animation("broken", broken); // its checksum is right, the content is not an animation
  source.add_playlist("default", "not json at all");
  JsonDocument s = run_update(board, source);
  TEST_ASSERT_EQUAL_STRING("invalid_file", s["last_result"].as<const char *>());
  TEST_ASSERT_EQUAL(2, s["failed_files"].as<int>());
  TEST_ASSERT_EQUAL(2, s["files"].as<int>());
  TEST_ASSERT_TRUE(storage::exists("/animations/good.json"));
  TEST_ASSERT_FALSE(storage::exists("/animations/broken.json"));
  TEST_ASSERT_FALSE(storage::exists("/playlists/default.json"));
  TEST_ASSERT_FALSE(storage::exists(updates::TEMP_FILE));
}

static void test_a_manifest_that_cannot_be_used_fails_the_check()
{
  struct Case
  {
    const char *label;
    std::string manifest;
    const char *code;
  };
  const std::string good = manifest("", "");
  std::string wrong_format = good;
  wrong_format.replace(wrong_format.find("manifest/1"), 10, "manifest/2");
  std::string wrong_version = good;
  wrong_version.replace(wrong_version.find("1.2.0"), 5, "one");
  const Case cases[] = {
      {"wrong format", wrong_format, "bad_manifest"},
      {"wrong version", wrong_version, "bad_manifest"},
      {"not JSON", "<html>", "bad_manifest"},
      {"too large", good + std::string(70000, ' '), "bad_manifest"},
  };
  for (const Case &c : cases)
  {
    Board board("sim-update-manifest", NOTIFY);
    updates::sim_use_files({{"manifest.json", c.manifest}});
    TEST_ASSERT_EQUAL_STRING("", error_of("\"cmd\":\"update_check\"").c_str());
    drive();
    JsonDocument s = status_update();
    TEST_ASSERT_EQUAL_STRING_MESSAGE(c.code, s["last_result"].as<const char *>(), c.label);
    TEST_ASSERT_EQUAL_MESSAGE(0, s["files"].as<int>(), c.label);
  }
}

static void test_server_failures_fail_the_check_with_their_own_code()
{
  struct Case
  {
    updates::Failure failure;
    const char *path;
    const char *code;
  };
  const Case cases[] = {
      {updates::Failure::ServerDown, "", "network_error"},
      {updates::Failure::TlsError, "manifest.json", "tls_error"},
      {updates::Failure::HttpError, "manifest.json", "http_error"},
  };
  for (const Case &c : cases)
  {
    Board board("sim-update-server", NOTIFY);
    Source source;
    source.add_animation("red", RED);
    source.publish();
    updates::sim_inject(c.failure, c.path);
    TEST_ASSERT_EQUAL_STRING("", error_of("\"cmd\":\"update_check\"").c_str());
    drive();
    TEST_ASSERT_EQUAL_STRING_MESSAGE(c.code, status_update()["last_result"].as<const char *>(), c.code);
  }
  // A manifest that is not there is an HTTP error with the detail no_release, and a simulator without a
  // source is a network error.
  Board board("sim-update-missing", NOTIFY);
  updates::sim_use_files({});
  error_of("\"cmd\":\"update_check\"");
  drive();
  TEST_ASSERT_EQUAL_STRING("http_error", status_update()["last_result"].as<const char *>());
  TEST_ASSERT_EQUAL_STRING("no_release", status_update()["last_detail"].as<const char *>());
  updates::sim_use_nothing();
  error_of("\"cmd\":\"update_check\"");
  drive();
  TEST_ASSERT_EQUAL_STRING("network_error", status_update()["last_result"].as<const char *>());
  TEST_ASSERT_TRUE(status_update()["last_detail"].isNull());
}

static void test_only_a_missing_manifest_has_the_detail_no_release()
{
  Board board("sim-update-detail", NOTIFY);
  Source source;
  source.add_animation("red", RED);
  source.publish();
  TEST_ASSERT_TRUE(status_update()["last_detail"].isNull()); // before the first check
  // A manifest that answers another error status.
  updates::sim_inject(updates::Failure::HttpError, "manifest.json");
  error_of("\"cmd\":\"update_check\"");
  drive();
  TEST_ASSERT_EQUAL_STRING("http_error", status_update()["last_result"].as<const char *>());
  TEST_ASSERT_TRUE(status_update()["last_detail"].isNull());
  // A file that is not there: the manifest lists red, the server has no copy.
  updates::sim_clear_failures();
  source.files.erase("animations/red.json");
  updates::sim_use_files(source.files);
  error_of("\"cmd\":\"update_check\"");
  drive();
  TEST_ASSERT_EQUAL_STRING("ok", status_update()["last_result"].as<const char *>());
  error_of("\"cmd\":\"update_install\",\"target\":\"animations\"");
  drive();
  TEST_ASSERT_EQUAL_STRING("http_error", status_update()["last_result"].as<const char *>());
  TEST_ASSERT_TRUE(status_update()["last_detail"].isNull());
  // The manifest goes missing, then comes back: the detail follows the last result.
  updates::sim_use_files({});
  error_of("\"cmd\":\"update_check\"");
  drive();
  TEST_ASSERT_EQUAL_STRING("no_release", status_update()["last_detail"].as<const char *>());
  source.publish();
  error_of("\"cmd\":\"update_check\"");
  drive();
  TEST_ASSERT_EQUAL_STRING("ok", status_update()["last_result"].as<const char *>());
  TEST_ASSERT_TRUE(status_update()["last_detail"].isNull());
}

static void test_a_file_that_does_not_fit_is_reported_as_no_space()
{
  Board board("sim-update-space", NOTIFY);
  storage::set_capacity(2 * storage::BLOCK_SIZE);
  Source source;
  const std::string a(storage::BLOCK_SIZE, ' ');
  // Two files of one block each, the second does not fit once the first is stored. (Padded animations stay valid JSON.)
  const std::string first = GREEN + a.substr(GREEN.size() > a.size() ? 0 : GREEN.size());
  source.add_animation("one", first);
  source.add_animation("two", first);
  source.add_animation("three", first);
  JsonDocument s = run_update(board, source);
  TEST_ASSERT_EQUAL_STRING("no_space", s["last_result"].as<const char *>());
  TEST_ASSERT_EQUAL(1, s["failed_files"].as<int>());
  TEST_ASSERT_TRUE(storage::exists("/animations/one.json"));
  TEST_ASSERT_TRUE(storage::exists("/animations/two.json"));
  TEST_ASSERT_FALSE(storage::exists("/animations/three.json"));
}

static void test_a_write_failure_while_downloading_is_a_storage_error()
{
  Board board("sim-update-write", NOTIFY);
  Source source;
  source.add_animation("red", RED);
  source.publish();
  error_of("\"cmd\":\"update_check\"");
  drive();
  storage::set_fail_writes(true);
  error_of("\"cmd\":\"update_install\",\"target\":\"animations\"");
  drive();
  storage::set_fail_writes(false);
  JsonDocument s = status_update();
  TEST_ASSERT_EQUAL_STRING("storage_error", s["last_result"].as<const char *>());
  TEST_ASSERT_EQUAL(1, s["failed_files"].as<int>());
  TEST_ASSERT_FALSE(storage::exists(updates::TEMP_FILE));
}

static void test_automatic_mode_installs_by_itself_after_a_check()
{
  Board board("sim-update-auto", R"("update_mode":"automatic")");
  Source source;
  source.add_animation("red", RED);
  source.publish();
  error_of("\"cmd\":\"update_check\"");
  drive();
  TEST_ASSERT_TRUE(storage::exists("/animations/red.json"));
  TEST_ASSERT_EQUAL(0, status_update()["files"].as<int>());
}

static void test_automatic_mode_follows_the_install_window()
{
  Board board("sim-update-window", R"("update_mode":"automatic","install_start":60,"install_end":120)");
  Source source;
  source.add_animation("red", RED);
  source.publish();
  error_of("\"cmd\":\"update_check\"");
  drive();
  // The time is not known: the board waits, and says so.
  JsonDocument waiting = status_update();
  TEST_ASSERT_EQUAL_STRING("waiting_for_time", waiting["state"].as<const char *>());
  TEST_ASSERT_EQUAL(1, waiting["files"].as<int>());
  TEST_ASSERT_FALSE(storage::exists("/animations/red.json"));
  TEST_ASSERT_FALSE(ask("\"cmd\":\"status\"")["time"]["known"].as<bool>());

  // Known and outside the window: idle with the file still waiting.
  updates::sim_set_local_minutes(600);
  sim::advance_us(60 * 1000000ULL);
  updates::poll();
  JsonDocument closed = status_update();
  TEST_ASSERT_EQUAL_STRING("idle", closed["state"].as<const char *>());
  TEST_ASSERT_EQUAL(1, closed["files"].as<int>());
  TEST_ASSERT_TRUE(ask("\"cmd\":\"status\"")["time"]["known"].as<bool>());

  // `update_install` ignores the window.
  // Inside the window, the board installs by itself.
  updates::sim_set_local_minutes(61);
  sim::advance_us(60 * 1000000ULL);
  drive();
  TEST_ASSERT_TRUE(storage::exists("/animations/red.json"));
  TEST_ASSERT_EQUAL(0, status_update()["files"].as<int>());

  Board other("sim-update-window-install", R"("update_mode":"automatic","install_start":60,"install_end":120)");
  Source again;
  again.add_animation("red", RED);
  again.publish();
  updates::sim_set_local_minutes(600);
  error_of("\"cmd\":\"update_check\"");
  drive();
  TEST_ASSERT_FALSE(storage::exists("/animations/red.json"));
  TEST_ASSERT_EQUAL_STRING("", error_of("\"cmd\":\"update_install\",\"target\":\"animations\"").c_str());
  drive();
  TEST_ASSERT_TRUE(storage::exists("/animations/red.json"));
}

// ---- Firmware in the simulator: slots, trial boot, rollback ----

namespace
{

const std::string IMAGE = "pixelart-sim-firmware-1.3.0";

// Serves the project manifest with a firmware for the simulator at `version`.
void publish_firmware(const std::string &version = "1.3.0", const std::string &image = IMAGE)
{
  std::map<std::string, std::string> files;
  files["firmware/simulator/app.bin"] = image;
  files["manifest.json"] = manifest("", "", firmware_entry("simulator", image), version);
  updates::sim_use_files(files);
}

// A restart of the simulated board, as the harness does: the files and the firmware stay.
void restart_board(bool unhealthy = false)
{
  firmware::sim_fail_next_health(unhealthy);
  do
  {
    firmware::sim_clear_restart();
    setup();
  } while (firmware::sim_restart_requested());
  firmware::sim_fail_next_health(false);
}

// Runs the updater until the installation ended: the board asked for a restart, or it failed.
void drive_install()
{
  for (int i = 0; i < 1000; i++)
  {
    updates::poll();
    if (firmware::sim_restart_requested() || !updates::firmware_installing())
      return;
  }
  TEST_FAIL_MESSAGE("the installation did not end");
}

// Checks and installs the published firmware, up to the restart.
void check_and_install(bool force = false)
{
  TEST_ASSERT_EQUAL_STRING("", error_of("\"cmd\":\"update_check\"").c_str());
  drive();
  TEST_ASSERT_EQUAL_STRING("", error_of(force ? "\"cmd\":\"update_install\",\"target\":\"firmware\",\"force\":true"
                                              : "\"cmd\":\"update_install\",\"target\":\"firmware\"")
                                   .c_str());
  drive_install();
}

JsonDocument last_install()
{
  JsonDocument doc;
  doc.set(status_update()["last_install"]);
  return doc;
}

} // namespace

static void test_an_installed_firmware_boots_on_trial_and_confirms_itself_at_its_first_frame()
{
  Board board("sim-firmware-trial", NOTIFY);
  firmware::sim_set_version("1.2.0");
  board.data.write("animations/dot.json", DOT);
  publish_firmware();
  check_and_install();
  TEST_ASSERT_TRUE(firmware::sim_restart_requested());
  TEST_ASSERT_TRUE(firmware::sim_image() == IMAGE);
  TEST_ASSERT_EQUAL_STRING("installing", status_update()["state"].as<const char *>());
  TEST_ASSERT_EQUAL(100, status_update()["progress"].as<int>());
  TEST_ASSERT_EQUAL_STRING("1.2.0", platform::firmware_version()); // still the old one until it restarts

  restart_board();
  TEST_ASSERT_EQUAL_STRING("1.3.0", platform::firmware_version());
  TEST_ASSERT_TRUE(firmware::sim_on_trial());
  TEST_ASSERT_TRUE(last_install().isNull()); // not confirmed yet
  // The first frame the board shows confirms it.
  TEST_ASSERT_TRUE(play_stored_animation("dot"));
  TEST_ASSERT_FALSE(firmware::sim_on_trial());
  JsonDocument done = last_install();
  TEST_ASSERT_EQUAL_STRING("updated", done["result"].as<const char *>());
  TEST_ASSERT_EQUAL_STRING("1.2.0", done["from"].as<const char *>());
  TEST_ASSERT_EQUAL_STRING("1.3.0", done["to"].as<const char *>());
  // A restart after the confirmation stays on the new firmware, and the record stays.
  restart_board();
  TEST_ASSERT_EQUAL_STRING("1.3.0", platform::firmware_version());
  TEST_ASSERT_FALSE(firmware::sim_on_trial());
  TEST_ASSERT_EQUAL_STRING("updated", last_install()["result"].as<const char *>());
}

static void test_a_firmware_that_restarts_before_its_first_frame_is_rolled_back_and_skipped()
{
  Board board("sim-firmware-crash", NOTIFY);
  firmware::sim_set_version("1.2.0");
  publish_firmware();
  check_and_install();
  restart_board();
  TEST_ASSERT_EQUAL_STRING("1.3.0", platform::firmware_version());
  restart_board(); // a crash or a power loss before the first frame

  TEST_ASSERT_EQUAL_STRING("1.2.0", platform::firmware_version());
  JsonDocument back = last_install();
  TEST_ASSERT_EQUAL_STRING("rolled_back", back["result"].as<const char *>());
  TEST_ASSERT_EQUAL_STRING("1.2.0", back["from"].as<const char *>());
  TEST_ASSERT_EQUAL_STRING("1.3.0", back["to"].as<const char *>());
  TEST_ASSERT_EQUAL_STRING("1.3.0", firmware::skipped().c_str());
  restart_board(); // the rollback is reported once recorded, and stays so
  TEST_ASSERT_EQUAL_STRING("rolled_back", last_install()["result"].as<const char *>());

  // The version is reported, never installed by a plain request, and installed by force.
  updates::sim_use_files({});
  publish_firmware();
  TEST_ASSERT_EQUAL_STRING("", error_of("\"cmd\":\"update_check\"").c_str());
  drive();
  TEST_ASSERT_EQUAL_STRING("1.3.0", status_update()["firmware"].as<const char *>());
  TEST_ASSERT_EQUAL_STRING("nothing_to_install",
                           error_of("\"cmd\":\"update_install\",\"target\":\"firmware\"").c_str());
  TEST_ASSERT_EQUAL_STRING("", error_of("\"cmd\":\"update_install\",\"target\":\"firmware\",\"force\":true").c_str());
  drive_install();
  restart_board();
  firmware::first_frame_shown();
  TEST_ASSERT_EQUAL_STRING("1.3.0", platform::firmware_version());
  TEST_ASSERT_EQUAL_STRING("updated", last_install()["result"].as<const char *>());
  TEST_ASSERT_EQUAL_STRING("", firmware::skipped().c_str()); // a skipped version that held is no longer skipped
}

static void test_a_failed_health_check_marks_the_firmware_invalid_and_the_previous_one_runs()
{
  Board board("sim-firmware-health", NOTIFY);
  firmware::sim_set_version("1.2.0");
  publish_firmware();
  check_and_install();
  restart_board(true);
  TEST_ASSERT_EQUAL_STRING("1.2.0", platform::firmware_version());
  TEST_ASSERT_FALSE(firmware::sim_on_trial());
  TEST_ASSERT_EQUAL_STRING("rolled_back", last_install()["result"].as<const char *>());
  TEST_ASSERT_EQUAL_STRING("1.3.0", firmware::skipped().c_str());
  // A health check that fails without a trial does nothing: there is nothing to go back to.
  restart_board(true);
  TEST_ASSERT_EQUAL_STRING("1.2.0", platform::firmware_version());
}

static void test_a_failed_mark_valid_records_no_installation_and_keeps_the_trial()
{
  Board board("sim-firmware-mark-valid", NOTIFY);
  firmware::sim_set_version("1.2.0");
  board.data.write("animations/dot.json", DOT);
  publish_firmware();
  check_and_install();
  restart_board();
  TEST_ASSERT_TRUE(firmware::sim_on_trial());
  firmware::sim_fail_marks(true);
  TEST_ASSERT_TRUE(play_stored_animation("dot"));
  TEST_ASSERT_TRUE(firmware::sim_on_trial());
  TEST_ASSERT_TRUE(last_install().isNull());
  for (int i = 0; i < 200; ++i)
    firmware::first_frame_shown();
  TEST_ASSERT_EQUAL_UINT(1, firmware::sim_failures_logged());
  TEST_ASSERT_TRUE(firmware::sim_on_trial());
  // The next call confirms once the mark works.
  firmware::sim_fail_marks(false);
  firmware::first_frame_shown();
  TEST_ASSERT_FALSE(firmware::sim_on_trial());
  TEST_ASSERT_EQUAL_STRING("updated", last_install()["result"].as<const char *>());
}

namespace
{

// Writes in one stored record, see sim_fail_saves_after().
constexpr unsigned RECORD_WRITES = 7;
// Writes of the first record to be stored for the evidence that the new firmware booted: the one that sets
// `confirmed` is the fifth.
constexpr unsigned WRITES_TO_EVIDENCE = 5;

// Force-installs the published firmware over a skipped 1.3.0, restarts into its trial and returns.
void install_skipped_firmware_and_boot_it()
{
  firmware::sim_set_version("1.2.0");
  firmware::sim_set_skipped("1.3.0");
  publish_firmware();
  TEST_ASSERT_EQUAL_STRING("", error_of("\"cmd\":\"update_check\"").c_str());
  drive();
  TEST_ASSERT_EQUAL_STRING("", error_of("\"cmd\":\"update_install\",\"target\":\"firmware\",\"force\":true").c_str());
  drive_install();
  restart_board();
  TEST_ASSERT_TRUE(firmware::sim_on_trial());
}

} // namespace

static void test_a_confirmation_that_cannot_be_stored_is_recorded_at_the_next_boot()
{
  Board board("sim-firmware-confirm-boot", NOTIFY);
  board.data.write("animations/dot.json", DOT);
  install_skipped_firmware_and_boot_it();

  // The slot is confirmed, but the result is not stored before the board restarts.
  firmware::sim_fail_saves_after(RECORD_WRITES);
  TEST_ASSERT_TRUE(play_stored_animation("dot"));
  TEST_ASSERT_FALSE(firmware::sim_on_trial());
  TEST_ASSERT_EQUAL_UINT(1, firmware::sim_failures_logged());
  firmware::sim_fail_saves(false);
  restart_board();
  TEST_ASSERT_EQUAL_STRING("1.3.0", platform::firmware_version());
  JsonDocument done = last_install();
  TEST_ASSERT_EQUAL_STRING("updated", done["result"].as<const char *>());
  TEST_ASSERT_EQUAL_STRING("1.2.0", done["from"].as<const char *>());
  TEST_ASSERT_EQUAL_STRING("1.3.0", done["to"].as<const char *>());
  TEST_ASSERT_EQUAL_STRING("", firmware::skipped().c_str());
  restart_board(); // the record was stored: it stays, and nothing is recorded twice
  TEST_ASSERT_EQUAL_STRING("updated", last_install()["result"].as<const char *>());
  TEST_ASSERT_EQUAL_STRING("", firmware::skipped().c_str());
}

static void test_the_store_failing_between_any_two_writes_never_loses_a_confirmed_installation()
{
  // The store breaks after `works` writes, over the evidence that the firmware booted and over the result,
  // and the board restarts. With the evidence stored the installation is reported whatever else was
  // stored; without it nothing is reported and the skip stays.
  for (unsigned works = 0; works <= 2 * RECORD_WRITES; ++works)
  {
    Board board("sim-firmware-confirm-writes", NOTIFY);
    board.data.write("animations/dot.json", DOT);
    install_skipped_firmware_and_boot_it();
    firmware::sim_fail_saves_after(works);
    TEST_ASSERT_TRUE(play_stored_animation("dot"));
    firmware::sim_fail_saves(false);
    restart_board();
    TEST_ASSERT_EQUAL_STRING_MESSAGE("1.3.0", platform::firmware_version(), "running");
    char message[48];
    snprintf(message, sizeof(message), "%u writes work", works);
    if (works >= WRITES_TO_EVIDENCE)
    {
      JsonDocument done = last_install();
      TEST_ASSERT_EQUAL_STRING_MESSAGE("updated", done["result"].as<const char *>(), message);
      TEST_ASSERT_EQUAL_STRING_MESSAGE("1.2.0", done["from"].as<const char *>(), message);
      TEST_ASSERT_EQUAL_STRING_MESSAGE("1.3.0", done["to"].as<const char *>(), message);
      TEST_ASSERT_EQUAL_STRING_MESSAGE("", firmware::skipped().c_str(), message);
    }
    else
    {
      TEST_ASSERT_TRUE_MESSAGE(last_install().isNull(), message);
      TEST_ASSERT_EQUAL_STRING_MESSAGE("1.3.0", firmware::skipped().c_str(), message);
    }
    restart_board(); // nothing is recorded twice, and nothing is lost
    TEST_ASSERT_EQUAL_STRING_MESSAGE(works >= WRITES_TO_EVIDENCE ? "updated" : "",
                                     last_install().isNull() ? "" : last_install()["result"].as<const char *>(),
                                     message);
  }
}

static void test_the_store_failing_between_any_two_writes_never_loses_a_rollback()
{
  for (unsigned works = 0; works <= RECORD_WRITES; ++works)
  {
    Board board("sim-firmware-rollback-writes", NOTIFY);
    firmware::sim_set_version("1.2.0");
    publish_firmware();
    check_and_install();
    restart_board();
    firmware::sim_fail_saves_after(works);
    restart_board(); // the new firmware restarts before its first frame: the bootloader rolls back
    firmware::sim_fail_saves(false);
    restart_board(); // an interrupted record is made again
    char message[48];
    snprintf(message, sizeof(message), "%u writes work", works);
    TEST_ASSERT_EQUAL_STRING_MESSAGE("1.2.0", platform::firmware_version(), message);
    TEST_ASSERT_EQUAL_STRING_MESSAGE("rolled_back", last_install()["result"].as<const char *>(), message);
    TEST_ASSERT_EQUAL_STRING_MESSAGE("1.3.0", last_install()["to"].as<const char *>(), message);
    TEST_ASSERT_EQUAL_STRING_MESSAGE("1.3.0", firmware::skipped().c_str(), message);
  }
}

static void test_a_firmware_flashed_over_usb_with_the_pending_version_is_not_reported_as_installed()
{
  Board board("sim-firmware-usb", NOTIFY);
  firmware::sim_set_version("1.2.0");
  firmware::sim_set_skipped("1.3.0");
  publish_firmware();
  TEST_ASSERT_EQUAL_STRING("", error_of("\"cmd\":\"update_check\"").c_str());
  drive();
  // The record of the installation is stored, and the board restarts before the boot slot changes.
  TEST_ASSERT_TRUE(firmware::begin_image(IMAGE.size()));
  TEST_ASSERT_TRUE(firmware::write_image(IMAGE.data(), IMAGE.size()));
  TEST_ASSERT_TRUE(firmware::end_image());
  firmware::sim_restart_before_switch();
  TEST_ASSERT_FALSE(firmware::activate("1.2.0", "1.3.0"));
  TEST_ASSERT_EQUAL_STRING("1.3.0", firmware::sim_pending_version().c_str());

  firmware::sim_set_version("1.3.0"); // 1.3.0 is flashed over USB
  restart_board();
  TEST_ASSERT_EQUAL_STRING("1.3.0", platform::firmware_version());
  TEST_ASSERT_FALSE(firmware::sim_on_trial());
  TEST_ASSERT_TRUE(last_install().isNull());
  TEST_ASSERT_EQUAL_STRING("1.3.0", firmware::skipped().c_str());
  TEST_ASSERT_EQUAL_STRING("", firmware::sim_pending_version().c_str());
  restart_board();
  TEST_ASSERT_TRUE(last_install().isNull());
}

static void test_a_new_firmware_that_booted_but_could_not_confirm_is_rolled_back_and_the_evidence_is_dropped()
{
  Board board("sim-firmware-booted-not-confirmed", NOTIFY);
  board.data.write("animations/dot.json", DOT);
  install_skipped_firmware_and_boot_it();
  firmware::sim_fail_marks(true);
  TEST_ASSERT_TRUE(play_stored_animation("dot")); // the evidence is stored, the mark fails
  firmware::sim_fail_marks(false);
  restart_board(); // the bootloader rolls back
  TEST_ASSERT_EQUAL_STRING("1.2.0", platform::firmware_version());
  TEST_ASSERT_EQUAL_STRING("rolled_back", last_install()["result"].as<const char *>());
  TEST_ASSERT_EQUAL_STRING("1.3.0", firmware::skipped().c_str());
  TEST_ASSERT_EQUAL_STRING("", firmware::sim_pending_version().c_str());
}

static void test_a_confirmation_retry_that_overlaps_a_second_installation_does_not_erase_it()
{
  Board board("sim-firmware-retry-overlap", NOTIFY);
  board.data.write("animations/dot.json", DOT);
  install_skipped_firmware_and_boot_it();
  firmware::sim_fail_saves_after(RECORD_WRITES); // the evidence is stored, the result is not
  TEST_ASSERT_TRUE(play_stored_animation("dot"));
  firmware::sim_fail_saves(false);

  // The retry copies the record and starts to store it. While it does, the network task records the next
  // installation, 1.4.0, and waits for the store.
  const std::string newer = "pixelart-sim-firmware-1.4.0";
  TEST_ASSERT_TRUE(firmware::begin_image(newer.size()));
  TEST_ASSERT_TRUE(firmware::write_image(newer.data(), newer.size()));
  TEST_ASSERT_TRUE(firmware::end_image());
  std::atomic<bool> activated{false};
  std::atomic<bool> network_done{false};
  std::thread network;
  firmware::sim_set_save_hook(
      [&]
      {
        network = std::thread(
            [&]
            {
              activated = firmware::activate("1.3.0", "1.4.0");
              network_done = true;
            });
        // Waits until the installation is recorded, then gives it time to be stored: it must wait for this store.
        for (int i = 0; i < 5000 && firmware::sim_pending_version() != "1.4.0"; ++i)
          std::this_thread::sleep_for(std::chrono::milliseconds(1));
        for (int i = 0; i < 300 && !network_done; ++i)
          std::this_thread::sleep_for(std::chrono::milliseconds(1));
      });
  for (int i = 0; i < 100; ++i)
    firmware::first_frame_shown();
  TEST_ASSERT_TRUE(network.joinable());
  network.join();
  TEST_ASSERT_TRUE(activated);

  // The stored record holds both: the installation of 1.3.0 and the pending 1.4.0.
  restart_board();
  TEST_ASSERT_EQUAL_STRING("1.4.0", platform::firmware_version());
  TEST_ASSERT_TRUE(firmware::sim_on_trial());
  TEST_ASSERT_EQUAL_STRING("updated", last_install()["result"].as<const char *>());
  TEST_ASSERT_EQUAL_STRING("1.3.0", last_install()["to"].as<const char *>());
  TEST_ASSERT_TRUE(play_stored_animation("dot"));
  TEST_ASSERT_FALSE(firmware::sim_on_trial());
  JsonDocument done = last_install();
  TEST_ASSERT_EQUAL_STRING("updated", done["result"].as<const char *>());
  TEST_ASSERT_EQUAL_STRING("1.3.0", done["from"].as<const char *>());
  TEST_ASSERT_EQUAL_STRING("1.4.0", done["to"].as<const char *>());
}

static void test_a_confirmation_that_cannot_be_stored_is_stored_again_while_the_board_runs()
{
  Board board("sim-firmware-confirm-retry", NOTIFY);
  firmware::sim_set_version("1.2.0");
  firmware::sim_set_skipped("1.3.0");
  board.data.write("animations/dot.json", DOT);
  publish_firmware();
  TEST_ASSERT_EQUAL_STRING("", error_of("\"cmd\":\"update_check\"").c_str());
  drive();
  TEST_ASSERT_EQUAL_STRING("", error_of("\"cmd\":\"update_install\",\"target\":\"firmware\",\"force\":true").c_str());
  drive_install();
  restart_board();

  firmware::sim_fail_saves(true);
  TEST_ASSERT_TRUE(play_stored_animation("dot"));
  for (int i = 0; i < 300; ++i)
    firmware::first_frame_shown(); // the attempts fail while the store does
  firmware::sim_fail_saves(false);
  for (int i = 0; i < 100; ++i)
    firmware::first_frame_shown();
  restart_board();
  TEST_ASSERT_EQUAL_STRING("1.3.0", platform::firmware_version());
  TEST_ASSERT_EQUAL_STRING("updated", last_install()["result"].as<const char *>());
  TEST_ASSERT_EQUAL_STRING("", firmware::skipped().c_str());
}

static void test_a_failed_mark_invalid_restarts_and_the_trial_is_treated_as_a_restart()
{
  Board board("sim-firmware-mark-invalid", NOTIFY);
  firmware::sim_set_version("1.2.0");
  publish_firmware();
  check_and_install();
  firmware::sim_fail_marks(true);
  restart_board(true); // the health check fails and the mark fails: the board still restarts
  firmware::sim_fail_marks(false);
  TEST_ASSERT_EQUAL_STRING("1.2.0", platform::firmware_version());
  TEST_ASSERT_FALSE(firmware::sim_on_trial());
}

static void test_a_restart_before_the_switch_is_not_a_rollback()
{
  Board board("sim-firmware-interrupted", NOTIFY);
  firmware::sim_set_version("1.2.0");
  publish_firmware();
  TEST_ASSERT_TRUE(firmware::begin_image(IMAGE.size()));
  TEST_ASSERT_TRUE(firmware::write_image(IMAGE.data(), IMAGE.size()));
  TEST_ASSERT_TRUE(firmware::end_image());
  restart_board(); // the board restarted before activate(): the slot was never made the boot slot
  TEST_ASSERT_EQUAL_STRING("1.2.0", platform::firmware_version());
  TEST_ASSERT_TRUE(last_install().isNull());
  TEST_ASSERT_EQUAL_STRING("", firmware::skipped().c_str());
}

static void test_a_restart_before_the_switch_after_an_earlier_rollback_is_not_a_rollback()
{
  Board board("sim-firmware-interrupted-after-rollback", NOTIFY);
  firmware::sim_set_version("1.2.0");
  publish_firmware();
  check_and_install();
  restart_board();
  restart_board(true); // 1.3.0 fails its health check: rolled back and skipped
  TEST_ASSERT_EQUAL_STRING("1.3.0", firmware::skipped().c_str());

  // The next installation stores its record, and the board restarts before the boot slot changes.
  const std::string newer = "pixelart-sim-firmware-1.4.0";
  TEST_ASSERT_TRUE(firmware::begin_image(newer.size()));
  TEST_ASSERT_TRUE(firmware::write_image(newer.data(), newer.size()));
  TEST_ASSERT_TRUE(firmware::end_image());
  firmware::sim_restart_before_switch();
  TEST_ASSERT_FALSE(firmware::activate("1.2.0", "1.4.0"));
  restart_board();

  // 1.4.0 never ran: no rollback is recorded for it, and the earlier one stays.
  TEST_ASSERT_EQUAL_STRING("1.2.0", platform::firmware_version());
  JsonDocument last = last_install();
  TEST_ASSERT_EQUAL_STRING("rolled_back", last["result"].as<const char *>());
  TEST_ASSERT_EQUAL_STRING("1.3.0", last["to"].as<const char *>());
  TEST_ASSERT_EQUAL_STRING("1.3.0", firmware::skipped().c_str());
}

static void test_a_firmware_that_cannot_be_written_leaves_the_boot_slot_and_reports_flash_error()
{
  Board board("sim-firmware-flash", NOTIFY);
  firmware::sim_set_version("1.2.0");
  publish_firmware();

  firmware::sim_fail_writes(true);
  TEST_ASSERT_EQUAL_STRING("", error_of("\"cmd\":\"update_check\"").c_str());
  drive();
  TEST_ASSERT_EQUAL_STRING("", error_of("\"cmd\":\"update_install\",\"target\":\"firmware\"").c_str());
  drive_install();
  TEST_ASSERT_FALSE(firmware::sim_restart_requested());
  TEST_ASSERT_EQUAL_STRING("flash_error", status_update()["last_result"].as<const char *>());
  TEST_ASSERT_EQUAL_STRING("idle", status_update()["state"].as<const char *>());
  TEST_ASSERT_EQUAL_STRING("1.3.0", status_update()["firmware"].as<const char *>()); // still offered
  TEST_ASSERT_FALSE(updates::firmware_installing());
  TEST_ASSERT_TRUE(firmware::sim_image().empty());

  // An image larger than the slot is refused before it is downloaded.
  firmware::sim_fail_writes(false);
  firmware::sim_set_slot_size(IMAGE.size() - 1);
  TEST_ASSERT_EQUAL_STRING("", error_of("\"cmd\":\"update_install\",\"target\":\"firmware\"").c_str());
  drive_install();
  TEST_ASSERT_EQUAL_STRING("flash_error", status_update()["last_result"].as<const char *>());
  TEST_ASSERT_FALSE(firmware::sim_restart_requested());

  // One exactly as large as the slot is written.
  firmware::sim_set_slot_size(IMAGE.size());
  TEST_ASSERT_EQUAL_STRING("", error_of("\"cmd\":\"update_install\",\"target\":\"firmware\"").c_str());
  drive_install();
  TEST_ASSERT_TRUE(firmware::sim_restart_requested());
}

static void test_a_record_that_cannot_be_stored_leaves_the_boot_slot_and_reports_flash_error()
{
  Board board("sim-firmware-record", NOTIFY);
  firmware::sim_set_version("1.2.0");
  publish_firmware();

  firmware::sim_fail_saves(true);
  TEST_ASSERT_EQUAL_STRING("", error_of("\"cmd\":\"update_check\"").c_str());
  drive();
  TEST_ASSERT_EQUAL_STRING("", error_of("\"cmd\":\"update_install\",\"target\":\"firmware\"").c_str());
  drive_install();
  TEST_ASSERT_FALSE(firmware::sim_restart_requested());
  TEST_ASSERT_EQUAL_STRING("flash_error", status_update()["last_result"].as<const char *>());
  TEST_ASSERT_EQUAL_STRING("1.2.0", firmware::sim_version());

  // Once the record can be stored the installation goes through.
  firmware::sim_fail_saves(false);
  TEST_ASSERT_EQUAL_STRING("", error_of("\"cmd\":\"update_install\",\"target\":\"firmware\"").c_str());
  drive_install();
  TEST_ASSERT_TRUE(firmware::sim_restart_requested());
}

static void test_every_failure_of_a_firmware_download_is_reported_and_nothing_is_staged()
{
  struct Failure
  {
    updates::Failure kind;
    const char *code;
  };
  const Failure failures[] = {{updates::Failure::Corrupt, "checksum_mismatch"},
                              {updates::Failure::TooLong, "checksum_mismatch"},
                              {updates::Failure::Cut, "network_error"},
                              {updates::Failure::HttpError, "http_error"},
                              {updates::Failure::TlsError, "tls_error"}};
  for (const Failure &f : failures)
  {
    Board board("sim-firmware-failures", NOTIFY);
    firmware::sim_set_version("1.2.0");
    publish_firmware();
    updates::sim_inject(f.kind, "firmware/simulator/app.bin");
    check_and_install();
    TEST_ASSERT_FALSE_MESSAGE(firmware::sim_restart_requested(), f.code);
    TEST_ASSERT_EQUAL_STRING(f.code, status_update()["last_result"].as<const char *>());
    TEST_ASSERT_EQUAL_STRING("idle", status_update()["state"].as<const char *>());
    TEST_ASSERT_TRUE_MESSAGE(firmware::sim_image().empty(), f.code);
    restart_board();
    TEST_ASSERT_EQUAL_STRING_MESSAGE("1.2.0", platform::firmware_version(), f.code);
    TEST_ASSERT_FALSE_MESSAGE(firmware::sim_on_trial(), f.code);
  }
  // A firmware manifest over plain HTTP is never read: the project's URL is HTTPS and built in.
  Board board("sim-firmware-down", NOTIFY);
  firmware::sim_set_version("1.2.0");
  publish_firmware();
  updates::sim_inject(updates::Failure::ServerDown);
  TEST_ASSERT_EQUAL_STRING("", error_of("\"cmd\":\"update_check\"").c_str());
  drive();
  TEST_ASSERT_EQUAL_STRING("network_error", status_update()["last_result"].as<const char *>());
  TEST_ASSERT_TRUE(status_update()["firmware"].isNull());
}

static void test_the_matrix_shows_the_update_icon_instead_of_the_animation_while_the_firmware_installs()
{
  Board board("sim-firmware-icon", NOTIFY);
  firmware::sim_set_version("1.2.0");
  board.data.write("animations/dot.json", pixelart_test::dot_animation("#ff0000", 5, 100));
  publish_firmware();
  TEST_ASSERT_EQUAL_STRING("", error_of("\"cmd\":\"update_check\"").c_str());
  drive();
  const size_t before = sim::frames().size();
  TEST_ASSERT_EQUAL_STRING("", error_of("\"cmd\":\"update_install\",\"target\":\"firmware\"").c_str());
  TEST_ASSERT_TRUE(updates::firmware_installing());
  TEST_ASSERT_TRUE(play_stored_animation("dot"));
  TEST_ASSERT_TRUE(firmware::sim_restart_requested());

  // The animation was in the wait for its first frame when the request came. The next frame is the icon, and
  // the animation's dot, at the corner, is gone.
  TEST_ASSERT_TRUE(sim::frames().size() > before + 1);
  TEST_ASSERT_TRUE(sim::frames()[before].at(0, 0) != 0);
  const sim::Frame &icon = sim::frames()[before + 1];
  // Board brightness 100: the matrix takes RGB565, applies the gamma tables of NeoMatrix, and scales each channel
  // by 101 / 256. Cyan 0x00FFFF is 0x006464 (255 * 101 >> 8 = 100). The tray grey 0x808080 is 565 values 16, 32, 16,
  // which the tables give 0x36, 0x41, 0x36, so 0x151915. The dark grey 0x202020 is 4, 8, 4, which gives 0x05, 0x09,
  // 0x05, so 0x010301. 0 progress fills nothing.
  TEST_ASSERT_EQUAL_HEX32(0x006464, icon.at(7, 1));
  TEST_ASSERT_EQUAL_HEX32(0x006464, icon.at(4, 6));
  TEST_ASSERT_EQUAL_HEX32(0x151915, icon.at(2, 11));
  TEST_ASSERT_EQUAL_HEX32(0x151915, icon.at(8, 13));
  TEST_ASSERT_EQUAL_HEX32(0x010301, icon.at(0, 15));
  TEST_ASSERT_EQUAL_HEX32(0x010301, icon.at(15, 15));
  TEST_ASSERT_EQUAL_HEX32(0, icon.at(0, 0));
  TEST_ASSERT_EQUAL_HEX32(0, icon.at(7, 12));
}

static void test_the_update_icon_follows_the_boards_brightness_setting()
{
  Board board("sim-firmware-icon-brightness", NOTIFY);
  firmware::sim_set_version("1.2.0");
  board.data.write("animations/dot.json", DOT);
  publish_firmware();
  TEST_ASSERT_TRUE(ask("\"cmd\":\"settings_set\",\"brightness\":50")["ok"].as<bool>());
  TEST_ASSERT_EQUAL_STRING("", error_of("\"cmd\":\"update_check\"").c_str());
  drive();
  const size_t before = sim::frames().size();
  TEST_ASSERT_EQUAL_STRING("", error_of("\"cmd\":\"update_install\",\"target\":\"firmware\"").c_str());
  TEST_ASSERT_TRUE(play_stored_animation("dot"));
  // Brightness 50: cyan is (255 * 51) >> 8 = 50 per lit channel.
  TEST_ASSERT_EQUAL_HEX32(0x003232, sim::frames()[before + 1].at(7, 1));
}

static void test_the_animation_resumes_when_the_installation_fails()
{
  Board board("sim-firmware-resume", NOTIFY);
  firmware::sim_set_version("1.2.0");
  board.data.write("animations/dot.json", pixelart_test::dot_animation("#ff0000", 4, 100));
  publish_firmware();
  updates::sim_inject(updates::Failure::Corrupt, "firmware/simulator/app.bin");
  TEST_ASSERT_EQUAL_STRING("", error_of("\"cmd\":\"update_check\"").c_str());
  drive();
  TEST_ASSERT_EQUAL_STRING("", error_of("\"cmd\":\"update_install\",\"target\":\"firmware\"").c_str());
  const size_t before = sim::frames().size();
  TEST_ASSERT_TRUE(play_stored_animation("dot"));
  TEST_ASSERT_FALSE(updates::firmware_installing());
  TEST_ASSERT_EQUAL_STRING("checksum_mismatch", status_update()["last_result"].as<const char *>());
  // The animation's dot is on the matrix again at the end: the last frame is the animation's.
  TEST_ASSERT_TRUE(sim::frames().size() > before);
  TEST_ASSERT_TRUE(sim::frames().back().at(0, 0) != 0);
  TEST_ASSERT_EQUAL_HEX32(0, sim::frames().back().at(7, 1));
}

static void test_the_simulated_restart_calls_the_hook_the_simulator_program_uses()
{
  Board board("sim-firmware-hook", NOTIFY);
  firmware::sim_set_version("1.2.0");
  publish_firmware();
  int calls = 0;
  firmware::sim_set_restart_hook(
      [&calls]
      {
        calls++;
      });
  check_and_install();
  firmware::sim_set_restart_hook(nullptr);
  TEST_ASSERT_EQUAL(1, calls);
}

static void test_the_simulator_checks_on_a_schedule_only_with_an_update_source()
{
  Board quiet("sim-update-quiet");
  sim::advance_us(3600ULL * 1000000);
  updates::poll();
  TEST_ASSERT_TRUE(status_update()["last_check"].isNull());

  Board board("sim-update-schedule", NOTIFY);
  Source source;
  source.add_animation("red", RED);
  source.publish();
  updates::poll(); // the first address
  sim::advance_us(299 * 1000000ULL);
  updates::poll();
  TEST_ASSERT_TRUE(status_update()["last_check"].isNull());
  sim::advance_us(1 * 1000000ULL);
  drive();
  JsonDocument s = status_update();
  TEST_ASSERT_EQUAL_STRING("ok", s["last_result"].as<const char *>());
  TEST_ASSERT_EQUAL(0, s["last_check"].as<int>());
  TEST_ASSERT_EQUAL(1, s["files"].as<int>());
  // Off never checks.
  Board off("sim-update-schedule-off", R"("update_mode":"off")");
  source.publish();
  updates::poll();
  sim::advance_us(3600ULL * 1000000);
  updates::poll();
  TEST_ASSERT_TRUE(status_update()["last_check"].isNull());
}

static void test_a_temporary_file_left_by_an_interrupted_update_is_removed_at_boot()
{
  Board board("sim-update-leftover", NOTIFY);
  board.data.write("update.tmp", "half a file");
  board.data.write("upload.tmp", "half an upload");
  setup();
  TEST_ASSERT_FALSE(storage::exists(updates::TEMP_FILE));
}

static void test_the_simulator_never_fetches_from_outside_its_source_folder()
{
  Board board("sim-update-confine", R"("animation_source":"https://example.test/a/../../manifest.json")");
  Source source;
  source.add_animation("red", RED);
  source.publish();
  error_of("\"cmd\":\"update_check\"");
  drive();
  TEST_ASSERT_EQUAL_STRING("network_error", status_update()["last_result"].as<const char *>());
}

static void test_the_default_source_and_a_local_http_source_both_map_to_the_folder()
{
  Board board("sim-update-urls", NOTIFY);
  Source source;
  source.add_animation("red", RED);
  source.publish();
  error_of("\"cmd\":\"update_check\""); // the default URL, https://monska85.github.io/PixelArt/manifest.json
  drive();
  TEST_ASSERT_EQUAL(1, status_update()["files"].as<int>());
  ask("\"cmd\":\"settings_set\",\"animation_source\":\"http://localhost:8000/manifest.json\"");
  updates::poll();
  TEST_ASSERT_EQUAL(0, status_update()["files"].as<int>()); // a new source forgets the old finding
  error_of("\"cmd\":\"update_check\"");
  drive();
  TEST_ASSERT_EQUAL_STRING("ok", status_update()["last_result"].as<const char *>());
  TEST_ASSERT_EQUAL(1, status_update()["files"].as<int>());
}

// ---- A manifest within the memory of the board ----

// A manifest with `count` animations, each with a long path and a SHA-256, as a release with many files.
static std::string many_animations(size_t count)
{
  std::string list;
  for (size_t i = 0; i < count; i++)
  {
    char id[8];
    snprintf(id, sizeof(id), "a%03u", (unsigned)i);
    list += (i ? "," : "") + anim_entry(id, std::string("animations/") + id + "-long-file-name.json", "100", HEX_A);
  }
  return manifest(list, "");
}

static void test_a_manifest_within_memory_is_read_after_its_input_is_released()
{
  const std::string json = many_animations(200);
  std::vector<std::string> events;
  ManifestMemory memory;
  memory.affordable = [&](size_t total, size_t block)
  {
    events.push_back("ask " + std::to_string(total) + " " + std::to_string(block));
    return true;
  };
  memory.release_input = [&]
  {
    events.push_back("release");
  };
  Manifest m;
  std::string reason;
  TEST_ASSERT_TRUE_MESSAGE(parse_manifest(json.data(), json.size(), m, reason, memory), reason.c_str());
  TEST_ASSERT_FALSE(memory.out_of_memory);
  TEST_ASSERT_EQUAL(200, m.animations.size());
  TEST_ASSERT_EQUAL_STRING("animations/a199-long-file-name.json", m.animations[199].file.c_str());
  // The input is released once, after the document was parsed (its allocations come first) and before
  // the lists are built: the one request after it is the cost of the lists, at least their vector.
  const auto release = std::find(events.begin(), events.end(), "release");
  TEST_ASSERT_TRUE(release != events.begin() && release != events.end());
  TEST_ASSERT_EQUAL(1, std::count(events.begin(), events.end(), "release"));
  TEST_ASSERT_EQUAL(1, events.end() - release - 1);
  size_t total = 0, block = 0;
  sscanf(release[1].c_str(), "ask %zu %zu", &total, &block);
  TEST_ASSERT_EQUAL(200 * sizeof(FileEntry), block);
  // Every entry's path and SHA-256 are longer than a string holds by itself.
  TEST_ASSERT_TRUE(total >= block + 200 * (65 + 36));
}

static void test_a_manifest_whose_document_does_not_fit_is_out_of_memory()
{
  const std::string json = many_animations(200);
  size_t granted = 0;
  ManifestMemory memory;
  memory.affordable = [&](size_t total, size_t)
  {
    if (granted + total > 8192)
      return false;
    granted += total;
    return true;
  };
  bool released = false;
  memory.release_input = [&]
  {
    released = true;
  };
  Manifest m;
  std::string reason;
  TEST_ASSERT_FALSE(parse_manifest(json.data(), json.size(), m, reason, memory));
  TEST_ASSERT_TRUE(memory.out_of_memory);
  TEST_ASSERT_FALSE(released);
  TEST_ASSERT_EQUAL_STRING("the manifest does not fit in memory", reason.c_str());
  TEST_ASSERT_EQUAL(0, m.animations.size());
}

static void test_a_manifest_whose_lists_do_not_fit_is_out_of_memory()
{
  const std::string json = many_animations(200);
  ManifestMemory memory;
  // The document fits (every request of the parser is small), the lists of 200 entries do not.
  memory.affordable = [&](size_t total, size_t)
  {
    return total < 200 * sizeof(FileEntry);
  };
  Manifest m;
  std::string reason;
  TEST_ASSERT_FALSE(parse_manifest(json.data(), json.size(), m, reason, memory));
  TEST_ASSERT_TRUE(memory.out_of_memory);
  TEST_ASSERT_EQUAL(0, m.animations.size());
}

static void test_a_wrong_manifest_is_not_out_of_memory()
{
  ManifestMemory memory;
  memory.affordable = [](size_t, size_t)
  {
    return true;
  };
  Manifest m;
  std::string reason;
  const std::string json = "{\"format\":\"other\"}";
  TEST_ASSERT_FALSE(parse_manifest(json.data(), json.size(), m, reason, memory));
  TEST_ASSERT_FALSE(memory.out_of_memory);
}

static void test_a_check_whose_manifest_does_not_fit_reports_out_of_memory()
{
  FakeHost host;
  serve(host, {{"a", "AAA"}});
  host.memory_budget = 0;
  Updater u(host);
  u.configure(config());
  u.tick(0);
  settle(u, 300000);
  TEST_ASSERT_TRUE(host.memory_asks > 0);
  TEST_ASSERT_TRUE(u.status().has_result && u.status().result == Error::OutOfMemory);
  TEST_ASSERT_EQUAL(0, u.status().files);
  TEST_ASSERT_EQUAL(0, host.downloaded.size());
  // With the memory back, the next check reads it.
  host.memory_budget = SIZE_MAX;
  TEST_ASSERT_TRUE(u.request_check());
  settle(u, 300001);
  TEST_ASSERT_TRUE(u.status().result == Error::None);
  TEST_ASSERT_EQUAL(1, u.status().files);
}

static void test_too_many_files_are_a_bad_manifest_even_without_memory()
{
  const std::string json = many_animations(201);
  ManifestMemory memory;
  memory.affordable = [](size_t, size_t)
  {
    return false;
  }; // nothing may be allocated
  bool asked_after_release = false, released = false;
  memory.release_input = [&]
  {
    released = true;
  };
  Manifest m;
  std::string reason;
  // The document cannot be parsed without memory: out of memory, not a verdict on the content.
  TEST_ASSERT_FALSE(parse_manifest(json.data(), json.size(), m, reason, memory));
  TEST_ASSERT_TRUE(memory.out_of_memory);
  // With room for the document but none for the lists, 201 files are refused for their number.
  memory.affordable = [&](size_t, size_t)
  {
    if (released)
      asked_after_release = true;
    return !released;
  };
  TEST_ASSERT_FALSE(parse_manifest(json.data(), json.size(), m, reason, memory));
  TEST_ASSERT_TRUE(released);
  TEST_ASSERT_FALSE(memory.out_of_memory);
  TEST_ASSERT_FALSE(asked_after_release);
  TEST_ASSERT_EQUAL_STRING("the manifest lists too many files", reason.c_str());
}

static void test_a_firmware_list_that_does_not_fit_is_out_of_memory()
{
  std::string firmware;
  for (int i = 0; i < 300; i++)
    firmware += (i ? "," : "") + std::string("{\"board\":\"board-") + std::to_string(i) +
                "\",\"part\":\"app\",\"file\":\"firmware/board-" + std::to_string(i) +
                "/app-1.2.0.bin\",\"size\":1000,\"sha256\":\"" + HEX_A + "\"}";
  const std::string json = manifest(anim_entry("dot", "animations/dot.json", "147", HEX_A), "", firmware);
  size_t asked = 0, block = 0;
  bool released = false;
  ManifestMemory memory;
  memory.release_input = [&]
  {
    released = true;
  };
  memory.affordable = [&](size_t t, size_t b)
  {
    if (released)
    {
      asked = t;
      block = b;
      return false;
    }
    return true;
  };
  Manifest m;
  std::string reason;
  TEST_ASSERT_FALSE(parse_manifest(json.data(), json.size(), m, reason, memory));
  TEST_ASSERT_TRUE(memory.out_of_memory);
  // The request counts the 300 firmware entries kept: their vector, and each path and SHA-256.
  TEST_ASSERT_EQUAL(300 * sizeof(FirmwareEntry), block);
  TEST_ASSERT_TRUE(asked >= block + 300 * (65 + 16 + 30 + 16));
  TEST_ASSERT_EQUAL(0, m.firmware.size());
}

static void test_only_the_app_firmware_entries_count()
{
  // Other parts are not kept, so they cost nothing but their place in the document.
  const std::string json = good_manifest();
  size_t block = 0;
  bool released = false;
  ManifestMemory memory;
  memory.release_input = [&]
  {
    released = true;
  };
  memory.affordable = [&](size_t, size_t b)
  {
    if (released)
      block = b;
    return true;
  };
  Manifest m;
  std::string reason;
  TEST_ASSERT_TRUE(parse_manifest(json.data(), json.size(), m, reason, memory));
  TEST_ASSERT_EQUAL(1, m.firmware.size());
  TEST_ASSERT_EQUAL(2 * sizeof(FileEntry) > sizeof(FirmwareEntry) ? 2 * sizeof(FileEntry) : sizeof(FirmwareEntry),
                    block);
}

static void test_a_plan_moves_the_strings_out_of_the_manifest()
{
  Manifest m;
  TEST_ASSERT_TRUE(reads(good_manifest(), m));
  std::vector<PlanItem> plan = plan_sync(m,
                                         [](Kind, const std::string &, std::string &)
                                         {
                                           return false;
                                         });
  TEST_ASSERT_EQUAL(3, plan.size());
  TEST_ASSERT_EQUAL_STRING("tree", plan[1].id.c_str());
  TEST_ASSERT_EQUAL_STRING("animations/tree.json", plan[1].file.c_str());
  TEST_ASSERT_EQUAL(64, plan[1].sha256.size());
  TEST_ASSERT_TRUE(m.animations[1].file.empty() && m.animations[1].sha256.empty());
  // The version and the firmware stay for the firmware check that follows.
  TEST_ASSERT_EQUAL_STRING("1.2.0", m.version.c_str());
  TEST_ASSERT_EQUAL(1, m.firmware.size());
  TEST_ASSERT_EQUAL(3 * sizeof(PlanItem), plan_block(m));
}

static void test_a_check_without_memory_for_its_plan_reports_out_of_memory()
{
  FakeHost host;
  serve(host, {{"a", "AAA"}});
  Updater u(host);
  u.configure(config());
  host.memory_rule = [](size_t, size_t block)
  {
    return block != sizeof(PlanItem);
  };
  u.tick(0);
  settle(u, 300000);
  TEST_ASSERT_TRUE(u.status().has_result && u.status().result == Error::OutOfMemory);
  TEST_ASSERT_EQUAL(0, u.status().files);
  TEST_ASSERT_EQUAL(0, host.downloaded.size());
}

int main(int, char **)
{
  UNITY_BEGIN();
  RUN_TEST(test_versions_follow_semver_precedence);
  RUN_TEST(test_a_release_is_an_update_for_its_development_build);
  RUN_TEST(test_versions_that_are_not_semver_do_not_parse);
  RUN_TEST(test_a_valid_manifest_is_read);
  RUN_TEST(test_a_manifest_needs_no_firmware_and_ignores_fields_it_does_not_know);
  RUN_TEST(test_the_manifest_size_limit_is_64_kib);
  RUN_TEST(test_a_manifest_that_is_not_strict_json_is_refused);
  RUN_TEST(test_the_format_and_the_version_are_checked);
  RUN_TEST(test_a_manifest_entry_needs_a_valid_id_path_size_and_checksum);
  RUN_TEST(test_a_manifest_lists_at_most_200_files);
  RUN_TEST(test_the_firmware_list_is_checked_only_for_what_the_board_uses);
  RUN_TEST(test_file_urls_resolve_against_the_manifest_url);
  RUN_TEST(test_file_urls_are_refused_when_they_could_leave_the_manifests_folder);
  RUN_TEST(test_redirects_never_leave_https_for_http_and_http_needs_permission);
  RUN_TEST(test_the_plan_adds_replaces_and_skips_with_animations_first);
  RUN_TEST(test_a_firmware_is_available_when_newer_for_this_board_and_not_skipped);
  RUN_TEST(test_the_first_check_comes_5_minutes_after_the_first_address);
  RUN_TEST(test_the_next_check_follows_check_hours_with_up_to_10_minutes_of_delay);
  RUN_TEST(test_a_failed_check_is_retried_after_30_minutes_then_the_schedule_goes_on);
  RUN_TEST(test_the_schedule_does_not_wrap_after_a_long_run);
  RUN_TEST(test_equal_start_and_end_is_the_whole_day_even_without_the_time);
  RUN_TEST(test_a_window_inside_the_day_includes_its_start_and_not_its_end);
  RUN_TEST(test_a_window_whose_end_is_before_its_start_runs_over_midnight);
  RUN_TEST(test_a_narrow_window_waits_for_the_time_when_it_is_not_known);
  RUN_TEST(test_the_first_check_runs_5_minutes_after_the_first_address);
  RUN_TEST(test_the_delay_after_a_check_is_random_and_a_failure_retries_after_30_minutes);
  RUN_TEST(test_nothing_is_checked_when_updates_are_off_or_the_board_is_offline);
  RUN_TEST(test_a_check_on_request_runs_at_once_and_a_second_one_is_refused_while_busy);
  RUN_TEST(test_an_installation_downloads_checks_and_stores_every_file_and_counts_failures);
  RUN_TEST(test_cancelling_stops_an_installation_without_counting_a_failure);
  RUN_TEST(test_a_file_the_loop_task_discards_ends_the_installation_quietly);
  RUN_TEST(test_an_installation_that_was_asked_for_does_not_start_after_a_cancel);
  RUN_TEST(test_a_file_is_refused_for_its_size_checksum_or_the_free_space_without_stopping_the_update);
  RUN_TEST(test_a_manifest_shaped_like_release_py_output_is_accepted);
  RUN_TEST(test_a_bad_manifest_is_a_failed_check_that_forgets_the_last_plan);
  RUN_TEST(test_a_manifest_that_answers_404_is_an_http_error_with_the_detail_no_release);
  RUN_TEST(test_the_firmware_manifest_answering_404_is_reported_the_same_way);
  RUN_TEST(test_automatic_mode_installs_after_a_check_inside_the_window);
  RUN_TEST(test_automatic_mode_waits_for_the_window_and_checks_again_when_it_opens);
  RUN_TEST(test_automatic_mode_reports_waiting_for_time_and_installs_when_the_time_is_known);
  RUN_TEST(test_an_installation_on_request_ignores_the_window);
  RUN_TEST(test_changing_the_source_or_turning_updates_off_forgets_what_was_found);
  RUN_TEST(test_an_unusable_source_url_fails_the_check_without_a_request);
  RUN_TEST(test_a_check_offers_the_firmware_for_this_board_when_it_is_newer);
  RUN_TEST(test_the_firmware_switch_off_never_reads_the_project_manifest);
  RUN_TEST(test_a_manifest_that_is_both_sources_is_read_once);
  RUN_TEST(test_each_manifest_that_fails_fails_the_check_but_the_other_result_stays);
  RUN_TEST(test_no_plan_is_held_while_a_manifest_is_read);
  RUN_TEST(test_a_skipped_version_is_reported_and_installs_only_by_force);
  RUN_TEST(test_a_release_newer_than_the_skipped_version_ends_the_skip);
  RUN_TEST(test_http_for_firmware_is_for_test_builds_only);
  RUN_TEST(test_a_firmware_install_downloads_checks_activates_and_restarts);
  RUN_TEST(test_a_firmware_install_that_fails_leaves_the_slot_alone_and_can_be_repeated);
  RUN_TEST(test_an_automatic_install_stores_the_animations_before_the_firmware);
  RUN_TEST(test_an_automatic_install_waits_for_its_window_and_never_installs_a_skipped_version);
  RUN_TEST(test_a_changed_animation_source_keeps_a_firmware_install_waiting_for_its_window);
  RUN_TEST(test_the_time_is_needed_only_for_a_window_narrower_than_the_day);
  RUN_TEST(test_the_update_icon_is_the_grid_of_the_specification);
  RUN_TEST(test_the_progress_bar_fills_a_sixteenth_per_6_and_a_quarter_percent);
  RUN_TEST(test_byte_buffer_stops_at_its_limit);
  RUN_TEST(test_update_check_and_install_download_and_store_what_the_manifest_lists);
  RUN_TEST(test_the_update_commands_refuse_what_the_settings_and_the_network_do_not_allow);
  RUN_TEST(test_every_failure_of_a_download_is_reported_and_leaves_the_other_files_installed);
  RUN_TEST(test_a_stored_file_stays_as_it_was_when_its_replacement_fails);
  RUN_TEST(test_a_file_the_engine_rejects_is_not_stored);
  RUN_TEST(test_a_manifest_that_cannot_be_used_fails_the_check);
  RUN_TEST(test_server_failures_fail_the_check_with_their_own_code);
  RUN_TEST(test_a_file_that_does_not_fit_is_reported_as_no_space);
  RUN_TEST(test_only_a_missing_manifest_has_the_detail_no_release);
  RUN_TEST(test_a_write_failure_while_downloading_is_a_storage_error);
  RUN_TEST(test_automatic_mode_installs_by_itself_after_a_check);
  RUN_TEST(test_automatic_mode_follows_the_install_window);
  RUN_TEST(test_an_installed_firmware_boots_on_trial_and_confirms_itself_at_its_first_frame);
  RUN_TEST(test_a_firmware_that_restarts_before_its_first_frame_is_rolled_back_and_skipped);
  RUN_TEST(test_a_failed_health_check_marks_the_firmware_invalid_and_the_previous_one_runs);
  RUN_TEST(test_a_failed_mark_valid_records_no_installation_and_keeps_the_trial);
  RUN_TEST(test_a_confirmation_that_cannot_be_stored_is_recorded_at_the_next_boot);
  RUN_TEST(test_a_confirmation_that_cannot_be_stored_is_stored_again_while_the_board_runs);
  RUN_TEST(test_the_store_failing_between_any_two_writes_never_loses_a_confirmed_installation);
  RUN_TEST(test_the_store_failing_between_any_two_writes_never_loses_a_rollback);
  RUN_TEST(test_a_firmware_flashed_over_usb_with_the_pending_version_is_not_reported_as_installed);
  RUN_TEST(test_a_new_firmware_that_booted_but_could_not_confirm_is_rolled_back_and_the_evidence_is_dropped);
  RUN_TEST(test_a_confirmation_retry_that_overlaps_a_second_installation_does_not_erase_it);
  RUN_TEST(test_a_failed_mark_invalid_restarts_and_the_trial_is_treated_as_a_restart);
  RUN_TEST(test_a_restart_before_the_switch_is_not_a_rollback);
  RUN_TEST(test_a_restart_before_the_switch_after_an_earlier_rollback_is_not_a_rollback);
  RUN_TEST(test_a_firmware_that_cannot_be_written_leaves_the_boot_slot_and_reports_flash_error);
  RUN_TEST(test_a_record_that_cannot_be_stored_leaves_the_boot_slot_and_reports_flash_error);
  RUN_TEST(test_every_failure_of_a_firmware_download_is_reported_and_nothing_is_staged);
  RUN_TEST(test_the_matrix_shows_the_update_icon_instead_of_the_animation_while_the_firmware_installs);
  RUN_TEST(test_the_update_icon_follows_the_boards_brightness_setting);
  RUN_TEST(test_the_animation_resumes_when_the_installation_fails);
  RUN_TEST(test_the_simulated_restart_calls_the_hook_the_simulator_program_uses);
  RUN_TEST(test_the_simulator_checks_on_a_schedule_only_with_an_update_source);
  RUN_TEST(test_a_temporary_file_left_by_an_interrupted_update_is_removed_at_boot);
  RUN_TEST(test_the_simulator_never_fetches_from_outside_its_source_folder);
  RUN_TEST(test_the_default_source_and_a_local_http_source_both_map_to_the_folder);
  RUN_TEST(test_a_manifest_within_memory_is_read_after_its_input_is_released);
  RUN_TEST(test_a_manifest_whose_document_does_not_fit_is_out_of_memory);
  RUN_TEST(test_a_manifest_whose_lists_do_not_fit_is_out_of_memory);
  RUN_TEST(test_a_wrong_manifest_is_not_out_of_memory);
  RUN_TEST(test_a_check_whose_manifest_does_not_fit_reports_out_of_memory);
  RUN_TEST(test_too_many_files_are_a_bad_manifest_even_without_memory);
  RUN_TEST(test_a_firmware_list_that_does_not_fit_is_out_of_memory);
  RUN_TEST(test_only_the_app_firmware_entries_count);
  RUN_TEST(test_a_plan_moves_the_strings_out_of_the_manifest);
  RUN_TEST(test_a_check_without_memory_for_its_plan_reports_out_of_memory);
  return UNITY_END();
}
