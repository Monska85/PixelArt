# Command protocol, version 1

Status: **implemented** by the firmware (`src/protocol.cpp`) and the simulator.

This document specifies how a client (the command line tool, the web app, a test) talks to a PixelArt board: reading what is stored, uploading and downloading animations and playlists, deleting them, and changing the board's settings. Why the protocol works this way is recorded in [ADR 0002](../adr/0002-command-protocol.md).

The protocol does not depend on the link. The board speaks it over its USB serial port, and the simulator speaks it over a local WebSocket. WiFi can carry the same messages later.

## Transports

### USB serial

The board reads requests from its USB serial port and writes replies to it. The same port also carries the board's log lines (`pixelart: ...`) and, in builds with the live mirror, one `@PX ...` line per frame. Protocol lines start with their own marker, so a client tells them apart without any switch or mode.

The link can lose or change bytes. The ESP32-C3's native USB serial has been seen dropping bytes in a long line just after boot. Every protocol line therefore carries a checksum, and the client repeats a request when its reply is missing or damaged (see [Retries](#retries)).

The board's USB serial driver keeps only 256 bytes in each direction unless told otherwise, and drops bytes when its buffer is full. The board sets a receive buffer of 4,096 bytes and a larger send buffer before it opens the port. A client follows two rules on this link:

- **Handshake first.** After opening the port, the client sends `info` and waits for its reply before it sends any long line. The board may still be starting.
- **Large buffers.** The client reads with a buffer of at least 8,192 bytes. In a browser, that means opening Web Serial with `bufferSize` set to 8,192 or more.

While an upload is in progress, the board pauses the live mirror (no `@PX` lines), so the long mirror lines do not compete with the upload.

Only one program can open the serial port at a time. A client and the serial monitor (`make monitor`) cannot run together.

### WebSocket (simulator)

The simulator serves the protocol with `--ws [PORT]`, default port 8765, in real-time runs only. It listens on `127.0.0.1` only and serves one client at a time; a second connection is refused until the first one closes.

