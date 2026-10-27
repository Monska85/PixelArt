# Playlist format `pixelart-playlist/1`

Status: **implemented** by the engine in `lib/PixelEngine/`, used by the firmware and the simulator.

A playlist decides which [animations](pixelart-v1.md) the board plays, in which order and how many times. Animations and playlists are separate files, so changing the order, adding or removing an animation never touches the animation files themselves.

The JSON Schema in [`schema/playlist-1.schema.json`](../../schema/playlist-1.schema.json) is the source of truth for the structure and the limits.

## Files

- Like animations, a playlist is written in YAML or JSON, and the board stores and reads JSON only. The JSON follows the same rules as for [animations](pixelart-v1.md#files): strict JSON in valid UTF-8, no U+0000 in any text, integers without fraction or exponent, and text lengths counted in characters.
- On the board, playlists live in `/playlists/`. Which of them the board plays depends on its `play` and `playlists` [settings](../protocol/protocol-v1.md#settings_get-settings_set) and on the [schedule](schedule-v1.md) `default`, as [How the board chooses what to play](#how-the-board-chooses-what-to-play) describes. A new board plays `/playlists/default.json`, as before schedules existed, until a schedule or a client changes it.
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

A field that is present is always checked, and `null` is a value like any other: `repeat: null` or `name: null` is an error, never the same as leaving the field out.

The same animation can appear more than once.

Every animation in a playlist must have the same `canvas` as the playlist. Declaring the size in both files lets tools and the web app check compatibility when they read the files.

## How the board chooses what to play

The board computes a list of playlists, then plays it. Why it works this way is recorded in [ADR 0007](../adr/0007-server-chosen-playlists.md).

### The list

| `play`             | Schedule and date                                        | List                                  | Reason        |
| ------------------ | -------------------------------------------------------- | ------------------------------------- | ------------- |
| `playlists`        | Any                                                      | The `playlists` setting.              | `user`        |
| `auto` (Automatic) | No valid `/schedules/default.json`                       | `[default]`                           | `no_schedule` |
| `auto`             | A valid schedule, the local date not known               | The schedule's `fallback`.            | `no_time`     |
| `auto`             | A valid schedule, the local date known, an entry wins    | The `playlists` of the winning entry. | `schedule`    |
| `auto`             | A valid schedule, the local date known, no entry matches | The schedule's `fallback`.            | `fallback`    |

The winning entry is chosen by the rules of the [schedule format](schedule-v1.md#which-entry-wins), for the local date of the board's clock in its `timezone` ([Time](../board/wifi-and-updates-v1.md#time)). A schedule is valid when `/schedules/default.json` exists and passes the engine's validation; a schedule with another ID is never played. The reason is what `status` reports in `play.reason` ([protocol](../protocol/protocol-v1.md#status)).

With no valid schedule, the list is `[default]`, which is exactly what a board played before schedules existed.

### Playlists the board cannot play

A playlist of the list is playable when `/playlists/<id>.json` exists, is valid, has the board's canvas, and has at least one enabled item whose animation is stored in `/animations/`. Any other playlist is skipped: one that is missing, invalid, made for another canvas, or with no item the board can play.

When the board cannot read a playlist or a schedule because an update holds the memory, it skips nothing: it waits and reads it again, as it does today for a playlist.

When the list gives the board nothing to play, it falls back, step by step:

- **Automatic, a winning entry:** when every playlist of the entry is skipped, the board uses the schedule's `fallback`, and the reason becomes `fallback`.
- **Automatic, any list:** when every playlist of the list is skipped (the `fallback` above included), the board uses `[default]`, and the reason stays as it was.
- **Automatic, `default` skipped too, and every playlist of My playlists skipped:** the board plays every valid animation in `/animations/`, in alphabetical order of ID. My playlists never falls back to `default`, so a board whose old `playlist` setting names a missing playlist plays as it did before schedules existed.
- **No valid animation at all:** the board shows a built-in "no animations" image.

### Playing the list

1. The board plays every playable playlist of the list in full, in the order of the list, then starts from the first again. A list of one playlist plays as a single playlist always did.
2. In a playlist, it plays the enabled items in order, each with its repeats. An item whose animation is missing, invalid, or made for a different canvas is skipped. The board prints the reason on the serial port (once per boot) and goes on with the next item.
3. The board reads each playlist again when it starts it. A playlist that it finds it cannot play at that moment, for example because every one of its animations turns out to be invalid, is skipped then, and the board goes on with the next one; when none is left, it falls back as above.
4. While it plays every animation, the board looks at the list again after each pass, so a playlist that becomes playable, for example because one of its animations was uploaded, plays from the next pass.

### When the board chooses again

The board computes the list again:

- at boot;
- when the time becomes known;
- at local midnight, when the local date changes, which the board notices when an animation ends;
- when a playlist or a schedule is stored or deleted: an upload (`put_end`), an update, `delete` or `delete_all`;
- when `timezone` changes;
- when the play settings change: `play`, `playlists`, or `playlist` as an older client sets it.

A new list takes effect when the current animation ends: the animation playing at the moment finishes unchanged, and its remaining repeats are cut, as they were when the active playlist changed. A new list that is the same as the old one, the same playlists in the same order, keeps the position: the board goes on with the playlist and the item it was at. A different list starts from its first playlist. A playlist that is stored or deleted always starts the list again from its first playlist, even when the list is the same, as an upload or a deletion of a playlist restarted the active playlist before.

`status` reports the newest list at once in `play`, with the playlist the board plays, or the one it will start when the current animation ends ([protocol](../protocol/protocol-v1.md#status)).

The board never loops over years to choose: it resolves one date, over at most 64 entries, at the events above. Ties are refused by the tools, and a board takes the first tied entry in the file.

## Limits

| Limit     | Value          |
| --------- | -------------- |
| File size | 16 KiB         |
| Items     | 256            |
| `repeat`  | 1 to 1,000     |
| `name`    | 128 characters |

## Validation

Like for animations, an implementation keeps at most 32 messages per file.

Errors reject the playlist (the board then skips it as described above): `format_unsupported`, `structure` (which includes a file that is not strict JSON), `limit_exceeded`, and `canvas_mismatch` when the playlist is made for a different matrix than the board's.

Warnings, reported by the tools when they know the full set of animations, for example in CI:

- `unknown_animation`: an item names an animation that does not exist.
- `canvas_mismatch`: an item names an animation made for a different canvas than the playlist.

On a board, such items are skipped.
