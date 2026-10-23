# Agent rules

Rules for coding agents working on this repository. `CLAUDE.md` is a symbolic link to this file, so both names keep working: edit `AGENTS.md`. Facts live elsewhere: the formats in `docs/format/`, the command protocol in `docs/protocol/`, the web app in `docs/web/`, decisions in `docs/adr/`, commands, layout and contribution rules in `README.md`, the conformance cases in `conformance/README.md`. Read those instead of trusting a summary here.

## Behaviour

- When the engine or the player changes, the simulator's frame output (`make sim`, every animation, `--raw` and timing included) must stay byte-identical unless the change is meant to alter frames. Compare the output before and after the change; a change meant to alter frames says which frames change and why.
- Every change to a file format or to the command protocol updates its specification in `docs/` and adds conformance cases in `conformance/` in the same change.
- Conformance expected results are worked out by hand from the specification. Never generate them by running an engine, the firmware or the simulator.

## Loop task stack

- A change that can add stack use on the board's loop task (the animation and playlist loaders, the engine and the player, the protocol request handling, JSON parsing, storage reads) measures the loop task's minimum free stack on a real board before and after the change, with the method in README.md, "Loop task stack", and records the numbers in the change.
- Without a board, the change says explicitly that the stack was not measured. Never skip the measurement silently.
- The debug code and the test files used for a measurement are never committed.

## History

- `v0/` holds the original Arduino sketch and its README as history. Never edit, format, move or delete anything in it, and keep every tool from building, linting or formatting it.

## Writing

- Documentation is plain prose, without em dashes.
- Never write details of a contributor's machine into repository files: no local paths, device names, operating system or distribution names, user names or host names.

## Commits

- Commits are single-line Conventional Commits, as README.md, "Contributing", describes for pull request titles.

## This file

- When a rule here no longer matches the repository or the way the project works, update this file in the same change.
- When this file and the repository disagree, the repository wins: fix this file.
