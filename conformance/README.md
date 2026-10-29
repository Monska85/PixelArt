# Conformance suite

`wifi-credentials.json` holds hand-computed bytes for the version 1 WiFi credential record in NVS, plus invalid records. The native WiFi test checks its encoding and decoding. The old separate NVS keys remain available for older firmware after rollback, as the [board specification](../docs/board/wifi-and-updates-v1.md#setup-with-improv) describes.

Test cases for the [`pixelart/1` animation format](../docs/format/pixelart-v1.md), the [`pixelart-playlist/1` playlist format](../docs/format/playlist-v1.md) and the [`pixelart-schedule/1` schedule format](../docs/format/schedule-v1.md) and the [`pixelart-play/1` play file format](../docs/format/play-v1.md), with the rules that choose what the board plays. Every implementation of the formats must pass all of them. Today there are two: the engine in `lib/PixelEngine/`, used by the firmware and the simulator, and the web app engine in `web/src/engine`. `make test` runs the first locally (`pio test -e native_test`), `make web-test` runs the second, and CI runs both.

## Layout

- `valid/<case>.json`: an animation that must load, and `valid/<case>.expected.json`: what it must produce.
- `invalid/<case>.json`: an animation that must be rejected, and `invalid/<case>.expected.json`: the error code it must report.
- `playlist/valid/` and `playlist/invalid/`: the same for playlists.
- `schedule/valid/` and `schedule/invalid/`: the same for schedules.
- `play/valid/` and `play/invalid/`: the same for play files.
- `schedule/winner.json` and `schedule/resolver.json`: rows of the rules that choose what the board plays, see [Schedule rows](#schedule-rows).

## Expected results

For a valid case:

```json
{
  "warnings": ["pivot_rounded"],
  "frames": [
    {
      "ms": 500,
      "background": "#000033",
      "pixels": {
        "#ff0000": [
          [3, 2],
          [4, 2]
        ]
      }
    }
  ]
}
```

- `warnings`: the exact set of warning codes the implementation must report.
- `brightness` (optional): the animation's `brightness` percentage, 1 to 100. It is 100 when the key is absent. The frames never change with it: the factor is applied when the LEDs are driven, as the [format specification](../docs/format/pixelart-v1.md#brightness) describes.
- `frames`: every frame of the timeline, in order, and nothing more. `ms` is the frame duration, `pixels` lists the lit pixels by color as `[x, y]`, and every other pixel has the `background` color (off when `background` is missing).

For an invalid case:

```json
{ "error": "unknown_color" }
```

The implementation must reject the file and report at least this error code. It may report other errors too. An optional `"max_diagnostics": 32` means the implementation must keep at most that many messages for the file. The `cap_keeps_error_over_warnings` case fills the 32 messages with warnings before an error is found, and expects the error to replace the latest warning.

For a valid playlist, the expected file lists the enabled items in order:

```json
{ "items": [{ "animation": "santa", "repeat": 2 }] }
```

For a valid schedule, the expected file lists `fallback` and the entries in the order of the file, each with its `from`, `to` and `playlists` as written (without `name`), and `entries` is empty when the file has none:

```json
{
  "fallback": ["default"],
  "entries": [
    {
      "from": { "month": 12, "day": 1 },
      "to": { "month": 1, "day": 6 },
      "playlists": ["christmas"]
    }
  ]
}
```

A valid schedule case is also valid for the build tools: none of them has a tie. An invalid schedule case expects one of the codes of the [schedule validation](../docs/format/schedule-v1.md#validation): `format_unsupported`, `structure`, `limit_exceeded` or `invalid_date`. A part beyond the signed 64-bit range is not an integer for the format: `year_2_pow_63`, `month_2_pow_64` and `day_below_int64` expect `structure`, and `year_int64_max`, the largest signed 64-bit integer, expects `invalid_date`.

For a valid play file, the expected file holds its `default` as written:

```json
{ "default": { "playlists": ["halloween", "christmas"] } }
```

An invalid play file case expects one of the codes of the [play file validation](../docs/format/play-v1.md#validation): `format_unsupported`, `structure` or `limit_exceeded`. The warnings `unknown_schedule` and `unknown_playlist` never reject a file, so no case in `play/invalid/` expects them: `unknown_schedule_and_playlists_are_not_errors` in `play/valid/` names files nothing stores, and the protocol cases `upload_play_unknown_schedule` and `upload_play_unknown_playlist` check the warnings. The `file_1024_bytes` and `file_too_large` cases are the pair for the 1 KiB limit: they are valid JSON followed by white space, which the format allows.

## Strict JSON cases

Files are strict JSON in valid UTF-8 and text lengths count characters, as the [format specification](../docs/format/pixelart-v1.md#files) says. The `strict_json_*` cases in `invalid/`, `playlist/invalid/`, `schedule/invalid/` and `play/invalid/` each break one rule (comment, single quotes, unquoted key, a number outside the JSON grammar, a raw control character, data after the value, byte order mark, invalid, overlong or surrogate UTF-8, U+0000 in a text or a key, a fraction or exponent where an integer is required) and expect `structure`. The `name_128_characters` and `name_129_characters` cases use the two-byte character `é`, so the byte count of the name is twice its length.

## Null cases

A field that is present is checked even when its value is `null`, as the format specifications say. The `null_*` cases in `invalid/`, `playlist/invalid/`, `schedule/invalid/` and `play/invalid/` each set one field that is present to `null`, optional or required (top-level fields, sprite and part positions, the fields of a `show` entry, the fields of a frame, a frame inside a loop, the playlist fields, the schedule fields, a part of an end, the fields of a play file's `default` and an ID of a list), and expect `structure`. The exception is `null_background`, which expects `unknown_color`, because the format reports a background that is not a color with that diagnostic. The `version_max` and `version_over_max` cases are the pair for the largest `version`, 2147483647.

## Brightness rows

`brightness.json` is not a case file: it holds the hand-computed rows of the effective brightness rule ([format specification](../docs/format/pixelart-v1.md#brightness)). Its shape is `{"description": "...", "rows": [{"board": 100, "percent": 50, "expected": 50}]}`: the board brightness (0 to 255), the animation's percentage (1 to 100) and the brightness the LEDs must receive. The C++ test `test_effective_brightness_rule` and the web app engine tests read the same rows.

## Schedule rows

`schedule/winner.json` and `schedule/resolver.json` are not case files: they hold hand-computed rows, which the C++ tests of the engine and the web app's tests read alike. Both start with `schedules`, an object of valid `pixelart-schedule/1` documents by key, which a test loads with the real schedule loader, and `rows`, which name a schedule by its key. A date is `YYYY-MM-DD`, a real date with a year from 2000 to 2999.

`winner.json` holds the rows of the [winner rules](../docs/format/schedule-v1.md#which-entry-wins):

```json
{
  "tie_schedules": ["ties"],
  "schedules": {
    "rules": {
      "format": "pixelart-schedule/1",
      "fallback": ["default"],
      "entries": []
    }
  },
  "rows": [{ "schedule": "rules", "date": "2026-12-25", "entry": null }]
}
```

`entry` is the 0-based index of the winning entry, or `null` when no entry matches. `tie_schedules` lists the schedules in which a date ends in a tie: the build tools refuse them with `schedule_tie`, and accept every other schedule of the file, while the rows give the first tied entry, as a board takes it.

`resolver.json` holds the rows of [How the board chooses what to play](../docs/format/playlist-v1.md#how-the-board-chooses-what-to-play):

```json
{
  "schedules": {
    "seasons": { "format": "pixelart-schedule/1", "fallback": ["default"] }
  },
  "rows": [
    {
      "name": "what the row shows",
      "play": "auto",
      "playlists": ["default"],
      "schedule": "default",
      "stored": { "seasons": "seasons" },
      "server_choice": { "schedule": "seasons" },
      "date": null,
      "playable": ["default"],
      "expected": {
        "source": "server",
        "schedule": "seasons",
        "reason": "no_time",
        "entry": null,
        "playlists": ["default"],
        "playing": "default"
      }
    }
  ]
}
```

- `play`, `playlists` and `schedule`: the settings of the same names.
- `stored`: the valid schedules stored on the board, an object from the schedule ID to a key of `schedules`. A schedule that is not in it is not stored, or not valid: the board cannot play it.
- `server_choice`: the server choice, which is the `default` of the valid play file `/play/default.json`: `null` for none, `{"schedule": "<id>"}` or `{"playlists": ["<id>", ...]}`. The rows give it directly, as the result of reading that file; the protocol cases `status_play_*` check the reading.
- `date`: the local date, or `null` when the time is not known.
- `playable`: the IDs of the stored playlists the board can play; every other ID is skipped.
- `expected`: what `status.play` reports besides `mode` and `server_choice`: `source` (`server`, `playlists`, `schedule` or `fallback`), `schedule` (the ID of the schedule the list comes from, or `null`), `reason`, `entry`, `playlists` (the list the board plays, after the fallback chain) and `playing` (the first playable playlist of that list, or `null` when the board plays every animation).

## Rules for new cases

- Work out the expected frames by hand from the specification, never by running an implementation and copying its output. Otherwise a bug in that implementation becomes the expected result.
- Every change to the format or to an effect comes with new cases, and CI fails until every implementation passes them.
- Keep cases small: a few pixels per sprite make the expected result easy to check by reading it.
- Every limit has a pair of cases: the largest accepted value in `valid/` (when its frames are easy to write down) and one above it in `invalid/`.

## Protocol cases

The `update_manifest_page_*` cases cover the optional published-content page format: a valid authoritative page, a missing page that fails without falling back to the legacy list, and a declared empty catalog that leaves stored files alone. Their page byte count and SHA-256 are computed independently from the literal page text in each case. The expected update status and stored files follow the [manifest specification](../docs/format/manifest-v1.md#paged-content-catalogs) and the existing update rules.

Files matching `protocol/<case>.json` are test cases for the [command protocol](../docs/protocol/protocol-v1.md). They specify requests and the replies every implementation must give. The Unity test `test/test_protocol` runs them through the real line reader on the simulated serial port (`make test`). Every case starts from a fresh data folder and a fresh boot.

A case is one JSON object:

```json
{
  "description": "what the case shows",
  "capacity": 12288,
  "files": {
    "animations/dot.json": "{...}",
    "animations/blob.json": { "base64": "..." }
  },
  "settings": { "brightness": 7, "playlist": "christmas" },
  "steps": [
    { "send": "@PR 3c250228 {\"seq\":1,\"cmd\":\"info\"}" },
    { "expect": { "seq": 1, "ok": true, "firmware": "<any>" } }
  ]
}
```

- `capacity` (optional): size of the simulated file system in bytes. The default is 983,040, the size of the board's data partition. Space is used in blocks of 4,096 bytes per file.
- `files` (optional): the files that exist before the board boots, by path from the root of the file system (`animations/`, `playlists/`, `schedules/` and `play/`; the board's server choice is `play/default.json`). The value is the text of the file, or `{"base64": "..."}` for bytes that are not text.
- `settings` (optional): the settings the board starts with, any of those of `settings_get`, the `token` included, which the board makes itself otherwise. The values are the ones the protocol allows. A case that gives neither `play` nor `playlists` starts a board that has never stored them, which derives them from `playlist` as the [protocol](../docs/protocol/protocol-v1.md#older-clients) says; a case that gives one of them gives both, with a `playlist` that agrees with them. A case that gives `schedule` starts a board that has stored it; without it the board reads `default`. A case that logs in gives the token, and writes the `hmac` of each `auth` with an independent tool, from that token and the nonce it gave.
- `transport` (optional): `usb` (the default) or `wifi`. With `wifi`, each `send` goes to the board as a request that arrived over WiFi, one line without a newline, and the replies are the ones that transport gets: no token, and `usb_only` for the commands reserved for USB. The WiFi client is connected from the start of the case, not logged in.
- `nonces` (optional): the nonces the board hands out for `auth_challenge`, in order, each as 32 lowercase hexadecimal digits. The first `auth_challenge` of the case gets the first one, and so on. Without them the nonce is random and a case cannot compute the answer.
- `firmware_version` (optional): the version the simulated firmware runs, which `info.firmware` reports and a manifest's `version` is compared with. The default is the version of the simulator's build, which is never newer than a release.
- `firmware_skip` (optional): a version already on the board's skip list, as an earlier rollback leaves it.
- `update_source` (optional): the server the simulator fetches updates from. `files` maps a path below the manifest's folder (`manifest.json`, `animations/red.json`) to its content, written as for `files`; a content `{"json": value}` is the compact text of the value, in the order the case gives its keys. `fail` (optional) is a list of injected failures, `{"kind": "cut", "path": "animations/red.json"}`, with a kind of `down` (every request, no path), `tls`, `http`, `cut`, `corrupt` or `too_long`, as the [simulator](../docs/board/wifi-and-updates-v1.md#simulator-and-tests) takes them. `local_time` (optional) is the local time the install window sees, as `HH:MM`, and `local_date` (optional) the local date the schedule sees, as `YYYY-MM-DD`; with either, `status` reports `time.known` `true`. With `local_time` alone the local date is 2000-01-01, and with `local_date` alone the local time is 12:00, as for the simulator's `--update-time` and `--date` ([simulator](../docs/board/wifi-and-updates-v1.md#simulator-and-tests)). An `update_source` with only `local_time` or `local_date` and no `files` serves nothing, which a case notices only if it lets a check run. A firmware entry offers a firmware to the simulator only with the `board` `simulator`; its file is any bytes, checked against the entry's size and SHA-256. Without `update_source`, the simulator reaches no server. The board has its address from the start, so its first scheduled check is 5 minutes of virtual time away.
- `steps`: what happens, in order. Each step has exactly one of these keys:
  - `send`: one protocol line. Over USB it is sent to the serial port followed by a newline; optional `eol` replaces that newline, for example with `"\r\n"`. Over WiFi it is sent as one WebSocket text message without a newline, and `eol` has no effect. The line is sent as written: protocol requests spell out the marker and CRC. Optional `via` (`usb` or `wifi`) chooses a transport other than the case's `transport`, for a case with both clients.
  - `expect`: the next reply line from the board. Its CRC must be right, its JSON must follow the strict JSON rules of the protocol, and it must equal this object, with the same keys. The string `"<any>"` matches any value, for what a case cannot know: the firmware version, `boot_id`, memory, used storage, the token, and the text of messages. The string `"<at most N characters>"` matches any text of at most N characters (code points), for a text the specification limits but does not fix.
  - `expect_nothing`: the board has sent nothing that is still unread.
  - `advance_ms`: lets this many milliseconds of virtual time pass, with no traffic. The board's update task runs meanwhile, so a check that is due starts.
  - `run_update`: lets the board's update task run until it has nothing more to do: a check or an installation that was started ends, and `status` then reports its result.
  - `update_fail`: a list of failures in the form of `update_source.fail`, which the update server injects from this step on, in addition to those it injects already. A case uses it when a check succeeds and a later one fails.
  - `record_unreadable`: `true` makes the record of the firmware installations unreadable from now on, as a failing flash can at boot; `false` makes it readable again. A case uses it before a `reboot`, so the board starts with a record it cannot read.
  - `rollback_mark_stuck`: `true` makes the board unable to forget the invalid mark of a slot it rolled back from, from now on; `false` lets it. A case uses it before the `reboot` that rolls back.
  - `network_busy`: `true` makes the board unable to hand a request to the network task from now on, so `wifi_forget` and `delete_all` with `settings: true` answer `busy`; `false` lets it. A case sets it back to `false` before it repeats the request.
  - `reboot`: restarts the board. The files stay, the settings go back to their defaults, and any upload is gone. The firmware slots stay too, with the skip list and the record of the last installation: a firmware that was installed boots on trial, and one that is restarted before its `first_frame` is rolled back to the previous firmware.
  - `reboot_unhealthy`: restarts the board as `reboot` does, and the health check of a firmware on trial fails, so it marks itself invalid and the board restarts into the previous firmware. Without a trial it is a plain `reboot`.
  - `first_frame`: the board shows a frame. A firmware on trial confirms itself when its record is stored and its mark works. A boot that is not on trial, such as one after a rollback, instead retries what it left unsettled: reading the record of the installations, storing a result, and clearing the invalid mark of the slot it rolled back from. When none of that is pending, the step changes nothing.
  - `wifi_connect`: the WiFi client's connection ends and a new one opens, not logged in. The board forgets the login and the reply it remembered for the WiFi transport.
  - `expect_closed`: `true` when the board has asked to close the WiFi connection since the last `expect_closed` step (after 3 failed logins, a new token), `false` when it has not. After the board closed the connection, a case continues with `wifi_connect`: lines sent before it get no reply.
  - `expect_files`: a map from path to content. A string is the exact content the file must have, and `null` means the file must not exist. Other files are not checked.

A case fails when the board sends a reply no step expects. Lines that are not protocol lines (log lines) are not replies and are ignored.

### Writing protocol cases

The rules for format cases apply here too. In addition:

- The requests and the expected replies are written from the specification, never copied from what an implementation sent. A reply the specification does not fix (a message, a diagnostic place) uses `"<any>"`.
- A CRC-32 or SHA-256 in a case is computed with an independent tool, on the bytes the case spells out: `python3 -c 'import zlib,sys; print("%08x" % zlib.crc32(sys.argv[1].encode()))' '{"seq":1,"cmd":"info"}'` and `sha256sum` or `hashlib.sha256`. Base64 comes from `base64` or `python3 -m base64`.
- Keep one idea per case, and name the case after it: `framing_*`, `info_*`, `list_*`, `get_*`, `upload_*`, `delete_*` (`delete_all_*` for `delete_all`), `settings_*`, `status_*`, `token_*`, `cert_*`, `usb_*` (the USB transport next to a WiFi client), `wifi_*` (`wifi_login_*` for the network login), `update_*` (`update_failure_*` for a failed file or check, `update_manifest_*` for a manifest the board refuses, `update_play_*` for the play file).
- Every change to the protocol comes with new cases.
