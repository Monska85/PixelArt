# 4. A static web app with its own engine, released apart from the firmware

Date: 2026-10-19

Status: accepted

## Context

Today a board is managed with PlatformIO and `tools/pixelart.py`, which need a development setup. The project wants people without technical skills to install the firmware, see what a board stores, add animations, change the playlist and draw new animations, with nothing to install on their computer. The [web app specification](../web/web-app-v1.md) describes what the app does.

Some constraints shape the solution:

- The board is reached over USB serial with the [command protocol](../protocol/protocol-v1.md). Browsers reach serial ports only through Web Serial, which only desktop Chromium browsers have. The simulator speaks the same protocol over a WebSocket on `127.0.0.1`.
- Firmware is installed from the browser with ESP Web Tools, which needs HTTPS and Web Serial.
- Releases are published on GitHub Pages, which hosts static files only, holds only the latest release, and replaces the whole site on every deployment ([ADR 0002](0002-command-protocol.md)).
- The editor needs to validate and preview animations without a board, so the browser needs an engine for the formats. [ADR 0001](0001-declarative-animations.md) chose two implementations kept identical by the conformance suite over a WebAssembly build of the C++ engine.
- The C++ engine reads JSON with ArduinoJson, which accepts input that strict JSON does not (single quotes, unquoted keys, `+1`, trailing data), counts text lengths in bytes while the specification says characters, and cuts strings at an escaped `\u0000`. A second engine built on the browser's `JSON.parse` would disagree with it on such files, and the conformance suite has no case for them.

## Decision

1. **A static web app on GitHub Pages,** at the root of the same site as the published firmware and animations. It connects to boards with Web Serial and to the simulator with a WebSocket, through one protocol client that follows the same rules as `tools/pixelart.py`.
2. **React and TypeScript, built with Vite,** in `web/` in this repository. The engine and the protocol client are plain TypeScript modules with no access to the page, so Vitest runs them in Node. Playwright runs the end-to-end tests against the simulator. npm installs the dependencies from a committed lockfile, and dependency install scripts never run.
3. **The web app has its own engine,** which passes the whole conformance suite in CI, as ADR 0001 planned. The brightness rule's test values move into a conformance file that the C++ and the TypeScript tests both read.
4. **Both engines read strict JSON.** Animation and playlist files are strict JSON in valid UTF-8, with no U+0000 in any text, integers written without fraction or exponent, and text lengths counted in characters. The C++ engine gains a strict check before ArduinoJson and counts characters; the TypeScript engine has its own JSON reader that keeps integers and other numbers apart. New conformance cases cover every rule. The 30 animations of the repository are unaffected, which a frame by frame comparison confirms.
5. **The firmware and the web app are released separately.** release-please manages two packages in this repository: the firmware (everything except `web/`, tags `vX.Y.Z`, unchanged) and the web app (`web/`, tags `web-vX.Y.Z`). Each has its own release pull request, version and changelog, so the web app can change without a firmware release. This replaces the single release of ADR 0002, decision 8; the firmware release itself is unchanged.
6. **Every Pages deployment publishes both latest releases.** After either release, one job downloads the firmware site archive and the web app archive from GitHub Releases, merges them, and deploys the result. For each package it takes the highest release that is neither a draft nor a pre-release, has a tag of the exact form and already carries its archive, so a newer release still without its archive is skipped. When one of the two has never been released, the other is published alone.
7. **The app finds the latest firmware in `./manifest.json`,** on its own site, and compares its version with the one the board reports.
8. **A full editor in the first version:** every field and effect of `pixelart/1`, edited visually, plus a YAML tab that edits the same document as text.
9. **A component library for a consistent interface.** The app uses shadcn/ui: components built on Radix primitives for behavior and styled with Tailwind CSS, whose code is copied into `web/src/ui/components/` so the project owns it. Icons come from lucide-react. Radix gives tabs, dialogs, menus, tooltips and toasts their keyboard and screen reader behavior. Light and dark themes come from CSS variables and follow the system, with a switch. The Content Security Policy allows inline styles, because Radix inserts a `<style>` element to stop the page from scrolling behind a dialog; scripts stay limited to the site itself.
10. **Bulk actions share one upload queue, and one command wipes the board.** Upload all, installing a playlist with its animations, and installing from the Library go through one queue that checks every file, skips identical ones, checks free space, sends animations before playlists, and stops at the first failure. A new protocol 1 command, `delete_all`, removes every animation and playlist in one request, added as the protocol allows. Its optional `settings` field (added 2026-10-20) also puts the settings back to their defaults in the same request: `settings_set` cannot do it, because it refuses a playlist that is not stored, and after `delete_all` no playlist is.

