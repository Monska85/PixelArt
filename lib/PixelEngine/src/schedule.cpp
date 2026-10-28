// SPDX-License-Identifier: GPL-3.0-or-later

// Parsing and validation of pixelart-schedule/1 documents, the winner rules and the choice of the
// playlists the board plays (docs/format/schedule-v1.md,
// docs/format/playlist-v1.md#how-the-board-chooses-what-to-play). Structural rules mirror
// schema/schedule-1.schema.json.

#include <ArduinoJson.h>

#include <algorithm>

#include "pixelart_engine.h"
#include "strict_json.h"

namespace pixelart
{

namespace
{

constexpr uint8_t PART_YEAR = 1, PART_MONTH = 2, PART_DAY = 4;
constexpr uint8_t YEAR_MONTH_DAY = PART_YEAR | PART_MONTH | PART_DAY;
constexpr uint8_t MONTH_DAY = PART_MONTH | PART_DAY;
constexpr uint8_t YEAR_MONTH = PART_YEAR | PART_MONTH;
constexpr size_t MAX_NAME = 128;
// ArduinoJson's default nesting limit, as for playlists.
constexpr int MAX_JSON_DEPTH = 10;
// Days before each month in a common year.
constexpr uint16_t DAYS_BEFORE[12] = {0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334};

bool is_leap(int year) { return (year % 4 == 0 && year % 100 != 0) || year % 400 == 0; }

int days_in_month(int year, int month)
{
  static const uint8_t DAYS[12] = {31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
  return month == 2 && is_leap(year) ? 29 : DAYS[month - 1];
}

// Days since 1970-01-01 of a real date (Howard Hinnant's days_from_civil).
long days_from_civil(int year, int month, int day)
{
  year -= month <= 2;
  const long era = year / 400;
  const long yoe = year - era * 400;
  const long doy = (153L * (month + (month > 2 ? -3 : 9)) + 2) / 5 + day - 1;
  const long doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  return era * 146097 + doe - 719468;
}

// The day number of `n(month, day)` in docs/format/schedule-v1.md#lengths: February 29 is March 1's.
int common_day(int month, int day) { return DAYS_BEFORE[month - 1] + day; }

// Rank of a part set by rules 1 and 2 of the winner: lower wins.
int rank(uint8_t parts)
{
  switch (parts)
  {
  case YEAR_MONTH_DAY:
    return 0;
  case MONTH_DAY:
    return 1;
  case YEAR_MONTH:
    return 2;
  case PART_DAY:
    return 3;
  case PART_MONTH:
    return 4;
  default:
    return 5; // PART_YEAR
  }
}

int month_day(const ScheduleEnd &end) { return end.month * 100 + end.day; }

// Whether `value` is in [from, to], or, for a range that crosses the end of its cycle, in [from, end] or [start, to].
bool in_cycle(int value, int from, int to)
{
  return from <= to ? from <= value && value <= to : value >= from || value <= to;
}

const char *part_name(uint8_t part) { return part == PART_YEAR ? "year" : part == PART_MONTH ? "month" : "day"; }

} // namespace

bool is_schedule_date(const LocalDate &date)
{
  return date.year >= MIN_SCHEDULE_YEAR && date.year <= MAX_SCHEDULE_YEAR && date.month >= 1 && date.month <= 12 &&
         date.day >= 1 && date.day <= days_in_month(date.year, date.month);
}

const char *play_reason_name(PlayReason reason)
{
  switch (reason)
  {
  case PlayReason::User:
    return "user";
  case PlayReason::Schedule:
    return "schedule";
  case PlayReason::Fallback:
    return "fallback";
  case PlayReason::NoTime:
    return "no_time";
  case PlayReason::NoSchedule:
    break;
  }
  return "no_schedule";
}

std::vector<std::string> Schedule::names(const uint16_t *indexes, size_t count) const
{
  std::vector<std::string> out;
  out.reserve(count);
  for (size_t i = 0; i < count; i++)
    out.push_back(ids_[indexes[i]]);
  return out;
}

// The state of one load(): the schedule it fills and the errors it reports.
struct Schedule::Loader
{
  Schedule &schedule;
  std::vector<Diagnostic> &diagnostics;
  const size_t first_diagnostic;
  bool ok = true;

