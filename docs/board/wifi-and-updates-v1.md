# WiFi and updates, version 1

Status: **implemented** by the firmware, with simulator support for tests.

This document specifies how a PixelArt board joins a WiFi network, keeps its animations and firmware up to date from a release manifest, and speaks the [command protocol](../protocol/protocol-v1.md) over the network. Why it works this way is recorded in [ADR 0005](../adr/0005-wifi-and-updates.md). The protocol commands and settings it mentions are specified in the protocol document; the screens of the web app in the [web app specification](../web/web-app-v1.md).

## Flash layout

Every board and every release image uses this partition table (`partitions.csv`), for 4 MB of flash:

| Name      | Type | Subtype | Offset     | Size       | Content                                          |
| --------- | ---- | ------- | ---------- | ---------- | ------------------------------------------------ |
| `nvs`     | data | nvs     | `0x9000`   | `0x5000`   | Settings, WiFi credentials, token.               |
| `otadata` | data | ota     | `0xE000`   | `0x2000`   | Which firmware slot boots, and its state.        |
| `app0`    | app  | ota_0   | `0x10000`  | `0x180000` | Firmware slot A, 1.5 MiB.                        |
| `app1`    | app  | ota_1   | `0x190000` | `0x180000` | Firmware slot B, 1.5 MiB.                        |
| `spiffs`  | data | spiffs  | `0x310000` | `0xF0000`  | LittleFS with animations and playlists, 960 KiB. |

The file system partition keeps the name `spiffs`, as the Arduino core expects. The firmware formats it when it cannot mount it, so a board whose flash was erased starts with an empty file system and shows its built-in "no animations" image until it gets animations over USB or WiFi. A firmware update, over USB or WiFi, never writes this partition. The firmware is built with `-Os` and with Espressif's common certificate bundle ([Certificates](#certificates)), and takes about 1.37 MB on the ESP32-C3, the largest of the three boards, which leaves about 200 KB free in its slot. The release build refuses a firmware that leaves less than 64 KiB free, so a growing firmware is noticed long before it stops fitting. After the first release a layout change erases the animations of every board.

A board flashed with an older layout gets the new one with **Install from scratch** in the web app, which erases its animations and settings.

## Tasks and memory

The board runs two tasks:

- **The loop task** plays animations and runs every protocol request, whatever transport it came from, in the waits between frames, as the protocol specifies. It also validates downloaded files with the engine, renames them into place, and changes the settings.
- **The network task** runs WiFi, NTP, HTTPS downloads and the WebSocket server. It never touches the engine, the player or the settings. It writes a download only to a temporary file outside the animation and playlist folders, then hands the file to the loop task through a queue and waits for the result.

Requests that arrive over WiFi are passed to the loop task through the same queue, and their replies go back the same way. The serial port is read by the loop task, as before.

At most one large allocation exists at a time: a TLS connection (up to about 70 KB, mostly during its handshake; in one measured run of 31 HTTPS downloads in a row on an ESP32-C3, single handshakes reached about 81 KB with the WiFi traffic of the moment, and left 8.9 KB free) or the load of an animation or an uploaded file with its parse. Before the network task opens a TLS connection and before the loop task loads a file, each takes a shared lock. The network task waits for it as long as it takes. The loop task waits at most 2 seconds, because the network task holds it for a whole connection, which can last minutes on a slow link. When the wait ends, the loop task does not load: the player keeps the last frame on the matrix and tries again after 200 milliseconds, a `list` request is answered `out_of_memory`, and so is the validation of an uploaded file (`put_end`) or of a downloaded one, which then counts as a failed file or a failed download. The simulator has no network task, so it never waits. A download is finished and its connection closed before the loop task validates the file, so a TLS connection and a parse never overlap.

Every flash write from the network task (a temporary file, a firmware block) happens right after a frame was sent to the LEDs, so a write never overlaps `show()`. Checked by eye on an ESP32-C3 with a 16x16 panel: on WiFi, idle and with protocol traffic, the animations play cleanly; while animations and playlists are written to flash by an update (240 files in 2.5 minutes in the test), a few brief glitches show, judged acceptable; during a firmware installation the download icon and its progress bar show cleanly.

## WiFi

### Setup with Improv

