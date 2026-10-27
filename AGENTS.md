# Agent rules

Read the relevant specifications in `docs/`, the commands and contribution guidance in `README.md`, and the conformance instructions in `conformance/README.md` before making a change. Edit `AGENTS.md` when agent rules change, not `CLAUDE.md`.

## Behavior

- When the engine or the player changes, the simulator's frame output (`make sim`, every animation, `--raw` and timing included) must stay byte-identical unless the change is meant to alter frames. Compare the output before and after the change; a change meant to alter frames says which frames change and why.
- Every change to a file format or to the command protocol updates its specification in `docs/` and adds conformance cases in `conformance/` in the same change.
- Conformance expected results are worked out by hand from the specification. Never generate them by running an engine, the firmware or the simulator.

## Loop task stack

- A change that can add stack use on the board's loop task (the animation and playlist loaders, the engine and the player, the protocol request handling, JSON parsing, storage reads) measures the loop task's minimum free stack on a real board before and after the change, using the method in [Loop task stack](README.md#loop-task-stack) and records the numbers in the change.
- Without a board, the change says explicitly that the stack was not measured. Never skip the measurement silently.
- The debug code and the test files used for a measurement are never committed.

## Privacy

- The privacy promise of the web app is a contract with the user. A change that makes any private or sensitive information (animations, settings, WiFi details, the token, drafts, anything the user enters or the board stores) leave the browser or the board, or that adds an outside service, request, analytics, telemetry or third-party script, updates the in-app Privacy view, the footer and the notes where data is entered, `docs/web/web-app-v1.md` and `README.md` in the same change, and is called out to the user for approval. A change that keeps data local needs no update.

## Builds and tests

- Run builds, tests and checks only through the `make` or `just` targets, with their default limits (`JOBS` and `NICE`, see [Resource limits](README.md#resource-limits)), unless the user asks for other limits. Never use hand-made `pio`, `make -j`, `npm run e2e` or Playwright commands with other parallelism.
- Run one build or test at a time, never two in parallel.
- Tests outside `content/` never depend on what the repository's content holds. A test that needs a named animation or playlist, or asserts exact frames, names, items or counts, uses its own fixture files (`test/fixtures/data/` for the native suites, `web/e2e/board-files/` for the end-to-end tests). A test that checks the shipped content reads `content/` and iterates over it, so a content change touches only `content/` and releases only the content package.
- When a change adds, moves or renames a folder or a file that a CI job reads, it updates the path filters of the `changes` job in `.github/workflows/ci.yml` and the README section on continuous integration in the same change, so each job still runs for every change that can break it. When in doubt, a path belongs in the filter: running a job too often costs time, skipping it hides a break.

## History

- `v0/` holds the original Arduino sketch and its README as history. Never edit, format, move or delete anything in it, and keep every tool from building, linting or formatting it.

## Licenses

- Every C, C++, assembly, TypeScript, JavaScript and Python source file starts with `SPDX-License-Identifier: GPL-3.0-or-later` in a comment, as the existing ones do; build, configuration, markup, style and shell files carry none. Copied third-party code keeps its own notice.
- A new third-party dependency of the firmware or the web app gets its notice in the same change, as `LICENSES/README.md` says; the release and web builds fail without it. Its license must be one the web allowlist or GPL-3.0-or-later accepts.

## Writing

- Documentation is plain prose, without em dashes.
- Never write details of a contributor's machine into repository files: no local paths, device names, operating system or distribution names, user names or host names.

## Commits

- Commits are single-line Conventional Commits, as [Contributing](README.md#contributing) describes for pull request titles.

## This file

- When a rule here no longer matches the repository or the way the project works, update this file in the same change.
- When this file and the repository disagree, the repository wins: fix this file.
