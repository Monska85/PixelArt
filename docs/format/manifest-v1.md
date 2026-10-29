# Release manifest `pixelart-manifest/1`

Status: **implemented** by `tools/release.py` and the release workflow (`.github/workflows/release.yml`).

The release manifest lists firmware files, animations, playlists, schedules and play files, with their sizes and SHA-256 checksums. The web app reads it to install firmware and offer animations. Boards on WiFi read it to find what changed, as [WiFi and updates](../board/wifi-and-updates-v1.md#updates) describes. Why releases work this way is recorded in [ADR 0002](../adr/0002-command-protocol.md); why the animations and playlists are released apart from the firmware, in [ADR 0006](../adr/0006-content-release.md); why schedules and the play file were added, in [ADR 0007](../adr/0007-server-chosen-playlists.md).

Three kinds of manifest use this format:

- **The firmware release** publishes one with its firmware files, empty `animations` and `playlists` lists, and no `schedules` and no `play`. Its `version` is the firmware version.
- **The content release** publishes one with its animations, playlists, schedules and play file (the `play` list, when the content has a [`play.yaml`](play-v1.md)), and no `firmware`. Its `version` and its `content_version` are both the content version.
- **The site** (GitHub Pages) serves the merge of the two, as [Assembling the site](#assembling-the-site) describes: `version` is the firmware version and `content_version` the content version.

The JSON Schema in [`schema/manifest-1.schema.json`](../../schema/manifest-1.schema.json) is the source of truth for the structure.

## Where it is published

CI publishes the releases on GitHub Pages, at `https://monska85.github.io/PixelArt/` for the project, or at the site address of a fork or custom domain (the firmware is built for that address, see [Site address](../board/wifi-and-updates-v1.md#site-address)); the paths below are relative to it. Pages holds only the latest firmware release, the latest content release and the latest web release. Every release, older ones included, is also kept as a GitHub Release:

- **A firmware release** (tag `vX.Y.Z`) holds `pixelart-site-<version>.zip`, an archive of its part of the site: its `manifest.json`, `firmware/` with every path of its manifests resolving inside it. It also holds the `factory` image of each board as a separate file named `<board>-factory-<version>.bin`, for `esptool write_flash 0x0`, and the firmware's third-party notices as `THIRD_PARTY_NOTICES.txt`. It holds nothing else.
- **A content release** (tag `content-vX.Y.Z`) holds `pixelart-content-<version>.zip`, an archive of its part of the site: its `manifest.json`, `animations/`, `playlists/`, `schedules/` and `play/`. It holds nothing else. A copy of this folder served anywhere is an animation source a board can use as it is.
- **A web release** (tag `web-vX.Y.Z`) holds the web app, see [Publishing](../web/web-app-v1.md#publishing).

The description of each release ends with a line on the source code and the licenses: the tag, the repository, how to build the release again, and, for the firmware and the web app, where the notices are.

The site:

| Path                                     | Content                                                                    |
| ---------------------------------------- | -------------------------------------------------------------------------- |
| `manifest.json`                          | This manifest, assembled from the firmware and the content releases.       |
| `firmware/<board>/<part>-<version>.bin`  | The firmware files of each board, see [Firmware files](#firmware-files).   |
| `firmware/<board>/factory-<version>.bin` | Every part of a first install in one image, for `esptool write_flash 0x0`. |
| `firmware/install.json`                  | ESP Web Tools manifest for a first install, with the offer to erase.       |
| `firmware/update.json`                   | ESP Web Tools manifest for a firmware update that keeps the animations.    |
| `animations/<id>.json`                   | Every animation of the content release, as stored on a board.              |
| `playlists/<id>.json`                    | Every playlist of the content release, as stored on a board.               |
| `schedules/<id>.json`                    | Every schedule of the content release, as stored on a board.               |
| `play/<id>.json`                         | The play file of the content release, as stored on a board.                |
| `firmware/THIRD_PARTY_NOTICES.txt`       | The third-party notices of the firmware, see [Notices](#notices).          |

The same site also holds the web app at its root (`index.html` and `assets/`), which reads this manifest; see [Publishing](../web/web-app-v1.md#publishing).

Paths in the manifest are relative to the manifest's own URL, so a copy of the files hosted elsewhere works without changes.

Firmware file names carry the release version. GitHub Pages lets browsers and proxies cache a file for 10 minutes, so a file that kept its name across releases could arrive stale and fail its checksum. Animation, playlist, schedule and play files keep their names, as a board stores them: a stale copy fails its checksum, and the board or the web app tries again at its next check or install.

## Assembling the site

A Pages deployment replaces the whole site, so every deployment merges the archives of the latest firmware release, the latest content release and the latest web release (`tools/release.py assemble`):

1. The firmware archive gives `firmware/` and, from its `manifest.json`, `version`, `released`, `source` and `firmware`.
2. The content archive gives `animations/`, `playlists/`, `schedules/`, `play/` and, from its `manifest.json`, the `animations`, `playlists`, `schedules` and `play` lists, and its `version`, which becomes `content_version`.
3. The web archive gives the web app.

The site's `manifest.json` is written from these fields, with `format` `pixelart-manifest/1`. A path that two archives both hold fails the assembly and nothing is written. When there is no content release, the site's manifest is the firmware release's manifest as it is; a firmware release published before the content package carries its own `animations/` and `playlists/`, which are then kept. When there is a content release, those folders and lists of an older firmware archive are left out. When there is no firmware release, the site's manifest is the content release's manifest as it is, with no `firmware`. The assembled manifest must stay within the limits of [How a board reads it](#how-a-board-reads-it), or the assembly fails.

## Example

```json
{
  "format": "pixelart-manifest/1",
  "version": "1.2.0",
  "released": "2026-11-02",
  "source": "https://github.com/Monska85/PixelArt/tree/v1.2.0",
  "content_version": "1.4.0",
  "firmware": [
    {
      "board": "esp32c3",
      "chip": "ESP32-C3",
      "part": "app",
      "offset": 65536,
      "file": "firmware/esp32c3/app-1.2.0.bin",
      "size": 365568,
      "sha256": "..."
    }
  ],
  "animations": [
    {
      "id": "xmas_tree",
      "name": "Christmas tree",
      "version": 1,
      "file": "animations/xmas_tree.json",
      "size": 1834,
      "sha256": "..."
    }
  ],
  "playlists": [
    {
      "id": "default",
      "name": "Default",
      "file": "playlists/default.json",
      "size": 912,
      "sha256": "..."
    }
  ],
  "schedules": [
    {
      "id": "seasons",
      "name": "Seasons",
      "file": "schedules/seasons.json",
      "size": 270,
      "sha256": "..."
    }
  ],
  "play": [
    {
      "id": "default",
      "file": "play/default.json",
      "size": 61,
      "sha256": "..."
    }
  ]
}
```

## Fields

| Field             | Meaning                                                                                                                                                                                                                                                                                                                       |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format`          | Always `pixelart-manifest/1` for this version.                                                                                                                                                                                                                                                                                |
| `version`         | The version of the release the manifest comes from: the firmware version (the tag without its leading `v`) in a firmware release and on the site, the content version in a content release. Boards compare it with their own.                                                                                                 |
| `released`        | Release date, `YYYY-MM-DD`.                                                                                                                                                                                                                                                                                                   |
| `source`          | Optional. Where the source code of the release is: the tree of its tag, or of its commit for a build without a tag. Boards and the web app do not read it.                                                                                                                                                                    |
| `content_version` | Optional. The version of the content release whose animations, playlists, schedules and play file the manifest lists, its tag without the leading `content-v`, a Semantic Version of at most 64 characters like `version`. Absent when the animations, playlists, schedules and play file do not come from a content release. |
| `firmware`        | Optional. Every firmware file, for every board. Absent in a content release; a reader takes a missing list as no firmware.                                                                                                                                                                                                    |
| `animations`      | Every published animation.                                                                                                                                                                                                                                                                                                    |
| `playlists`       | Every published playlist.                                                                                                                                                                                                                                                                                                     |
| `schedules`       | Optional. Every published [schedule](schedule-v1.md). A reader takes a missing list as no schedule.                                                                                                                                                                                                                           |
| `play`            | Optional. Every published [play file](play-v1.md): the release's choice of what Automatic plays. A reader takes a missing list as no play file.                                                                                                                                                                               |

Every file entry has `file` (its path), `size` (bytes) and `sha256` (64 lowercase hexadecimal digits). A client checks both before it uses a downloaded file.

Animation entries add `id`, `name` and `version`, read from the file. Playlist and schedule entries add `id`, and `name` when the file has one. Play entries have `id` only. A client compares `sha256` with the one the board reports in [`list`](../protocol/protocol-v1.md#list) to find which files changed.

## `play`

`play` lists the play files of the release: the one the project writes is `play/default.json`, built from [`content/play.yaml`](play-v1.md). The release tool lists it when `content/play.yaml` exists, and lists nothing otherwise. A board that checks the manifest installs it like the other files and uses it as its server choice ([WiFi and updates](../board/wifi-and-updates-v1.md#server-choice)). A manifest without `play` says that the release has no choice, and a board keeps the play file it stores.

## Firmware files

Each firmware entry adds `board` (`esp32c3`, `esp32`, `esp32s3`), `chip` (the ESP Web Tools chip family: `ESP32-C3`, `ESP32`, `ESP32-S3`), `part` and `offset`, the flash address the part is written to.

| `part`       | Content                                                                                                               |
| ------------ | --------------------------------------------------------------------------------------------------------------------- |
| `bootloader` | The second-stage bootloader.                                                                                          |
| `partitions` | The partition table.                                                                                                  |
| `boot_app0`  | The data that selects the first firmware slot at boot.                                                                |
| `app`        | The firmware itself. Updates over WiFi use this file alone.                                                           |
| `filesystem` | A LittleFS image with animations and playlists. Only firmware releases published before the content package carry it. |
| `factory`    | All the other parts of the release in one image starting at address 0.                                                |

The parts are published separately because a firmware update must not touch the board's settings or animations. The settings memory sits between the partition table and `boot_app0`, and a merged image fills that gap with `0xFF`, which erases the settings. `update.json` and `install.json` both list `bootloader`, `partitions`, `boot_app0` and `app`, and no file system: `update.json` never offers to erase the board, `install.json` does (`new_install_prompt_erase`). A firmware release publishes no `filesystem` part. After an erase the firmware formats the empty file system partition at its first boot, and the board shows its built-in "no animations" image until it gets animations over USB or WiFi; without the erase, the board keeps the files it stores. The `factory` image is meant for a first install from the command line: it holds `bootloader`, `partitions`, `boot_app0` and `app`, erases the settings on the board and leaves its file system partition as it is.

The offsets come from the build, not from this document: the bootloader is at `0x1000` on the ESP32 and at `0x0` on the ESP32-C3 and ESP32-S3, and the other parts follow the partition table.

## Notices

`firmware/THIRD_PARTY_NOTICES.txt` lists the third-party software each board's firmware links, with its version, license and source, followed by the full text of every license. The release build writes it with `tools/firmware_notices.py`, from the link map of each board: a library that is linked but not described in `LICENSES/firmware.json` fails the build, and so does a framework version other than the one the texts in `LICENSES/` were taken from (see `LICENSES/README.md`). The web app's own notices are at the root of the site, `THIRD_PARTY_NOTICES.txt` (see [Publishing](../web/web-app-v1.md#publishing)).

## How a board reads it

A board reads the manifest at its `animation_source` as [WiFi and updates](../board/wifi-and-updates-v1.md#checks) describes, and the firmware manifest at the site address. That specification lists every reason a board rejects a manifest as `bad_manifest`. `tools/release.py` refuses a manifest over 20 KiB or with more than 200 animation, playlist, schedule and play entries in all, whether it writes it for a firmware release, a content release or the site. It writes only the generated `manifest.json` as compact JSON, so more entries fit without changing the format or the byte limit; repository source files and the other JSON written by the release tool keep their existing formatting. A board can read up to 64 KiB over `http://` and about 26 KB over HTTPS, so the release's 20 KiB limit leaves room for its TLS connection. The size limit can still be reached before the entry limit. Each ID may appear only once per kind. A board installs the animations first, then the playlists, then the schedules, then the play files, so a playlist finds its animations, a schedule its playlists and a play file its schedule or playlists ([Animation updates](../board/wifi-and-updates-v1.md#animation-updates)). Each `file` path must be relative to the manifest URL, at most 160 characters long, and use only letters, digits, `.`, `_`, `-` and `+`. Relative paths let a copy of the release work when hosted elsewhere. Fields a board does not know are ignored.

## Changes to this format

New optional fields can be added within version 1, and clients ignore fields they do not know. Removing a field or changing its meaning needs `pixelart-manifest/2`.

`source` and `content_version` were added after the first version of this format. They are optional and a reader that does not know them ignores them, as every reader ignores fields it does not know, so they do not change the format version. `firmware` was required in the first version and is optional now. Boards already read a manifest without it as one with no firmware.

`play` was added with the choice of schedules by the server, together with the play file. It is optional, with entries like those of `schedules`, and the boards and web apps released before it ignore it, as they ignore every field they do not know. The 200-entry limit counts play files too.

`schedules` was added with [schedules](schedule-v1.md). It is optional, and the boards and web apps released before it ignore it, as they ignore every field they do not know (checked on the firmware 1.0.0 with `content_version`): such a board installs the animations and playlists of the manifest and never a schedule, and keeps playing its `playlist` setting. The 200-entry limit counts schedules too: a board that knows schedules refuses (`bad_manifest`) a manifest with more than 200 animations, playlists and schedules in all, while an older board counts only the animations and playlists. The release's 20 KiB limit keeps every published manifest far below 200 entries. A web app released before this change does not check `firmware`, so on a site with a content release and no firmware release it would show the content version as the firmware version. This cannot happen on the project's site, which has a firmware release and always serves the newest web app with the content. A web app that knows this change says that no firmware release is published when the site's manifest has no firmware entry.
