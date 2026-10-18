# Playlist format `pixelart-playlist/1`

Status: **draft**, not implemented yet.

A playlist decides which [animations](pixelart-v1.md) the board plays, in which order and how many times. Animations and playlists are separate files, so changing the order, adding or removing an animation never touches the animation files themselves.

The JSON Schema in [`schema/playlist-1.schema.json`](../../schema/playlist-1.schema.json) is the source of truth for the structure and the limits.

## Files

- Like animations, a playlist is written in YAML or JSON, and the board stores and reads JSON only.
- On the board, playlists live in `/playlists/`. The board plays `/playlists/default.json`.
- Playlist file names follow the same rules as animation IDs.

## Example

```yaml
format: pixelart-playlist/1
name: Christmas
canvas: { width: 16, height: 16 }

items:
  - animation: xmas_tree
  - animation: santa
    repeat: 2
  - animation: snow_trees
    enabled: false
  - animation: sleigh
```

## Fields

| Field    | Required | Meaning                                                                                                                                                          |
| -------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format` | yes      | Always `pixelart-playlist/1` for this version.                                                                                                                   |
| `name`   | no       | Title shown to people.                                                                                                                                           |
| `canvas` | yes      | `{ width, height }` of the matrix the playlist is made for, like the [animation `canvas`](pixelart-v1.md#coordinates-and-canvas). Version 1 supports only 16x16. |
| `items`  | yes      | The animations to play, in order. When the last one ends, the board starts again from the first.                                                                 |

Each item:

| Field       | Required | Meaning                                                                            |
| ----------- | -------- | ---------------------------------------------------------------------------------- |
| `animation` | yes      | ID of the animation, which is its file name without extension.                     |
| `repeat`    | no       | How many times the animation plays before moving on. From 1 to 1,000. Default `1`. |
| `enabled`   | no       | `false` skips the item without removing it from the list. Default `true`.          |

The same animation can appear more than once.

Every animation in a playlist must have the same `canvas` as the playlist. Declaring the size in both files lets the tools, the web app and update manifests tell at a glance which matrix a file is made for, without opening the animations.

## How the board chooses what to play

1. If `/playlists/default.json` exists, is valid and has the board's canvas, the board plays its enabled items in order.
2. An item whose animation is missing, invalid, or made for a different canvas is skipped. The board reports the reason through the command protocol and goes on with the next item.
3. If there is no playlist, the playlist is invalid, or it has no item the board can play, the board plays every valid animation in `/animations/`, in alphabetical order of ID.
4. If there is no valid animation at all, the board shows a built-in "no animations" image.

## Limits

| Limit     | Value          |
| --------- | -------------- |
| File size | 16 KiB         |
| Items     | 256            |
| `repeat`  | 1 to 1,000     |
| `name`    | 128 characters |

## Validation

Errors reject the playlist (the board then falls back as described above): `format_unsupported`, `structure`, `limit_exceeded`, and `canvas_mismatch` when the playlist is made for a different matrix than the board's.

Warnings, reported by the tools when they know the full set of animations, for example in CI:

- `unknown_animation`: an item names an animation that does not exist.
- `canvas_mismatch`: an item names an animation made for a different canvas than the playlist.

On a board, such items are skipped.
