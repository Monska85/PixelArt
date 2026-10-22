#!/bin/sh
# Runs the reference image comparison (screenshots/views.spec.ts) inside the official Playwright container, so the
# text of every page is drawn by the same browser build and fonts everywhere. `compare` checks the pages against
# screenshots/baselines/; `update` writes the reference images again.
#
#   PLAYWRIGHT_IMAGE  the image to use; by default the one of the pinned @playwright/test version (CI names it by digest)
#   PIXELART_SIM      the simulator to start for each test; by default the one `make sim-build` makes. It runs inside
#                     the container, so it must be a Linux program.
#   PIXELART_PYTHON   the Python whose websockets package the simulator's WebSocket bridge uses (default python3).
#                     The container's Python has no websockets, so the package is mounted from this one.
#
# More arguments go to Playwright, for example --grep dialog.
#
# The built app (web/dist) and the board files must exist: `make web-screenshots` makes them first.

set -eu

mode=${1:-compare}
[ $# -eq 0 ] || shift
case "$mode" in
  compare) script=screenshots ;;
  update) script=screenshots:update ;;
  *) echo "usage: $0 compare|update [playwright options]" >&2; exit 2 ;;
esac

root=$(cd "$(dirname "$0")/../.." && pwd)
version=$(sed -n 's/.*"@playwright\/test": "\([^"]*\)".*/\1/p' "$root/web/package.json")
[ -n "$version" ] || { echo "cannot read the @playwright/test version from web/package.json" >&2; exit 1; }
image=${PLAYWRIGHT_IMAGE:-mcr.microsoft.com/playwright:v$version-noble}
# A pinned image must be the one of the Playwright version in use, or the browser would not match the test runner.
case "$image" in
  *"v$version-"*) ;;
  *) echo "The image $image is not the one of @playwright/test $version: update PLAYWRIGHT_IMAGE (CI pins it by digest)." >&2; exit 1 ;;
esac
sim=${PIXELART_SIM:-$root/.pio/build/native/program}

command -v docker >/dev/null 2>&1 || { echo "Docker is needed: the screenshots are drawn inside the Playwright container." >&2; exit 1; }
[ -f "$sim" ] || { echo "No simulator at $sim: run 'make sim-build'." >&2; exit 1; }
if [ "$(head -c 4 "$sim" | od -An -tx1 | tr -d ' \n')" != "7f454c46" ]; then
  echo "$sim is not a Linux program, so it cannot run in the container. Set PIXELART_SIM to a Linux build of the simulator." >&2
  exit 1
fi
# The package is pure Python: its optional compiled part is skipped when it does not load in the container.
websockets=$("${PIXELART_PYTHON:-python3}" -c 'import os, websockets; print(os.path.dirname(websockets.__file__))' 2>/dev/null) || {
  echo "The simulator's WebSocket needs the websockets package, version 15 or later: pip install websockets" >&2
  exit 1
}

exec docker run --rm --init --ipc=host \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp \
  -e CI="${CI:-}" \
  -e PIXELART_SIM=/pixelart-sim \
  -e PIXELART_WS_BRIDGE=/work/tools/ws_bridge.py \
  -e PYTHONPATH=/pixelart-python \
  -v "$root:/work" \
  -v "$sim:/pixelart-sim:ro" \
  -v "$websockets:/pixelart-python/websockets:ro" \
  -w /work/web \
  "$image" \
  npm run "$script" -- "$@"
