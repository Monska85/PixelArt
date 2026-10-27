# 2. A line-based command protocol, versioned firmware and releases on GitHub Pages

Date: 2026-10-19

Status: accepted

Note: decision 8 is replaced in part by [ADR 0004](0004-web-app.md), decision 5. The repository now has two release packages, the firmware and the web app. The firmware release itself is unchanged.

Note: decision 8 is replaced in part by [ADR 0006](0006-content-release.md) too. The animations and playlists are released as their own package, `content`, and the firmware release no longer publishes them.

Note: superseded in part by [ADR 0005](0005-wifi-and-updates.md). Decision 5 is carried out by its decision 10, the protocol over WiFi on a WebSocket served by the board. The last consequence, that authentication must come before the protocol runs over WiFi, is replaced by its decisions 10 and 11: a network login with a token, off by default.

## Context

The board plays animations stored in its file system, but only PlatformIO can change them today, by flashing a whole file system image. The web app planned in phase 3 must read what is on a board and change it from a browser, and boards will update themselves over WiFi in phase 4. Both need a way to talk to the board and a place to download firmware and animations from.

Some constraints shape the solution:

- The ESP32-C3 SuperMini talks to the computer over its native USB serial port. In a test on the real board, one long line sent just after boot arrived damaged. The driver keeps only 256 bytes in each direction by default and drops bytes when its buffer is full. The link must be assumed to lose or change bytes.
- On the same port, the driver can also hold the end of a long line until more output follows, so a reply can reach the computer seconds late.
- The same port carries the board's log lines and, in mirror builds, one `@PX` line per frame. Neither may break, and the monitor filter must keep working.
- The board plays animations with blocking waits on a single core, and the frames must keep their timing while commands run.
- The board has about 300 KB of RAM. An animation file can be 64 KiB, and anything that arrives over the link is untrusted.
- Browsers reach real serial ports through Web Serial, and they cannot open a pseudo serial port, so the simulator needs another transport for clients developed without a board.
- Browsers cannot download GitHub Release assets directly, because those downloads have no CORS headers.

## Decision

1. **A custom protocol, borrowing from existing ones.** One request and one reply per line, `@PR <crc> <json>`, in both directions. The CRC-32 of the JSON is always required. The board ignores lines without the marker and answers a damaged line with `bad_frame`; the next newline resynchronizes the link. The full rules are in the [protocol specification](../protocol/protocol-v1.md).
2. **Safe retries.** Every request carries a sequence number. The board remembers its last reply and sends it again, without running the command twice, when the same request arrives again. A chunk that was already received is acknowledged without being written again, as in MCUmgr's file upload. A client that loses a reply sends the same request again. The board uses large serial buffers and flushes the USB serial port after every reply line, and a client starts with an `info` handshake.
3. **Uploads in small acknowledged chunks.** A file goes to a temporary file in chunks of 512 bytes, one at a time, each acknowledged. At the end the board checks the size and SHA-256, validates the file with the engine and renames it over the stored file. A failed, rejected or abandoned upload never changes a stored file.
4. **Commands run between frames.** The waits between frames read and answer requests until the frame's deadline. Deadlines follow the original schedule, so a slow command delays one frame at most, and with no traffic the frames are exactly what they were.
5. **The protocol does not know its transport.** The board speaks it over USB serial. The simulator speaks it over a WebSocket on `127.0.0.1`, one line per message, and accepts connections only from local pages, command line clients and the project's GitHub Pages site. WiFi can carry the same lines in phase 4.
6. **Settings in NVS.** Brightness and the active playlist are settings, kept apart from the animation files.
7. **The firmware knows its version**, from `git describe` at build time: `X.Y.Z` for a clean tagged build, a development version otherwise.
8. **release-please makes releases.** It keeps a release pull request open from the conventional commits on `main`. Merging it creates the tag, the GitHub Release and the changelog. The same workflow then builds every board and publishes the firmware parts, the animations as JSON, and a [manifest](../format/manifest-v1.md) with SHA-256 checksums.
9. **GitHub Pages serves the latest release; GitHub Releases keep every release.** Pages sends CORS headers, so the web app and the boards can download from it directly.

