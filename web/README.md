# PixelArt web app

A static React and TypeScript app (Vite) that manages a board or the simulator from the browser. The specification is in [`docs/web/web-app-v1.md`](../docs/web/web-app-v1.md).

## Commands

Run them from this folder, or use the `make web-*` targets of the repository root. The app needs Node.js at the version in the `engines` field of `package.json`. `make check` and the `make web-*` targets run `npm ci` the first time they need the dependencies.

| Command                | What it does                                                      |
| ---------------------- | ----------------------------------------------------------------- |
| `npm ci`               | Install the exact dependencies of `package-lock.json`.            |
| `npm run dev`          | Start the app on `http://localhost:5173` with live reload.        |
| `npm run build`        | Type check and build into `dist/`.                                |
| `npm run typecheck`    | Type check with `tsc`.                                            |
| `npm run lint`         | Run ESLint.                                                       |
| `npm run format:check` | Check formatting with Prettier (`npm run format` fixes it).       |
| `npm test`             | Run the unit tests and the conformance suite with Vitest.         |
| `npm run size`         | Fail when the JavaScript loaded at start is over 190 KB gzip.     |
| `npm run e2e`          | Run the Playwright tests against the built app and the simulator. |
| `npm run screenshots`  | Compare screenshots (only inside the Playwright container).       |

The unit tests read `../conformance`, and the YAML tests compare with `../data`, so run `make data` (or `python3 tools/pixelart.py build`) first.

## End-to-end tests

1. Build the simulator (`make sim-build`) and the board files (`make data`).
2. Install the browser once: `npx playwright install chromium`.
3. `npm run build && npm run e2e`.

The built app is served by `e2e/serve-site.mjs` with a fixture release next to it, as Pages serves it: a `manifest.json` made from the animations and playlists of `e2e/site/published.json` (with their real SHA-256), and the ESP Web Tools manifests of `e2e/site/firmware/`. Each test starts its own simulator on a free port, with a temporary copy of `data/`. The tests use `.pio/build/native/program` and `data/`; set `PIXELART_SIM` and `PIXELART_DATA` to use other copies.

## Screenshot tests

`screenshots/views.spec.ts` takes a screenshot of every view and its main states at 1,280 and 375 px wide, in the light and the dark theme, compares it with the image in `screenshots/baselines/`, and checks that the page does not scroll sideways. Text is only drawn the same way by the same browser build and fonts, so the suite runs inside the official Playwright container, never directly:

- `make web-screenshots` builds the app and compares. A failure leaves the expected, actual and diff images in `test-results-screenshots/`.
- `make web-screenshots-update` draws the reference images again. Look at the new images before committing them: a changed image is a changed layout.

Docker is needed. The container is the Playwright image of the pinned `@playwright/test` version (`mcr.microsoft.com/playwright:v<version>-noble`; CI names it by digest). The repository is mounted into it, and the simulator that `make sim-build` made is started from inside the container for each test, so it must be a Linux program: on Linux that is the default build. On another system, set `PIXELART_SIM` to a Linux build of the simulator. The suite has its own board files (`screenshots/board-files/`) and published release (`screenshots/site-published.json`), and fixes the clock, the time zone and the firmware version the pages see, so only a change of the app moves a picture. The reference images are drawn on x86-64.

The functional tests in `e2e/` stay separate: `make web-e2e` runs them on the host and does not need Docker.

## Layout

- `src/engine/`: the formats in TypeScript (strict JSON reader, loaders, player). No access to the page.
- `src/yaml/`: YAML reading with the rules of `tools/pixelart.py`, JSON and YAML writers.
- `src/protocol/`: framing, client, upload and download, WebSocket and Web Serial transports.
- `src/release/`: the release manifest, SemVer precedence and the library state. No access to the page.
- `src/ui/components/`: the shadcn/ui components (Radix primitives, Tailwind CSS) the whole app is built from. `src/ui/common/` holds the patterns made from them: page header, file table, dialogs, alerts, the activity panel. `src/ui/shell/` is the top bar, the connection chip and the theme button.
- `src/ui/`: React components. Views are listed in `src/ui/views.tsx`: Board, Library, Firmware and Editor (ESP Web Tools is loaded only when the Firmware view opens, the Editor view only when it opens). `src/ui/editor/` holds the editor's components, its shared state and its drafts in IndexedDB.
- `src/editor/`: the editor's document operations, undo history, YAML tab state and preview search. No access to the page.
- `test/`: Vitest. `e2e/`: Playwright.
