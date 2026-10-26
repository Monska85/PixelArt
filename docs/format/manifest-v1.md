# Release manifest `pixelart-manifest/1`

Status: **implemented** by `tools/release.py` and the release workflow (`.github/workflows/release.yml`).

Every release publishes a manifest that lists its firmware files, animations and playlists, with their sizes and SHA-256 checksums. The web app reads it to install firmware and offer animations. Boards on WiFi read it to find what changed, as [WiFi and updates](../board/wifi-and-updates-v1.md#updates) describes. Why releases work this way is recorded in [ADR 0002](../adr/0002-command-protocol.md).

The JSON Schema in [`schema/manifest-1.schema.json`](../../schema/manifest-1.schema.json) is the source of truth for the structure.

## Where it is published

CI publishes each release on GitHub Pages, at `https://monska85.github.io/PixelArt/` for the project, or at the site address of a fork or custom domain (the firmware is built for that address, see [Site address](../board/wifi-and-updates-v1.md#site-address)); the paths below are relative to it. Pages holds only the latest release. Every release, older ones included, is also kept as a GitHub Release. The GitHub Release holds `pixelart-site-<version>.zip`, an archive of the site with the same files and layout as the table below, so every path in `manifest.json` and the ESP Web Tools manifests resolves inside it. It also holds the `factory` image of each board as a separate file named `<board>-factory-<version>.bin`, for `esptool write_flash 0x0`, and the firmware's third-party notices as `THIRD_PARTY_NOTICES.txt`. It holds nothing else. Its description ends with a line on the source code and the licenses: the tag, the repository, how to build the release again, and where the notices are.

| Path                                     | Content                                                                    |
| ---------------------------------------- | -------------------------------------------------------------------------- |
| `manifest.json`                          | This manifest.                                                             |
| `firmware/<board>/<part>-<version>.bin`  | The firmware files of each board, see [Firmware files](#firmware-files).   |
| `firmware/<board>/factory-<version>.bin` | Every part of a first install in one image, for `esptool write_flash 0x0`. |
| `firmware/install.json`                  | ESP Web Tools manifest for a first install, animations included.           |
| `firmware/update.json`                   | ESP Web Tools manifest for a firmware update that keeps the animations.    |
| `animations/<id>.json`                   | Every animation of the repository, as stored on a board.                   |
| `playlists/<id>.json`                    | Every playlist of the repository, as stored on a board.                    |
| `firmware/THIRD_PARTY_NOTICES.txt`       | The third-party notices of the firmware, see [Notices](#notices).          |

The same site also holds the web app at its root (`index.html` and `assets/`), which reads this manifest; see [Publishing](../web/web-app-v1.md#publishing).

Paths in the manifest are relative to the manifest's own URL, so a copy of the files hosted elsewhere works without changes.

Firmware file names carry the release version. GitHub Pages lets browsers and proxies cache a file for 10 minutes, so a file that kept its name across releases could arrive stale and fail its checksum.

## Example

```json
{
  "format": "pixelart-manifest/1",
  "version": "1.2.0",
  "released": "2026-11-02",
  "source": "https://github.com/Monska85/PixelArt/tree/v1.2.0",
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
  ]
}
```

## Fields

| Field        | Meaning                                                                                                                                                    |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format`     | Always `pixelart-manifest/1` for this version.                                                                                                             |
| `version`    | The release version, the tag without its leading `v`.                                                                                                      |
| `released`   | Release date, `YYYY-MM-DD`.                                                                                                                                |
| `source`     | Optional. Where the source code of the release is: the tree of its tag, or of its commit for a build without a tag. Boards and the web app do not read it. |
| `firmware`   | Every firmware file, for every board.                                                                                                                      |
| `animations` | Every published animation.                                                                                                                                 |
| `playlists`  | Every published playlist.                                                                                                                                  |

Every file entry has `file` (its path), `size` (bytes) and `sha256` (64 lowercase hexadecimal digits). A client checks both before it uses a downloaded file.

Animation entries add `id`, `name` and `version`, read from the file. Playlist entries add `id`, and `name` when the playlist has one. A client compares `sha256` with the one the board reports in [`list`](../protocol/protocol-v1.md#list) to find which files changed.

## Firmware files

Each firmware entry adds `board` (`esp32c3`, `esp32`, `esp32s3`), `chip` (the ESP Web Tools chip family: `ESP32-C3`, `ESP32`, `ESP32-S3`), `part` and `offset`, the flash address the part is written to.

| `part`       | Content                                                       |
| ------------ | ------------------------------------------------------------- |
| `bootloader` | The second-stage bootloader.                                  |
| `partitions` | The partition table.                                          |
| `boot_app0`  | The data that selects the first firmware slot at boot.        |
| `app`        | The firmware itself. Updates over WiFi use this file alone.   |
| `filesystem` | A LittleFS image with the published animations and playlists. |
| `factory`    | All the parts above in one image starting at address 0.       |

The parts are published separately because a firmware update must not touch the board's settings or animations. The settings memory sits between the partition table and `boot_app0`, and a merged image fills that gap with `0xFF`, which erases the settings. `update.json` lists `bootloader`, `partitions`, `boot_app0` and `app`; `install.json` adds `filesystem`. The `factory` image is meant for a first install from the command line: it erases the settings and the animations on the board, and puts the published animations there.

The offsets come from the build, not from this document: the bootloader is at `0x1000` on the ESP32 and at `0x0` on the ESP32-C3 and ESP32-S3, and the other parts follow the partition table.

## Notices

`firmware/THIRD_PARTY_NOTICES.txt` lists the third-party software each board's firmware links, with its version, license and source, followed by the full text of every license. The release build writes it with `tools/firmware_notices.py`, from the link map of each board: a library that is linked but not described in `LICENSES/firmware.json` fails the build, and so does a framework version other than the one the texts in `LICENSES/` were taken from (see `LICENSES/README.md`). The web app's own notices are at the root of the site, `THIRD_PARTY_NOTICES.txt` (see [Publishing](../web/web-app-v1.md#publishing)).

`source` was added after the first version of this format. It is optional and a reader that does not know it ignores it, as every reader ignores fields it does not know, so it does not change the format version.

## How a board reads it

A board reads the manifest at its `animation_source` as [WiFi and updates](../board/wifi-and-updates-v1.md#checks) describes. That specification lists every reason a board rejects a manifest as `bad_manifest`. `tools/release.py` refuses a release manifest over 20 KiB or with more than 200 animation and playlist entries. A board can read up to 64 KiB over `http://` and about 26 KB over HTTPS, so the release's 20 KiB limit leaves room for its TLS connection. With the release's indentation, about 67 entries fill 20 KiB, so the size limit is reached before the entry limit. Each ID may appear only once per kind. Each `file` path must be relative to the manifest URL, at most 160 characters long, and use only letters, digits, `.`, `_`, `-` and `+`. Relative paths let a copy of the release work when hosted elsewhere. Fields a board does not know are ignored.

## Changes to this format

New optional fields can be added within version 1, and clients ignore fields they do not know. Removing a field or changing its meaning needs `pixelart-manifest/2`.
