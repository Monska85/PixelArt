# Schedule format `pixelart-schedule/1`

Status: **implemented** by the tools (`tools/pixelart.py`: the build, the validation and the tie check) and by the engine in `lib/PixelEngine/`, used by the firmware and the simulator, and by the web app (`web/src/engine/schedule.ts`).

A schedule tells the board which [playlists](playlist-v1.md) to play on which days of the year. The project publishes one with every content release, so the server can choose what a board plays in each season, while the user keeps the last word: a board set to My playlists ignores every schedule. Why it works this way is recorded in [ADR 0007](../adr/0007-server-chosen-playlists.md).

The JSON Schema in [`schema/schedule-1.schema.json`](../../schema/schedule-1.schema.json) is the source of truth for the structure and the limits. The rules it cannot express (real dates, the order of the two ends, ties) are the [validation](#validation) rules below.

## Files

- Like animations and playlists, a schedule is written in YAML or JSON, and the board stores and reads JSON only. The JSON follows the same rules as for [animations](pixelart-v1.md#files): strict JSON in valid UTF-8, no U+0000 in any text, integers without fraction or exponent, and text lengths counted in characters.
- In the repository, schedules live in `content/schedules/`, and a release publishes `content/schedules/<id>.yaml` as `schedules/<id>.json`. On the board, they live in `/schedules/`.
- Schedule file names follow the same rules as animation IDs.
- The board plays only the schedule with the ID `default` (`/schedules/default.json`). A schedule with another ID is stored, listed, validated, installed by updates and deleted like any other file, but never played.

## Example

```yaml
format: pixelart-schedule/1
name: Seasons
fallback: [default]
entries:
  - name: Halloween
    from: { month: 10, day: 1 }
    to: { month: 11, day: 2 }
    playlists: [halloween]
  - name: Christmas
    from: { month: 12, day: 1 }
    to: { month: 1, day: 6 }
    playlists: [christmas]
```

From October 1 to November 2 the board plays the playlist `halloween`, from December 1 to January 6 the playlist `christmas`, and on every other day, or while it does not know the date, the playlist `default`.

The simplest schedule has only a `fallback`, for example `fallback: [christmas, halloween]`: the board plays the two playlists in turn all year.

## Fields

| Field      | Required | Meaning                                                                                                                    |
| ---------- | -------- | -------------------------------------------------------------------------------------------------------------------------- |
| `format`   | yes      | Always `pixelart-schedule/1` for this version.                                                                             |
| `name`     | no       | Title shown to people, 1 to 128 characters.                                                                                |
| `fallback` | yes      | 1 to 8 playlist IDs, no ID twice. The board plays them when no entry matches the date, or while it does not know the date. |
| `entries`  | no       | 0 to 64 entries. Leaving the field out is the same as an empty list.                                                       |

Each entry:

| Field       | Required | Meaning                                                                            |
| ----------- | -------- | ---------------------------------------------------------------------------------- |
| `name`      | no       | Title shown to people, 1 to 128 characters.                                        |
| `from`      | yes      | The first day of the entry, an [end](#ends).                                       |
| `to`        | yes      | The last day of the entry, an [end](#ends) with the same parts as `from`.          |
| `playlists` | yes      | 1 to 8 playlist IDs, no ID twice. The board plays them on the days the entry wins. |

A playlist ID follows the rule of animation IDs. The same playlist may appear in several entries and in `fallback`.

A field that is present is always checked, and `null` is a value like any other: `name: null` or `entries: null` is an error, never the same as leaving the field out. A field that this specification does not define is an error, at every level.

## Ends

`from` and `to` are objects with up to three integer parts:

| Part    | Values       |
| ------- | ------------ |
| `year`  | 2000 to 2999 |
| `month` | 1 to 12      |
| `day`   | 1 to 31      |

The parts that are present form the part set of the end. These six part sets are accepted:

| Part set             | Matches                                            | Example                                                           |
| -------------------- | -------------------------------------------------- | ----------------------------------------------------------------- |
| `{year, month, day}` | The days from one date to another.                 | `from: { year: 2026, month: 12, day: 24 }` to the same date       |
| `{month, day}`       | The same days every year.                          | `from: { month: 12, day: 1 }`, `to: { month: 1, day: 6 }`         |
| `{year, month}`      | Whole months, from one month of a year to another. | `from: { year: 2026, month: 11 }`, `to: { year: 2027, month: 2 }` |
| `{day}`              | The same days of every month.                      | `from: { day: 28 }`, `to: { day: 3 }`                             |
| `{month}`            | Whole months, every year.                          | `from: { month: 12 }`, `to: { month: 12 }`                        |
| `{year}`             | Whole years.                                       | `from: { year: 2027 }`, `to: { year: 2028 }`                      |

Refused: an end with no part, an end with `year` and `day` but no `month`, two ends with different part sets, and any other field in an end.

Both ends are inclusive: an entry whose `from` and `to` are the same date matches that one day.

### Meaning

- **No year: every year.** An entry without `year` repeats every year. Its range may cross the end of its cycle: `{month: 12, day: 1}` to `{month: 1, day: 6}` runs from December 1 to January 6, `{month: 11}` to `{month: 2}` from November to February, and `{day: 28}` to `{day: 3}` from the 28th of each month to the 3rd of the next. A range crosses the end of its cycle when `from` comes after `to`, comparing month first and then day.
- **No day: whole months.** `{month: 12}` to `{month: 12}` is all of December, `{year: 2026, month: 11}` to `{year: 2027, month: 2}` is November 2026 to February 2027.
- **Year alone: whole years.**
- **Day alone: those days of every month.** A day a month lacks never matches in that month: `{day: 31}` to `{day: 31}` matches January 31, March 31 and the other months with 31 days, never April. `{day: 30}` to `{day: 2}` matches the 30th and the 31st where the month has them, then the 1st and the 2nd of the next month; in February it matches only the 1st and the 2nd.
- **`{month, day}` must be a valid date in some year.** February 29 is accepted, and matches only in leap years: `{month: 2, day: 29}` to `{month: 2, day: 29}` matches February 29, 2028 and no day of 2027. April 31 and February 30 are refused.
- **`{year, month, day}` must be a real date.** February 29, 2028 is accepted, February 29, 2027 is refused.
- **With a year, `from` must not be after `to`.** Ends with a year never cross a cycle, so `{year: 2027}` to `{year: 2026}` is refused, as is `{year: 2027, month: 3}` to `{year: 2027, month: 2}`.

A year is a leap year in the Gregorian calendar: divisible by 4, except the years divisible by 100 that are not divisible by 400. 2000 is a leap year, 2100 is not.

## Which entry wins

For a local date, every entry that matches it is a candidate, and exactly one wins. When no entry matches, the board plays `fallback`.

1. **More parts wins:** three parts beat two, two beat one.
2. **Same count: the most important part decides.** With two parts, `{month, day}` beats `{year, month}`. With one part, `{day}` beats `{month}`, which beats `{year}`. Together with the first rule, the six part sets rank in this order, the first winning: `{year, month, day}`, `{month, day}`, `{year, month}`, `{day}`, `{month}`, `{year}`.
3. **Same part set: the shorter range wins,** measured in the smallest unit of the part set, both ends included, as the next section defines.
4. **Still equal: a tie.** The build tools refuse a schedule in which two entries can tie for some date (`schedule_tie`, see [Ties](#ties)). A board that gets such a file anyway, uploaded by hand, takes the first of the tied entries in the order of the file.

### Lengths

| Part set             | Unit   | Length of a range from `from` to `to`                                                                          |
| -------------------- | ------ | -------------------------------------------------------------------------------------------------------------- |
| `{year, month, day}` | days   | The number of days from `from` to `to`, both included.                                                         |
| `{month, day}`       | days   | `n(to) - n(from) + 1`, or `365 - n(from) + n(to) + 1` for a range that crosses the end of the year.            |
| `{year, month}`      | months | `(12 × to.year + to.month) - (12 × from.year + from.month) + 1`.                                               |
| `{day}`              | days   | `to.day - from.day + 1`, or `31 - from.day + to.day + 1` for a range that crosses the end of the month.        |
| `{month}`            | months | `to.month - from.month + 1`, or `12 - from.month + to.month + 1` for a range that crosses the end of the year. |
| `{year}`             | years  | `to.year - from.year + 1`.                                                                                     |

`n(month, day)` is the day number in a common year: the days of the months before `month` in a common year (31 for February, 59 for March, 334 for December), plus `day`. February 29 is therefore day 60, the same number as March 1, so `{month: 2, day: 28}` to `{month: 2, day: 29}` is 2 days long and `{month: 2, day: 29}` to `{month: 3, day: 1}` is 1 day long. A range crosses the end of the year by the comparison of [Meaning](#meaning) (month first, then day), not by its day numbers.

### Worked examples

With these entries:

| Index | `from`                 | `to`                   | Part set       | Length  |
| ----- | ---------------------- | ---------------------- | -------------- | ------- |
| 0     | `{month: 12}`          | `{month: 12}`          | `{month}`      | 1 month |
| 1     | `{month: 12, day: 1}`  | `{month: 1, day: 6}`   | `{month, day}` | 37 days |
| 2     | `{month: 12, day: 25}` | `{month: 12, day: 25}` | `{month, day}` | 1 day   |
| 3     | `{year: 2026}`         | `{year: 2026}`         | `{year}`       | 1 year  |

- **December 25, 2026:** entries 0, 1, 2 and 3 match. Entries 1 and 2 have two parts and beat entries 0 and 3 (rule 1). They have the same part set, and entry 2 is 1 day long against 37 (rule 3): entry 2 wins.
- **December 24, 2026:** entries 0, 1 and 3 match. Entry 1 has two parts (rule 1): it wins.
- **January 3, 2027:** only entry 1 matches (it crosses the end of the year, and entry 3 covers 2026 only): it wins. Its length is `365 - n(12, 1) + n(1, 6) + 1` = `365 - 335 + 6 + 1` = 37.
- **November 30, 2026:** only entry 3 matches: it wins.
- **November 30, 2027:** no entry matches: the board plays `fallback`.

With `{month: 10}` to `{month: 10}` and `{day: 1}` to `{day: 7}`, October 3 matches both, and `{day}` beats `{month}` (rule 2): the first week of every month wins over October.

With `{year: 2026, month: 12}` to `{year: 2026, month: 12}` and `{month: 12, day: 1}` to `{month: 12, day: 31}`, December 10, 2026 matches both, and `{month, day}` beats `{year, month}` (rule 2), although the dated entry names a year.

With `{month: 12, day: 1}` to `{month: 12, day: 31}` listed twice, December 10 matches both with the same part set and the same length, 31 days: the tools refuse the file, and a board takes the first one.

## Ties

A date ends in a tie when rule 4 decides its winner: two or more entries match it and are still equal after the first three rules, and no other entry that matches beats them. Two equal entries that a better entry always beats are not a tie; the `ties` schedule of [`conformance/schedule/winner.json`](../../conformance/schedule/winner.json) shows both. The build tools check that no date ends in a tie and refuse the schedule with the error `schedule_tie` when one does. They check only the dates where a tie can differ:

- every day of every year from the smallest `year` to the largest `year` of the entries that have a year;
- every day of one leap year and of one common year, for the entries without a year: which of them match a date, and their lengths, depend only on the month lengths, so these two years show every case.

Entries without a year are checked on the dated years too, with the entries that have one. The worst case is one entry from 2000 to 2999, about 366,000 days, which takes a few seconds in CI. Only the tools run this check. The board never loops over years: it resolves one date, over at most 64 entries, as [How the board chooses what to play](playlist-v1.md#how-the-board-chooses-what-to-play) describes, and takes the first tied entry in the file.

## How the board uses it

The board plays the schedule `default` when its `play` [setting](../protocol/protocol-v1.md#settings_get-settings_set) is `auto` (Automatic):

- **The date is known:** the playlists of the winning entry, or `fallback` when no entry matches.
- **The date is not known:** `fallback`.
- **No valid `/schedules/default.json`:** the playlist `default`, exactly as a board did before schedules existed.

The board plays every playlist of the list in full, in order, then starts from the first again. A playlist it cannot play is skipped, and when it can play none, it falls back further. The local date comes from the board's clock and its `timezone` setting, as [Time](../board/wifi-and-updates-v1.md#time) describes. The whole rule, with the events that make the board choose again, is in [How the board chooses what to play](playlist-v1.md#how-the-board-chooses-what-to-play).

A board set to My playlists (`play` is `playlists`) plays the user's playlists and ignores every schedule.

## Limits

| Limit                           | Value          |
| ------------------------------- | -------------- |
| File size                       | 16 KiB         |
| Entries                         | 64             |
| Playlists in an entry           | 8              |
| Playlists in `fallback`         | 8              |
| `name`, of the file or an entry | 128 characters |
| `year`                          | 2000 to 2999   |

## Validation

Like for animations and playlists, an implementation keeps at most 32 messages per file. These errors reject the schedule (the board then plays as with no schedule):

| Code                 | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format_unsupported` | The file is not an object, or its `format` is missing or not `pixelart-schedule/1`.                                                                                                                                                                                                                                                                                                                                                                                                       |
| `structure`          | The file is not strict JSON; a field is unknown, missing, `null` or of the wrong type; a `name` is empty or longer than 128 characters; `fallback` or the `playlists` of an entry is empty, names an ID that breaks the ID rule, or names an ID twice; an end has no part, `year` and `day` without `month`, or other parts than the other end; a part is not an integer within the signed 64-bit range (-2^63 to 2^63 - 1), so a part beyond it is `structure` and never `invalid_date`. |
| `limit_exceeded`     | The file is larger than 16 KiB, or has more than 64 entries, or more than 8 playlists in `fallback` or in an entry.                                                                                                                                                                                                                                                                                                                                                                       |
| `invalid_date`       | A part is an integer within the signed 64-bit range and outside its values (a `year` outside 2000 to 2999, a `month` outside 1 to 12, a `day` outside 1 to 31); a `{month, day}` end is not a date of any year (April 31, February 30); a `{year, month, day}` end is not a real date (February 29, 2027); or, with a year, `from` is after `to`.                                                                                                                                         |

Warnings, reported by the board when the schedule is uploaded or installed, and by the tools when they know the full set of playlists, for example in CI:

- `unknown_playlist`: `fallback` or an entry names a playlist that is not stored, or that the release does not have. The schedule is still stored, since the playlist can come afterwards. On a board, the playlist is skipped while it is missing.

The tools also report this error, which the board never checks:

- `schedule_tie`: a date ends in a tie, see [Ties](#ties). The tools refuse to build or release the schedule.