## Alternatives considered

- **MCUmgr's Simple Management Protocol (SMP).** The closest existing standard: base64 lines with a marker that share the port with logs, a CRC, sequence numbers, and file upload and download by offset. Rejected because it has no server for the ESP32 Arduino core, encodes messages in CBOR, defines no WebSocket transport and has no Web Serial client, so the project would write both ends anyway. Its upload rules are borrowed.
- **Improv Serial.** The standard for WiFi setup from ESP Web Tools, but limited to WiFi credentials and device information. It comes in phase 4, next to this protocol.
- **JSON-RPC 2.0.** It defines messages but no transport or framing. The protocol keeps its ideas of a request number echoed in the reply and an error with a code and a message.
- **Binary framing (COBS or SLIP with binary payloads), XMODEM or ZMODEM.** About a third faster for uploads, since there is no base64. Rejected: they need binary data or a mode switch on a port shared with text logs, the lines are no longer readable in a terminal or a log, and the firmware, the web app and the tests all need more code. Animation files are small, so speed matters little.
- **An optional CRC, so requests can be typed by hand.** Rejected: a damaged line without a CRC could run a command. The command line client covers terminal use.
- **Larger chunks or several chunks in flight.** Faster, but they need larger serial buffers and more state on the board, a lost line costs more, and the failure cases are harder to test. A 64 KiB file in 512-byte chunks takes about 128 round trips, which is quick on USB.
- **A separate task for the protocol.** It would answer during long frames, but it needs locks around the file system and the player on a single-core chip. Rejected.
- **A non-blocking player driven from `loop()`.** Same result as handling commands in the waits, with a larger rewrite of the playback code and more risk of changing a frame.
- **Tagging releases by hand and writing the changelog by hand.** Simple, but easy to forget a step or a change. release-please writes the changelog from the commit messages the project already writes. Its changelog sections are mapped to the Keep a Changelog names (Added, Fixed, Changed), and the open release pull request takes the place of an `[Unreleased]` section.
- **One merged firmware image for updates.** Merging fills the gaps between parts with `0xFF`, and the gap after the partition table holds the settings, so every update would erase them. The parts are published separately; a merged image is kept only for first installs.
- **Publishing only on GitHub Releases.** Rejected because browsers cannot download the assets. Publishing only on Pages loses older versions, so releases keep them.
- **Keeping every version on Pages.** Each Pages deploy replaces the whole site, so every deploy would have to download and republish all older releases. Not needed yet.

## Consequences

- A client needs a CRC-32, SHA-256 and base64, all of which browsers and Python provide.
- The command line tool can manage a board from a terminal, and the web app can do the same over Web Serial, with one protocol implementation for the board and for the simulator.
- A frame can be shown late while the board validates an uploaded file.
- Sending a reply waits until the line has left the USB serial port. The slowest steps are validating a large file at `put_end` and sending a `list` page. On the ESP32-C3, measured, a `list` page of 8 files delays a frame by about a quarter of a second, and the `put_end` of a 64 KiB animation by about three quarters of a second. The frames after it keep their schedule.
- The board briefly holds an uploaded file and its parse in memory, next to the playing animation. If that does not fit, the upload fails with `out_of_memory` and nothing changes.
- The playlist specification changes: the board plays the active playlist, `default` unless changed, instead of always `default.json`.
- Version 1 has no authentication. Anyone with the USB port, or on the same computer as the simulator, can change the board. Phase 4 must add authentication before the protocol runs over WiFi.
- Every protocol change adds hand-written conformance cases, and the web app's implementation must pass them too.
- Pages must be set to deploy from GitHub Actions in the repository settings before the first release.
