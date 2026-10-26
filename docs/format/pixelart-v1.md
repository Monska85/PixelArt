# Animation format `pixelart/1`

Status: **implemented** by the engine in `lib/PixelEngine/`, used by the firmware and the simulator.

This document specifies the file that describes one animation for the 16x16 LED matrix. The board reads the file and plays it: there is no compilation step. Why the format works this way is recorded in [ADR 0001](../adr/0001-declarative-animations.md). The order in which animations play is defined separately, in a [playlist](playlist-v1.md).

The JSON Schema in [`schema/pixelart-1.schema.json`](../../schema/pixelart-1.schema.json) is the source of truth for the structure and the limits. This document explains the meaning of every field and the rules the schema cannot express.

## Files

- An animation is written in **YAML** (recommended) or **JSON**. The content is the same in both: YAML is only a more comfortable syntax for writing by hand.
- The board stores and reads **JSON** only. The tools that upload animations (the web app and the command line) convert YAML to JSON before sending it. Nothing is lost except comments.
- The JSON is **strict JSON** ([RFC 8259](https://www.rfc-editor.org/rfc/rfc8259)) in valid UTF-8, whose top-level value is an object with nothing before or after it except JSON whitespace (space, tab, line feed and carriage return): no byte order mark, no comments, no single quotes, no unquoted keys, no control characters inside strings, no escaped surrogate that is not part of a pair, and numbers only in the JSON forms (no `+1`, `01`, `.5` or `1.`). No text may contain the character U+0000, even written as `\u0000`. A file that breaks one of these rules is rejected with `structure`.
- Where this document asks for an integer, the JSON number must have no fraction and no exponent: `100` is an integer, `100.0` and `1e2` are not. Text lengths, such as the 128 characters of `name`, count characters (Unicode code points), not bytes.
- The **file name is the animation ID**: `snow_globe.yaml` in the repository becomes `/animations/snow_globe.json` on the board, and playlists refer to it as `snow_globe`. IDs use lowercase letters, digits, `_` and `-`, start with a letter or digit, and are at most 32 characters long.

## A complete example

A heart that beats: it shows a small heart, then a big one, four times.

```yaml
format: pixelart/1
name: Beating heart
version: 1
canvas: { width: 16, height: 16 }
frame_ms: 400

palette:
  red: "#ff0000"
  pink: "#ff7aa8"

sprites:
  small:
    at: [6, 6]
    points:
      red: [[0, 0], [2, 0], [0, 1], [1, 1], [2, 1], [1, 2]]
  big:
    at: [5, 5]
    points:
      red:
        [[0, 0], [1, 0], [3, 0], [4, 0], [0, 1], [4, 1], [1, 2], [3, 2], [2, 3]]
      pink: [[1, 1], [2, 1], [3, 1], [2, 2]]

timeline:
  - loop: 4
    steps:
      - show: [small]
      - show: [big]
        ms: 200
```

## Top-level fields

| Field         | Required | Meaning                                                                                                                                                               |
| ------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format`      | yes      | Always `pixelart/1` for this version. A board rejects versions it does not know.                                                                                      |
| `name`        | yes      | Title shown to people, for example in the web app. It is not the ID (see [Files](#files)).                                                                            |
| `version`     | no       | Integer from 1 to 2,147,483,647, increased by the author on every change. Update manifests use it to show what changed. Default `1`.                                  |
| `author`      | no       | Free text.                                                                                                                                                            |
| `description` | no       | Free text.                                                                                                                                                            |
| `canvas`      | yes      | `{ width: 16, height: 16 }`, the size of the matrix the animation is drawn for. Version 1 supports only 16x16, see [Coordinates and canvas](#coordinates-and-canvas). |
| `frame_ms`    | no       | Default duration of every frame, in milliseconds. Default `500`.                                                                                                      |
| `brightness`  | no       | Percentage of the board's brightness the animation plays at, from 1 to 100. Default `100`. See [Brightness](#brightness).                                             |
| `background`  | no       | [Color](#colors) of every pixel that no sprite draws, in every frame. Without it, those pixels are off.                                                               |
| `palette`     | no       | Named colors, see [Colors](#colors).                                                                                                                                  |
| `sprites`     | yes      | The pictures the animation is made of, see [Sprites](#sprites).                                                                                                       |
| `timeline`    | yes      | What to show and when, see [Timeline](#timeline).                                                                                                                     |

A field that is present is always checked, and `null` is a value like any other: `frame_ms: null` or `at: null` is an error, never the same as leaving the field out. This holds for every optional field at every level, in the top-level fields, in sprites, parts, `show` entries, loops and `recolor`.

## Colors

A color is written in one of two ways:

- **A palette name**, defined once in `palette` and used anywhere: `red`, `dark_green`. Names use lowercase letters, digits and `_`, start with a letter, and are at most 32 characters long.
- **A hex value** `"#rrggbb"`, used directly without a palette entry: `"#ff8800"`.

Hex values **must be quoted** in YAML. Without quotes, `#` starts a comment that hides the rest of the line. `- [8, 3, #ff0000]` makes the file unreadable, and a grouped entry such as `#00ff00: [[2, 2]]` is silently ignored, so those pixels disappear without any error.

Two colors are the same if they resolve to the same `#rrggbb` value, whatever way they were written. This matters for [`recolor`](#recolor).

The file describes the color as it should look. The board converts it for the LEDs exactly as the current firmware does (16-bit color plus the NeoMatrix gamma correction), so animations keep their current look. The overall brightness of the LEDs is a board setting; an animation can only lower it, see [Brightness](#brightness).

## Brightness

The board has a brightness setting from 0 (off) to 255, chosen by its user and changed through the [command protocol](../protocol/protocol-v1.md). It is the absolute limit: it keeps the matrix within what the user's power supply handles, and at the level the user wants for the room.

An animation can play softer than that with `brightness`, a whole percentage from 1 to 100. It applies to the whole animation, every frame and every LED, background included. Without the field, the animation plays at 100 percent, which is the board brightness itself. Nothing in a file can make the LEDs brighter than the board setting.

The brightness the LEDs receive is computed with whole numbers only, so that every implementation gives the same result. With `B` the board brightness (0 to 255) and `P` the animation's percentage (1 to 100):

- if `B` is 0, the result is 0;
- otherwise the result is `(B × P + 50) ÷ 100`, where `÷` keeps only the whole part (the fraction is dropped), and a result of 0 becomes 1.

The `+ 50` rounds to the nearest whole number, halves upwards. The last rule keeps a dimmed animation visible: an animation never switches the matrix off by itself, only a board brightness of 0 does.

| Board brightness `B` | Animation `brightness` `P` | LEDs receive |
| -------------------- | -------------------------- | ------------ |
| 100                  | 100 (or no field)          | 100          |
| 100                  | 50                         | 50           |
| 255                  | 33                         | 84           |
| 3                    | 50                         | 2            |
| 1                    | 1                          | 1            |
| 0                    | 50                         | 0            |

The result is used for as long as the animation plays, in the same way as the board brightness: the colors go through the same 16-bit and gamma conversion, then the LED driver scales them by the result. When the board brightness changes while an animation plays, the new result applies from the next frame.

## Sprites

A sprite is a picture with a name. It has either **points** (it is drawn pixel by pixel) or **parts** (it is made of other sprites), never both.

| Field    | Meaning                                                                                             |
| -------- | --------------------------------------------------------------------------------------------------- |
| `at`     | Home position `[x, y]` on the canvas: where the sprite's point `[0, 0]` lands. Default `[0, 0]`.    |
| `points` | The pixels, in one of the two forms below.                                                          |
| `parts`  | The sprites this sprite is made of, see [Composite sprites](#composite-sprites).                    |
| `pivot`  | Point `[x, y]` the sprite turns around, in the sprite's own coordinates. See [Rotation](#rotation). |

Coordinates are integers. `x` grows to the right and `y` grows downwards, starting from `0`. Point coordinates are relative to the sprite: a sprite at `[3, 5]` with a point at `[1, 0]` lights the LED at column 4, row 5.

### Coordinates and canvas

The canvas declares which matrix a file is made for. Tools and the web app can check it when they read the file, and [playlists](playlist-v1.md) declare their canvas too. Version 1 supports only 16x16, the size of the matrix in the frame. Larger canvases can be allowed later without breaking existing files because every 16x16 file stays valid.

Coordinates, `at`, `move` and `pivot` values go from -128 to 127. The range is much wider than the canvas on purpose: sprites enter and leave the screen, so positions such as `x = 16` (just right of the screen) or negative values are normal. The bound protects the board from absurd values, and it fits one signed byte, which lets the board store each point in 3 bytes.

### Points

One entry per pixel, `[x, y, color]`:

```yaml
balls:
  points:
    - [8, 3, red]
    - [6, 5, red]
    - [7, 3, "#c141f2"]
```

Or grouped by color, which is shorter for most sprites:

```yaml
balls:
  points:
    red: [[8, 3], [6, 5]]
    "#c141f2": [[7, 3]]
```

A sprite only covers the pixels it lists. Every other pixel is transparent: it shows whatever is below, and in the end the background. If two points of the same sprite share a position, the later one in the file wins, and the validator warns about it.

### Composite sprites

A composite sprite groups other sprites, so they can be placed, moved and turned as one:

```yaml
sprites:
  body: { points: { red: [[1, 0], [15, 0]] } }
  tree: { at: [7, -6], points: { green: [[0, 2], [1, 2]] } }
  present: { at: [3, -2], points: { blue: [[0, 0], [1, 0]], yellow: [[2, 0]] } }

  sleigh:
    at: [0, 7]
    parts: [body, tree, present]
```

- Each part is placed at its own `at`, measured from the composite's position. Write `{ sprite: tree, at: [8, -6] }` to place a part differently inside this composite only.
- Parts are drawn in list order: later parts cover earlier ones.
- A composite can contain other composites, up to the nesting limit in [Limits](#limits). A sprite that contains itself, directly or through other sprites, is an error.
- A composite counts every pixel of its parts, as many times as each part appears, toward the limit of pixels drawn in one frame. A part listed 64 times at four nesting levels would otherwise draw millions of pixels per frame.
- Parts cannot be hidden or animated one by one inside a composite. To animate one part on its own, show the parts as separate sprites in the frame instead.

## Timeline

The timeline is a list of **items**, played in order. An item is either a **frame** or a **loop**.

### Frame

A frame says what is visible and for how long:

```yaml
- show: [tree, red_balls]
  ms: 500
```

| Field     | Meaning                                                                                                                                                            |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `show`    | Sprites drawn in this frame, from bottom to top. Each entry is a sprite name or a [sprite reference](#sprite-references). An empty list shows only the background. |
| `ms`      | How long the frame stays on screen. Default: the animation's `frame_ms`.                                                                                           |
| `repeat`  | Show this frame `repeat` times in a row. Default `1`. Each repetition can differ through [motion](#motion) and [spin](#rotation).                                  |
| `recolor` | Color substitutions for this frame, see [Recolor](#recolor).                                                                                                       |

A frame with `repeat: N` produces `N` frames on the matrix. The repetitions are numbered `k = 0, 1, ..., N-1`.

### Loop

A loop plays a list of items several times:

```yaml
- loop: 3
  steps:
    - show: [tree]
    - show: [tree, red_balls]
```

`loop` is how many times `steps` is played. `steps` can contain frames and other loops, up to the nesting limit in [Limits](#limits). A loop only ever repeats the items nested inside it.

### Sprite references

In `show`, a sprite can be written as its name, or as an object that changes how it is drawn in this frame:

```yaml
show:
  - trees
  - { sprite: snow, move: [0, 1], wrap: true }
```

| Field    | Meaning                                                                                                                       |
| -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `sprite` | The sprite name. Required.                                                                                                    |
| `at`     | Position for this frame, replacing the sprite's home position.                                                                |
| `move`   | `[dx, dy]` added to the position on each repetition, see [Motion](#motion).                                                   |
| `wrap`   | `true` makes pixels that leave one side of the canvas come back on the other side. Default `false`: they disappear.           |
| `rotate` | Clockwise rotation in degrees: `0`, `90`, `180` or `270`. Negative values turn counterclockwise (`-90` is the same as `270`). |
| `spin`   | Rotation added on each repetition, same values as `rotate`.                                                                   |
| `flip`   | `x` mirrors left and right, `y` mirrors top and bottom, `xy` does both.                                                       |
| `pivot`  | Pivot for this frame, replacing the sprite's own `pivot`.                                                                     |

## Effects

Every frame is drawn the same way: start from the background, then draw each sprite of `show` in order. Each sprite goes through these steps, in this order:

1. [Flip](#flip)
2. [Rotation](#rotation)
3. [Position](#position) and [motion](#motion)
4. [Wrap or clip](#wrap-or-clip)
5. [Recolor](#recolor)
6. [Draw](#draw)

### Flip

`flip` mirrors the sprite within its own bounding box (the smallest rectangle that contains all its pixels), so the sprite stays where it was.

With the bounding box from `min_x` to `max_x` and from `min_y` to `max_y`:

- `x`: a pixel at `x` moves to `min_x + max_x - x`.
- `y`: a pixel at `y` moves to `min_y + max_y - y`.

### Rotation

The angle for repetition `k` is `rotate + k * spin`, reduced to 0, 90, 180 or 270 degrees. The sprite turns clockwise around its pivot `[px, py]`. Turning by 90 degrees moves a pixel at `[x, y]` to:

```text
x' = px - (y - py)
y' = py + (x - px)
```

180 and 270 degrees apply this two and three times. Only multiples of 90 degrees exist, so every pixel lands exactly on another pixel.

The **pivot** is the frame's `pivot`, else the sprite's `pivot`, else the center of the bounding box: `[floor((min_x + max_x) / 2), floor((min_y + max_y) / 2)]`. When that center falls between two pixels, it is rounded toward the top-left, and a turning sprite appears to shift by one pixel. The validator warns about it on sprites that rotate, so the author can set an explicit `pivot`.

### Position

The sprite is placed at the frame's `at`, else the sprite's `at`, else `[0, 0]`.

### Motion

`move: [dx, dy]` shifts the sprite by `k * [dx, dy]` on repetition `k`. On the first repetition (`k = 0`), the sprite is at its normal position. `move` and `spin` have no visible effect in a frame without `repeat`, and the validator warns about it.

The final position of a pixel is: its coordinates after flip and rotation, plus the position, plus `k * move`.

### Wrap or clip

Pixels that end up outside the canvas disappear, unless `wrap: true`. With `wrap`, a pixel at column `x` is drawn at column `x mod width` (always positive), and the same for rows.

### Recolor

`recolor` replaces colors in the pixels drawn by the sprites of this frame. It does not change the background.

```yaml
- show: [flake]
  recolor: { light_blue: white, white: light_blue }
```

All substitutions happen at once, from the original colors: two colors can swap places, as in the example above. Colors match by their resolved `#rrggbb` value, see [Colors](#colors).

### Draw

The sprite's pixels are drawn over what is already there. After the last sprite of `show`, the frame is shown for its duration. The next frame starts again from the background: nothing carries over from one frame to the next.

## Examples from the current animations

Falling snow over trees, 32 frames of 250 ms:

```yaml
timeline:
  - show: [trees, { sprite: snow, move: [0, 1], wrap: true }]
    repeat: 32
    ms: 250
```

A sleigh leaving on the left, coming back in from the right, and ending where it started:

```yaml
timeline:
  - show: [{ sprite: sleigh, move: [-1, 0] }]
    repeat: 16
    ms: 250
  - show: [{ sprite: sleigh, at: [16, 0], move: [-1, 0] }]
    repeat: 16
    ms: 250
  - show: [sleigh]
    ms: 250
```

A snowflake that swaps its two colors on every other frame:

```yaml
timeline:
  - loop: 5
    steps:
      - show: [flake]
      - show: [flake]
        recolor: { light_blue: white, white: light_blue }
```

A tree that shows red and purple balls in turn:

```yaml
timeline:
  - loop: 4
    steps:
      - show: [tree]
      - show: [tree, red_balls]
      - show: [tree]
      - show: [tree, purple_balls]
  - show: [tree]
```

## Limits

Animations can come from any source, including URLs typed by users, so every implementation enforces these limits before playing anything. A file that breaks one of them is rejected as a whole.

| Limit                                                               | Value              |
| ------------------------------------------------------------------- | ------------------ |
| File size (JSON, as stored on the board)                            | 64 KiB             |
| Canvas                                                              | exactly 16x16      |
| Palette entries                                                     | 256                |
| Different colors in the whole animation                             | 256                |
| Sprites                                                             | 64                 |
| Points, counted once per sprite definition                          | 4,096              |
| Composite nesting depth                                             | 4                  |
| Parts in one composite sprite                                       | 64                 |
| Pixels drawn in one frame, counting every part of composite sprites | 4,096              |
| Loop nesting depth                                                  | 4                  |
| Timeline items, frames and loops at all levels                      | 1,024              |
| Entries in one `show` list                                          | 32                 |
| `repeat` and `loop`                                                 | 1 to 10,000        |
| `frame_ms` and `ms`                                                 | 20 to 60,000       |
| `brightness`                                                        | 1 to 100           |
| `version`                                                           | 1 to 2,147,483,647 |
| Coordinates, `at`, `move` and `pivot` values                        | -128 to 127        |
| `name` and `author`                                                 | 128 characters     |
| `description`                                                       | 512 characters     |

For reference, the largest current animation (`snow_globe`) is about 4.5 KB with 555 points, 4 sprites and 12 colors.

## Validation

Validation runs in the command line tools and in CI, and again on the board, which never trusts a file. Every message names the place of the problem, for example `sprite "tree", point 12: unknown color "gren"`. An implementation keeps at most 32 messages per file, so a file full of mistakes cannot exhaust the board's memory; such a file is still rejected.

### Errors

An error rejects the file.

| Code                 | Meaning                                                                                                                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format_unsupported` | `format` is missing or is not a version this implementation supports.                                                                                                                                                                       |
| `structure`          | The file is not strict JSON (see [Files](#files)), or it does not match the JSON Schema: missing field, wrong type, unknown field, or a single value out of its range (a coordinate, a duration, a `repeat`).                               |
| `limit_exceeded`     | A size or count limit is exceeded: file size; number of palette entries, colors, sprites, points or timeline items; entries in a `show` list, parts of a composite or `recolor` substitutions; pixels drawn in one frame; or nesting depth. |
| `unknown_color`      | A color is neither a palette name nor a valid `"#rrggbb"` value.                                                                                                                                                                            |
| `unknown_sprite`     | `show` or `parts` names a sprite that does not exist.                                                                                                                                                                                       |
| `sprite_cycle`       | A composite sprite contains itself, directly or through other sprites.                                                                                                                                                                      |
| `invalid_angle`      | `rotate` or `spin` is an integer that is not one of -270, -180, -90, 0, 90, 180, 270. A value that is not an integer is `structure`.                                                                                                        |
| `empty_sprite`       | A sprite has no points, or an empty `parts` list.                                                                                                                                                                                           |

### Warnings

A warning does not reject the file.

| Code              | Meaning                                                         |
| ----------------- | --------------------------------------------------------------- |
| `pivot_rounded`   | A sprite that rotates has its default pivot between two pixels. |
| `duplicate_point` | Two points of the same sprite share a position.                 |
| `no_effect`       | `move` or `spin` is used in a frame without `repeat`.           |
| `unused_sprite`   | A sprite is never shown, directly or as a part.                 |
| `unused_color`    | A palette entry is never used.                                  |

## Changes to this format

New effects or fields need a new format version, `pixelart/2`, and a firmware that understands it. A board refuses versions it does not know, and the web app then asks the user to update the firmware. Every change comes with new files in the conformance test suite, which all implementations (the board firmware, the simulator and the web app) must pass.
