# Command protocol, version 1

Status: **implemented** by the firmware (`src/protocol.cpp`) and the simulator.

This document specifies how a client (the command line tool, the web app, a test) talks to a PixelArt board: reading what is stored, uploading and downloading animations and playlists, deleting them, and changing the board's settings. Why the protocol works this way is recorded in [ADR 0002](../adr/0002-command-protocol.md).

The protocol does not depend on the link. The board speaks it over its USB serial port and over a WebSocket on WiFi, and the simulator speaks it over a local WebSocket.

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

The simulator serves the protocol with `--ws [PORT]`, default port 8765, in real-time runs only. It starts `tools/ws_bridge.py`, which serves the WebSocket and passes the lines to the simulator, so `--ws` needs Python with the `websockets` package, version 15 or later. It listens on `127.0.0.1` only and serves one client at a time; a second connection is refused with HTTP status 503, as soon as it sends its opening request, until the first one closes.

- Every WebSocket text message carries exactly one protocol line, with the same framing as on the serial port and without the final newline.
- The 1,024-byte [line limit](#limits) counts the whole message, after the simulator reassembles it from fragments. A longer message closes the connection with status 1009. A binary message closes it with status 1003. A text message that contains a newline closes it with status 1008, and one that is not valid UTF-8 closes it with status 1007.
- The simulator accepts the WebSocket handshake on any request path.
- The simulator sends only protocol lines over the WebSocket. Clients still ignore any line without the protocol marker, as on the serial port.
- A connection that does not complete its opening handshake within 5 seconds is closed, and the closing handshake waits at most 1 second for the client. A client that leaves more than 256 KiB of replies or pongs unread is disconnected. Requests the simulator has not read yet are buffered up to a limit, after which the connection is not read, so a client that sends faster than the simulator reads has to wait.
- **Origin check.** Any web page can open a WebSocket to `localhost`, so the simulator accepts a connection only when its `Origin` header is missing (command line clients), is `http://localhost` or `http://127.0.0.1` with any port, or is `https://monska85.github.io`. `--ws-origin ORIGIN`, which can be repeated, adds another one. Any other origin is refused with HTTP status 403. This keeps a website you happen to visit from rewriting the simulator's files.
- Any other invalid handshake (a wrong method, a missing or unsupported header) gets the HTTP status the `websockets` package gives under the WebSocket standard. Clients must not rely on the body of a refusal, 403 and 503 included. A refused connection is closed right after the HTTP response.
- Malformed frames during the closing handshake are handled as RFC 6455 says. When the simulator stops, the client is closed with status 1001.
- A client that completed the handshake keeps the single slot until it disconnects, even while it sends nothing, so the web app can stay connected while idle.
- `--ws-transport wifi` makes the WebSocket stand for the board's WiFi transport, to test the network login and the commands reserved for USB without a board: see [WiFi and updates](../board/wifi-and-updates-v1.md#simulator-and-tests). The default is `usb`, with the behavior described here.

Uploads and deletions through the simulator change its data folder (`data/` or the folder given with `--data`). `make data` writes the converted repository files there again.

### WebSocket (board over WiFi)

A board connected to WiFi serves the protocol on a WebSocket, with the framing of the simulator's WebSocket above: one line per text message, the same limits and close codes, one client at a time. Its address, the accepted origins, what differs from the simulator and the network login are specified in [WiFi and updates](../board/wifi-and-updates-v1.md#protocol-over-wifi). A few commands are reserved for USB and answered `usb_only` over WiFi, and with network login on a WiFi client [authenticates](#authentication) first.

The WebSocket carries no checksum in its own right, but the lines keep theirs, and a client uses the same sequence numbers and retries as on the serial port. The board remembers the last reply of each transport separately, and forgets the one of the WiFi transport when a WiFi connection opens or closes, so a reply made for one client is never sent to the next.

## Lines

Every protocol message, in both directions, is one line:

```text
@PR <crc> <json>
```

- `@PR` followed by one space, at the very start of the line.
- `<crc>` is the CRC-32 of the `<json>` bytes, exactly as sent, written as 8 lowercase hexadecimal digits, followed by one space. The CRC is the common one used by zlib, PNG and Ethernet (polynomial `0x04C11DB7` reflected, initial value and final XOR `0xFFFFFFFF`). In Python it is `zlib.crc32(data)`.
- `<json>` is one JSON object in valid UTF-8, with no newline inside. It follows the same strict JSON rules as a file ([format specification](../format/pixelart-v1.md#files)): no comments, no single quotes, no unquoted keys, no control characters inside strings, no escaped surrogate that is not part of a pair, numbers only in the JSON forms, no U+0000 in a text, even written as `\u0000`, and nothing after the object.
- The line ends with `\n`. A `\r` just before the `\n` is ignored, so terminals that send `\r\n` work.

For example, the `info` request with sequence number 1:

```text
@PR 3c250228 {"seq":1,"cmd":"info"}
```

Every reply the board sends is valid UTF-8, whatever the files or the request contained. Text the board quotes from a stored file, an upload or a request (a list `name`, a diagnostic `where` or `message`, a message that names a field) is copied with every byte that is not part of a well-formed UTF-8 sequence replaced by U+FFFD, the replacement character, one for each such byte. Well-formed means the sequences of RFC 3629: no overlong forms, no surrogates and nothing above U+10FFFF. A control character in such a text (U+0001 to U+001F) is always written as a JSON escape (`\b`, `\f`, `\n`, `\r`, `\t` or `\u00XX`), never raw, so every reply follows the strict JSON rules above and the text arrives unchanged. A client can therefore always decode a reply, and a damaged file can always be listed and deleted.

The board ignores, without replying, every line that does not start with `@PR `. Log lines and typed noise therefore never run anything. The board writes every line it sends in one piece, so a protocol line never mixes with a log or mirror line.

The board answers with a `bad_frame` error, without `seq`, when a line starts with `@PR ` but:

- is longer than the line limit (the board drops the bytes up to the next newline);
- has a CRC that is not 8 lowercase hexadecimal digits, or that does not match the JSON;
- holds JSON that breaks the strict JSON rules above, is not an object, or nests deeper than 4 levels.

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

A request or its reply can be lost on the link. The client waits for the reply with a timeout (the command line tool waits 2 seconds, and 10 seconds for `put_end` and `delete_all`) and then sends the same request again, with the same `seq`, up to 5 times in all.

The board remembers its last reply on each transport, USB and WiFi, with the `seq` and the CRC of the request it answered; a request on one transport never replaces the reply remembered for the other. When a request arrives with the same `seq` and the same CRC as the last request on its transport, the board sends that reply again without running the command a second time. A file is therefore never committed twice. A request with the same `seq` but a different CRC is a new request and runs normally. The board forgets both replies when it restarts, and the WiFi one also when a WiFi connection opens or closes (see [WebSocket](#websocket-board-over-wifi)); `info.boot_id` lets a client notice a restart.

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

A file has at most 32 diagnostics, as the format specifications require. The board cuts `where` and `message` after 160 characters, or sooner when the text would take more than 192 bytes once written in JSON, never inside a character, so a reply with 32 diagnostics stays under 16 KiB.

## Commands

Every command that names a file uses two fields:

- `kind`: `animation` or `playlist`. Any other value is `invalid_kind`.
- `id`: the file ID, with the rule of the [format](../format/pixelart-v1.md#files): lowercase letters, digits, `_` and `-`, starting with a letter or digit, at most 32 characters. Any other value is `invalid_id`.

The board builds the path itself, `/animations/<id>.json` or `/playlists/<id>.json`. A client never sends a path.

### `info`

What the board is and what it supports. No fields.

```text
@PR 3c250228 {"seq":1,"cmd":"info"}
@PR 64db6cd1 {"seq":1,"ok":true,"protocol":1,"firmware":"1.2.0","board":"esp32c3","boot_id":2864434397,"formats":{"animation":["pixelart/1"],"playlist":["pixelart-playlist/1"]},"canvas":{"width":16,"height":16},"storage":{"total":983040,"used":180224},"memory":{"free":182340,"largest":110580},"limits":{"line":1024,"chunk":512,"page":8,"animation":65536,"playlist":16384}}
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

The reply holds `kind`, `entries` (at most 8) and `more`, which is `true` when files remain after the last entry. The client asks for the next page with `after` set to the last ID it received. `after` does not have to name an existing file, but it must follow the ID rule, and a value that is not text, `null` included, is `bad_request`. While an update holds the memory for more than 2 seconds, the board answers `out_of_memory`, over USB as over WiFi, and the client asks again later.

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

Upload one animation or playlist, replacing the stored file with the same ID, if any. See [Uploads](#uploads) for the whole sequence. While an upload is in progress, the four commands over the other transport than the one that began it are answered `busy`.

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

`put_abort` cancels the upload in progress and removes the temporary file. It has no fields, and it succeeds even when no upload is in progress. It is `busy` when the upload in progress belongs to the other transport.

### `delete`

Removes a stored file. Fields `kind` and `id`. A missing file is `not_found`.

Deleting the active playlist is allowed: the board then plays every animation, as the [playlist specification](../format/playlist-v1.md#how-the-board-chooses-what-to-play) describes for a missing playlist.

### `delete_all`

Removes every animation and every playlist, and, when asked, puts the settings back to their defaults. It has one optional field, `settings`: `true` or `false`, `false` when it is left out. Any other value, `null` included, is `bad_request`, and nothing changes.

The board first cancels an upload in progress, over either transport, and removes its temporary file. It also stops an installation of animations and playlists that is running or was asked for with `update_install`, so that the files it removes are not stored again: the file being downloaded is discarded, the files not yet stored are skipped, and the files the last check found are forgotten, so `update.files` and `update.failed_files` are 0 and `update.state` is `idle` at once. A stopped installation counts no failure and sets no `last_result`: it stays what it was. A new `update_check` finds the files again. An installation of firmware is not touched. Then it removes every file in `/playlists`, then every file in `/animations`, including files whose names are not valid IDs, so a damaged file can always be cleared.

Without `settings` (or with `false`) the settings do not change: the `playlist` setting keeps its value, so the board plays every animation until a playlist with that ID is stored again, and shows its built-in "no animations" image while there is none.

With `settings: true`, once every file is removed, every setting goes back to its default in the [settings tables](#settings_get-settings_set): brightness `100`, playlist `default`, and the defaults of the update, power and login settings. The board asks the network task to erase the stored WiFi network, as `wifi_forget` does, before it removes anything: when it cannot hand that request over, the answer is `busy`, nothing has changed, and the client repeats the command. Once every file is removed, a new token is made as by `token_regenerate` (and a new certificate as by `cert_regenerate`, where it exists). With `settings: true`, `delete_all` works over USB only; over WiFi it is `usb_only` and removes nothing. Without it, `delete_all` works over WiFi too. The playlist setting takes its default even though no playlist `default` is stored, which `settings_set` refuses. Saving follows the all or nothing rule of `settings_set`: the playlist is saved first and put back if the brightness cannot be saved.

The reply on success holds `playlists` and `animations`, the number of files removed from each folder, and with `settings: true` also `settings`, with every setting after the reset, as `settings_get` gives them. When a file cannot be removed, the board stops and replies `storage_error`; the files removed before it stay removed, the settings do not change, and sending `delete_all` again removes the rest. With `settings: true`, the stored WiFi network is already erased by then, since that request goes first. When every file is removed but the settings cannot be saved, the reply is `storage_error` too: the files stay removed and the settings are as they were, except when the settings memory fails twice, as for `settings_set`, and the message says the settings may be partly changed. Sending `delete_all` with `settings: true` again, as a new request, finishes the reset; the client can also read the settings with `settings_get`.

A board whose firmware is older than this field answers `bad_request` to `settings`, since a field the command does not define is an error, and removes nothing.

```text
> {"seq":12,"cmd":"delete_all"}
< {"seq":12,"ok":true,"playlists":1,"animations":30}
> {"seq":13,"cmd":"delete_all","settings":true}
< {"seq":13,"ok":true,"playlists":0,"animations":0,"settings":{"brightness":100,"playlist":"default",...}}
```

Removing many files takes time on the board, so the frame being waited for can be shown late, as for other slow commands (see [Playback while commands run](#playback-while-commands-run)).

### `settings_get`, `settings_set`

The board's settings. They live in the board's settings memory (NVS), not with the animations, so uploading or deleting files never changes them; only `delete_all` with `settings: true` puts them back to their defaults. The simulator keeps them in memory for the length of a run.

| Setting      | Type    | Default   | Meaning                                                                                                                                                                             |
| ------------ | ------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `brightness` | integer | `100`     | LED brightness, from 0 (off) to 255. It is the limit: the playing animation can lower it with its own `brightness` ([format](../format/pixelart-v1.md#brightness)), never raise it. |
| `playlist`   | string  | `default` | ID of the active playlist, the one the board plays.                                                                                                                                 |

The board also has these settings, specified in [WiFi and updates](../board/wifi-and-updates-v1.md):

| Setting             | Type    | Default                            | Values                                                                                      |
| ------------------- | ------- | ---------------------------------- | ------------------------------------------------------------------------------------------- |
| `wifi_power`        | string  | `auto`                             | `auto`, `8.5`, `11`, `13`, `15`, `17`, `18.5`, `19.5`.                                      |
| `update_mode`       | string  | `automatic`                        | `off`, `notify`, `automatic`.                                                               |
| `update_firmware`   | boolean | `true`                             | `true` or `false`.                                                                          |
| `update_animations` | boolean | `true`                             | `true` or `false`.                                                                          |
| `check_hours`       | integer | `6`                                | 1 to 168.                                                                                   |
| `install_start`     | integer | `0`                                | 0 to 1,439, minutes after midnight.                                                         |
| `install_end`       | integer | `0`                                | 0 to 1,439. Equal to `install_start`: the whole day.                                        |
| `timezone`          | string  | `UTC0`                             | A POSIX TZ string, 1 to 64 printable ASCII characters.                                      |
| `animation_source`  | string  | `<site>manifest.json` of the build | An `https://` or `http://` URL with a host, no user information, at most 512 characters.    |
| `network_login`     | boolean | `false`                            | `true` or `false`: whether WiFi clients must [authenticate](#authentication).               |
| `token`             | string  | made at first start                | Read only: 16 characters from `a-z` and `0-9`. See [`token_regenerate`](#token_regenerate). |

`<site>` is the site address the firmware was built with, `https://monska85.github.io/PixelArt/` for the project's own build ([site address](../board/wifi-and-updates-v1.md#site-address)), so a fork's boards update from the fork's release without a setting.

`settings_get` over USB includes `token`; over WiFi it leaves it out. `settings_set` with `token` is `bad_request`. A value that breaks the rules of its row is `bad_request`.

A `settings_set` that sets every setting to its longest value (a 32 character playlist ID, a 64 character time zone and a 512 character `animation_source`) is a line of 903 bytes, within the 1,024 byte limit of a request.

`settings_get` has no fields. Its reply holds `settings`, an object with every setting.

`settings_set` has one optional field per setting, and at least one of them. The board checks every field before changing anything: a value out of range or of the wrong type, `null` included, is `bad_request`, a `playlist` that does not follow the ID rule is `invalid_id`, and a `playlist` that is not stored is `not_found`. If a setting cannot be saved, the reply is `storage_error` and no setting has changed. The one exception is a settings memory that fails twice: when the brightness cannot be saved and the previous playlist cannot be put back either, the reply is `storage_error` with a message that the settings may be partly changed, and the client reads them again with `settings_get`. On success the reply holds `settings`, with every setting after the change.

```text
> {"seq":9,"cmd":"settings_set","brightness":40}
< {"seq":9,"ok":true,"settings":{"brightness":40,"playlist":"default",...}}
```

(This example and the later ones show the JSON only, and `...` stands for the other settings. On the link, each one is a full `@PR <crc> <json>` line.)

The active playlist can be deleted after it was set. The board then falls back as for a missing playlist, and the setting keeps its value, so uploading the playlist again makes it active again.

### `status`

The board's WiFi and update state, specified in [WiFi and updates](../board/wifi-and-updates-v1.md). No fields.

```text
> {"seq":20,"cmd":"status"}
< {"seq":20,"ok":true,"wifi":{"state":"connected","ip":"192.168.1.42","rssi":-58,"power":"19.5","power_reduced":false,"hostname":"pixelart-118c","ssid":"Example Home WiFi"},"time":{"known":true},"update":{"state":"idle","progress":0,"last_check":1200,"last_result":"ok","last_detail":null,"failed_files":0,"firmware":"1.3.0","files":3,"last_install":{"result":"updated","from":"1.2.0","to":"1.3.0"}}}
```

| Field                 | Meaning                                                                                                                                                                                                                                                                |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wifi.state`          | `not_configured`, `connecting`, `connected`, `network_not_found`, `wrong_password`, `no_address` or `disconnected`.                                                                                                                                                    |
| `wifi.ip`             | The board's IPv4 address, or `null` without one.                                                                                                                                                                                                                       |
| `wifi.rssi`           | Signal strength in dBm, or `null` when not joined.                                                                                                                                                                                                                     |
| `wifi.power`          | The transmit power in use, one of the fixed values of `wifi_power`.                                                                                                                                                                                                    |
| `wifi.power_reduced`  | `true` when the board fell back to 8.5 dBm.                                                                                                                                                                                                                            |
| `wifi.hostname`       | `pixelart-XXXX`, also its mDNS name without `.local`.                                                                                                                                                                                                                  |
| `wifi.ssid`           | The name of the stored network, text, or `null` when none is stored (`not_configured`). It is the name as stored, up to 32 bytes; bytes that are not valid UTF-8 are sent as U+FFFD, one for each byte that is not part of a well-formed sequence. See the note below. |
| `time.known`          | Whether the board knows the time: it asks for it only when the install window is narrower than the whole day.                                                                                                                                                          |
| `update.state`        | `idle`, `checking`, `downloading`, `installing` or `waiting_for_time`.                                                                                                                                                                                                 |
| `update.progress`     | From 0 to 100 while downloading or installing, `0` otherwise.                                                                                                                                                                                                          |
| `update.last_check`   | Seconds since the last check ended, or `null` when none ended since the board started.                                                                                                                                                                                 |
| `update.last_result`  | `ok`, or the [update error](#update-errors) of the last check or installation; `null` before the first one.                                                                                                                                                            |
| `update.last_detail`  | `no_release` when the last check failed because a manifest request was answered 404 (`last_result` is then `http_error`), `null` otherwise, and before the first check. See [update errors](#update-errors).                                                           |
| `update.failed_files` | How many files failed in the last animation update.                                                                                                                                                                                                                    |
| `update.firmware`     | The firmware version the last check found for this board, newer than the running one, or `null`. A version on the skip list is reported too: `last_install` then says `rolled_back` with the same `to`, and only `update_install` with `force` installs it.            |
| `update.files`        | How many animations and playlists would be added or replaced, as the last check found them. A check starts from 0, so it is 0 after a check that could not read the manifest at `animation_source`.                                                                    |
| `update.last_install` | `null`, or the last firmware installation: `result` (`updated` or `rolled_back`), `from` and `to` (versions). A firmware on its trial boot has not confirmed itself yet: it reports the installation before it, and `updated` once it has confirmed itself, normally at its first frame. When storing that it booted or marking itself valid fails, the confirmation waits and is tried again (see the [updates specification](../board/wifi-and-updates-v1.md#rollback)); a restart before it rolls the installation back.           |

The board reports the name of the stored network in `wifi.ssid` and never the password, over any transport. Over WiFi, `status` is a command like the others: with `network_login` on, a client that has not logged in gets `unauthorized`, so only a logged in client is sent the name, and with it off every client is. The simulator reports `connected`, the address `127.0.0.1`, `rssi` `-50`, the hostname `pixelart-sim` and the name `PixelArt Simulator`, and keeps reporting them after `wifi_forget`: it has no stored network to erase, and a `null` name next to `connected` would break the rule above. Its `wifi.power` follows the `wifi_power` setting (`19.5` for `auto`), and `time.known` is `false` unless the simulator was given a time with `--update-time`.

#### Update errors

| Code                | Meaning                                                                       |
| ------------------- | ----------------------------------------------------------------------------- |
| `network_error`     | The server could not be reached, or the connection dropped.                   |
| `tls_error`         | The server's certificate could not be checked.                                |
| `http_error`        | The server answered with a status other than 200.                             |
| `bad_manifest`      | The manifest is too large, not strict JSON, of another format, or incomplete. |
| `checksum_mismatch` | A downloaded file differs from the manifest's size or SHA-256.                |
| `invalid_file`      | A downloaded animation or playlist fails the engine's validation.             |
| `no_space`          | Not enough free space for a file.                                             |
| `out_of_memory`     | Not enough free memory for the connection, the manifest or the validation.    |
| `storage_error`     | The file system failed.                                                       |
| `flash_error`       | The firmware slot could not be written, or the image is larger than the slot. |

An `http_error` has a detail when the request that failed was for a manifest (the animation source or the firmware manifest) and the server answered 404, after any redirects: `status` then reports `update.last_detail` as `no_release`, meaning that no release is published at that address yet. A file (an animation, a playlist or a firmware) that is answered 404, and every other status of a manifest, is an `http_error` with `last_detail` `null`. The detail belongs to the last result: the next check or installation replaces it, and a success clears it. The simulator answers 404 for a manifest that its `--update-source` folder does not have, and for a file the folder does not have it answers a plain `http_error`.

### `update_check`

Starts a check at once, in the background. No fields. The reply comes before the check ends; `status` follows it.

It is `updates_off` when `update_mode` is `off` or both `update_firmware` and `update_animations` are `false`, `no_network` when the board is not connected, and `busy` when a check or an installation is running. The board tests them in this order. While the board has not settled its last boot (it cannot read the record of its installations, has not stored a rollback, or has not cleared the mark of the slot it rolled back from), a check finds no firmware: `update.firmware` stays `null` and `update_install` for `firmware` answers `nothing_to_install`. The board retries every two seconds, and a check made after it has settled finds the firmware as usual.

### `update_install`

Installs what the last check found, at once, ignoring the install window. The reply comes before the installation ends.

| Field    | Required | Meaning                                                                                    |
| -------- | -------- | ------------------------------------------------------------------------------------------ |
| `target` | yes      | `firmware` or `animations`.                                                                |
| `force`  | no       | `true` installs a firmware version on the skip list. `false` when left out. Firmware only. |

It is `updates_off` when `update_mode` is `off` or the switch of `target` is `false`, `no_network` and `busy` as for `update_check` (for `firmware`, `busy` is also the answer while the running firmware is still on its trial boot, which normally ends at its first frame and may last longer when its confirmation is delayed, before `nothing_to_install` is considered), and `nothing_to_install` when the last check found nothing for `target` (a check that is still running has found nothing yet: the answer is `busy`). The board tests them in this order. The `message` of the `busy` for a running trial says that the firmware is still confirming itself and that the request can be repeated after it has, so a client can tell it from a running check or installation; the text is not fixed. A field other than `target` and `force` is `bad_request`, as is a `target` that is not `firmware` or `animations` and a `force` that is not `true` or `false`; `force` is ignored for `animations`. The animations and playlists the last check found are stored as for an upload (`put_end`), one file at a time; `status` shows the progress, and the files that failed stay in `update.files`. What the last check found for animations and playlists is forgotten when `animation_source` changes (`update.files` becomes 0 until the next check, and `update_install` for `animations` answers `nothing_to_install`), while a firmware it found is kept, since it does not come from `animation_source`. The files are also forgotten when `delete_all` stops the installation (see [`delete_all`](#delete_all)). An upload (`put_*`) during an installation is allowed: the installation may replace the uploaded file, as the server wins at the next check. A firmware installation ends with a restart, which the client notices by a changed `info.boot_id`; while it runs, `update.state` is `installing` and `update.progress` counts the written part. An installation that fails leaves `update.last_result` set to the error, `update.state` back to `idle`, and the firmware still in `update.firmware`. `force` installs a version of the skip list, never a lower or equal version than the running one: for those the answer is `nothing_to_install`. For `firmware` the answer is also `nothing_to_install` when the last check found a skipped version and `force` is not `true`.

### `wifi_forget`

Erases the stored WiFi network and disconnects. No fields. USB only. The reply means that the network task has been asked to erase it, which it does when it has finished its current work (a scan, for one), and `status` reports no network at once. When the board cannot hand the request to the network task, the answer is `busy`, `status` still reports the network, and the client repeats the command.

### `token_regenerate`

Makes a new token, replacing the old one, and closes the WiFi client's connection. No fields. USB only. The reply holds `token`.

### `cert_regenerate`

Makes a new key and self-signed certificate for the WebSocket over TLS, and closes the WiFi client's connection. No fields. USB only. It exists only if a later firmware serves the WebSocket over TLS (see [WiFi and updates](../board/wifi-and-updates-v1.md#protocol-over-wifi)); the firmware of this version answers `unknown_command`.

### `auth_challenge`, `auth`

[Authentication](#authentication) for a WiFi client. `auth_challenge` has no fields; its reply holds `nonce`, 32 lowercase hexadecimal digits. `auth` has one field, `hmac`, 64 lowercase hexadecimal digits. Both also work over USB, where they are never needed.

## Uploads

An upload goes through these steps, in order:

1. The client sends `put_begin` with the kind, ID, size and SHA-256 of the file. The board holds one upload, which belongs to the transport whose `put_begin` started it. While it is in progress, `put_begin`, `put_chunk`, `put_end` and `put_abort` over the other transport are answered `busy`, before their fields are checked, until the upload ends: by `put_end`, by `put_abort` from its own transport, by a failed chunk write, or by the idle timeout below. Over its own transport, a new `put_begin` cancels the upload in progress, whether or not the new `put_begin` is accepted. It then checks the fields and the free space. It checks that its largest free memory block can hold the file and its parse, and replies `out_of_memory` without creating anything otherwise. Then it opens an empty temporary file, and keeps it open until the upload ends.
2. The client sends the file in chunks with `put_chunk`, in order, waiting for each reply before sending the next chunk. The board appends each chunk to the temporary file. A chunk that cannot be written cancels the upload and is answered with `storage_error`.
3. The client sends `put_end`. The board closes the temporary file and checks that it received exactly `size` bytes with the declared SHA-256. It checks the memory again, because it may have shrunk during the upload, and replies `out_of_memory` without trying otherwise. Then it validates the file with the engine, as it would before playing it; when an update connection holds the memory for more than 2 seconds, the reply is `out_of_memory` as well, and the client may upload again later.
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

- **The client stops sending.** After 10 seconds without a `put_begin` or an accepted `put_chunk`, the board cancels the upload and removes the temporary file. A later `put_chunk` or `put_end` is `no_upload`. A dropped connection does not end an upload by itself: the upload stays open until it ends as described above (`put_end`, `put_abort`, a new `put_begin`, a failed chunk write, or this timeout), so the next client over the same transport can continue it, while the other transport gets `busy` until the timeout.
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

- **`brightness`** applies from the next frame. The brightness the LEDs receive is the board setting lowered by the playing animation's own `brightness` ([format](../format/pixelart-v1.md#brightness)), so a change of the setting reaches the LEDs in that proportion.
- **The active playlist,** and any upload or deletion of a playlist, applies when the current animation ends: the board then reads the active playlist again and starts it from its first item.
- **Animations** are read from storage each time they start, so an uploaded or deleted animation applies the next time the playlist reaches it. The animation playing at the moment finishes unchanged. The same holds for animations and playlists installed by an [update](../board/wifi-and-updates-v1.md#animation-updates).
- **A firmware installation** stops the animation and shows the update icon until the board restarts, see [Firmware updates](../board/wifi-and-updates-v1.md#firmware-updates). Requests are still answered meanwhile.

## Errors

| Code                 | Meaning                                                                                                                                                        |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bad_frame`          | The line is too long, its CRC is malformed or wrong, or its JSON is broken. The reply has no `seq`.                                                            |
| `bad_request`        | A field is missing, unknown, of the wrong type or out of range, or the base64 data is invalid.                                                                 |
| `unknown_command`    | `cmd` names a command this firmware does not know.                                                                                                             |
| `invalid_kind`       | `kind` is not `animation` or `playlist`.                                                                                                                       |
| `invalid_id`         | `id`, `after` or the `playlist` setting does not follow the ID rule.                                                                                           |
| `not_found`          | The named file is not stored.                                                                                                                                  |
| `too_large`          | The declared `size` is over the limit of its kind, or a chunk goes past the declared `size`.                                                                   |
| `no_space`           | Not enough free space for the upload.                                                                                                                          |
| `no_upload`          | `put_chunk` or `put_end` without an upload in progress.                                                                                                        |
| `bad_offset`         | `put_chunk` does not continue where the upload stands. `expected` holds the right offset.                                                                      |
| `size_mismatch`      | At `put_end`, the bytes received differ from the declared `size`.                                                                                              |
| `checksum_mismatch`  | At `put_end`, the SHA-256 of the bytes received differs from the declared one.                                                                                 |
| `invalid_file`       | The engine rejects the file. `diagnostics` says why.                                                                                                           |
| `out_of_memory`      | The board has not enough free memory to validate the file, at `put_begin` or `put_end`, or an update holds the memory (`list`, `put_end`). Nothing is changed. |
| `storage_error`      | The file system failed to read, write, rename or remove a file. An upload in progress is cancelled.                                                            |
| `unauthorized`       | Over WiFi with network login on: the client has not authenticated, or `auth` failed.                                                                           |
| `usb_only`           | The command works over USB only.                                                                                                                               |
| `busy`               | A check or an installation is already running, the running firmware is still on trial and has not confirmed itself (`update_install` for `firmware`), or (`put_*`) an upload over the other transport is in progress, or (`wifi_forget`, `delete_all` with `settings: true`) the network task cannot take the request now.                                                 |
| `updates_off`        | Updates are off for what the command asks.                                                                                                                     |
| `no_network`         | The board is not connected to WiFi.                                                                                                                            |
| `nothing_to_install` | The last check found nothing to install for the `target`.                                                                                                      |

Every error leaves the stored files and the settings as they were (so a `busy` always means nothing changed, and the request can be repeated), except that a `storage_error` during `delete` may have removed the file, and a `storage_error` during `delete_all` does not bring back the files it removed before the failure (nor, with `settings: true`, the files when the settings then cannot be saved). One more exception: when the settings memory fails twice during `settings_set`, or during `delete_all` with `settings: true`, the settings may be partly changed, and the `storage_error` message says so (see [`settings_set`](#settings_get-settings_set)).

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
- Over USB and the simulator's WebSocket there is no authentication: whoever can open the USB port, or connect to the simulator on the same computer, can change the board.
- Over WiFi, the board accepts connections only from the origins listed in [WiFi and updates](../board/wifi-and-updates-v1.md#protocol-over-wifi). With network login off (the default), anyone on the network can send every command except those reserved for USB. With it on, a WiFi client authenticates first.

### Authentication

With `network_login` on, a WiFi client authenticates once per connection:

1. The client sends `auth_challenge`. The board answers with `nonce`: 16 random bytes from the hardware random number generator, as 32 lowercase hexadecimal digits. A new `auth_challenge` replaces the previous nonce.
2. The client sends `auth` with `hmac`: HMAC-SHA256 with the token's 16 ASCII bytes as the key and the nonce's 32 ASCII characters as the message, as 64 lowercase hexadecimal digits.
3. When it matches, the reply is `ok` and the connection is authenticated until it closes. When it does not, or no nonce is waiting, the reply is `unauthorized`. A nonce serves one `auth` only, right or wrong. After 3 failed `auth` on one connection, the board closes it.

A request with a missing, mistyped or malformed `hmac` (not 64 lowercase hexadecimal digits) is `bad_request`: it does not use the nonce and is not a failed login. A login that is tried when `network_login` is off works the same, and changes nothing for the commands.

The login belongs to the connection. A new connection starts without it, and so does a connection that is open when `network_login` is turned on. `token_regenerate`, and `delete_all` with `settings: true`, close the WiFi client, because they make a new token. Over USB, `auth_challenge` and `auth` answer the same way, with a login of their own that never closes anything and never logs in the WiFi client.

The token never crosses the network. Before authenticating, a WiFi client can send `info`, `auth_challenge` and `auth`; every other command is `unauthorized`, even a command reserved for USB or one the firmware does not know. The traffic itself is not encrypted with `ws://`; someone who can watch the network sees the requests and replies, and someone who can change them on the way can take over an authenticated connection.

For example, with the token `k3j9x0q7w2m5z8a1` and the nonce below (the HMAC comes from Python's `hmac.new(token, nonce, hashlib.sha256).hexdigest()`, an implementation independent of the board's):

```text
> {"seq":2,"cmd":"auth_challenge"}
< {"seq":2,"ok":true,"nonce":"000102030405060708090a0b0c0d0e0f"}
> {"seq":3,"cmd":"auth","hmac":"8a2422fe7ca97df26f5b82ca480c6f0362cb0e3eb9ebc9e8c0dd7467c28ffe23"}
< {"seq":3,"ok":true}
```

## Conformance

The cases in `conformance/protocol/` describe exchanges of requests and expected replies, run in CI against the simulator. Every implementation of this protocol passes them. Each change to the protocol comes with new cases.
