# 1. Animations are declarative files interpreted by the board

Date: 2026-10-18

Status: proposed

## Context

The animations are C++ code compiled into the firmware. Adding or changing one means editing C++, rebuilding and flashing the board, which only developers can do.

We want people without technical skills to add animations through a small web app, boards to download new animations from a URL over WiFi, and coding agents to write and test animations quickly. Some constraints shape the solution:

- The ESP32-C3 SuperMini cannot appear as a USB drive: its USB port is a fixed serial and debug interface. Files reach the board through the firmware itself, over USB serial or WiFi.
- The board has about 300 KB of RAM and a small stack, and files from a URL or a user upload cannot be trusted.
- Animations must be easy to create in a web editor and readable in git diffs, and agents must be able to write them and check the result in the simulator.
- The current 30 animations use a few patterns: layers that appear and disappear, sprites that move or wrap around, colors that swap, and a colored background.

## Decision

1. **Animations are declarative data files** that describe sprites and a timeline, as specified in [`pixelart/1`](../format/pixelart-v1.md). The order of play is defined in separate [playlist](../format/playlist-v1.md) files.
2. **The board interprets the files.** There is no compilation step. The file stored on the board is the same document people write, so the web app can download it back and edit it.
3. **YAML for writing, JSON on the board.** Authors and the repository use YAML. The tools convert it to JSON before upload, because a JSON parser fits the board well and a YAML parser does not. In the repository, YAML is the source and CI publishes the JSON.
4. **Pixels are listed as points**, one per pixel or grouped by color. Colors are palette names or quoted `#rrggbb` values. Pixels that no sprite draws are off, or take the animation's `background` color.
5. **Version 1 effects are fixed:** drawing order, position, motion with optional wrap, rotation in steps of 90 degrees, flip, recolor and background. Composite sprites group several sprites so they move as one. Loops repeat only the items nested inside them.
6. **Every implementation enforces the same limits** (a 16x16 canvas, file size, sprites, points, colors, nesting, value ranges) before playing a file, and rejects a file that breaks them as a whole.
7. **The JSON Schema is the source of truth for the structure.** The board firmware, the simulator and the web app each implement the format. A shared conformance test suite, run in CI against every implementation, keeps them identical: valid files with their expected frames, and invalid files with their expected error.

## Alternatives considered

- **Animated GIF files.** Easy to make in common tools, but they hold only finished frames: no layers, no motion or color rules, poor diffs, and a format the web editor cannot edit structurally. Rejected as the main format. A GIF or PNG importer can still be added to the tools later.
- **A compiler on the PC that turns the description into finished frames for the board.** It keeps the firmware smaller and lets new effects ship without a firmware update. Rejected because the file on the board would no longer be editable, a second binary format would need its own versioning, published animations would not be the files people write, and long loops would grow into large files.
- **Pixels drawn as text grids** (one character per pixel). Readable in the file, but it needs single-character color keys, alignment rules and placeholders for transparent pixels. Rejected because the tools show the result better than the file can: the simulator renders previews and the web app is the editor. Grids can return in a later format version if they are missed.
- **Rotation by any angle.** On a 16x16 matrix, angles other than multiples of 90 degrees lose or double pixels and break thin lines. Rejected for version 1.
- **One implementation compiled to WebAssembly for the web app.** It removes the duplication between the firmware and the web app, but adds a heavy toolchain to the web app. Rejected in favour of two implementations checked by the conformance suite.

## Consequences

- Adding or changing an animation no longer needs a firmware build: uploading a file is enough.
- New effects need a new format version and a firmware update. Boards refuse format versions they do not know, and the web app asks the user to update the firmware. Over-the-air firmware updates make this acceptable.
- The board validates every file, enforces the limits, and reports why it rejected a file through the command protocol.
- The format has two implementations that must stay in line. Every change to the format comes with new conformance test files, and CI fails until every implementation passes them.
- The 30 existing animations are converted to the new format automatically, and the conversion is checked by comparing their frames with the current firmware, pixel by pixel.
