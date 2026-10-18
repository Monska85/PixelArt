# Conformance suite

Test cases for the [`pixelart/1` animation format](../docs/format/pixelart-v1.md) and the [`pixelart-playlist/1` playlist format](../docs/format/playlist-v1.md). Every implementation of the formats must pass all of them. Today that is the engine in `lib/PixelEngine/`, used by the firmware and the simulator; the planned web app will be the second. `make test` runs them locally, and CI runs the same tests (`pio test -e native_test`).

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
- `frames`: every frame of the timeline, in order, and nothing more. `ms` is the frame duration, `pixels` lists the lit pixels by color as `[x, y]`, and every other pixel has the `background` color (off when `background` is missing).

For an invalid case:

```json
{ "error": "unknown_color" }
```

The implementation must reject the file and report at least this error code. It may report other errors too. An optional `"max_diagnostics": 32` means the implementation must keep at most that many messages for the file.

For a valid playlist, the expected file lists the enabled items in order:

```json
{ "items": [{ "animation": "santa", "repeat": 2 }] }
```

## Rules for new cases

- Work out the expected frames by hand from the specification, never by running an implementation and copying its output. Otherwise a bug in that implementation becomes the expected result.
- Every change to the format or to an effect comes with new cases, and CI fails until every implementation passes them.
- Keep cases small: a few pixels per sprite make the expected result easy to check by reading it.
- Every limit has a pair of cases: the largest accepted value in `valid/` (when its frames are easy to write down) and one above it in `invalid/`.
