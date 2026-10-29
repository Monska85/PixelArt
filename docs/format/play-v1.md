# Play file format `pixelart-play/1`

Status: **implemented** by the tools (`tools/pixelart.py`: the build and the validation; `tools/release.py`: the manifest's `play` list).

A play file says what the project wants a board in Automatic to play: one [schedule](schedule-v1.md), or a list of [playlists](playlist-v1.md). It is the board's server choice. The project publishes one with every content release, and the board stores it like any other file. Why it is a file is recorded in [ADR 0007](../adr/0007-server-chosen-playlists.md).

The JSON Schema in [`schema/play-1.schema.json`](../../schema/play-1.schema.json) is the source of truth for the structure and the limits. That the schedule or the playlists exist is not a rule of the format: it is a warning, below.

## Files

- Like animations and playlists, a play file is written in YAML or JSON, and the board stores and reads JSON only. The JSON follows the rules of [animations](pixelart-v1.md#files): strict JSON in valid UTF-8, no U+0000 in any text.
- In the repository the file is `content/play.yaml`. It is optional. `make data` builds it as `data/play/default.json` and a content release publishes it as `play/default.json`, listed in the `play` list of the [manifest](manifest-v1.md). On the board it lives in `/play/`, the folder of the protocol kind `play`.
- A board stores any valid ID in `/play/`, and lists, reads, uploads and deletes it like any other file. It uses only `default`: the board's server choice is the `default` field of a valid `/play/default.json`. Without that file, or with an invalid one, the board has no server choice and plays its own rule ([How the board chooses what to play](playlist-v1.md#how-the-board-chooses-what-to-play)).
- It belongs to the content package, like `content/schedules/` and `content/playlists/`.

## Example

```yaml
format: pixelart-play/1
default:
  schedule: seasons
```

The JSON the board stores:

```json
{ "format": "pixelart-play/1", "default": { "schedule": "seasons" } }
```

A list of playlists instead of a schedule:

```yaml
format: pixelart-play/1
default:
  playlists: [christmas, default]
```

## Fields

| Field     | Required | Meaning                                                                 |
| --------- | -------- | ----------------------------------------------------------------------- |
| `format`  | yes      | Always `pixelart-play/1` for this version.                              |
| `default` | yes      | What Automatic plays. An object with exactly one of the two keys below. |

`default` has exactly one of:

| Key         | Meaning                                                                        |
| ----------- | ------------------------------------------------------------------------------ |
| `schedule`  | The ID of a schedule, which is its file name without extension.                |
| `playlists` | 1 to 8 playlist IDs, no ID twice. The board plays them in turn, in this order. |

An ID follows the rule of the [animation format](pixelart-v1.md#files): lowercase letters, digits, `_` and `-`, starting with a letter or digit, at most 32 characters. A field that is present is always checked, and `null` is a value like any other. A field that this specification does not define is an error, at the top and in `default`.

## Limits

| Limit                  | Value |
| ---------------------- | ----- |
| File size              | 1 KiB |
| Playlists in `default` | 8     |

## Validation

Like for the other formats, an implementation keeps at most 32 messages per file. These errors reject the file: a board refuses it at `put_end` and in an update (`invalid_file`), and the tools refuse to build it. A stored file that is invalid is no server choice.

| Code                 | Meaning                                                                                                                                                                                                                                         |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format_unsupported` | The file is not an object, or its `format` is missing or not `pixelart-play/1`.                                                                                                                                                                 |
| `structure`          | The file is not strict JSON (the YAML source of the tools: not strict YAML); a field is unknown, missing, `null` or of the wrong type; `default` has both keys or neither; an ID breaks the ID rule; `playlists` is empty or names an ID twice. |
| `limit_exceeded`     | The file is larger than 1 KiB, or `playlists` has more than 8 IDs.                                                                                                                                                                              |

Warnings never reject the file. The board reports them when the file is uploaded (`put_end`) and when an update installs it, and the tools report them when they know the full content:

- `unknown_schedule`: `default` names a schedule that is not stored on the board, or that the content does not have or did not validate.
- `unknown_playlist`: `default` names a playlist that is not stored, or that the content does not have, once for each place it appears.

The file is still stored, since the schedule or the playlist can come afterwards. While the target is missing, the board falls back as [How the board chooses what to play](playlist-v1.md#how-the-board-chooses-what-to-play) says.

## What a board does with it

A board reads `/play/default.json` whenever it chooses what to play, and follows its `default` whenever its `play` setting is `auto`. Storing or deleting the file makes the board choose again. `status.play.server_choice` reports the `default` of a valid file, or `null`.
