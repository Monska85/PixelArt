# Conformance suite

Test cases for the [`pixelart/1` animation format](../docs/format/pixelart-v1.md) and the [`pixelart-playlist/1` playlist format](../docs/format/playlist-v1.md). Every implementation of the formats must pass all of them. Today there are two: the engine in `lib/PixelEngine/`, used by the firmware and the simulator, and the web app engine in `web/src/engine`. `make test` runs the first locally (`pio test -e native_test`), `make web-test` runs the second, and CI runs both.

## Layout

- `valid/<case>.json`: an animation that must load, and `valid/<case>.expected.json`: what it must produce.
- `invalid/<case>.json`: an animation that must be rejected, and `invalid/<case>.expected.json`: the error code it must report.
- `playlist/valid/` and `playlist/invalid/`: the same for playlists.

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

## Strict JSON cases

Files are strict JSON in valid UTF-8 and text lengths count characters, as the [format specification](../docs/format/pixelart-v1.md#files) says. The `strict_json_*` cases in `invalid/` and `playlist/invalid/` each break one rule (comment, single quotes, unquoted key, a number outside the JSON grammar, a raw control character, data after the value, byte order mark, invalid, overlong or surrogate UTF-8, U+0000 in a text or a key, a fraction or exponent where an integer is required) and expect `structure`. The `name_128_characters` and `name_129_characters` cases use the two-byte character `é`, so the byte count of the name is twice its length.

## Null cases

A field that is present is checked even when its value is `null`, as the format specifications say. The `null_*` cases in `invalid/` and `playlist/invalid/` each set one optional field to `null` (top-level fields, sprite and part positions, the fields of a `show` entry, the fields of a frame, a frame inside a loop, the playlist fields) and expect `structure`. The `version_max` and `version_over_max` cases are the pair for the largest `version`, 2147483647.

## Brightness rows

`brightness.json` is not a case file: it holds the hand-computed rows of the effective brightness rule ([format specification](../docs/format/pixelart-v1.md#brightness)). Its shape is `{"description": "...", "rows": [{"board": 100, "percent": 50, "expected": 50}]}`: the board brightness (0 to 255), the animation's percentage (1 to 100) and the brightness the LEDs must receive. The C++ test `test_effective_brightness_rule` and the web app engine tests read the same rows.

## Rules for new cases

- Work out the expected frames by hand from the specification, never by running an implementation and copying its output. Otherwise a bug in that implementation becomes the expected result.
- Every change to the format or to an effect comes with new cases, and CI fails until every implementation passes them.
- Keep cases small: a few pixels per sprite make the expected result easy to check by reading it.
- Every limit has a pair of cases: the largest accepted value in `valid/` (when its frames are easy to write down) and one above it in `invalid/`.

## Protocol cases

`protocol/<case>.json` are test cases for the [command protocol](../docs/protocol/protocol-v1.md): requests, and the replies every implementation must give. The Unity test `test/test_protocol` runs them through the real line reader on the simulated serial port (`make test`). Every case starts from a fresh data folder and a fresh boot.

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
- `files` (optional): the files that exist before the board boots, by path from the root of the file system. The value is the text of the file, or `{"base64": "..."}` for bytes that are not text.
- `settings` (optional): the settings the board starts with, any of those of `settings_get`, the `token` included, which the board makes itself otherwise. The values are the ones the protocol allows. A case that logs in gives the token, and writes the `hmac` of each `auth` with an independent tool, from that token and the nonce it gave.
- `transport` (optional): `usb` (the default) or `wifi`. With `wifi`, each `send` goes to the board as a request that arrived over WiFi, one line without a newline, and the replies are the ones that transport gets: no token, and `usb_only` for the commands reserved for USB. The WiFi client is connected from the start of the case, not logged in.
- `nonces` (optional): the nonces the board hands out for `auth_challenge`, in order, each as 32 lowercase hexadecimal digits. The first `auth_challenge` of the case gets the first one, and so on. Without them the nonce is random and a case cannot compute the answer.
- `firmware_version` (optional): the version the simulated firmware runs, which `info.firmware` reports and a manifest's `version` is compared with. The default is the version of the simulator's build, which is never newer than a release.
- `firmware_skip` (optional): a version already on the board's skip list, as an earlier rollback leaves it.
- `update_source` (optional): the server the simulator fetches updates from. `files` maps a path below the manifest's folder (`manifest.json`, `animations/red.json`) to its content, written as for `files`; a content `{"json": value}` is the compact text of the value, in the order the case gives its keys. `fail` (optional) is a list of injected failures, `{"kind": "cut", "path": "animations/red.json"}`, with a kind of `down` (every request, no path), `tls`, `http`, `cut`, `corrupt` or `too_long`, as the [simulator](../docs/board/wifi-and-updates-v1.md#simulator-and-tests) takes them. `local_time` (optional) is the local time the install window sees, as `HH:MM`; `status` then reports `time.known` `true`. A firmware entry offers a firmware to the simulator only with the `board` `simulator`; its file is any bytes, checked against the entry's size and SHA-256. Without `update_source`, the simulator reaches no server. The board has its address from the start, so its first scheduled check is 5 minutes of virtual time away.
- `steps`: what happens, in order. Each step has exactly one of these keys:
  - `send`: one line of text sent to the serial port, followed by a newline. The optional key `eol` replaces the newline, for example with `"\r\n"`. The line is sent as written: protocol requests spell out the whole line, marker and CRC included. The optional key `via`, `usb` or `wifi`, sends this line over that transport instead of the case's `transport`, for a case that has both a USB client and a WiFi client.
  - `expect`: the next reply line from the board. Its CRC must be right, its JSON must follow the strict JSON rules of the protocol, and it must equal this object, with the same keys. The string `"<any>"` matches any value, for what a case cannot know: the firmware version, `boot_id`, memory, used storage, the token, and the text of messages. The string `"<at most N characters>"` matches any text of at most N characters (code points), for a text the specification limits but does not fix.
  - `expect_nothing`: the board has sent nothing that is still unread.
  - `advance_ms`: lets this many milliseconds of virtual time pass, with no traffic. The board's update task runs meanwhile, so a check that is due starts.
  - `run_update`: lets the board's update task run until it has nothing more to do: a check or an installation that was started ends, and `status` then reports its result.
  - `update_fail`: a list of failures in the form of `update_source.fail`, which the update server injects from this step on, in addition to those it injects already. A case uses it when a check succeeds and a later one fails.
  - `reboot`: restarts the board. The files stay, the settings go back to their defaults, and any upload is gone. The firmware slots stay too, with the skip list and the record of the last installation: a firmware that was installed boots on trial, and one that is restarted before its `first_frame` is rolled back to the previous firmware.
  - `reboot_unhealthy`: restarts the board as `reboot` does, and the health check of a firmware on trial fails, so it marks itself invalid and the board restarts into the previous firmware. Without a trial it is a plain `reboot`.
  - `first_frame`: the board shows its first frame, which confirms a firmware on trial.
  - `wifi_connect`: the WiFi client's connection ends and a new one opens, not logged in. The board forgets the login and the reply it remembered for the WiFi transport.
  - `expect_closed`: `true` when the board has asked to close the WiFi connection since the last `expect_closed` step (after 3 failed logins, a new token), `false` when it has not. After the board closed the connection, a case continues with `wifi_connect`: lines sent before it get no reply.
  - `expect_files`: a map from path to content. A string is the exact content the file must have, and `null` means the file must not exist. Other files are not checked.

A case fails when the board sends a reply no step expects. Lines that are not protocol lines (log lines) are not replies and are ignored.

### Writing protocol cases

The rules for format cases apply here too. In addition:

- The requests and the expected replies are written from the specification, never copied from what an implementation sent. A reply the specification does not fix (a message, a diagnostic place) uses `"<any>"`.
- A CRC-32 or SHA-256 in a case is computed with an independent tool, on the bytes the case spells out: `python3 -c 'import zlib,sys; print("%08x" % zlib.crc32(sys.argv[1].encode()))' '{"seq":1,"cmd":"info"}'` and `sha256sum` or `hashlib.sha256`. Base64 comes from `base64` or `python3 -m base64`.
- Keep one idea per case, and name the case after it: `framing_*`, `info_*`, `list_*`, `get_*`, `upload_*`, `delete_*` (`delete_all_*` for `delete_all`), `settings_*`, `status_*`, `token_*`, `cert_*`, `usb_*` (the USB transport next to a WiFi client), `wifi_*` (`wifi_login_*` for the network login), `update_*` (`update_failure_*` for a failed file or check, `update_manifest_*` for a manifest the board refuses).
- Every change to the protocol comes with new cases.
