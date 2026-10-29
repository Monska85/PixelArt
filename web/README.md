# PixelArt web app

A static React and TypeScript app (Vite) that manages a board or the simulator from the browser. The specification is in [`docs/web/web-app-v1.md`](../docs/web/web-app-v1.md).

## Commands

Run them from this folder, or use the `make web-*` targets of the repository root. The app needs Node.js at the version in the `engines` field of `package.json`. `make check` and the `make web-*` targets run `npm ci` the first time they need the dependencies.

| Command                | What it does                                                         |
| ---------------------- | -------------------------------------------------------------------- |
| `npm ci`               | Install the exact dependencies of `package-lock.json`.               |
| `npm run dev`          | Start the app on `http://localhost:5173` with live reload.           |
| `npm run build`        | Type check and build into `dist/`.                                   |
| `npm run typecheck`    | Type check with `tsc`.                                               |
| `npm run lint`         | Run ESLint.                                                          |
| `npm run format:check` | Check formatting with Prettier (`npm run format` fixes it).          |
| `npm test`             | Run the unit tests and the conformance suite with Vitest.            |
| `npm run size`         | Fail when the JavaScript loaded at start is over 190 KB gzip.        |
| `npm run e2e`          | Run the Playwright tests against the built app and the simulator.    |
| `npm run screenshots`  | Compare the reference images (only inside the Playwright container). |

The unit tests read `../conformance`, and the YAML tests compare with `../data`, so run `make data` (or `python3 tools/pixelart.py build`) first.

## End-to-end tests

1. Build the simulator (`make sim-build`). The simulator's WebSocket needs `python3` with the `websockets` package (`pip install websockets`).
2. Install the browser once: `npx playwright install chromium`.
3. `npm run build && npm run e2e`.

The built app is served by `e2e/serve-site.mjs` with a fixture release next to it, as Pages serves it: a `manifest.json` made from the animations, playlists and schedules of `e2e/site/published.json` (with their real SHA-256, and its `contentVersion` as `content_version`) and one firmware entry, and the ESP Web Tools manifests of `e2e/site/firmware/`. `e2e/first-install.ts` draws what needs a real board for the installation after a first install: a closing ESP Web Tools dialog and a serial port wired to the simulator's WebSocket. `fakeSerial` also stands for a USB port with Chrome's rules and no PixelArt board behind it (silent, or answering lines that are not the protocol), used by `e2e/serial-old-firmware.spec.ts`. Tests that need a live board start their own simulator on a free port, with a temporary copy of the fixture board files in `e2e/board-files/`. The layout states without a live board skip that setup. A change to `content/` therefore never breaks a test. The tests use `.pio/build/native/program` and `e2e/board-files/`; set `PIXELART_SIM` and `PIXELART_DATA` to use other copies. A test can pass more options to its simulator with `test.use({ simulatorArgs: [...] })`: `--ws-transport wifi --token TOKEN` makes it stand for a board over WiFi, as the tests of the network login do.

## Screenshot tests

Every view and its main states are scripted once, in `screenshots/states.ts`, and checked two ways:

- **Layout checks.** `screenshots/layout.spec.ts` runs for every state at 1,280 and 375 px wide through `npm run e2e` and `make web-e2e` on the host. It checks that the page does not scroll sideways, nothing extends beyond the window or its clipping box, and every control has an accessible name. It also checks that table row cells are centered on one line (except Diagnostics messages, which start at the top), row actions end at the same place, and a playlist item's mark sits under its animation field, aligned with its left edge. Each state asserts the expected dialog, progress panel or error. A failure names the element that moved. `e2e/layout-checks.spec.ts` demonstrates each rule failing. To add a state, see the comment at the top of `screenshots/states.ts`.
- **Reference images**, for one main state per view (`screenshots/views.spec.ts`): the Board view (its Files section closed, and open on both tabs), the Library, Firmware and Editor views, the playlist editor, a confirmation dialog and the connection chip's panel, at 1,280 and 375 px, in the light and the dark theme, 36 images in `screenshots/baselines/`. A difference of more than 20 pixels fails. Text is only drawn the same way by the same browser build and fonts, so this part runs inside the official Playwright container, never directly:

- `make web-screenshots` builds the app and compares. A failure leaves the expected, actual and diff images in `test-results-screenshots/`.
- `make web-screenshots-update` draws the reference images again. Look at the new images before committing them: a changed image is a changed layout.

Docker is needed. The container is the Playwright image of the pinned `@playwright/test` version (`mcr.microsoft.com/playwright:v<version>-noble`; CI names it by digest). The repository is mounted into it, and the simulator that `make sim-build` made is started from inside the container for each test, so it must be a Linux program: on Linux that is the default build. On another system, set `PIXELART_SIM` to a Linux build of the simulator. The container's Python has no `websockets` package, so the script mounts the one of the host's `python3` (or `PIXELART_PYTHON`, which `make` and `just` set to their Python) for the simulator's WebSocket bridge. The suite has its own board files (`screenshots/board-files/`) and published release (`screenshots/site-published.json`), and fixes the clock, the time zone and the firmware version the pages see, so only a change of the app moves a picture. The reference images are drawn on x86-64.

The functional tests in `e2e/` stay separate: `make web-e2e` runs them on the host and does not need Docker.

## Layout

- `src/engine/`: the formats in TypeScript (strict JSON reader, loaders, player). No access to the page.
- `src/yaml/`: YAML reading with the rules of `tools/pixelart.py`, JSON and YAML writers.
- `src/protocol/`: framing, client, upload and download, WebSocket and Web Serial transports.
- `src/release/`: the release manifest, SemVer precedence and the library state. No access to the page.
- `src/ui/components/`: the shadcn/ui components (Radix primitives, Tailwind CSS) the whole app is built from. `src/ui/common/` holds the patterns made from them: page header, file table, dialogs, alerts, the activity panel. `src/ui/shell/` is the top bar, the connection chip and the theme button.
- `src/ui/`: React components. Views are listed in `src/ui/views.tsx`: Board, Library, Firmware and Editor (ESP Web Tools is loaded only when the Firmware view opens, the Editor view only when it opens). `src/ui/editor/` holds the editor's components, its shared state and its drafts in IndexedDB.
- `src/editor/`: the editor's document operations, undo history, YAML tab state and preview search. No access to the page.
- `test/`: Vitest. A test file that renders a component has `// @vitest-environment jsdom` on the line after its license comment; the others run in Node. `e2e/`: Playwright.