  // Keeps at most MAX_DIAGNOSTICS entries, like the animation and playlist loaders.
  void error(const char *code, const std::string &where, const std::string &message)
  {
    if (diagnostics.size() - first_diagnostic < MAX_DIAGNOSTICS)
      diagnostics.push_back({Severity::Error, code, where, message});
    ok = false;
  }

  void read(const char *json, size_t length);
  void check_name(JsonObjectConst object, const std::string &where);
  bool read_playlists(JsonVariantConst value, const std::string &where, uint16_t *indexes, uint8_t &count);
  bool read_end(JsonVariantConst value, const std::string &where, ScheduleEnd &end, uint8_t &parts, bool &valid);
  void read_entry(JsonVariantConst value, const std::string &where);
  void check_dates(const Entry &entry, const std::string &where);
};

void Schedule::Loader::check_name(JsonObjectConst object, const std::string &where)
{
  if (!object["name"].is<JsonVariantConst>())
    return;
  const char *name = object["name"].as<const char *>();
  if (!name || !*name || utf8_code_points(name) > MAX_NAME)
    error("structure", where, "must be a text of 1 to 128 characters");
}

// A list of 1 to 8 playlist IDs, no ID twice, into `indexes`. False when it is not one.
bool Schedule::Loader::read_playlists(JsonVariantConst value, const std::string &where, uint16_t *indexes,
                                      uint8_t &count)
{
  if (!value.is<JsonArrayConst>() || value.as<JsonArrayConst>().size() == 0)
  {
    error("structure", where, "must be a non-empty list of playlist IDs");
    return false;
  }
  JsonArrayConst list = value.as<JsonArrayConst>();
  if (list.size() > MAX_SCHEDULE_PLAYLISTS)
  {
    error("limit_exceeded", where, "more than " + std::to_string(MAX_SCHEDULE_PLAYLISTS) + " playlists");
    return false;
  }
  std::vector<std::string> &ids = schedule.ids_;
  count = 0;
  size_t i = 0;
  for (JsonVariantConst item : list)
  {
    const std::string at = where + "[" + std::to_string(i++) + "]";
    const char *id = item.as<const char *>();
    if (!item.is<const char *>() || !is_valid_id(id))
    {
      error("structure", at, "must be a playlist ID: lowercase letters, digits, _ and -");
      return false;
    }
    const size_t index = std::find(ids.begin(), ids.end(), id) - ids.begin();
    if (std::find(indexes, indexes + count, index) != indexes + count)
    {
      error("structure", at, std::string("names \"") + id + "\" twice");
      return false;
    }
    if (index == ids.size())
      ids.push_back(id);
    indexes[count++] = (uint16_t)index;
  }
  return true;
}

// An end with its parts. False when the end is refused; a part out of its values is reported and `valid` cleared.
bool Schedule::Loader::read_end(JsonVariantConst value, const std::string &where, ScheduleEnd &end, uint8_t &parts,
                                bool &valid)
{
  if (!value.is<JsonObjectConst>())
  {
    error("structure", where, "must be an object with year, month or day");
    return false;
  }
  JsonObjectConst object = value.as<JsonObjectConst>();
  bool structure_ok = true;
  for (JsonPairConst kv : object)
    if (!is_allowed_key(kv.key(), {"year", "month", "day"}))
    {
      error("structure", where + "." + kv.key().c_str(), std::string("unknown field \"") + kv.key().c_str() + "\"");
      structure_ok = false;
    }
  parts = 0;
  for (uint8_t part : {PART_YEAR, PART_MONTH, PART_DAY})
  {
    JsonVariantConst v = object[part_name(part)];
    if (!v.is<JsonVariantConst>())
      continue;
    parts |= part;
    const std::string at = where + "." + part_name(part);
    if (!v.is<long long>())
    {
      error("structure", at, "must be an integer of at most 64 bits");
      structure_ok = false;
      continue;
    }
    const long long low = part == PART_YEAR ? MIN_SCHEDULE_YEAR : 1;
    const long long high = part == PART_YEAR ? MAX_SCHEDULE_YEAR : part == PART_MONTH ? 12 : 31;
    const long long number = v.as<long long>();
    if (number < low || number > high)
    {
      error("invalid_date", at, "must be from " + std::to_string(low) + " to " + std::to_string(high));
      valid = false;
      continue;
    }
    if (part == PART_YEAR)
      end.year = (uint16_t)number;
    else if (part == PART_MONTH)
      end.month = (uint8_t)number;
    else
      end.day = (uint8_t)number;
  }
  if (!structure_ok)
    return false;
  if (parts == 0)
  {
    error("structure", where, "must have a year, a month or a day");
    return false;
  }
  if (parts == (PART_YEAR | PART_DAY))
  {
    error("structure", where, "a year and a day need a month");
    return false;
  }
  return true;
}

// The rules on the ends of an entry whose parts are each in their values: each end is a date, and with a year
// `from` is not after `to`.
void Schedule::Loader::check_dates(const Entry &entry, const std::string &where)
{
  bool valid = true;
  for (const ScheduleEnd *end : {&entry.from, &entry.to})
  {
    const char *side = end == &entry.from ? ".from" : ".to";
    // {month, day} needs a date of some year, so February 29 counts in a leap year.
    if ((entry.parts & MONTH_DAY) == MONTH_DAY &&
        end->day > days_in_month(entry.parts & PART_YEAR ? end->year : 2000, end->month))
    {
      error("invalid_date", where + side, "is not a date");
      valid = false;
    }
  }
  if (valid && (entry.parts & PART_YEAR))
  {
    const long from = entry.from.year * 10000L + entry.from.month * 100 + entry.from.day;
    const long to = entry.to.year * 10000L + entry.to.month * 100 + entry.to.day;
    if (from > to)
      error("invalid_date", where, "from is after to");
  }
}

void Schedule::Loader::read_entry(JsonVariantConst value, const std::string &where)
{
  if (!value.is<JsonObjectConst>())
  {
    error("structure", where, "must be an object with from, to and playlists");
    return;
  }
  JsonObjectConst object = value.as<JsonObjectConst>();
  for (JsonPairConst kv : object)
    if (!is_allowed_key(kv.key(), {"name", "from", "to", "playlists"}))
      error("structure", where + "." + kv.key().c_str(), std::string("unknown field \"") + kv.key().c_str() + "\"");
  check_name(object, where + ".name");
  Entry entry;
  read_playlists(object["playlists"], where + ".playlists", entry.playlists, entry.count);
  uint8_t from_parts = 0, to_parts = 0;
  bool valid = true;
  const bool from_ok = read_end(object["from"], where + ".from", entry.from, from_parts, valid);
  const bool to_ok = read_end(object["to"], where + ".to", entry.to, to_parts, valid);
  if (!from_ok || !to_ok)
    return;
  if (from_parts != to_parts)
  {
    error("structure", where, "from and to must have the same parts");
    return;
  }
  entry.parts = from_parts;
  if (!valid)
    return;
  check_dates(entry, where);
  schedule.entries_.push_back(entry);
}

void Schedule::Loader::read(const char *json, size_t length)
{
  JsonDocument doc;
  const char *code = nullptr;
  std::string message;
  if (!parse_document(json, length, MAX_SCHEDULE_FILE_SIZE, MAX_JSON_DEPTH, doc, code, message))
  {
    error(code, "", message);
    return;
  }
  JsonObjectConst root = doc.as<JsonObjectConst>();
  const char *format = root["format"].as<const char *>();
  if (!doc.is<JsonObjectConst>() || !format || std::string(format) != "pixelart-schedule/1")
  {
    error("format_unsupported", "format", std::string("unsupported format \"") + (format ? format : "") + "\"");
    return;
  }
  for (JsonPairConst kv : root)
    if (!is_allowed_key(kv.key(), {"format", "name", "fallback", "entries"}))
      error("structure", kv.key().c_str(), std::string("unknown field \"") + kv.key().c_str() + "\"");
  check_name(root, "name");
  read_playlists(root["fallback"], "fallback", schedule.fallback_, schedule.fallback_count_);

  if (!root["entries"].is<JsonVariantConst>())
    return;
  if (!root["entries"].is<JsonArrayConst>())
  {
    error("structure", "entries", "must be a list");
    return;
  }
  JsonArrayConst entries = root["entries"].as<JsonArrayConst>();
  if (entries.size() > MAX_SCHEDULE_ENTRIES)
    error("limit_exceeded", "entries", "more than " + std::to_string(MAX_SCHEDULE_ENTRIES) + " entries");
  else
  {
    schedule.entries_.reserve(entries.size());
    size_t i = 0;
    for (JsonVariantConst value : entries)
      read_entry(value, "entries[" + std::to_string(i++) + "]");
  }
}

bool Schedule::load(const char *json, size_t length, std::vector<Diagnostic> &diagnostics)
{
  *this = Schedule();
  Loader loader{*this, diagnostics, diagnostics.size()};
  loader.read(json, length);
  if (!loader.ok)
    *this = Schedule();
  return loader.ok;
}

int Schedule::winner(const LocalDate &date) const
{
  int best = -1, best_rank = 0;
  long best_length = 0;
  for (size_t i = 0; i < entries_.size(); i++)
  {
    const Entry &e = entries_[i];
    bool match = false;
    long length = 0;
    switch (e.parts)
    {
    case YEAR_MONTH_DAY:
    {
      const long day = days_from_civil(date.year, date.month, date.day);
      const long from = days_from_civil(e.from.year, e.from.month, e.from.day);
      const long to = days_from_civil(e.to.year, e.to.month, e.to.day);
      match = from <= day && day <= to;
      length = to - from + 1;
      break;
    }
    case MONTH_DAY:
    {
      const int from = month_day(e.from), to = month_day(e.to);
      match = in_cycle(date.month * 100 + date.day, from, to);
      const int n_from = common_day(e.from.month, e.from.day), n_to = common_day(e.to.month, e.to.day);
      length = from <= to ? n_to - n_from + 1 : 365 - n_from + n_to + 1;
      break;
    }
    case YEAR_MONTH:
    {
      const long month = 12L * date.year + date.month;
      const long from = 12L * e.from.year + e.from.month, to = 12L * e.to.year + e.to.month;
      match = from <= month && month <= to;
      length = to - from + 1;
      break;
    }
    case PART_DAY:
      match = in_cycle(date.day, e.from.day, e.to.day);
      length = e.from.day <= e.to.day ? e.to.day - e.from.day + 1 : 31 - e.from.day + e.to.day + 1;
      break;
    case PART_MONTH:
      match = in_cycle(date.month, e.from.month, e.to.month);
      length = e.from.month <= e.to.month ? e.to.month - e.from.month + 1 : 12 - e.from.month + e.to.month + 1;
      break;
    default: // PART_YEAR
      match = e.from.year <= date.year && date.year <= e.to.year;
      length = e.to.year - e.from.year + 1;
      break;
    }
    if (!match)
      continue;
    const int r = rank(e.parts);
    if (best < 0 || r < best_rank || (r == best_rank && length < best_length))
    {
      best = (int)i;
      best_rank = r;
      best_length = length;
    }
  }
  return best;
}

PlayChoice choose_playlists(PlayMode mode, const std::vector<std::string> &user, const Schedule *schedule,
                            const LocalDate *date, const std::function<bool(const std::string &)> &playable)
{
  PlayChoice choice;
  auto first_playable = [&](const std::vector<std::string> &list)
  {
    for (size_t i = 0; i < list.size(); i++)
      if (playable(list[i]))
        return (int)i;
    return -1;
  };
  auto use = [&](std::vector<std::string> list)
  {
    choice.playlists = std::move(list);
    choice.playing = first_playable(choice.playlists);
    return choice.playing >= 0;
  };

  if (mode == PlayMode::Playlists)
  {
    choice.reason = PlayReason::User;
    use(user); // My playlists never fall back to `default`: every playlist skipped plays every animation
    return choice;
  }
  if (!schedule)
  {
    choice.reason = PlayReason::NoSchedule;
    use({"default"});
    return choice;
  }
  if (!date)
    choice.reason = PlayReason::NoTime;
  else
  {
    choice.entry = schedule->winner(*date);
    choice.reason = choice.entry >= 0 ? PlayReason::Schedule : PlayReason::Fallback;
    if (choice.entry >= 0 && use(schedule->playlists(choice.entry)))
      return choice;
    choice.reason = PlayReason::Fallback; // every playlist of the winning entry is skipped: entry still names it
  }
  if (!use(schedule->fallback()))
    use({"default"});
  return choice;
}

} // namespace pixelart
