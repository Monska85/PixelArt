# 6. Animations and playlists released as their own content package

Date: 2026-10-27

Status: accepted

## Context

release-please manages two packages ([ADR 0004](0004-web-app.md), decision 5): the firmware, which is everything in the repository except `web/`, and the web app. The animations and playlists belong to the firmware package, so a commit that only adds an animation raises the firmware version, and the firmware release builds a LittleFS image with every animation and puts it into the first-install manifest of ESP Web Tools. Boards then see a new firmware that holds no new code, and a new animation waits for a firmware release.

Some facts shape the solution:

- Boards on WiFi already read animations and playlists from the manifest at their `animation_source`, apart from the firmware, and install them one file at a time ([WiFi and updates](../board/wifi-and-updates-v1.md#animation-updates)). A manifest without a `firmware` list is read as one with no firmware.
- The web app already installs published animations and playlists over USB or WiFi through its upload queue (the Library view).
- The firmware mounts LittleFS with format on failure, so a board whose file system partition is erased starts with an empty file system and shows its built-in "no animations" image.
- release-please gives a commit to a package when one of its files is under the package's path. A package has one path, so one package cannot cover the two folders `animations/` and `playlists/` at the root of the repository.

## Decision

1. **A third release-please package, `content`,** at `content/`, which now holds `content/animations/` and `content/playlists/`. Its tags are `content-vX.Y.Z`, its changelog `content/CHANGELOG.md`, and its first release is `content-v1.0.0`. The firmware package excludes `content/` and `web/`, so a firmware release happens only for firmware code. The web package is unchanged.
2. **The firmware release carries no animations, no playlists and no file system image.** Its ESP Web Tools manifest for a first install, `firmware/install.json`, writes the firmware parts only, like `firmware/update.json`, and offers to erase the board. The firmware formats the empty file system at its first boot, so no file system part is needed. The `factory` image holds the same parts.
3. **The release manifest names both versions** within format 1: `version` stays the firmware version, and a new optional field, `content_version`, gives the version of the content release whose animations and playlists it lists. `firmware` becomes optional, so a content release publishes a manifest of its own with no firmware, which a board can use as its `animation_source`. Every board accepts both changes, and so does every web app, except that a web app released before this change shows the content version as the firmware version on a site with a content release and no firmware release (see [Changes to this format](../format/manifest-v1.md#changes-to-this-format)).
4. **Pages is assembled from the latest firmware, web and content releases.** A release of any of the three, and the manual redeploy, downloads the latest archive of each and merges them. The root `manifest.json` takes its firmware fields from the firmware release and its animations and playlists from the content release.
5. **The web app installs the content right after a first install.** When the Install from scratch dialog of ESP Web Tools closes after a finished installation, the app opens the same USB port and installs every published animation and playlist through its upload queue. It is on by default, with a box to skip it. A board that misses this step shows the "no animations" image until it gets content over USB or WiFi.
6. **Local development keeps flashing both.** `make upload` and `just upload` flash the firmware and the content of the working tree, `upload-firmware` only the firmware, and `upload-data` is renamed `upload-content` and flashes only the content.
7. **Boards already flashed keep their animations.** A firmware update over USB or WiFi never writes the file system, as before.

This replaces in part [ADR 0004](0004-web-app.md), decisions 5 and 6, and [ADR 0002](0002-command-protocol.md), decision 8: there are three packages, and the firmware release no longer publishes the animations.

## Alternatives considered

- **Keeping the content in the firmware release.** Simplest, but every new animation would keep raising the firmware version and reflashing nothing new.
- **Two packages, `animations` and `playlists`, with linked versions.** release-please can keep them at one version, but each gets its own tag and changelog, and a playlist change would be released apart from the animations it names.
- **A new manifest format for the content.** It would let the content manifest drop `version`, but every reader would need a change, and a content manifest of format 1 already works with every board released and with every web app released, except in the case the [format document](../format/manifest-v1.md#changes-to-this-format) describes.
- **A filled file system image in the content release.** ESP Web Tools could write it at the first install, but the image is tied to the flash layout and the LittleFS version of the firmware, so the content release would depend on the firmware again.
- **An empty file system image in the firmware release.** It would make the first install write an empty, formatted file system. The firmware already formats the partition when it cannot mount it, so the image adds a file without adding a guarantee.

## Consequences

- An animation can be released without a firmware release, and boards on WiFi install it at their next check. A firmware release no longer changes the animations of any board.
- The site holds the latest of three releases, and a release of any of them redeploys it. Until the first content release, the site keeps the animations of the latest firmware release that carried them.
- The animations and playlists moved from the root of the repository to `content/`. Open pull requests that add files at the old paths need a rebase; Git moves the new files of a renamed folder on its own.
- A first install from the web app takes one more step after the firmware, and needs the board to stay connected. A board installed from the command line with the `factory` image gets its content over WiFi, from the web app or with `tools/pixelart.py`.
- A firmware built from a commit has no animations of its own on the site: a local release build that wants them builds the content too (`make release-site`).