The board implements [Improv Wi-Fi](https://www.improv-wifi.com/serial/) over its USB serial port, version 1, next to the protocol. The line reader recognizes the Improv header (`IMPROV` followed by the version byte) at any point between protocol lines, reads the whole frame by its length field, checks its checksum, and hands it to the Improv handler; a protocol line is never mistaken for an Improv frame, since protocol lines start with `@PR `. A frame with a wrong checksum is dropped, with the Improv error "invalid RPC packet". A frame that stops for 1 second is dropped, so a lost byte does not swallow the protocol lines after it.

The board supports these Improv commands:

| Command                    | What the board does                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Send WiFi settings         | Stores the network name and password in NVS, connects, and answers "provisioned" once it has an IP address.              |
| Request current state      | Answers "ready" (no network stored, or the stored one failed), "provisioning" (connecting) or "provisioned" (connected). |
| Request device information | Firmware `PixelArt`, its version, the chip (`ESP32-C3`, `ESP32`, `ESP32-S3`) and the device name.                        |
| Request scanned networks   | Scans and lists the networks it sees, with their signal and whether they need a password.                                |

When the connection fails, the board answers with the Improv error "unable to connect" after 30 seconds and keeps the new credentials, so a network that comes back later still works. The "provisioned" answer carries no URL.

The web app's WiFi screen and the ESP Web Tools install dialog both use Improv. The protocol command `wifi_forget` erases the stored network, over USB only. Its reply says that the network task has the request, not that the erase is done; when the request cannot be queued, the answer is `busy` and the network stays stored.

The board sends the name of the stored network in [`status`](../protocol/protocol-v1.md#status) (`wifi.ssid`) and never sends the password back, over any transport. It never writes either to its log. Over USB the name goes to any client. Over WiFi `status` follows the rule of every command: with the [network login](#protocol-over-wifi) on, only a client that has logged in gets it, and with the login off every client does. Bytes of the name that are not valid UTF-8 (the standard allows any bytes in a name of up to 32) are sent as U+FFFD, one for each byte that does not belong to a well-formed UTF-8 sequence, so the reply is always valid JSON. Credentials are stored in NVS in plain text: anyone who holds the board can read its flash.

### Connection

- **Hostname** `pixelart-XXXX`, where `XXXX` are the last four hexadecimal digits of the board's WiFi MAC address, lowercase. The board announces it with mDNS as `pixelart-XXXX.local`, with a `_pixelart._tcp` service on the port of the [WebSocket](#protocol-over-wifi).
- **Power saving** is off while connected, so the board answers quickly.
- **Reconnection.** When the connection drops, the board tries again after 1, 2, 4, 8, 16, 32 and then every 60 seconds, without restarting.
- **No address.** When the board joined the network but got no address from DHCP within 30 seconds, it reports `no_address`, disconnects, and tries again on the same schedule.

The connection states, reported by [`status`](../protocol/protocol-v1.md#status):

| State               | Meaning                                                               |
| ------------------- | --------------------------------------------------------------------- |
| `not_configured`    | No network is stored.                                                 |
| `connecting`        | Joining the network or waiting for an address.                        |
| `connected`         | Joined, with an IP address.                                           |
| `network_not_found` | The stored network is not in range or not on 2.4 GHz.                 |
| `wrong_password`    | The network refused the password.                                     |
| `no_address`        | Joined, but the network gave no IP address (see above).               |
| `disconnected`      | The connection dropped for another reason; the board is trying again. |

### Transmit power

The `wifi_power` setting takes `auto` (the default) or a fixed power: `8.5`, `11`, `13`, `15`, `17`, `18.5` or `19.5` dBm.

- **`auto`** connects at 19.5 dBm. When joining fails twice in a row at the WiFi level (not found, refused, or no answer from the access point), it uses 8.5 dBm until the next restart.
- **A fixed power** that fails to join three times in a row is replaced by 8.5 dBm until the next restart, and `status` reports `power_reduced: true`. The setting itself does not change.

Lower values exclude nothing a home network needs: 8.5 dBm is the value that works on ESP32-C3 SuperMini boards with weak antennas. Values below 8.5 dBm are not offered, because the link becomes unreliable. A new `wifi_power` value, or a new network, starts the count of failures again and ends the fallback.

The web app shows this legend next to the setting, with the signal strength the board reports:

- **Auto** is recommended. It starts at full power and lowers it by itself when the board cannot connect.
- Lower values give less range and draw less current. They help boards with a weak antenna, such as some ESP32-C3 SuperMini boards.
- If the board does not connect or keeps dropping the connection, choose 8.5 dBm.
- If the connection is stable but the signal is weak (below -75 dBm), try a higher value.
- Signal: -50 dBm or more is excellent, -50 to -67 dBm good, -67 to -75 dBm fair, below -75 dBm weak.

### Time

The board needs the time only for an install window narrower than the whole day. When the updates are not `off` and the window is narrower, it gets the time with SNTP from `pool.ntp.org` once connected, and again every 12 hours. Otherwise it does not ask for the time and `status` reports it as not known. The `timezone` setting is a POSIX TZ string, for example `CET-1CEST,M3.5.0,M10.5.0/3`; the web app sets it from the browser's time zone, and the board applies it to the local time its install window sees. `status` reports whether the time is known: after the first answer from the time server, and not before.

## Updates

### Settings

The update settings are protocol settings ([`settings_get`, `settings_set`](../protocol/protocol-v1.md#settings_get-settings_set)):

| Setting             | Default                                                  | Meaning                                                                               |
| ------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `update_mode`       | `automatic`                                              | `off`, `notify` or `automatic`, see below.                                            |
| `update_firmware`   | `true`                                                   | Whether firmware updates are checked and installed.                                   |
| `update_animations` | `true`                                                   | Whether animation and playlist updates are checked and installed.                     |
| `check_hours`       | `6`                                                      | Hours between two checks, from 1 to 168.                                              |
| `install_start`     | `0`                                                      | Start of the install window, minutes after midnight, from 0 to 1,439.                 |
| `install_end`       | `0`                                                      | End of the install window, in the same unit. Equal to `install_start`: the whole day. |
| `timezone`          | `UTC0`                                                   | POSIX TZ string for the install window, at most 64 characters.                        |
| `animation_source`  | `<site>manifest.json`, see [Site address](#site-address) | URL of the manifest the animations and playlists come from.                           |

The modes:

- **`off`:** the board never checks, by itself or on request. Updates come over USB only.
- **`notify`:** the board checks on schedule and on request, and reports what is available in `status`. It installs only when a client sends `update_install`.
- **`automatic`:** the board checks the same way and installs what is available, inside the install window. This is the default: a new board, and a board after a settings reset (`delete_all` with `settings: true`), installs updates by itself, and the install window is the whole day unless it is narrowed.

The default was `notify` in the first version of this specification and is `automatic` now, by the project owner's decision (see [ADR 0005](../adr/0005-wifi-and-updates.md)). The board stores a setting only when it differs from the value it holds, so the stored memory says whether a mode was ever chosen. A board updated from a firmware whose default was `notify` keeps a mode that is stored in its settings memory (`off`, `automatic`, or `notify` chosen after another mode). It reads `automatic` when no mode is stored, which is the case for a board left on `notify` and for one where `notify` was set while it already held `notify`; whoever wants `notify` on such a board sets it again, and it is then stored. The install window, the skip list, the rollback and the refusal of downgrades do not depend on the mode.

These settings change only through `settings_set` (over USB, or over WiFi when the [network login](#protocol-over-wifi) allows it). A manifest or a downloaded file can never change them.

### Checks

A check reads one or two manifests:

- **Firmware**, when `update_firmware` is on: the project's manifest, `<site>manifest.json` ([Site address](#site-address)). The URL is built into the firmware and is not a setting. A test build can replace it at build time (`-DPIXELART_FIRMWARE_MANIFEST=...`), and with `-DPIXELART_FIRMWARE_ALLOW_HTTP` added, which does nothing without the first flag, the firmware manifest and the firmware download may use `http://`, so a board test can run against a local server. Release firmware never allows it.
- **Animations**, when `update_animations` is on: the manifest at `animation_source`. When it is the same URL as the firmware manifest, the board reads it once.

The first check runs 5 minutes after the board first gets an address after a restart, then every `check_hours` hours, plus a random delay of up to 10 minutes so boards do not all ask at once. A client can ask for a check at once with `update_check`. A check that fails is retried after 30 minutes, then on the normal schedule.

The board reads a manifest over HTTPS, checking the server's certificate against its [certificate bundle](#certificates), and follows at most 3 redirects. `animation_source` may also be an `http://` URL, for a local test server; a URL with user information (`user:pass@host`) is refused, as a setting (`bad_request`) and as a manifest or file address, so a credential is never stored or sent; firmware manifests are HTTPS only, except in the test build described above. A manifest is refused (`bad_manifest`) when it is larger than 64 KiB, is not strict JSON, has a `format` other than `pixelart-manifest/1`, or lacks a field the board needs. File paths in a manifest are relative to its own URL, as the [manifest format](../format/manifest-v1.md) says. A path is refused (`bad_manifest`) unless it is made of parts joined by `/`, each part not empty, not `.` or `..`, and written with letters, digits, `.`, `_`, `-` and `+` only, at most 160 characters in all (a release made from a commit without a tag has a `+` in its version, and so in its file names): so an absolute path, a path with `..`, another host (`https://...` or `//host/...`), a query, a fragment, a backslash or a `%` is refused. A manifest is also refused when it lists more than 200 animations and playlists in all (the data partition holds fewer), an ID twice in one kind, a `sha256` that is not 64 lowercase hexadecimal digits, or a `size` below 1. The URL of a file is the folder of the `animation_source` URL followed by the path, whatever address a redirect led to when the manifest was read.

A check starts by forgetting what the last check found for animations and playlists (`update.files` becomes 0) and freeing that list, before it reads any manifest, and when the firmware manifest and `animation_source` are two addresses it reads the firmware manifest first: the list of files to install can take tens of kilobytes (about 41 KB for 170 files, measured on an ESP32-C3), and a TLS connection needs that room. When the manifest at `animation_source` cannot be read, `update.files` therefore stays 0 until a check reads it; when only the firmware manifest cannot be read, the files the animation manifest gave are listed as usual. The firmware a check found stays when a later check cannot read the firmware manifest.

A manifest request that is answered with status 404 (after its redirects) fails the check with `http_error` and the detail `no_release`: no release is published at that address yet, as before the first release of the project's Pages site, or a wrong `animation_source`. `status` reports the detail in `update.last_detail`, and the web app and the command line tool say it in words. Any other status, and any file (an animation, a playlist or a firmware) that is answered 404, is a plain `http_error` without the detail. The detail belongs to the last result: the next check or installation replaces it.

A manifest that does not fit in the board's free memory is refused with `out_of_memory`, and the check fails as any other. The board holds the whole manifest while its connection is open, so it needs the manifest's size and 16 KiB more next to the connection; then it parses it, frees the text once the parsed copy holds what it needs, builds the lists of files and of the firmware for its board kind, and moves the files to change into the plan of the update, each step only while 16 KiB stay free for the rest of the board. A manifest that lists more than 200 animations and playlists stays `bad_manifest`, whatever the memory. On an ESP32-C3 a manifest of 200 entries of about 40 KB fits when read over `http://` after a restart, and one padded to 64 KiB does not; a second check of the 40 KB manifest right after the first reads it again, since the first check's list of 170 files is freed, its buffer included, before the second reads anything, and a manifest of the release size (20 KiB, 67 entries) was read three times in a row. Over HTTPS the manifest has to fit next to the TLS connection as well: measured on an ESP32-C3 with WiFi connected, about 43 KB of heap is free once the connection is open and the headers are read, so the board reads a manifest of up to about 26 KB over HTTPS (25.6 KB was read, with the lowest free heap at about 14.8 KB while the body arrived, and 28.7 KB was refused with `out_of_memory`). A release therefore keeps its manifest at 20 KiB or less (see the [manifest format](../format/manifest-v1.md)); a manifest on your own `https://` server must stay as small, and a larger one is refused with `out_of_memory`, never read in part.

The board follows each redirect by hand (301, 302, 303, 307 and 308, at most 3): the target must be an `https://` URL or, when the source is `http://`, an `http://` URL, and a redirect from `https://` to `http://` is refused (`http_error`). The `firmware` list of a manifest is not needed for animation updates; a manifest without it is read as one with no firmware.

### Certificates

The board checks an HTTPS server's certificate against Espressif's common certificate bundle: the 43 roots that `cmn_crt_authorities.csv` of esp-idf v5.5.5 lists, out of the 150 of the full bundle the framework embeds. GitHub Pages, which serves the project's manifest and files, chains up to ISRG Root X1, one of them. An `https://` animation source on another server must use a certificate that chains up to one of these roots; otherwise every check fails with `tls_error`. `certs/README.md` says how the bundle is made and when it is made again, and CI checks that the GitHub Pages chain saved in `certs/` verifies against it.

### Animation updates

When `update_animations` is on, the server wins. For every animation of the manifest, then every playlist:

- **Not stored:** the board downloads it and adds it.
- **Stored with another SHA-256:** the board downloads it and replaces the stored file, even if it was edited on the board.
- **Stored with the same SHA-256:** nothing to do.

Stored files that the manifest does not list are never changed or removed. An animation deleted on the board comes back at the next update. What a check found for animations and playlists is forgotten when `animation_source` changes: `status` reports no files to install (`update.files` is 0) until the next check, and `update_install` with `target` `animations` answers `nothing_to_install`. A firmware found by the last check is kept, since it does not come from `animation_source`: `update.firmware` still shows it, `update_install` with `target` `firmware` still installs it, and an automatic installation of it still waits for its window.

`delete_all` stops an installation that is running or was asked for, so the files it removes are not stored again: the file being downloaded is discarded when it arrives, the files not yet stored are skipped, the files the last check found are forgotten, no failure is counted, and `last_result` stays as it was. A firmware installation goes on. An upload (`put_*`) during an installation is allowed; the installation may replace the uploaded file, since the server wins. To keep local changes, turn animation updates off.

Each file is downloaded on its own:

1. The network task downloads the file to `/update.tmp`, stopping as soon as it passes the manifest's `size` or the [limit of its kind](../protocol/protocol-v1.md#limits).
2. It checks the size and the SHA-256 against the manifest, closes the connection, and hands the file to the loop task.
3. The loop task validates it with the engine, exactly as `put_end` does, and renames it over the stored file in one atomic step. A file that fails is removed; the stored file stays as it was.

A failed file does not stop the update: the board goes on with the next one and reports the failures. A file is not downloaded when the free space is smaller than its size rounded up to the 4,096-byte block (`no_space`), or when the manifest gives a size over the limit of its kind (`invalid_file`: the engine would refuse it). A download fails with `network_error` when no byte arrives for 30 seconds, or when it takes longer than 30 seconds plus the time the file needs at 10 KiB per second (about 3 minutes for a firmware of 1.7 MB); the 30 seconds without a byte do not count the time spent writing to flash, but the total does, so a link slower than 10 KiB per second on average fails a large file. A download that ends before the size the manifest gives, or goes past it, fails with `network_error` or `checksum_mismatch`, and the temporary file is removed. A temporary file left by a restart is removed at boot. Animations go first, so a new playlist finds its animations. The playing animation finishes unchanged; a replaced animation plays the next time the playlist reaches it, as for an upload.

In `notify` mode, `status` reports how many animations and playlists would be added or replaced. After an update, it reports the files that failed, which are still to do.

`update_install` installs what the last check found. In `automatic` mode, a check that finds files outside the window leaves them waiting; when the window opens, the board checks again, so it installs from a current manifest. While it waits and the window is narrower than the whole day with the time unknown, `status` reports `waiting_for_time`. A board that has not got the time yet (see [Time](#time)) reports `waiting_for_time` for every window narrower than the whole day.

### Firmware updates

When `update_firmware` is on, a check also reads the project's manifest and looks in it for the entry with the board's own `board` and the `part` `app`. A firmware is **available** when that entry exists, its manifest's `version` is higher than the running firmware's by Semantic Versioning precedence, and the version is at most 64 characters. A development build (`1.2.0-dev.3+gabc1234`) is a pre-release, so the release `1.2.0` is an update for it. A lower or equal version is never installed over the network, with or without `force`; any version can be installed over USB.

A version on the skip list (see [Rollback](#rollback)) is reported as available, since `status` has to let a client offer it, but only an installation by request with `force: true` installs it: the board never installs it by itself, in any mode. The check ends the skip when the manifest holds a release newer than the skipped version, so that release installs like any other. The firmware found by the last check stays reported until a later check finds none, the switch is turned off or the mode is `off`.

In `notify` mode the board only reports the firmware in `status`. `update_install` with the target `firmware` installs it on request, ignoring the install window. In `automatic` mode, a check inside the window installs what it found: first the animations and playlists, as above, then the firmware, since the firmware ends with a restart. Outside the window, or while the time is not known and the window is narrower than the day, the firmware waits as the files do, and the board checks again when the window opens.

An installation:

1. The matrix stops the animation and shows the [update icon](#update-icon) with an empty progress bar. The board answers requests as before while it installs.
2. The network task checks that the image fits the inactive firmware slot: a firmware larger than the slot is refused with `flash_error` without a download. It then downloads the `app` file over HTTPS (never plain HTTP) and writes it, block by block, to the inactive slot, updating the progress bar. Each block is written right after a frame of the icon, so a write never overlaps `show()`. The SHA-256 is computed as the blocks arrive.
3. It checks the size and the SHA-256 against the manifest (`checksum_mismatch`) and then that the slot holds a valid firmware image (`flash_error`). On any failure before the boot slot changes, the boot slot stays as it was, the matrix returns to the animation, and `status` reports the error in `update.last_result`; the firmware stays available, so the installation can be repeated.
4. It stores the versions it goes from and to in NVS, marks the new slot to boot on trial, and restarts the board. When the record cannot be stored, the boot slot stays as it was and the installation fails with `flash_error`, because a rollback could not then skip the version.

The settings and the stored files are not touched. Only one update runs at a time: a request while a check or an installation runs is `busy`, and so is `update_install` for `firmware` while the running firmware is still on its trial boot (see [Rollback](#rollback)). In `automatic` mode, a check that finds the running firmware on trial installs no firmware; the next check does.

### Rollback

A new firmware boots on trial: the firmware overrides `verifyRollbackLater()`, so the bootloader's rollback stays armed after `setup()`. The new firmware confirms itself as valid once the file system is mounted, the settings are read and the first frame is shown, which normally takes a few seconds. A failure to read or store the record of the installation, or to mark the firmware valid, delays the confirmation as described below. If it restarts or crashes before that, the bootloader starts the previous firmware again at the next boot. A health check that fails without a crash (the file system cannot be mounted) marks the new firmware invalid and restarts at once. When the board cannot mark the new firmware valid, it records no `updated` result, logs the failure once, and tries again at the next frame, so the firmware stays on trial and rolls back at the next restart if the mark never works. When it cannot mark the new firmware invalid after a failed health check, it restarts anyway. The bootloader finds the firmware unconfirmed at the next boot and rolls back, and the previous firmware then finds the new slot marked invalid and puts the version on the skip list, as for any other rollback. The simulator's mark-failure seam (`sim_fail_marks`) exists for tests only.

The board keeps the installation in NVS from before the restart. The new firmware, while it is still on trial and just before it marks itself valid, stores that the installation booted. When that cannot be stored, for instance because another write of the record is running, it stays on trial and marks itself valid only after the evidence is stored. A store that finds another store running is tried again at the next frame; a store that fails is tried again after two seconds, so that a valid animation with frames of a minute confirms at the first frame after the store works again. The record of the installation is read at boot, and every value of it is read with a call that tells a missing value from an error. A namespace that does not exist yet (a new board, before its first installation) is an empty record, and the first installation creates it. A failed read of any value, not only of the whole namespace, makes the record unreadable. A value that exists but does not fit the longest version the board writes is a failed read, not an absent value: only a key that is not there is empty, so the evidence of a pending installation is never taken for missing. The firmware never takes an unreadable record for an empty one, and it never stores a record it did not read. The table gives the outcome of each case, and the code and the tests follow it.

| Boot                                                | Record     | Pending installation                      | Outcome                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------- | ---------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Any                                                 | Unreadable | Unknown                                   | Nothing is stored. No check offers a firmware, since the skip list is unknown, and no installation starts. The firmware reads the record again every two seconds of its running time, at a frame. The memory of the boot is empty: `status` shows no last installation.                                                                                                                                                                                                                                                                       |
| Trial                                               | Unreadable | Unknown                                   | The firmware stays on trial and is not confirmed. When the record is read, the row below applies. If it never is, the next restart rolls back.                                                                                                                                                                                                                                                                                                                                                                                                |
| Trial                                               | Readable   | None                                      | Not an installation over the network. The firmware marks itself valid and records nothing.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Trial                                               | Readable   | For the running version                   | The evidence is stored, then the firmware marks itself valid and records `updated`, as described below.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Trial                                               | Readable   | For another version                       | The firmware is not the installation that was recorded, so it is never reported as installed. It marks itself invalid and restarts, as for a failed health check; the previous firmware then records `rolled_back` and skips the recorded version.                                                                                                                                                                                                                                                                                            |
| After a rollback (the other slot is marked invalid) | Readable   | For the version that failed               | The rollback is stored: `rolled_back` with the versions, the version on the skip list, the pending installation dropped. The invalid mark is cleared after that. While the result cannot be stored, the boot stays unsettled: the record is not changed in memory, no installation starts, and the store is tried again every two seconds. While the mark cannot be cleared, the boot stays unsettled too: the result is stored and `status` shows it, no installation starts, and the board tries to clear the mark again every two seconds. |
| After a rollback                                    | Unreadable | Unknown                                   | As the first row. The invalid mark stays, and when the record is read, the rollback is stored before anything else.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Other boot (power lost or crash)                    | Readable   | Stored as booted, for the running version | The installation is recorded as `updated`, as the confirmation would have.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Other boot                                          | Readable   | Not booted, or for another version        | The pending installation is dropped without a result or a skip. A firmware flashed over USB is never reported as installed from its version number alone.                                                                                                                                                                                                                                                                                                                                                                                     |
| Other boot                                          | Readable   | None                                      | Nothing happens.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

While the boot is unsettled, which is while the record is unreadable, a rollback or confirmation of this boot is not stored, or the invalid mark of a rolled back slot is not cleared, a check reports no firmware, so `update_install` for `firmware` answers `nothing_to_install` and no installation starts. Beneath that reply, the board's own activation of a firmware image refuses to store a pending installation and leaves the boot slot as it is; a client does not get that refusal as a reply. A new pending installation is never stored next to an invalid mark of an earlier rollback, so a restart before the boot slot changes is never taken for a rollback of the new version. A board that is not on trial and cannot read the record leaves an invalid slot as it is, so the next boot reports the rollback if the record never could be read. Once the evidence is stored, the firmware marks itself valid and records the installation as `updated`, with the versions it went from and to, and ends the skip of its own version when that was on the list. The record is written value by value in a fixed order, the pending installation last, and a write that fails stops the rest, so the pending installation stays stored until the result and the skip are. When the result cannot be stored, the board tries again every two seconds of its running time, at a frame. A board that restarts before the result was stored finds the installation pending, stored as booted, and running the version it went to; it records `updated` at that boot, as the confirmation would have. A version number alone is never taken for proof: a firmware flashed over USB with the version of a pending installation that never booted is not reported as installed. The skip is the first value of the record, so it can already be gone when a later value of the result fails to store; the installation is still reported at the next boot, because its evidence and its pending record were stored before. Two stores never run at once, and each writes the record as it is when its turn comes, so an installation recorded while an earlier result is being stored is never lost. No installation starts while the running firmware is on trial: it ends at the first frame at which its evidence is stored and it has marked itself valid, which is normally the first frame, so the record of a trial is never replaced by another installation's. A check, a scheduled installation or an `update_install` for `firmware` that finds the running firmware on trial does not install; the next check or request, after the trial, does. After a rollback, the previous firmware finds the record of an installation it did not boot into and the new slot marked invalid. It then puts that version on its skip list in NVS and reports `rolled_back` in `status`, with the versions. A board that restarted after the record and before the switch has no invalid slot, and the record is dropped without a skip or a result. The skip list holds one version, the last that was rolled back: a newer release ends the skip, so a longer list would hold nothing that matters. Automatic installs skip the version on the list. `update_install` with `force: true` installs it, and when it holds on its trial the skip ends.

The last installation (`updated` or `rolled_back`, with its versions) stays in `status` until the next one. The bootloaders of the three boards are built with app rollback (`CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE`) in Arduino-ESP32 3.3.12.

Power lost during the trial boot also counts as a failure and rolls back. Rollback is always on; no setting turns it off.

### Install window

In `automatic` mode the board installs only inside the window from `install_start` to `install_end`, in `timezone`. A window whose end is before its start runs over midnight (for example 22:00 to 06:00). When the window is narrower than the whole day and the time is not known, the board does not install automatically and reports `waiting_for_time`. Checks run at any time. `update_install` ignores the window.

### Update icon

While firmware installs, the matrix shows a built-in icon instead of the animation, at the board's brightness setting: a cyan arrow pointing down into a gray tray, and a progress bar on the bottom row that fills from left to right in green. The loop task draws it, as often as every 25 milliseconds, from the progress the network task reports.

```text
row  0  ................
row  1  .......AA.......
row  2  .......AA.......
row  3  .......AA.......
row  4  .......AA.......
row  5  .......AA.......
row  6  ....AAAAAAAA....
row  7  .....AAAAAA.....
row  8  ......AAAA......
row  9  .......AA.......
row 10  ................
row 11  ..T..........T..
row 12  ..T..........T..
row 13  ..TTTTTTTTTTTT..
row 14  ................
row 15  PPPPPPPP........   (progress, here half done)
```

`A` is the arrow (`#00FFFF`), `T` the tray (`#808080`), `P` the filled part of the progress bar (`#00FF00`); the rest of row 15 is dark gray (`#202020`), and every other pixel is off. The bar fills `progress * 16 / 100` pixels, rounded down: 8 pixels at 50 percent, 15 at 99, all 16 at 100. The icon stays until the board restarts, or until the installation fails.

### Status

[`status`](../protocol/protocol-v1.md#status) reports the WiFi state, the name of the stored network and whether the time is known. It also reports whether a check or an installation is running and its progress (`installing` while firmware is written and until the board restarts). The update details include when the last check ran (seconds ago), its result and detail (`no_release`), the available firmware version, the number of animation and playlist changes waiting, and the result of the last firmware installation (`updated` or `rolled_back`, with the versions).

## Protocol over WiFi

The board serves the protocol on a WebSocket at `ws://<board>/ws`, port 80, with the framing of the [simulator's WebSocket](../protocol/protocol-v1.md#websocket-simulator): one protocol line per text message, the same line limit and close codes. The server is the ESP-IDF HTTP server (`esp_http_server`). It runs in its own task, which the network task starts when the board gets an address and stops when WiFi is lost, so the port is open only while the board is on a network.

- **One client at a time.** While a client holds the connection, a new one is refused with HTTP status 503, which the board writes as soon as it accepts the socket. A client holds it from its handshake until the connection ends, even while it sends nothing. A refused connection makes the board send a WebSocket ping to the holder, so any client on the network can start the check by being refused. A holder that sends nothing back within 3 seconds, a pong or any other frame, is closed when the next connection is refused. The ping is written without blocking, and a holder whose connection cannot take the 2-byte ping is closed at once, at the first refusal: its send buffer is full, so it has stopped reading (the board sends one reply per request). Only these two holders are closed. The web app and `tools/pixelart.py` wait the same way, 200, 400, 800, 1600 and 3200 ms between six tries (at about 0, 0.2, 0.6, 1.4, 3.0 and 6.2 seconds), which are spaced so that the first one starts the check, the one at 3.0 seconds closes the holder and the last one gets in. A holder that answers keeps the slot, and a second tab still gets 503. A new client in the slot always gets its own login wait, whatever socket number it has. If two handshakes arrive at the same moment, the second is accepted and closed at once with status 1013. USB keeps working at the same time; both reach the same loop task, one request at a time.
- **Origins.** The board accepts a connection only when its `Origin` header:
  - is missing (command line clients);
  - is the origin of the [site address](#site-address) the firmware was built with (`https://monska85.github.io` for the project's own build), without a port unless the address has one;
  - has the scheme `http` or `https`, any port, and a host that is `localhost`, ends in `.local`, or is an IPv4 address in `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16` or `127.0.0.0/8`, written as four decimal numbers without leading zeros.

  The header is compared as written, in lowercase, with nothing after the port: an upper case letter, a trailing dot, user information, a path, an IPv6 address and a name with an empty label are all refused. Any other origin, other host names included (for example `nas.lan`, which the board cannot check without DNS), is refused, so a website on the internet cannot change the board. The rule is plain C++ with native tests (`lib/PixelNet`).

- **Network login.** With the `network_login` setting off (the default), a WiFi client can send every command except those reserved for USB. With it on, a WiFi client must authenticate first: every command other than `info`, `auth_challenge` and `auth` is answered `unauthorized` until then. A client that is connected when the setting is turned on, even by itself, has to authenticate before its next request. See [Authentication](../protocol/protocol-v1.md#authentication).
- **USB only.** `wifi_forget`, `token_regenerate`, `cert_regenerate` and `delete_all` with `settings: true` work over USB only, and the token is never sent over WiFi. Over WiFi they are answered `usb_only`, except that before the login they are `unauthorized` like every other command. This firmware has no `cert_regenerate`: it answers `unknown_command`, over USB and over WiFi. A new token (`token_regenerate`, or `delete_all` with `settings: true`) closes the WiFi client with status 1008, since its login was made with the old token. So do 3 failed logins.

What differs from the simulator's WebSocket, because `esp_http_server` works that way:

- **A refused origin is a close, not a 403.** The server answers the WebSocket handshake before it runs the board's code. A connection whose origin is not allowed is therefore accepted and closed at once with status 1008, before any message of it is read or run. The 503 above is the only refusal that is an HTTP status. A request for `/` is answered with the [page](#the-page-at-) and a request for another path with a plain 404, and a request for `/ws` that is not a WebSocket handshake is 400.
- **Handshake time.** A request that stays incomplete is dropped after 5 seconds, as in the simulator. The server limits a request head to 1,024 bytes.
- **Closing.** The board sends its close frame and closes the connection without waiting for the client's close frame, and a client that was still sending may see the connection reset instead of the status. The client's own close frame is answered as RFC 6455 says.
- **Frames.** A client frame must be masked, as the standard says, or the connection closes with status 1002. A message that starts inside another one, or a continuation with nothing to continue, closes it with 1002. A pong is read and ignored, whenever it comes, even between the parts of a fragmented message; a control frame with more than 125 bytes closes the connection with 1002. The simulator's checks are made in the same order: too long (1009), then binary (1003), then invalid UTF-8 (1007), then a newline (1008); a frame that would take the message over the limit is refused before its payload is read.
- **Slow clients.** The board sends one reply at a time and waits at most 5 seconds for the client to take it, instead of queueing up to 256 KiB. It answers a line only when the loop task has answered the one before it, and closes the connection with status 1011 when the loop task has not answered within 20 seconds.
- **Silent connections.** The network task checks the open sockets about every 2 seconds while it is not inside a download, and closes two kinds. A socket that has not completed the WebSocket handshake within 10 seconds is closed, so silent TCP connections cannot fill the server's sockets and keep the owner out. With the network login on, the client that holds the slot is closed when it has not logged in within 30 seconds; the 30 seconds start when the connection opens, or when the login becomes required, and a login ends them. With the network login off, there is no limit.
- **Idle connections.** A client that is logged in, or that needs no login, and sends nothing keeps its place as long as it answers pings (the browser does it by itself), so the web app can stay connected while idle. A client that has gone away without closing (the network dropped) frees it after about 30 seconds, when the TCP keep-alive probes fail.

Memory: the server's own memory is small next to a TLS connection (a task stack of 5,120 bytes, a 1,024-byte message buffer and a queue of 3 messages), so a client that is connected keeps its connection while a download runs. The server is never started inside a download, since the network task, which starts it, also runs the downloads. While the network task holds the lock of the large allocations for a TLS connection, a new connection is refused with 503 like a second client, and the web app tries again; the network task never waits for a client.

The web app connects to `ws://`, and Chrome asks the user to allow access to the local network. This choice is checked with Chrome and Firefox against a test page on a public HTTPS site once the project's Pages site is live. If the test shows that browsers need TLS, a later change makes the board serve `wss://<board>/ws` on port 443 instead, with a self-signed certificate it creates at first start: an ECDSA P-256 key, valid for 10 years from its creation (from the firmware's build date when the time is not known), naming `pixelart-XXXX.local` and the board's address at that time. The web app then opens `https://<board>/` once in a new tab so the user can accept the certificate. `cert_regenerate`, over USB only, creates a new key and certificate.

### The page at `/`

A browser that opens the board's address gets a small page instead of an error. The texts and headers are plain C++ in `lib/PixelNet` (`net_page.h`), with native tests, and `src/ws_server_board.cpp` only sends them. `GET /` answers `200` with a fixed HTML page of a few hundred bytes, made once when the server starts from a constant in flash and the site address, so a request allocates nothing. It says that this is a PixelArt board and links to the web app at the [site address](#site-address) of the build (`https://monska85.github.io/PixelArt/` for the project's own build). It holds no script, no style and no image, form, frame or other resource, and nothing in it comes from the board (no hostname, address or version), so whoever reaches port 80 learns only that a PixelArt board answers there. The characters HTML treats specially in the address are written as entities. Every answer below carries these headers, which keep it inert:

- `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`: the answer loads nothing and cannot be framed.
- `X-Content-Type-Options: nosniff` and `Cache-Control: no-store`.
- `Connection: close`: the board closes the connection after the answer, so such a request never holds one of the server's sockets.

| Request                                 | Status                   | Content type                | Body                                       | Other        |
| --------------------------------------- | ------------------------ | --------------------------- | ------------------------------------------ | ------------ |
| `GET /`                                 | `200 OK`                 | `text/html; charset=utf-8`  | the page                                   |              |
| any other path, any method              | `404 Not Found`          | `text/plain; charset=utf-8` | `Not found`, without a line break          |              |
| a method other than `GET` on `/`, `/ws` | `405 Method Not Allowed` | `text/plain; charset=utf-8` | `Method not allowed`, without a line break | `Allow: GET` |
| `GET /ws`, not a WebSocket handshake    | `400 Bad Request`        | the server's own            | `WebSocket only`                           | unchanged    |
| `GET /ws`, a WebSocket handshake        | `101`, then the protocol | none                        | none                                       | unchanged    |

A query string is not part of the path, so `/?x=1` is the page. The server answers a WebSocket handshake itself and does not call the handler of `/ws` for it, so `/ws` is exactly as it was: the 400 for a plain `GET /ws` and every WebSocket rule above do not change. The 404 and the 405 are the answers of the server's error handlers for `HTTPD_404_NOT_FOUND` and `HTTPD_405_METHOD_NOT_ALLOWED`.

The page shares the rule of the connections. The board decides about a connection when it accepts the socket, before any byte is read, and it does not know the path yet: a connection is refused with 503 while a WebSocket client holds the slot, and while a TLS connection is open (the [lock of the large allocations](#tasks-and-memory), held while the board checks for or downloads an update). The page is therefore not shown while the web app is connected over WiFi, or while an update is checked or downloaded. A page request does not take the slot of the WebSocket client. The server is started with room for two URI handlers, `/ws` and `/`. The simulator has no page, since it has no HTTP server.

### Site address

The firmware has one site address, the place where the web app and the release manifest are published, fixed when it is built (`PIXELART_SITE_URL`, `include/site.h`). It is an `https://` address with a trailing slash, and the firmware takes from it:

- the firmware manifest, `<site>manifest.json`, which `PIXELART_FIRMWARE_MANIFEST` can still replace for a test build;
- the default of `animation_source`, the same manifest address;
- the link on the [page at `/`](#the-page-at-);
- the origin that the [origin check](#protocol-over-wifi) accepts for the web app.

The build computes it with `tools/site_url.py`, the first rule that applies: the environment variable `PIXELART_SITE_URL` (a custom domain), else in GitHub Actions `https://<owner in lowercase>.github.io/<repository>/` from `GITHUB_REPOSITORY` (`https://<owner>.github.io/` for a repository named `<owner>.github.io`), else the project's own `https://monska85.github.io/PixelArt/` for local builds. An address is normalized the way a browser writes an origin: the host is lowercased and an explicit port 443 is dropped (`https://Art.Example.com:443/` is `https://art.example.com/`), and the origin the board accepts follows the same rule. The address must be `https` with a host, an optional port and plain path segments (letters, digits, `.`, `_`, `~`, `-`), a trailing slash, and no user information, query or fragment, and short enough that `<site>manifest.json` is a valid `animation_source` (499 characters at most); a build with another value fails. A release build never allows `http`. Three checks of the release keep the firmware and the site address together, and each guarantees only this:

- **At the build** (`tools/release.py build`): every firmware image carries the manifest address of the site address computed for that build, or the build fails and nothing is released.
- **Before the deployment** (`tools/release.py check-site` on the address GitHub Pages announces for the repository): that address is the site address computed by the same rules in the deployment job, or the deployment stops and the site that is live stays as it was. It does not read the firmware images again: the deployed site holds the latest firmware release, which an earlier run may have built, so a site address changed between that build and this deployment (a new `PIXELART_SITE_URL`, a renamed repository) is not caught here.
- **After the deployment** (the same check on the address of the deployment itself): the site is live by then, so this check cannot stop a wrong site from being published. A failure marks the run as failed, so a maintainer sets `PIXELART_SITE_URL` to the address Pages serves and releases again.

## Security

- **Untrusted downloads.** Manifests and downloaded files are untrusted. Every limit of the protocol applies to them, every animation and playlist goes through the engine's validation, and nothing in them can change a setting.
- **Firmware source.** Firmware comes only from the project's manifest over HTTPS and must match its SHA-256. Custom firmware is installed over USB only.
- **Network access.** With network login off, anyone on the same network can change the board's files and settings, and start updates of the project's firmware. The web app says so next to the switch.
- **Token.** 16 characters from `a-z` and `0-9` (about 82 bits), made with the hardware random number generator at the first start (with the radio off, the board turns on the generator's entropy source for the draw and off again, never while WiFi starts), stored in NVS, readable with `settings_get` over USB only.
- **Physical access.** Whoever holds the board can read the WiFi password and the token from its flash, and can install any firmware over USB. This is accepted.

## Simulator and tests

- **Update logic** (reading a manifest, comparing versions and checksums, planning which files change, the install window, the skip list) is plain C++ shared by the board and the simulator, and has native tests.
- **The simulator** reports a fixed network in `status`: `wifi.ssid` is `PixelArt Simulator`, with the other fixed WiFi values (the [protocol specification](../protocol/protocol-v1.md#status) lists them). It has no stored network to erase, so `wifi_forget` changes nothing and `status` keeps reporting the same name and `connected`, as before: reporting `null` next to `connected` would contradict the rule that the name is `null` only when no network is stored. It fetches manifests and files from a folder given with `--update-source DIR`, with failure injection: a download cut halfway, a wrong checksum, an invalid file, a server that does not answer, a wrong version. Firmware slots and restarts are simulated, so the trial boot and the rollback run in the tests. The simulated board is named `simulator`, so a manifest needs a firmware entry with that `board` to offer it a firmware, and it reports the version of its build unless `--firmware-version VERSION` gives another. The firmware file is any bytes: the simulator checks its size and SHA-256 and does not run it, and the version it boots into is the manifest's. A restart makes the simulator start its sketch again, with the settings back to their defaults and the slots, the skip list and the record of the last installation kept, as in flash. A firmware on trial confirms itself at its first frame (the simulator's seams for a failed store, mark or read can delay that, for tests); `--update-trial fail` makes the health check of the first trial fail instead, so the board rolls back. A test that restarts the board before the first frame stands for a crash or a power loss.
  - The folder stands in for every server: the path of a URL is looked up in it, and when the folder has no copy of the folders of the path, the part after them is. A folder with the published site therefore answers for `https://monska85.github.io/PixelArt/manifest.json` and for its files. The host is not looked at, and a path with `..` is refused. A manifest that the folder does not have stands for a server that answers 404: the check fails with `http_error` and the detail `no_release`. A file that the folder does not have is a plain `http_error`, and so is `--update-fail http` for the manifest. Without `--update-source` the simulator reaches no server: a check fails with `network_error`, and it does not check on a schedule.
  - `--update-fail down` makes every request fail with `network_error`. `--update-fail KIND[:PATH]` makes the requests for the file `PATH` (or every file, without a path) fail: `tls` (`tls_error`), `http` (`http_error`), `cut` (the download ends halfway: `network_error`), `corrupt` (the first byte is changed: `checksum_mismatch`) and `too_long` (one byte too many: `checksum_mismatch`). The option can be repeated. An invalid file or a wrong manifest is made of files in the folder.
  - `--update-time HH:MM` sets the local time the install window sees, and `status` then reports the time as known. Without it the time is not known, as on a board that has not got the time yet. The simulator checks 5 minutes of virtual time after the start, as the board does after its first address.
  - `--ws-transport wifi` makes the simulator's WebSocket stand for the board's WiFi transport: the client is a WiFi client, with the network login when `network_login` is on, no token in `settings_get`, `usb_only` for the commands reserved for USB and a close with status 1008 after 3 failed logins or a new token. The serial port stays the USB transport and none of its traffic goes to the WebSocket, so the commands reserved for USB are only refused, never run. `--token TOKEN` gives the simulated board a token, 16 characters from `a-z` and `0-9`, instead of a new one at each start, so a client can log in. The origin rule of the simulator does not change.
- **Conformance cases** cover the new protocol commands and settings, written by hand from this specification.
- **The real board** is tested for WiFi setup, the update of animations and firmware from a local copy of the Pages manifest, a deliberately broken firmware rolled back by the bootloader, a long run for memory leaks, the LED panel during downloads and flash writes, and the loop task's stack as AGENTS.md requires.

## Limits

| Limit                   | Value                                                 |
| ----------------------- | ----------------------------------------------------- |
| Manifest                | 64 KiB (about 26 KB over HTTPS, 20 KiB for a release) |
| Files in a manifest     | 200 animations and playlists                          |
| File path in a manifest | 160 characters                                        |
| Redirects               | 3                                                     |
| `animation_source`      | 512 characters                                        |
| `timezone`              | 64 characters                                         |
| WiFi clients at a time  | 1                                                     |
| WiFi networks stored    | 1                                                     |
| Bands                   | 2.4 GHz only (the ESP32 chips)                        |
