// The storage layer on the simulator: the file rules the board's file system
// imposes, and the listing and reading calls the protocol builds on.
// Run with: pio test -e native_test (or make test)

#include <sim.h>
#include <unity.h>

#include <string>

#include "storage.h"
#include "pixelart_test.h"

namespace fs = std::filesystem;
using pixelart_test::TempData;

void setUp() {}
void tearDown() {}

static void test_simulator_refuses_to_read_or_rename_a_file_a_writer_holds_open()
{
  sim::reset();
  TempData data("open-file");
  storage::Writer writer;
  TEST_ASSERT_TRUE(writer.open("/animations/held.json"));
  TEST_ASSERT_TRUE(writer.write("abc", 3));
  storage::Buffer out;
  TEST_ASSERT_TRUE(storage::read("/animations/held.json", out, 100) == storage::ReadResult::Unreadable);
  TEST_ASSERT_FALSE(storage::rename("/animations/held.json", "/animations/moved.json"));

  writer.close();
  TEST_ASSERT_TRUE(storage::read("/animations/held.json", out, 100) == storage::ReadResult::Ok);
  TEST_ASSERT_EQUAL(3, out.size);
  TEST_ASSERT_TRUE(storage::rename("/animations/held.json", "/animations/moved.json"));
}

static void test_list_is_sorted_and_skips_folders()
{
  sim::reset();
  TempData data("list");
  data.write("animations/b.json", "{}");
  data.write("animations/a.json", "{}");
  data.write("animations/sub/c.json", "{}");
  std::vector<std::string> names = storage::list("/animations");
  TEST_ASSERT_EQUAL(2, names.size());
  TEST_ASSERT_EQUAL_STRING("a.json", names[0].c_str());
  TEST_ASSERT_EQUAL_STRING("b.json", names[1].c_str());
  TEST_ASSERT_TRUE(storage::list("/missing").empty());
}

static void test_reader_read_all_reports_what_storage_read_reports()
{
  sim::reset();
  TempData data("read-all");
  data.write("animations/a.json", "abcd");

  storage::Reader file;
  TEST_ASSERT_TRUE(file.open("/animations/a.json") == storage::ReadResult::Ok);
  TEST_ASSERT_EQUAL(4, file.size());
  storage::Buffer out;
  TEST_ASSERT_TRUE(file.read_all(out, 100) == storage::ReadResult::Ok);
  TEST_ASSERT_EQUAL(4, out.size);
  TEST_ASSERT_EQUAL_MEMORY("abcd", out.data.get(), 4);
  TEST_ASSERT_TRUE(file.read_all(out, 3) == storage::ReadResult::TooLarge);

  storage::Reader missing;
  TEST_ASSERT_TRUE(missing.open("/animations/none.json") == storage::ReadResult::Missing);
}

static void test_exists_size_and_remove_of_a_missing_file()
{
  sim::reset();
  TempData data("missing");
  size_t size = 99;
  TEST_ASSERT_FALSE(storage::exists("/animations/none.json"));
  TEST_ASSERT_FALSE(storage::file_size("/animations/none.json", size));
  TEST_ASSERT_TRUE(storage::remove("/animations/none.json"));

  data.write("animations/a.json", "abc");
  TEST_ASSERT_TRUE(storage::exists("/animations/a.json"));
  TEST_ASSERT_TRUE(storage::file_size("/animations/a.json", size));
  TEST_ASSERT_EQUAL(3, size);
  TEST_ASSERT_TRUE(storage::remove("/animations/a.json"));
  TEST_ASSERT_FALSE(storage::exists("/animations/a.json"));
}

static void test_a_folder_is_missing_for_read_and_open_and_is_not_removed()
{
  sim::reset();
  TempData data("folder");
  fs::create_directories(data.root / "animations" / "x.json");
  storage::Buffer out;
  TEST_ASSERT_TRUE(storage::read("/animations/x.json", out, 100) == storage::ReadResult::Missing);
  storage::Reader file;
  TEST_ASSERT_TRUE(file.open("/animations/x.json") == storage::ReadResult::Missing);
  TEST_ASSERT_FALSE(storage::exists("/animations/x.json"));
  TEST_ASSERT_FALSE(storage::remove("/animations/x.json"));
  TEST_ASSERT_TRUE(fs::is_directory(data.root / "animations" / "x.json"));
}

static void test_reader_open_refuses_a_file_a_writer_holds_open()
{
  sim::reset();
  TempData data("reader-open");
  storage::Writer writer;
  TEST_ASSERT_TRUE(writer.open("/animations/held.json"));
  storage::Reader file;
  TEST_ASSERT_TRUE(file.open("/animations/held.json") == storage::ReadResult::Unreadable);
  writer.close();
  TEST_ASSERT_TRUE(file.open("/animations/held.json") == storage::ReadResult::Ok);
}

int main()
{
  UNITY_BEGIN();
  RUN_TEST(test_simulator_refuses_to_read_or_rename_a_file_a_writer_holds_open);
  RUN_TEST(test_list_is_sorted_and_skips_folders);
  RUN_TEST(test_reader_read_all_reports_what_storage_read_reports);
  RUN_TEST(test_exists_size_and_remove_of_a_missing_file);
  RUN_TEST(test_a_folder_is_missing_for_read_and_open_and_is_not_removed);
  RUN_TEST(test_reader_open_refuses_a_file_a_writer_holds_open);
  return UNITY_END();
}
