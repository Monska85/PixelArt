# Play choice format `pixelart-play/1`

Status: **implemented** by the tools (`tools/pixelart.py`: the validation; `tools/release.py`: the manifest's `default`).

`content/play.yaml` says what the project wants a board in Automatic to play: one [schedule](schedule-v1.md), or a list of [playlists](playlist-v1.md). The release tool copies it into the `default` field of the [release manifest](manifest-v1.md#default), and a board that checks the manifest stores it as its server choice. Why it works this way is recorded in [ADR 0007](../adr/0007-server-chosen-playlists.md).

The JSON Schema in [`schema/play-1.schema.json`](../../schema/play-1.schema.json) is the source of truth for the structure and the limits. That the schedule or the playlists exist in the content is a rule of the tools, below.

## Files

- The file is `content/play.yaml`. It is optional: without it the manifest has no `default`, and a board in Automatic plays its own rule.
- It is a source file of the content only. It is not a file of the board: `make data` does not write it to `data/`, and a board never stores it. Its content reaches a board only as the manifest's `default`, or through the command `server_choice_set` ([protocol](../protocol/protocol-v1.md#server_choice_set)).
- It belongs to the content package, like `content/schedules/` and `content/playlists/`.

## Example

```yaml
format: pixelart-play/1
default:
  schedule: seasons
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

An ID follows the rule of the [animation format](pixelart-v1.md#files): lowercase letters, digits, `_` and `-`, starting with a letter or digit, at most 32 characters. Any other key, at the top or in `default`, is an error, and so are a `default` with both keys or neither, an ID that is not text, an empty list, more than 8 playlists and an ID twice in a list. A field that is present is always checked, and `null` is a value like any other.

## Validation

The build tools (`make data`, `make release-content`) refuse the file, with the error and its place, when:

- the file is not strict YAML (a duplicate key, a key that is not text), or its `format` is not `pixelart-play/1`;
- it breaks a rule above;
- the schedule it names is not a schedule of the content, or a playlist it names is not a playlist of the content. A schedule or a playlist that failed its own validation does not count as one.

The release tool writes `default` into the content release's `manifest.json` as it is in the file, and writes none when the content has no `play.yaml`. It refuses a `default` that names a schedule or a playlist the release does not contain.

## What a board does with it

A board that stores the choice plays what it names whenever its `play` setting is `auto` ([How the board chooses what to play](playlist-v1.md#how-the-board-chooses-what-to-play)). A board never validates this file: it reads the manifest's `default`, and a `default` that breaks the rules counts as absent.
