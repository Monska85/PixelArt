# 7. Server-chosen playlists

Date: 2026-10-28

Status: accepted

## Context

A board plays one playlist, the one its `playlist` setting names, `default` unless a client changes it. To play Halloween animations in October and Christmas animations in December, someone has to change the setting on every board, twice a year. Content releases ([ADR 0006](0006-content-release.md)) already reach every board on WiFi without a firmware release, so the project could choose the season for every board, if the board knew what to play when.

Some facts shape the solution:

- **Backward compatibility comes first.** Boards running firmware 1.0.0 and 1.1.0, the web apps released with them and `tools/pixelart.py` speak protocol 1 and read manifest format 1. Protocol 1 can grow only by addition ([versions](../protocol/protocol-v1.md#versions)), and every reader ignores manifest fields it does not know (checked on the firmware 1.0.0 with `content_version`).
- **Older clients know only `playlist`.** An older web app shows it as "Active playlist" and sets it with `settings_set`. An older firmware, after a rollback, plays the playlist its stored `playlist` key names.
- **The time is optional.** A board asks for the time only for an install window narrower than the day, and may never get it (no WiFi, a blocked server). It must play something sensible without it.
- **The board is small.** The loop task that plays the animations and answers the protocol has a stack of 8 KB and checks its frame timing; any work it does at a switch must be bounded and short.
- **The user keeps the last word.** Some users want their own choice, whatever the season.

## Decision

1. **A new content file, the schedule** ([`pixelart-schedule/1`](../format/schedule-v1.md)). `content/schedules/default.yaml` is published as `schedules/default.json` in the content release, listed in a new optional `schedules` list of the manifest, installed by updates after the playlists, and uploadable over USB and WiFi with the new `schedule` kind. A schedule has a required `fallback` and up to 64 entries, each with a range of days (`from`, `to`, with the parts `year`, `month`, `day` in six accepted sets) and up to 8 playlists. The board plays only the schedule with the ID `default`; others are stored but not played, which leaves room for a schedule of the user's own later.
2. **One entry wins, by fixed rules.** For a date, more parts win, then the more important part, then the shorter range; a remaining tie is an error of the build tools, and a board takes the first tied entry in the file. The rules make a specific day (December 25) win over a season (December 1 to January 6), which wins over a month (December), without priorities to write by hand.
3. **Automatic or My playlists.** A new setting `play` chooses between `auto`, where the schedule decides, and `playlists`, where the board plays the user's own list, the new setting `playlists`, of 1 to 8 playlists played in turn. Automatic is the default.
4. **The old `playlist` setting stays, and means the same to older clients.** A board without a stored `play` derives it: `default` means Automatic, any other playlist means My playlists with that one, so an upgrade keeps every board's choice and writes nothing. `playlist` reports `default` in Automatic and the first of the user's playlists otherwise, and the board keeps its stored key equal to that, so a rollback plays what the user expects. An older client that sets `playlist` sets the mode with it.
5. **A list of playlists, played in turn, with a fallback chain.** The board computes a list (the winning entry's playlists, the schedule's `fallback`, or the user's list), plays each playlist in full, in order, and starts again. Missing playlists are skipped. In Automatic the chain goes on to `fallback`, then `default`, then every animation, then the "no animations" image; My playlists goes straight to every animation, as a missing active playlist did before.
6. **Without a schedule or without the time, the board plays what it played before.** With no valid schedule, the list is `[default]`. Without the time, it is the schedule's `fallback`. The first published schedule has `fallback: [default]`, and `default` keeps its items, so older boards, the simulator and Automatic outside the seasons play what they play today. A new `christmas` playlist holds the Christmas items.
7. **The board chooses again only at events,** and switches between animations. It resolves one date, at boot, when the time becomes known, at local midnight, when a playlist or schedule is stored or deleted, when `timezone` changes and when the play settings change. A new list takes effect when the current animation ends. The board never loops over years; only the build tools check every date for ties, limited to the years the dated entries cover plus one leap year and one common year.
8. **The time when the schedule needs it.** The board asks for the time when `play` is `auto` and a valid schedule is stored, or when a narrow install window needs it, from the new setting `ntp_server` (`pool.ntp.org` by default) every `time_sync_hours` hours (6 by default), which replaces the fixed 12-hour resync. The `timezone` setting gives the local date as it gives the local time of the install window. The project owner approved the extra contact with the time server on 2026-10-28, and the privacy texts of the web app say when the board makes it.
9. **The protocol grows only by addition.** The `schedule` kind, `info.formats.schedule` and `info.limits.schedule`, the four new settings, `status.play` and the `schedules` count of `delete_all` are new; nothing changes for an older client. A web app offers the new choices only to a board that reports `formats.schedule`, and falls back to "Active playlist" for an older one. The promise that every setting fits in one 1,024-byte `settings_set` is dropped: a client sends only the settings it changes.
10. **One resolver, two implementations, shared cases.** The firmware and the simulator use one C++ resolver; the web app has a TypeScript twin for its "now" and "next" view. Both pass the same hand-computed conformance rows.

## Alternatives considered

- **Changing `playlist` from the server.** The update could rewrite the setting, but a manifest must never change a setting ([WiFi and updates](../board/wifi-and-updates-v1.md#security)), and the user's own choice would be lost twice a year.
- **Dates inside the playlist file.** Each playlist could carry its season, but the board would have to read every playlist to choose, a playlist would carry two concerns, and `pixelart-playlist/1` would need a new version.
- **Explicit priorities on entries.** A number per entry decides any overlap, but every new entry means renumbering, and two equal numbers are a tie anyway. The fixed rules make the common cases, a day inside a season inside a month, work without one.
- **Several schedules played at once, or a schedule chosen by the user now.** Only `default` plays; a user's own schedule is left for a later change, and the stored schedules with other IDs leave room for it.
- **A new protocol version.** Protocol 2 would let `playlist` change meaning, but every older client would stop working with a new board, and every older board with a new client.
- **Asking for the time always.** Simpler, but a board in My playlists with no narrow window would contact a server it does not need.

## Consequences

- The project chooses the season for every board in Automatic with a content release, and a user who wants another choice picks My playlists in the web app.
- Older boards ignore the manifest's `schedules` and keep playing their `playlist`; older web apps and tools keep setting it, and on a new board their `default` means Automatic.
- A board in Automatic with a schedule contacts the time server, which it did before only for a narrow install window.
- The settings memory holds four more settings, and the longest `settings_set` no longer fits in one line, so a client that sends every setting at once must send them in parts.
- The board does a little more work at a switch: it reads the schedule and the playlists of the list, at most one date over 64 entries, between two animations. Its time, the frame timing and the loop task's stack are measured on a board before and after the change.
- The conformance suite gains schedule files, winner and resolver rows, and protocol cases with a local date.