- Every WebSocket text message carries exactly one protocol line, with the same framing as on the serial port and without the final newline.
- The 1,024-byte [line limit](#limits) counts the whole message, after the simulator reassembles it from fragments. A longer message closes the connection with status 1009. A binary message closes it with status 1003. A text message that contains a newline closes it with status 1008, and one that is not valid UTF-8 closes it with status 1007.
- The simulator accepts the WebSocket handshake on any request path.
- The simulator sends only protocol lines over the WebSocket. Clients still ignore any line without the protocol marker, as on the serial port.
- **Origin check.** Any web page can open a WebSocket to `localhost`, so the simulator accepts a connection only when its `Origin` header is missing (command line clients), is `http://localhost` or `http://127.0.0.1` with any port, or is `https://monska85.github.io`. `--ws-origin ORIGIN` adds another one. Any other origin is refused with HTTP status 403. This keeps a website you happen to visit from rewriting the simulator's files.

Uploads and deletions through the simulator change its data folder (`data/` or the folder given with `--data`). `make data` writes the converted repository files there again.

## Lines

Every protocol message, in both directions, is one line:

```text
@PR <crc> <json>
```

- `@PR` followed by one space, at the very start of the line.
- `<crc>` is the CRC-32 of the `<json>` bytes, exactly as sent, written as 8 lowercase hexadecimal digits, followed by one space. The CRC is the common one used by zlib, PNG and Ethernet (polynomial `0x04C11DB7` reflected, initial value and final XOR `0xFFFFFFFF`). In Python it is `zlib.crc32(data)`.
- `<json>` is one JSON object in UTF-8, with no newline inside.
- The line ends with `\n`. A `\r` just before the `\n` is ignored, so terminals that send `\r\n` work.

For example, the `info` request with sequence number 1:

```text
@PR 3c250228 {"seq":1,"cmd":"info"}
```

Every reply the board sends is valid UTF-8, whatever the files or the request contained. Text the board quotes from a stored file, an upload or a request (a list `name`, a diagnostic `where` or `message`, a message that names a field) is copied with every byte that is not part of a well-formed UTF-8 sequence replaced by U+FFFD, the replacement character, one for each such byte. Well-formed means the sequences of RFC 3629: no overlong forms, no surrogates and nothing above U+10FFFF. A client can therefore always decode a reply, and a damaged file can always be listed and deleted.

The board ignores, without replying, every line that does not start with `@PR `. Log lines and typed noise therefore never run anything. The board writes every line it sends in one piece, so a protocol line never mixes with a log or mirror line.

The board answers with a `bad_frame` error, without `seq`, when a line starts with `@PR ` but:

- is longer than the line limit (the board drops the bytes up to the next newline);
- has a CRC that is not 8 lowercase hexadecimal digits, or that does not match the JSON;
- holds JSON that does not parse, is not an object, or nests deeper than 4 levels.

```text
@PR 15233999 {"ok":false,"error":"bad_frame","message":"checksum does not match"}
```

A client that gets `bad_frame` repeats its last request at once, without waiting for its timeout. A client throws away every line it receives with a bad CRC, as if it had never arrived.

A line from the board with no `seq` and an `event` field is an event: a message the board sends on its own. Version 1 defines no events. Clients ignore events they do not know, so later versions can add them.

## Requests and replies

A request is a JSON object with:

| Field | Type    | Meaning                                                                                                 |
| ----- | ------- | ------------------------------------------------------------------------------------------------------- |
| `seq` | integer | Sequence number chosen by the client, from 0 to 4,294,967,295. A new request takes a new number.        |
| `cmd` | string  | The command, see [Commands](#commands).                                                                 |
| ...   |         | The command's own fields. A field the command does not define is an error (`bad_request`), not ignored. |

The board answers every well-formed request with exactly one reply, in order. A reply is a JSON object with:

| Field         | Type    | Meaning                                                                                  |
| ------------- | ------- | ---------------------------------------------------------------------------------------- |
| `seq`         | integer | The request's `seq`. Missing only in a `bad_frame` reply.                                |
| `ok`          | boolean | `true` when the command succeeded.                                                       |
| `error`       | string  | Only when `ok` is `false`: the [error code](#errors).                                    |
| `message`     | string  | Only when `ok` is `false`: a short explanation for people. Clients do not parse it.      |
| `diagnostics` | array   | Only for `invalid_file`: the engine's [diagnostics](#diagnostics) for the rejected file. |
| `expected`    | integer | Only for `bad_offset`: the offset the board expects next.                                |
| ...           |         | On success, the command's own fields.                                                    |

Clients ignore reply fields they do not know, so later firmware can add fields without breaking them.

A request without a `seq` that is a valid integer, or without a `cmd` string, is answered with `bad_request` and no `seq`.

### Retries

A request or its reply can be lost on the link. The client waits for the reply with a timeout (the command line tool waits 2 seconds, and 10 seconds for `put_end`) and then sends the same request again, with the same `seq`, up to 5 times in all.

The board remembers its last reply, with the `seq` and the CRC of the request it answered. When a request arrives with the same `seq` and the same CRC, the board sends that reply again without running the command a second time. A file is therefore never committed twice. A request with the same `seq` but a different CRC is a new request and runs normally. The board forgets the last reply when it restarts; `info.boot_id` lets a client notice a restart.

A `bad_frame` reply does not change the remembered reply.

A client keeps one request in flight. It sends the next request only after the reply to the first one, or after it gave up on it. It accepts only the reply whose `seq` equals the request in flight and discards any other reply. A late duplicate caused by a retry is such a reply.

### Diagnostics

Each diagnostic is an object with the fields of the engine's validation messages, described in [`pixelart-v1.md`](../format/pixelart-v1.md#validation):

| Field      | Meaning                                                                    |
| ---------- | -------------------------------------------------------------------------- |
| `severity` | `error` or `warning`.                                                      |
| `code`     | The error or warning code, for example `unknown_color`.                    |
| `where`    | The place of the problem, for example `sprites.tree.points[12]`, or empty. |
| `message`  | A short explanation for people.                                            |

A file has at most 32 diagnostics, as the format specifications require.

## Commands

Every command that names a file uses two fields:

- `kind`: `animation` or `playlist`. Any other value is `invalid_kind`.
- `id`: the file ID, with the rule of the [format](../format/pixelart-v1.md#files): lowercase letters, digits, `_` and `-`, starting with a letter or digit, at most 32 characters. Any other value is `invalid_id`.

The board builds the path itself, `/animations/<id>.json` or `/playlists/<id>.json`. A client never sends a path.

### `info`

What the board is and what it supports. No fields.

```text
@PR 3c250228 {"seq":1,"cmd":"info"}
@PR aabf0c13 {"seq":1,"ok":true,"protocol":1,"firmware":"1.2.0","board":"esp32c3","boot_id":2864434397,"formats":{"animation":["pixelart/1"],"playlist":["pixelart-playlist/1"]},"canvas":{"width":16,"height":16},"storage":{"total":1441792,"used":180224},"memory":{"free":182340,"largest":110580},"limits":{"line":1024,"chunk":512,"page":8,"animation":65536,"playlist":16384}}
```

| Field      | Meaning                                                                                                                                                                      |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `protocol` | The protocol version, `1`. A client reads it before anything else, see [Versions](#versions).                                                                                |
| `firmware` | The firmware version, see [Firmware version](#firmware-version).                                                                                                             |
| `board`    | The build: `esp32c3`, `esp32`, `esp32s3`, or `simulator`.                                                                                                                    |
| `boot_id`  | A random number from 0 to 4,294,967,295, chosen at every start. A change means the board restarted: any upload in progress is gone.                                          |
| `formats`  | The file format versions the board plays.                                                                                                                                    |
| `canvas`   | The matrix size.                                                                                                                                                             |
| `storage`  | `total` and `used` bytes of the file system that holds animations and playlists.                                                                                             |
| `memory`   | `free` bytes of memory and the `largest` block that can be allocated, for diagnosis. The simulator reports `0` for both, and `0` for both means the memory was not measured. |
| `limits`   | `line`: longest line the board reads; `chunk`: most bytes in one chunk; `page`: most entries in one `list` reply; `animation` and `playlist`: largest file.                  |

Clients take the limits from `info` instead of assuming the values of this document.

### `list`

The stored files of one kind, sorted by ID in byte order, one page at a time.

| Field   | Required | Meaning                                                             |
| ------- | -------- | ------------------------------------------------------------------- |
| `kind`  | yes      | `animation` or `playlist`.                                          |
| `after` | no       | An ID. The page starts with the first file whose ID sorts after it. |

The reply holds `kind`, `entries` (at most 8) and `more`, which is `true` when files remain after the last entry. The client asks for the next page with `after` set to the last ID it received. `after` does not have to name an existing file, but it must follow the ID rule.

Each entry has:

| Field     | Meaning                                                                                       |
| --------- | --------------------------------------------------------------------------------------------- |
| `id`      | The file ID.                                                                                  |
| `size`    | Size in bytes.                                                                                |
| `sha256`  | SHA-256 of the file, 64 lowercase hexadecimal digits.                                         |
| `name`    | Animations and playlists that have one: the `name` field of the file, at most 128 characters. |
| `version` | Animations only: the `version` field of the file, `1` when the file has none.                 |

Only files whose name is a valid ID followed by `.json` are listed. The `name` is cut after 128 characters, never inside a character, and any bytes that are not valid UTF-8 are replaced as described under [Lines](#lines) before it is cut. `name` and `version` are left out when the board cannot read them from the file, for example because the file is not valid JSON; such a file is still listed, so a client can see it and delete it. A file whose content cannot be read at all has no `sha256` either.

```text
@PR 88f98d70 {"seq":5,"cmd":"list","kind":"animation"}
@PR 19cac38c {"seq":5,"ok":true,"kind":"animation","entries":[{"id":"dot","size":147,"sha256":"3c878c7d9776ae2066e60d164ef9d7f3d245fd1a844ba99d76ce31162d8fb225","name":"Dot","version":1}],"more":false}
```

### `get`

Reads part of a stored file. Reads are independent of each other, so a client repeats a lost read by sending it again.

| Field    | Required | Meaning                                         |
| -------- | -------- | ----------------------------------------------- |
| `kind`   | yes      | `animation` or `playlist`.                      |
| `id`     | yes      | The file ID.                                    |
| `offset` | yes      | First byte to read, from 0 to the file size.    |
| `length` | yes      | Bytes to read, from 1 to the chunk limit (512). |

The reply holds `size` (the whole file), `offset`, and `data`: the bytes read, in standard base64 with padding. Fewer bytes than `length` come back at the end of the file, and none (`"data":""`) when `offset` equals the size. An `offset` past the end of the file is `bad_request`.

A file can change between two reads. A client that needs a consistent copy compares the SHA-256 of what it read with the one `list` reports.

### `put_begin`, `put_chunk`, `put_end`, `put_abort`

Upload one animation or playlist, replacing the stored file with the same ID, if any. See [Uploads](#uploads) for the whole sequence.

`put_begin` starts an upload:

| Field    | Required | Meaning                                                           |
| -------- | -------- | ----------------------------------------------------------------- |
| `kind`   | yes      | `animation` or `playlist`.                                        |
| `id`     | yes      | The file ID.                                                      |
| `size`   | yes      | Size of the whole file in bytes, from 1 to the limit of its kind. |
| `sha256` | yes      | SHA-256 of the whole file, 64 lowercase hexadecimal digits.       |

The reply on success holds nothing else.

`put_chunk` sends the next part of the file:

| Field    | Required | Meaning                                                                                   |
| -------- | -------- | ----------------------------------------------------------------------------------------- |
| `offset` | yes      | Position of these bytes in the file, see [Uploads](#uploads).                             |
| `data`   | yes      | The bytes, in standard base64 with padding: from 1 to the chunk limit (512) once decoded. |

The reply on success holds `received`, the number of bytes received so far.

`put_end` finishes the upload. It has no fields. The reply on success holds `warnings`, the engine's warnings for the new file (possibly empty).

`put_abort` cancels the upload in progress and removes the temporary file. It has no fields, and it succeeds even when no upload is in progress.

### `delete`

Removes a stored file. Fields `kind` and `id`. A missing file is `not_found`.

Deleting the active playlist is allowed: the board then plays every animation, as the [playlist specification](../format/playlist-v1.md#how-the-board-chooses-what-to-play) describes for a missing playlist.

### `settings_get`, `settings_set`

The board's settings. They live in the board's settings memory (NVS), not with the animations, so uploading or deleting files never changes them. The simulator keeps them in memory for the length of a run.

| Setting      | Type    | Default   | Meaning                                             |
| ------------ | ------- | --------- | --------------------------------------------------- |
| `brightness` | integer | `100`     | LED brightness, from 0 (off) to 255.                |
| `playlist`   | string  | `default` | ID of the active playlist, the one the board plays. |

`settings_get` has no fields. Its reply holds `settings`, an object with every setting.

`settings_set` has one optional field per setting, and at least one of them. The board checks every field before changing anything: a value out of range or of the wrong type is `bad_request`, a `playlist` that does not follow the ID rule is `invalid_id`, and a `playlist` that is not stored is `not_found`. If a setting cannot be saved, the reply is `storage_error` and no setting has changed. The one exception is a settings memory that fails twice: when the brightness cannot be saved and the previous playlist cannot be put back either, the reply is `storage_error` with a message that the settings may be partly changed, and the client reads them again with `settings_get`. On success the reply holds `settings`, with every setting after the change.

```text
> {"seq":9,"cmd":"settings_set","brightness":40}
< {"seq":9,"ok":true,"settings":{"brightness":40,"playlist":"default"}}
```

(This example and the later ones show the JSON only. On the link, each one is a full `@PR <crc> <json>` line.)

The active playlist can be deleted after it was set. The board then falls back as for a missing playlist, and the setting keeps its value, so uploading the playlist again makes it active again.

## Uploads

An upload goes through these steps, in order:

1. The client sends `put_begin` with the kind, ID, size and SHA-256 of the file. The board cancels any upload in progress, whether or not the new `put_begin` is accepted. It then checks the fields and the free space. It checks that its largest free memory block can hold the file and its parse, and replies `out_of_memory` without creating anything otherwise. Then it opens an empty temporary file, and keeps it open until the upload ends.
2. The client sends the file in chunks with `put_chunk`, in order, waiting for each reply before sending the next chunk. The board appends each chunk to the temporary file. A chunk that cannot be written cancels the upload and is answered with `storage_error`.
3. The client sends `put_end`. The board closes the temporary file and checks that it received exactly `size` bytes with the declared SHA-256. It checks the memory again, because it may have shrunk during the upload, and replies `out_of_memory` without trying otherwise. Then it validates the file with the engine, as it would before playing it.
4. If the file is valid, the board moves it over the stored file with the same ID in one atomic step, and replies with the warnings. If not, it removes the temporary file, keeps the stored file as it was, and replies with the error.

The upload ends at `put_end`, whatever its result, or at `put_abort`. A `put_chunk` or `put_end` without an upload in progress is `no_upload`. A malformed request is `bad_request` even without an upload: the board checks the fields of `put_chunk` (`offset` and `data`, including the base64) before it looks for an upload.

A client recovers from a failed upload like this:

- **`no_upload`, or a changed `info.boot_id`:** the upload is gone. The client starts again with `put_begin` from offset 0.
- **`bad_offset`:** the client resumes from `expected`.
- **No reply after its retries:** the client reports the failure, and sends `put_abort` once the link answers again.

The command line tool's retry budget (5 tries of 2 seconds) can reach the 10 second idle timeout, so `no_upload` after retries is expected. The tool restarts the upload from `put_begin` once, and then reports the failure.

The `offset` of a `put_chunk` is compared with the number of bytes received so far:

- **Equal:** the board appends the chunk.
- **Lower:** the chunk was already received, for example because its reply got lost. The board does not write it again and replies with the current `received`.
- **Higher:** bytes are missing. The board replies `bad_offset`, with the number of bytes received in `expected`, and the upload stays open. The client resumes from `expected`.

An already received chunk is therefore never written twice, even when the client changed `seq` before retrying.

The temporary file lives outside the animation and playlist folders, so the board never lists or plays it, and a stored file is never half written:

- **The client stops sending.** After 10 seconds without a `put_begin` or an accepted `put_chunk`, the board cancels the upload and removes the temporary file. A later `put_chunk` or `put_end` is `no_upload`. A dropped connection does not end an upload by itself: the upload stays open until it ends as described above (`put_end`, `put_abort`, a new `put_begin`, a failed chunk write, or this timeout), so the next client can continue it.
- **The board restarts during an upload.** It removes any leftover temporary file at boot.
- **The file is wrong.** `size_mismatch`, `checksum_mismatch` and `invalid_file` all leave the stored file untouched.

For a playlist, the board also checks its items against the stored animations: a missing animation is reported as an `unknown_animation` warning, and the playlist is still stored, because the animation can be uploaded afterwards.

The board needs free space for the whole new file while the old one still exists. It refuses an upload with `no_space` when the free space is smaller than `size` rounded up to the file system block (4,096 bytes).

A complete upload of a small animation:

```text
@PR 4b9e3a3e {"seq":2,"cmd":"put_begin","kind":"animation","id":"dot","size":147,"sha256":"3c878c7d9776ae2066e60d164ef9d7f3d245fd1a844ba99d76ce31162d8fb225"}
@PR efda5dd8 {"seq":2,"ok":true}
@PR 9d23a854 {"seq":3,"cmd":"put_chunk","offset":0,"data":"eyJmb3JtYXQiOiJwaXhlbGFydC8xIiwibmFtZSI6IkRvdCIsImNhbnZhcyI6eyJ3aWR0aCI6MTYsImhlaWdodCI6MTZ9LCJzcHJpdGVzIjp7ImRvdCI6eyJwb2ludHMiOltbNyw3LCIjZmYwMDAwIl1dfX0sInRpbWVsaW5lIjpbeyJzaG93IjpbImRvdCJdfV19"}
@PR 926df781 {"seq":3,"ok":true,"received":147}
@PR eff91e3c {"seq":4,"cmd":"put_end"}
@PR a0054623 {"seq":4,"ok":true,"warnings":[]}
```

The file is the 147 bytes:

```text
{"format":"pixelart/1","name":"Dot","canvas":{"width":16,"height":16},"sprites":{"dot":{"points":[[7,7,"#ff0000"]]}},"timeline":[{"show":["dot"]}]}
```

A rejected file replies like this (shortened):

```text
< {"seq":4,"ok":false,"error":"invalid_file","message":"the file is not a valid animation","diagnostics":[{"severity":"error","code":"unknown_color","where":"sprites.dot.points[0]","message":"unknown color \"gren\""}]}
```

## Playback while commands run

The board keeps playing its animations while it handles commands. It reads requests while it waits for the next frame, so a frame is shown at its normal time unless a command takes longer than the frame's wait. A slow command delays at most the frame being waited for; the following frames keep their original schedule. The slowest steps are validating a large file at `put_end` and sending a `list` page. On the ESP32-C3, measured, a `list` page of 8 files delays a frame by about a quarter of a second, and the `put_end` of a 64 KiB animation by about three quarters of a second.

Changes reach the matrix at these times:

- **`brightness`** applies from the next frame.
- **The active playlist,** and any upload or deletion of a playlist, applies when the current animation ends: the board then reads the active playlist again and starts it from its first item.
- **Animations** are read from storage each time they start, so an uploaded or deleted animation applies the next time the playlist reaches it. The animation playing at the moment finishes unchanged.

## Errors

| Code                | Meaning                                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------- |
| `bad_frame`         | The line is too long, its CRC is malformed or wrong, or its JSON is broken. The reply has no `seq`.         |
| `bad_request`       | A field is missing, unknown, of the wrong type or out of range, or the base64 data is invalid.              |
| `unknown_command`   | `cmd` names a command this firmware does not know.                                                          |
| `invalid_kind`      | `kind` is not `animation` or `playlist`.                                                                    |
| `invalid_id`        | `id`, `after` or the `playlist` setting does not follow the ID rule.                                        |
| `not_found`         | The named file is not stored.                                                                               |
| `too_large`         | The declared `size` is over the limit of its kind, or a chunk goes past the declared `size`.                |
| `no_space`          | Not enough free space for the upload.                                                                       |
| `no_upload`         | `put_chunk` or `put_end` without an upload in progress.                                                     |
| `bad_offset`        | `put_chunk` does not continue where the upload stands. `expected` holds the right offset.                   |
| `size_mismatch`     | At `put_end`, the bytes received differ from the declared `size`.                                           |
| `checksum_mismatch` | At `put_end`, the SHA-256 of the bytes received differs from the declared one.                              |
| `invalid_file`      | The engine rejects the file. `diagnostics` says why.                                                        |
| `out_of_memory`     | The board has not enough free memory to validate the file, at `put_begin` or `put_end`. Nothing is changed. |
| `storage_error`     | The file system failed to read, write, rename or remove a file. An upload in progress is cancelled.         |

Every error leaves the stored files and the settings as they were, except that a `storage_error` during `delete` may have removed the file.

## Limits

| Limit                                    | Value                 |
| ---------------------------------------- | --------------------- |
| Line read by the board, newline excluded | 1,024 bytes           |
| JSON nesting in a request                | 4 levels              |
| Chunk, decoded                           | 512 bytes             |
| Entries in one `list` reply              | 8                     |
| Uploads in progress                      | 1                     |
| Upload idle timeout                      | 10 seconds            |
| Animation file                           | 64 KiB (65,536 bytes) |
| Playlist file                            | 16 KiB (16,384 bytes) |

A 512-byte chunk is 684 characters in base64, which leaves room for the rest of the `put_chunk` line within 1,024 bytes. Lines sent by the board can be longer than 1,024 bytes; with at most 8 list entries and 32 diagnostics, they stay under 16 KiB, and clients accept lines up to that length.

## Versions

### Protocol version

`info` reports the protocol version. Version 1 can grow only by addition: new commands, new optional request fields, new reply fields, new error codes. A client that uses something newer than the board supports gets `unknown_command` or `bad_request`, and the board's state does not change. Removing or changing the meaning of anything makes a new version, protocol 2, and a client reads `info.protocol` before it sends anything else.

### Firmware version

`info.firmware` is set when the firmware is built, from the git tag:

- A build of a commit tagged `vX.Y.Z`, with no local changes, reports `X.Y.Z`.
- Any other build reports `<last tag>-dev.<commits since the tag>+g<commit>`, with `.dirty` at the end when there are local changes, for example `1.2.0-dev.3+gabc1234.dirty`. Without any tag, the last tag counts as `0.0.0`. Only tags of the form `vX.Y.Z` count: a tag with a suffix, such as `v1.2.3-rc1`, is ignored. When several such tags point at the same commit, the highest version counts, compared number by number (1.10.0 is higher than 1.2.0).
- A build made without git reports `0.0.0-unknown`.

## Security

The board treats every request as untrusted:

- It builds file paths only from `kind` and a valid `id`, so a request cannot reach any other file.
- Every size, count and nesting depth has a limit, checked before any memory is used for it: line length, JSON depth, chunk size, file size, upload count.
- Every uploaded file goes through the same engine validation as a file read from storage, and is stored only if it passes.
- Version 1 has no authentication: whoever can open the USB port, or connect to the simulator on the same computer, can change the board. Phase 4 adds authentication for WiFi.

## Conformance

The cases in `conformance/protocol/` describe exchanges of requests and expected replies, run in CI against the simulator. Every implementation of this protocol passes them. Each change to the protocol comes with new cases.
