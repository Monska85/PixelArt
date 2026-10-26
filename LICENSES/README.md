# Third-party license texts

PixelArt is licensed under GPL-3.0-or-later with the additional permission in [`LICENSE-EXCEPTION`](../LICENSE-EXCEPTION), see [License](../README.md#license). This folder holds the license texts of third-party software that the release ships in its notices and that the build inputs do not carry, in the place the [REUSE specification](https://reuse.software/spec/) gives license texts. Most of them carry the copyright line of their own project, so they are named after the project and grouped by what ships them: `firmware/` for the firmware, `web/` for the web app.

## Firmware

`tools/firmware_notices.py` writes `firmware/THIRD_PARTY_NOTICES.txt` into the release site, called by `tools/release.py build` (`make release-firmware`, `make release-site`). It reads the link map (`firmware.map`) of each board, so it lists what the firmware really links, and it:

- names every linked archive with a section of [`firmware.json`](firmware.json), with its license, its source and the files of its license text. The release fails if no section names an archive, so a new dependency cannot be shipped without its notice.
- reads the versions from the build: ESP-IDF and the managed components from `versions.txt` of the framework's library package, Arduino-ESP32 from that package's `package.json`, the compiler from its own `package.json`, and each PlatformIO library from its `library.json` or `library.properties`.
- fails when the build uses another ESP-IDF, Arduino-ESP32 or component version than `pins` in `firmware.json`: the texts in `firmware/` were taken from those versions.
- takes the texts of the PlatformIO libraries (Adafruit GFX, NeoMatrix, NeoPixel, ArduinoJson) from the libraries themselves, and those of newlib and of the GCC runtime from the compiler package (`share/licenses/`), so they always match the build.
- lists a library that has no archive of its own (ArduinoJson, headers only) when a library of the project that is linked depends on it in its `library.json`.

The texts in `firmware/`, taken on 2026-10-25:

| File                           | From                                                                                                             |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `arduino-esp32.LICENSE.md`     | `LICENSE.md` of espressif/arduino-esp32 at tag 3.3.12                                                            |
| `esp-idf.LICENSE`              | `LICENSE` of espressif/esp-idf at tag v5.5.5; the binary libraries, mdns and esp_diagnostics carry the same text |
| `wpa_supplicant.COPYING`       | `components/wpa_supplicant/COPYING` and the License part of its `README`, ESP-IDF v5.5.5                         |
| `FreeRTOS-Kernel.LICENSE.md`   | `components/freertos/FreeRTOS-Kernel/LICENSE.md`, ESP-IDF v5.5.5                                                 |
| `http_parser.LICENSE.txt`      | `components/http_parser/LICENSE.txt`, ESP-IDF v5.5.5                                                             |
| `lwip.COPYING`                 | `COPYING` of espressif/esp-lwip at the commit of ESP-IDF v5.5.5 (fd432e4ee2cf)                                   |
| `mbedtls.LICENSE`              | `LICENSE` of espressif/mbedtls at the commit of ESP-IDF v5.5.5 (9d669eadb195)                                    |
| `protobuf-c.LICENSE`           | `LICENSE` of protobuf-c/protobuf-c at the commit of ESP-IDF v5.5.5 (abc67a11c6db)                                |
| `cJSON.LICENSE`                | `LICENSE` of DaveGamble/cJSON at the commit of ESP-IDF v5.5.5 (b2890c8d76bb), the same as component cjson 1.7.19 |
| `tlsf.LICENSE`                 | the BSD-3-Clause text (SPDX) with the copyright line of `tlsf.c`, espressif/tlsf at the commit of ESP-IDF v5.5.5 |
| `xtensa-hal.notice.txt`        | the license header of `components/xtensa/include/xtensa/hal.h`, ESP-IDF v5.5.5                                   |
| `esp_littlefs.LICENSE`         | `license.txt` of component joltwallet/littlefs 1.22.3 in the ESP Component Registry                              |
| `littlefs.LICENSE.md`          | `src/littlefs/LICENSE.md` in the archive of component joltwallet/littlefs 1.22.3                                 |
| `network_provisioning.LICENSE` | `license.txt` of component espressif/network_provisioning 1.0.2 in the ESP Component Registry                    |
| `MPL-2.0.txt`                  | <https://www.mozilla.org/media/MPL/2.0/index.txt>, for the Mozilla CA list in `certs/x509_crt_bundle.bin`        |

## Updating

When the framework moves to another ESP-IDF or Arduino-ESP32 release, or a managed component to another version, the release build stops with the name and both versions. Take each text in `firmware/` again from the new version, as the table says, update `pins` in `firmware.json` and the table above, and build the release site again. When the build links an archive that no section names, add it to the section of the component it comes from, or a new section with its license and text. A new PlatformIO library goes into `libraries` in `firmware.json` with its license and the names of its license files.

## Web app

The web app writes its own notices, `THIRD_PARTY_NOTICES.txt` at the root of its build, from the packages it bundles (`web/scripts/notices.ts`, see [Publishing](../docs/web/web-app-v1.md#publishing)). The texts in `web/` are those the bundle needs and no package carries:

| File                                  | From                                                                                                                                                             |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shadcn-ui.LICENSE.md`                | `LICENSE.md` of shadcn-ui/ui at commit 6ea6856f5a10, for the components of `web/src/ui/components`                                                               |
| `esptool-legacy-flasher-stub.LICENSE` | `LICENSE` of espressif/esptool-legacy-flasher-stub at tag v1.3.0, for the flasher stubs that esptool-js bundles                                                  |
| `react-remove-scroll-bar.LICENSE`     | `LICENSE` of theKashey/react-remove-scroll-bar at commit 7301c160fda4: its npm package 2.3.8 ships none, the repository has no tags                              |
| `lit.LICENSE`                         | `LICENSE` of lit/lit at tag `@lit-labs/ssr-dom-shim@1.6.0`, for `@lit-labs/ssr-dom-shim` 1.6.0, whose npm package ships none (the same text as the lit packages) |
