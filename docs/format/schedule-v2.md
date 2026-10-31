# Schedule format `pixelart-schedule/2`

Status: implemented by the content tools, firmware, simulator and web app. The [JSON Schema](../../schema/schedule-2.schema.json) defines its structure and limits. The date ranges, winner ranking and tie rule remain those of [schedule format 1](schedule-v1.md).

A format 2 schedule is authored once in `content/schedules/<id>.yaml` or JSON. The content build writes `schedules-v2/<id>.json` and derives `schedules/<id>.json` by removing each `hours` property and changing only `format` to `pixelart-schedule/1`. The format 1 copy gives older firmware the entry's base `playlists` all day. A format 2 schedule without `hours` is valid and still uses both output paths. The board stores format 2 files in `/schedules-v2/`; it prefers a valid file there for an ID and uses a valid `/schedules/` file if the format 2 file is absent or invalid. A valid but untimed format 2 file takes precedence over the format 1 copy. Removing a catalog entry does not delete a stored file; replace a timed file with an untimed format 2 file or explicitly delete it to stop its timing.

```yaml
format: pixelart-schedule/2
fallback: [default]
entries:
  - from: { month: 3, day: 1 }
    to: { month: 5, day: 31 }
    playlists: [spring_rest]
    hours:
      - { from: "08:00", to: "12:00", playlists: [spring_morning] }
      - { from: "14:00", to: "15:00", playlists: [spring_afternoon] }
```

From 08:00 through 11:59 the first window plays; from 14:00 through 14:59 the second plays. The entry's `spring_rest` plays for its other minutes. Outside the date range, `default` plays. Each date entry may have an optional `hours` list, including an empty list. A window has exactly `from`, `to` and `playlists`; each playlist list follows the format 1 rule of 1 to 8 distinct IDs. A window affects only its containing date entry. Date entry ranking is independent of time: first choose the winning date entry, then choose one of its windows or its base list.

Window bounds are fixed local `HH:MM` values, with exactly two digits for each part. `from` is 00:00 through 23:59; `to` may additionally be `24:00`. The start is included and the end excluded. `from` must be before `to`; overnight and overlapping windows in one entry are invalid. Adjacent windows are allowed, regardless of list order. There are at most 8 windows per entry and 64 per file, 64 date entries and 16 KiB of UTF-8 JSON. Invalid syntax reports `structure`, a zero-length, reversed or overlapping interval reports `invalid_time`, and excess count or bytes reports `limit_exceeded`. The other errors and warnings follow format 1. An unknown playlist is a warning, including in a window.

The board reads its configured local time zone and minute. It reselects at minute boundaries so a window starts or ends without a restart. After time has synchronized once, it keeps using its local clock when the network drops. Before the date or minute is known, a timed schedule uses `fallback`; an untimed format 2 schedule needs only the date, like format 1. If every playlist in the selected window is unavailable, the ordinary schedule fallback chain applies. The user may still choose fixed playlists, bypassing all schedules. Neither an animation nor a playlist has its own time rule.