The work is delivered in three steps: the engine and board management, then the firmware view, the library and the publishing, then the editor.

## Alternatives considered

- **A separate repository for the web app.** It would give the web app its own release schedule and keep Node out of the firmware's tooling. Rejected: the conformance suite, the schemas, the specifications and the simulator used by the end-to-end tests live here, and a format change must update both engines and the cases in one pull request. Two release packages in one repository give the separate schedule anyway. Moving the web app out later stays possible.
- **One release for both.** Simpler, but every change to the web app would need a firmware release, and a firmware release would carry web app changes it does not need.
- **Deploying the web app on every push to `main`.** The app would update without any release, but the deployment would replace the release files, so it would have to republish them, and Pages would show code that was never released.
- **Preact, Svelte or no UI library.** Preact and plain TypeScript give a smaller bundle; Svelte compiles to small code. React was chosen for its familiarity and ecosystem. The engine and the protocol client do not depend on it.
- **The GitHub Releases API to find the latest firmware.** It adds an external service with a rate limit, and the files would still come from Pages. The deployment already puts the manifest next to the app.
- **A TypeScript engine that copies ArduinoJson's leniency.** It would agree with the C++ engine without changing it, but the formats say the files are JSON and count characters, so the specifications would have to describe the quirks of one library.
- **A stricter TypeScript engine with the difference documented.** Least work, but the two engines would disagree on hand-written files, which is what the conformance suite exists to prevent.
- **Mantine as the component library.** Complete and polished, with a built-in dark theme. Rejected for size: measured with the same set of components, it adds about 76 KB of JavaScript and 11 to 36 KB of CSS (gzip), against about 55 KB and 5 KB for Radix with Tailwind. Its CSS is not trimmed to the components in use, and its provider also inserts styles at run time.
- **Radix primitives with the existing hand-written CSS.** The smallest option (about 37 KB of JavaScript), with the same accessible behavior, but every component's look would be designed and kept consistent by hand, which is what the users found lacking.
- **sonner for notifications,** the toast library shadcn/ui suggests. It inserts its CSS from JavaScript and adds size; Radix's own toast is used instead.
- **Wiping the board file by file** with the existing `delete` command. It needs no firmware change, but takes one round trip per file and leaves the rule to each client. Nothing is released yet, so a new command costs no compatibility.
- **A reduced first editor** (points and timeline only, composites and effects later). The YAML tab would cover the rest, but the goal is that people without technical skills can make animations, so the visual editor covers the whole format.

## Consequences

- People can install the firmware and manage a board from a browser, with nothing to install, on desktop Chromium browsers. Other browsers can use the editor and the simulator only.
- The repository needs Node for the web app. `make check` runs the web app's type check, linter and unit tests, and CI runs the conformance suite and the end-to-end tests with the simulator.
- Every change to the formats adds conformance cases that both engines must pass.
- A file that ArduinoJson used to accept but is not strict JSON is now rejected by the board. Every file produced by the project's tools is strict JSON, so only hand-written files can be affected, and no board outside the project runs the firmware yet.
- The release workflow handles two packages and one deployment that merges two archives. The web app and the firmware can be one or more releases apart, so the web app checks the protocol version and the formats each board reports, and asks for a firmware update when needed.
- The initial JavaScript grew from 133 KB to about 165 KB (gzip) with the component library. CI checks the size of the main bundle against a budget.
- Inline styles are allowed by the Content Security Policy. Scripts are not, so injected markup still cannot run code, and React renders untrusted text as text.
- A board with firmware older than `delete_all` answers `unknown_command`, and the app then asks for a firmware update.
- A board with firmware older than the `settings` field of `delete_all` answers `bad_request` to a reset and deletes nothing; the app then asks for a firmware update or a Delete everything without the reset.
- The web app relies on its dependencies' supply chain: versions are pinned, the lockfile is committed, install scripts are disabled and Dependabot proposes updates.
