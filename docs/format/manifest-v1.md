# Release manifest `pixelart-manifest/1`

Status: **implemented** by `tools/release.py` and the release workflow (`.github/workflows/release.yml`).

Every release publishes a manifest that lists its firmware files, animations and playlists, with their sizes and SHA-256 checksums. The web app reads it to install firmware and offer animations. Boards will read it over WiFi to find what changed. Why releases work this way is recorded in [ADR 0002](../adr/0002-command-protocol.md).

The JSON Schema in [`schema/manifest-1.schema.json`](../../schema/manifest-1.schema.json) is the source of truth for the structure.

## Where it is published

CI publishes each release on GitHub Pages, at `https://monska85.github.io/PixelArt/`. Pages holds only the latest release. Every release, older ones included, is also kept as a GitHub Release. The GitHub Release holds `pixelart-site-<version>.zip`, an archive of the site with the same files and layout as the table below, so every path in `manifest.json` and the ESP Web Tools manifests resolves inside it. It also holds the `factory` image of each board as a separate file named `<board>-factory-<version>.bin`, for `esptool write_flash 0x0`. It holds nothing else.

| Path                                     | Content                                                                    |
| ---------------------------------------- | -------------------------------------------------------------------------- |
| `manifest.json`                          | This manifest.                                                             |
| `firmware/<board>/<part>-<version>.bin`  | The firmware files of each board, see [Firmware files](#firmware-files).   |
| `firmware/<board>/factory-<version>.bin` | Every part of a first install in one image, for `esptool write_flash 0x0`. |
| `firmware/install.json`                  | ESP Web Tools manifest for a first install, animations included.           |
| `firmware/update.json`                   | ESP Web Tools manifest for a firmware update that keeps the animations.    |
| `animations/<id>.json`                   | Every animation of the repository, as stored on a board.                   |
| `playlists/<id>.json`                    | Every playlist of the repository, as stored on a board.                    |

Paths in the manifest are relative to the manifest's own URL, so a copy of the files hosted elsewhere works without changes.

Firmware file names carry the release version. GitHub Pages lets browsers and proxies cache a file for 10 minutes, so a file that kept its name across releases could arrive stale and fail its checksum.

## Example

```json
{
  "format": "pixelart-manifest/1",
  "version": "1.2.0",
  "released": "2026-11-02",
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

| Field        | Meaning                                               |
| ------------ | ----------------------------------------------------- |
| `format`     | Always `pixelart-manifest/1` for this version.        |
| `version`    | The release version, the tag without its leading `v`. |
| `released`   | Release date, `YYYY-MM-DD`.                           |
| `firmware`   | Every firmware file, for every board.                 |
| `animations` | Every published animation.                            |
| `playlists`  | Every published playlist.                             |

Every file entry has `file` (its path), `size` (bytes) and `sha256` (64 lowercase hexadecimal digits). A client checks both before it uses a downloaded file.

Animation entries add `id`, `name` and `version`, read from the file. Playlist entries add `id`, and `name` when the playlist has one. A client compares `sha256` with the one the board reports in [`list`](../protocol/protocol-v1.md#list) to find which files changed.

## Firmware files

Each firmware entry adds `board` (`esp32c3`, `esp32`, `esp32s3`), `chip` (the ESP Web Tools chip family: `ESP32-C3`, `ESP32`, `ESP32-S3`), `part` and `offset`, the flash address the part is written to.

| `part`       | Content                                                                |
| ------------ | ---------------------------------------------------------------------- |
| `bootloader` | The second-stage bootloader.                                           |
| `partitions` | The partition table.                                                   |
| `boot_app0`  | The data that selects the first firmware slot at boot.                 |
| `app`        | The firmware itself. Phase 4 over-the-air updates use this file alone. |
| `filesystem` | A LittleFS image with the published animations and playlists.          |
| `factory`    | All the parts above in one image starting at address 0.                |

The parts are published separately because a firmware update must not touch the board's settings or animations. The settings memory sits between the partition table and `boot_app0`, and a merged image fills that gap with `0xFF`, which erases the settings. `update.json` lists `bootloader`, `partitions`, `boot_app0` and `app`; `install.json` adds `filesystem`. The `factory` image is meant for a first install from the command line: it erases the settings and the animations on the board, and puts the published animations there.

The offsets come from the build, not from this document: the bootloader is at `0x1000` on the ESP32 and at `0x0` on the ESP32-C3 and ESP32-S3, and the other parts follow the partition table.

## Changes to this format

New optional fields can be added within version 1, and clients ignore fields they do not know. Removing a field or changing its meaning needs `pixelart-manifest/2`.
