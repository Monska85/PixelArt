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

- `capacity` (optional): size of the simulated file system in bytes. The default is 1,441,792, the size of the board's data partition. Space is used in blocks of 4,096 bytes per file.
- `files` (optional): the files that exist before the board boots, by path from the root of the file system. The value is the text of the file, or `{"base64": "..."}` for bytes that are not text.
- `settings` (optional): the settings the board starts with, `brightness` and `playlist`.
- `steps`: what happens, in order. Each step has exactly one of these keys:
  - `send`: one line of text sent to the serial port, followed by a newline. The optional key `eol` replaces the newline, for example with `"\r\n"`. The line is sent as written: protocol requests spell out the whole line, marker and CRC included.
  - `expect`: the next reply line from the board. Its CRC must be right, and its JSON must equal this object, with the same keys. The string `"<any>"` matches any value, for what a case cannot know: the firmware version, `boot_id`, memory, used storage, and the text of messages.
  - `expect_nothing`: the board has sent nothing that is still unread.
  - `advance_ms`: lets this many milliseconds of virtual time pass, with no traffic.
  - `reboot`: restarts the board. The files stay, the settings go back to their defaults, and any upload is gone.
  - `expect_files`: a map from path to content. A string is the exact content the file must have, and `null` means the file must not exist. Other files are not checked.

A case fails when the board sends a reply no step expects. Lines that are not protocol lines (log lines) are not replies and are ignored.

### Writing protocol cases

The rules for format cases apply here too. In addition:

- The requests and the expected replies are written from the specification, never copied from what an implementation sent. A reply the specification does not fix (a message, a diagnostic place) uses `"<any>"`.
- A CRC-32 or SHA-256 in a case is computed with an independent tool, on the bytes the case spells out: `python3 -c 'import zlib,sys; print("%08x" % zlib.crc32(sys.argv[1].encode()))' '{"seq":1,"cmd":"info"}'` and `sha256sum` or `hashlib.sha256`. Base64 comes from `base64` or `python3 -m base64`.
- Keep one idea per case, and name the case after it: `framing_*`, `info_*`, `list_*`, `get_*`, `upload_*`, `delete_*` (`delete_all_*` for `delete_all`), `settings_*`.
- Every change to the protocol comes with new cases.
