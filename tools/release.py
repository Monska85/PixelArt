#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Assemble the release site: firmware files, ESP Web Tools manifests, animations, playlists and manifest.json.

  tools/release.py version
      Print the firmware version of this checkout (PIXELART_VERSION, else git).
  tools/release.py build [--out site] [--schema]
      Collect the files of every board from the PlatformIO build folders and
      the converted files in data/, write the third-party notices of the
      firmware (tools/firmware_notices.py), and write the site. Run
      `make release-firmware` to build everything first.
  tools/release.py check-site URL
      Fail when URL (the address GitHub Pages announces or serves the site at) is not the site address computed
      from this environment by the rules of tools/site_url.py, the address a firmware built here looks for. It
      reads no firmware. Used by the release workflow before and after the deployment.
  tools/release.py assemble --out DIR [--firmware DIR] [--web DIR]
      Merge a firmware site (the output of `build`) and a built web app into the
      site GitHub Pages serves. Used by the release workflow and `make release-site`.

The layout and the manifest are specified in docs/format/manifest-v1.md. Needs
PlatformIO (pio) on the PATH, PyYAML is not used here. --schema needs jsonschema.
Needs Python 3.8+ and works on Linux and macOS.
"""

import argparse
import datetime
import hashlib
import json
import os
import re
import shutil
import struct
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import firmware_notices  # noqa: E402
import fw_version  # noqa: E402
import site_url  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
BUILD_DIR = ROOT / ".pio" / "build"
SCHEMA = ROOT / "schema" / "manifest-1.schema.json"
FORMAT = "pixelart-manifest/1"

# board (PlatformIO environment) -> esptool chip, ESP Web Tools chip family, bootloader address
BOARDS = {
    "esp32c3": {"chip": "esp32c3", "family": "ESP32-C3", "bootloader": 0x0},
    "esp32": {"chip": "esp32", "family": "ESP32", "bootloader": 0x1000},
    "esp32s3": {"chip": "esp32s3", "family": "ESP32-S3", "bootloader": 0x0},
}
PARTITIONS_OFFSET = 0x8000
BOOT_APP0_OFFSET = 0xE000

ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]{0,31}$")

# What a board accepts in a manifest (docs/board/wifi-and-updates-v1.md, "Checks")
# A board reads up to 64 KiB over http, but over HTTPS the manifest must fit next to the TLS connection: about
# 26 KB on an ESP32-C3 (docs/board/wifi-and-updates-v1.md, Checks). A release stays under that with room to spare.
MAX_MANIFEST_BYTES = 20 * 1024
MAX_MANIFEST_FILES = 200
# Room each application keeps in its slot, so the next releases still fit the layout
SLOT_MARGIN = 64 * 1024

# Partition table entry types and subtypes (ESP-IDF)
TYPE_APP, TYPE_DATA = 0x00, 0x01
SUBTYPE_OTA_0, SUBTYPE_SPIFFS = 0x10, 0x82
ENTRY_MAGIC = b"\xaa\x50"
ENTRY_SIZE = 32


class ReleaseError(Exception):
    """A failure the user should see, printed without a traceback."""


def describe_version():
    try:
        return fw_version.describe_version(ROOT)
    except ValueError as err:
        raise ReleaseError(str(err)) from err


def sha256_of(path):
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 16), b""):
            digest.update(block)
    return digest.hexdigest()


def source_url():
    """Where the source code of this build is: the tree of the release tag (RELEASE_TAG, set by the release workflow),
    else of the commit checked out, in the repository of GitHub Actions or else the project's own."""
    server = os.environ.get("GITHUB_SERVER_URL", "").strip().rstrip("/") or "https://github.com"
    repository = os.environ.get("GITHUB_REPOSITORY", "").strip() if os.environ.get("GITHUB_ACTIONS") == "true" else ""
    if repository:
        try:
            site_url.from_repository(repository)  # the same rules as the site address
        except ValueError as e:
            raise ReleaseError(str(e))
    base = f"{server}/{repository}" if repository else firmware_notices.REPOSITORY
    ref = os.environ.get("RELEASE_TAG", "").strip()
    if not ref:
        try:
            ref = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
        except (OSError, subprocess.CalledProcessError) as e:
            raise ReleaseError(f"cannot read the commit of this checkout: {e}")
    return f"{base}/tree/{ref}"


def released_date():
    epoch = os.environ.get("SOURCE_DATE_EPOCH", "").strip()
    moment = (
        datetime.datetime.fromtimestamp(int(epoch), datetime.timezone.utc)
        if epoch.isdigit()
        else datetime.datetime.now(datetime.timezone.utc)
    )
    return moment.date().isoformat()


def pio_packages_dir():
    """PlatformIO's package folder, asked from PlatformIO and never assumed."""
    explicit = os.environ.get("PLATFORMIO_PACKAGES_DIR", "").strip()
    if explicit:
        return Path(explicit)
    core = os.environ.get("PLATFORMIO_CORE_DIR", "").strip()
    if not core:
        try:
            out = subprocess.run(
                ["pio", "system", "info", "--json-output"], capture_output=True, text=True, timeout=120, check=True
            )
            core = json.loads(out.stdout)["core_dir"]["value"]
        except (OSError, subprocess.SubprocessError, ValueError, KeyError) as e:
            raise ReleaseError(f"cannot find PlatformIO's core folder: {e}")
    return Path(core) / "packages"


def boot_app0_path():
    path = pio_packages_dir() / "framework-arduinoespressif32" / "tools" / "partitions" / "boot_app0.bin"
    if not path.is_file():
        raise ReleaseError(f"{path} not found: build a firmware first so PlatformIO installs the framework")
    return path


def read_partitions(path):
    """Partitions of a built partition table: [(label, type, subtype, offset, size)]."""
    data = Path(path).read_bytes()
    entries = []
    for start in range(0, len(data) - ENTRY_SIZE + 1, ENTRY_SIZE):
        entry = data[start : start + ENTRY_SIZE]
        if entry[:2] != ENTRY_MAGIC:
            break  # the MD5 entry, or the empty space after the table
        kind, subtype, offset, size = struct.unpack_from("<BBII", entry, 2)
        label = entry[12:28].split(b"\0", 1)[0].decode("ascii", "replace")
        entries.append((label, kind, subtype, offset, size))
    if not entries:
        raise ReleaseError(f"{path} holds no partition")
    return entries


def find_partition(entries, kind, subtype, what):
    for entry in entries:
        if entry[1] == kind and entry[2] == subtype:
            return entry
    raise ReleaseError(f"the partition table has no {what} partition")


def merge_factory(chip, output, parts):
    """The whole flash in one image from address 0, made with PlatformIO's esptool."""
    command = ["pio", "pkg", "exec", "-p", "tool-esptoolpy", "--", "esptool.py", "--chip", chip, "merge_bin"]
    command += ["--output", str(output), "--flash_size", "keep"]
    for offset, path in sorted(parts):
        command += [hex(offset), str(path)]
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=300)
    except (OSError, subprocess.SubprocessError) as e:
        raise ReleaseError(f"cannot run esptool: {e}")
    if result.returncode != 0:
        raise ReleaseError(f"esptool merge_bin failed:\n{result.stdout}{result.stderr}")


def entry_of(path, site):
    return {"file": path.relative_to(site).as_posix(), "size": path.stat().st_size, "sha256": sha256_of(path)}


def build_board(board, version, site, boot_app0):
    spec = BOARDS[board]
    env_dir = BUILD_DIR / board
    sources = {
        "bootloader": env_dir / "bootloader.bin",
        "partitions": env_dir / "partitions.bin",
        "boot_app0": boot_app0,
        "app": env_dir / "firmware.bin",
        "filesystem": env_dir / "littlefs.bin",
    }
    for part, path in sources.items():
        if not path.is_file():
            hint = " (pio run -e %s -t buildfs)" % board if part == "filesystem" else " (pio run -e %s)" % board
            raise ReleaseError(f"{path} not found{hint}")

    app = read_partitions(sources["partitions"])
    app_entry = find_partition(app, TYPE_APP, SUBTYPE_OTA_0, "first application")
    fs_entry = find_partition(app, TYPE_DATA, SUBTYPE_SPIFFS, "file system")
    room = check_app_room(board, sources["app"].stat().st_size, app_entry[4])
    print(f"release: {board} application leaves {room} bytes free in its {app_entry[4]}-byte partition")
    if sources["filesystem"].stat().st_size != fs_entry[4]:
        raise ReleaseError(f"{board}: the file system image is not the size of its partition")
    app_bytes = sources["app"].read_bytes()
    if version.encode("ascii") not in app_bytes:
        raise ReleaseError(f"{board}: the firmware was not built with version {version}")
    check_firmware_address(board, app_bytes, site_address())

    offsets = {
        "bootloader": spec["bootloader"],
        "partitions": PARTITIONS_OFFSET,
        "boot_app0": BOOT_APP0_OFFSET,
        "app": app_entry[3],
        "filesystem": fs_entry[3],
    }

    target = site / "firmware" / board
    target.mkdir(parents=True, exist_ok=True)
    files = {}
    for part, source in sources.items():
        files[part] = target / f"{part}-{version}.bin"
        shutil.copyfile(source, files[part])
    files["factory"] = target / f"factory-{version}.bin"
    merge_factory(spec["chip"], files["factory"], [(offsets[p], files[p]) for p in sources])
    offsets["factory"] = 0

    entries = []
    for part in ("bootloader", "partitions", "boot_app0", "app", "filesystem", "factory"):
        entry = {"board": board, "chip": spec["family"], "part": part, "offset": offsets[part]}
        entry.update(entry_of(files[part], site))
        entries.append(entry)
    return entries


def site_address():
    """The site address of this build, by the rules of tools/site_url.py (PIXELART_SITE_URL, GITHUB_REPOSITORY)."""
    try:
        return site_url.site_url(os.environ)
    except ValueError as e:
        raise ReleaseError(str(e))


def check_firmware_address(board, app_bytes, site):
    """The firmware must carry the manifest address of the site it is published to, as a C string."""
    expected = site_url.manifest_url(site)
    if expected.encode("ascii") + b"\0" not in app_bytes:
        raise ReleaseError(f"{board}: the firmware does not carry {expected}: it was built for another site address "
                           "(set PIXELART_SITE_URL the same for the build and the release, and build again)")


def check_site(url):
    """The address Pages serves the site at must be the site address of this environment, the one a firmware built
    here looks for its manifest at. The firmware images themselves are checked at build time (check_firmware_address)."""
    expected = site_address()
    got = url if url.endswith("/") else url + "/"
    if got != expected:
        raise ReleaseError(f"the site is served at {got} but a firmware built here looks for {expected}: set the "
                           "PIXELART_SITE_URL repository variable to the address Pages serves, and release again")
    print(f"release: the site is served at {expected}, the address a firmware built here looks for")


def check_app_room(board, size, slot):
    """The bytes an application leaves free in its slot, at least SLOT_MARGIN."""
    if size + SLOT_MARGIN > slot:
        raise ReleaseError(f"{board}: the application ({size} bytes) leaves less than {SLOT_MARGIN} bytes free in its {slot}-byte partition")
    return slot - size


def web_tools_manifest(version, firmware, parts, erase):
    """An ESP Web Tools manifest with paths relative to site/firmware/."""
    builds = []
    for board, spec in BOARDS.items():
        wanted = [e for e in firmware if e["board"] == board and e["part"] in parts]
        wanted.sort(key=lambda e: parts.index(e["part"]))
        listed = [{"path": e["file"][len("firmware/") :], "offset": e["offset"]} for e in wanted]
        builds.append({"chipFamily": spec["family"], "parts": listed})
    return {"name": "PixelArt", "version": version, "new_install_prompt_erase": erase, "builds": builds}


def collect_documents(data, kind, site, with_version):
    entries = []
    folder = data / kind
    if folder.is_symlink():
        raise ReleaseError(f"{folder}: a symbolic link, not a folder of the data build")
    for path in sorted(folder.glob("*.json")):
        if not ID_PATTERN.match(path.stem):
            raise ReleaseError(f"{path}: invalid file name")
        if path.is_symlink() or not path.is_file():
            raise ReleaseError(f"{path}: not a regular file")
        target = site / kind / path.name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, target)
        try:
            document = json.loads(path.read_text(encoding="utf-8"))
        except ValueError as e:
            raise ReleaseError(f"{path}: {e}")
        if not isinstance(document, dict):
            raise ReleaseError(f"{path}: the file is not a JSON object")
        entry = {"id": path.stem}
        if "name" in document:
            entry["name"] = document["name"]
        if with_version:
            entry["version"] = document.get("version", 1)
        entry.update(entry_of(target, site))
        entries.append(entry)
    return entries


def json_text(document):
    return json.dumps(document, indent=2, ensure_ascii=False) + "\n"


def write_json(path, document):
    path.write_text(json_text(document), encoding="utf-8")


def check_manifest_limits(manifest):
    """Refuses a manifest every board would refuse for its number of files or its size. A manifest of 200 files is over
    the size limit already, so the number is checked first and each limit gives its own message."""
    files = len(manifest["animations"]) + len(manifest["playlists"])
    if files > MAX_MANIFEST_FILES:
        raise ReleaseError(f"manifest.json lists {files} animations and playlists, more than the {MAX_MANIFEST_FILES} a board takes")
    size = len(json_text(manifest).encode("utf-8"))
    if size > MAX_MANIFEST_BYTES:
        raise ReleaseError(f"manifest.json takes {size} bytes, more than the {MAX_MANIFEST_BYTES} a board reads over HTTPS")


def validate(manifest):
    try:
        import jsonschema
    except ImportError:
        raise ReleaseError("--schema needs the jsonschema package (pip install jsonschema)")
    validator = jsonschema.Draft202012Validator(json.loads(SCHEMA.read_text(encoding="utf-8")))
    problems = sorted(validator.iter_errors(manifest), key=lambda e: list(e.absolute_path))
    for problem in problems:
        where = ".".join(str(p) for p in problem.absolute_path) or "(root)"
        print(f"manifest.json: {where}: {problem.message}", file=sys.stderr)
    if problems:
        raise ReleaseError(f"manifest.json does not match {SCHEMA.name}")


def check_replaceable(site):
    """Refuses to delete anything but the default site/ or a folder an earlier run built.

    The default site/ is always replaceable, even when an interrupted run left no manifest.json in it.
    """
    inside = ROOT in site.parents
    if inside and site != ROOT / "site":
        raise ReleaseError(f"refusing to replace {site}: inside the repository, only site/ is allowed")
    if not site.exists():
        return
    if not site.is_dir():
        raise ReleaseError(f"refusing to replace {site}: not a folder")
    if site == ROOT / "site":
        return
    try:
        empty = not any(site.iterdir())
    except PermissionError as e:
        raise ReleaseError(f"cannot read {site}: {e.strerror}")
    if empty:
        return
    try:
        previous = json.loads((site / "manifest.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        previous = None
    if not isinstance(previous, dict) or previous.get("format") != FORMAT:
        raise ReleaseError(f"refusing to replace {site}: not empty and not a release site built by this tool")


def site_path(out):
    """The site folder `out`, resolved; never the repository or a folder above it."""
    site = Path(out).resolve()
    if site == ROOT or site in ROOT.parents:
        raise ReleaseError(f"refusing to use {site} as the site folder")
    return site


def reset_site(site):
    """Empties the site folder, which must be empty or a site this tool built, and creates it."""
    check_replaceable(site)
    if site.exists():
        shutil.rmtree(site)
    site.mkdir(parents=True)


def build_site(out, version, data, use_schema):
    if not fw_version.SAFE_VERSION.fullmatch(version):
        raise ReleaseError(f"'{version}' is not a valid version")
    site = site_path(out)
    reset_site(site)

    boot_app0 = boot_app0_path()
    firmware = []
    for board in BOARDS:
        firmware += build_board(board, version, site, boot_app0)
    animations = collect_documents(Path(data), "animations", site, True)
    playlists = collect_documents(Path(data), "playlists", site, False)
    if not animations or not playlists:
        raise ReleaseError(f"{data} has no animations or no playlists: run make data")

    source = source_url()
    manifest = {
        "format": FORMAT,
        "version": version,
        "released": released_date(),
        "source": source,
        "firmware": firmware,
        "animations": animations,
        "playlists": playlists,
    }
    if use_schema:
        validate(manifest)
    check_manifest_limits(manifest)
    write_json(site / "manifest.json", manifest)
    try:
        notices = firmware_notices.build_notices(version, source)
    except firmware_notices.NoticesError as e:
        raise ReleaseError(f"third-party notices: {e}")
    (site / "firmware" / "THIRD_PARTY_NOTICES.txt").write_text(notices, encoding="utf-8")

    update_parts = ["bootloader", "partitions", "boot_app0", "app"]
    write_json(site / "firmware" / "install.json", web_tools_manifest(version, firmware, update_parts + ["filesystem"], True))
    write_json(site / "firmware" / "update.json", web_tools_manifest(version, firmware, update_parts, False))
    print(f"release: version {version}, {len(firmware)} firmware files, {len(animations)} animations, "
          f"{len(playlists)} playlists in {site}")


def list_tree(root, label):
    """Every file under `root` as a relative POSIX path. Symbolic links and special files are refused."""
    root = Path(root)
    if root.is_symlink() or not root.is_dir():
        raise ReleaseError(f"{label} {root}: not a folder, or a symbolic link")
    files = []
    for folder, dirs, names in os.walk(root, followlinks=False):
        for name in dirs + names:
            path = Path(folder) / name
            if path.is_symlink():
                raise ReleaseError(f"{label}: {path} is a symbolic link")
        for name in names:
            path = Path(folder) / name
            if not path.is_file():
                raise ReleaseError(f"{label}: {path} is not a regular file")
            files.append(path.relative_to(root).as_posix())
    return sorted(files)


def find_conflicts(first, second):
    """Paths the two trees both hold, as a file in one and a file or a folder in the other."""
    def parents(path):
        parts = path.split("/")
        return {"/".join(parts[:i]) for i in range(1, len(parts))}

    conflicts = set(first) & set(second)
    conflicts |= {p for p in second if parents(p) & set(first)}
    conflicts |= {p for p in first if parents(p) & set(second)}
    return sorted(conflicts)


def assemble_site(out, firmware, web):
    """Copy the firmware site, then the web app, into `out`. A path in both is an error and nothing is written."""
    if firmware is None and web is None:
        raise ReleaseError("assemble needs --firmware, --web or both")
    site = site_path(out)
    inputs = [(label, Path(path)) for label, path in (("firmware", firmware), ("web", web)) if path]
    # Listed first, as given: a link must be seen before it is resolved
    trees = [(label, path, list_tree(path, label)) for label, path in inputs]
    for label, path, _ in trees:
        real = path.resolve()
        if site == real or site in real.parents or real in site.parents:
            raise ReleaseError(f"the site folder {site} and the {label} folder {real} must not contain each other")
    if len(trees) == 2:
        conflicts = find_conflicts(trees[0][2], trees[1][2])
        if conflicts:
            shown = ", ".join(conflicts[:10]) + (f" and {len(conflicts) - 10} more" if len(conflicts) > 10 else "")
            raise ReleaseError(f"the firmware site and the web app both hold: {shown}")

    reset_site(site)
    for label, path, files in trees:
        for name in files:
            target = site / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path / name, target)
        print(f"release: {len(files)} files of the {label} copied to {site}")


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("version", help="print the firmware version of this checkout")
    build = commands.add_parser("build", help="assemble the release site from the build folders")
    build.add_argument("--out", default="site", help="site folder, replaced if it exists (default: site)")
    build.add_argument("--schema", action="store_true", help="check manifest.json against the JSON Schema")
    check = commands.add_parser("check-site", help="check the address the site is served at against the firmware's")
    check.add_argument("url", help="the address Pages serves the site at")
    assemble = commands.add_parser("assemble", help="merge a firmware site and a web app into one site")
    assemble.add_argument("--out", required=True, help="site folder, replaced if it is site/ or a site built by this tool")
    assemble.add_argument("--firmware", help="the firmware site made by `build`")
    assemble.add_argument("--web", help="the built web app (web/dist)")
    args = parser.parse_args()

    try:
        if args.command == "version":
            print(describe_version())
        elif args.command == "check-site":
            check_site(args.url)
        elif args.command == "assemble":
            assemble_site(args.out, args.firmware, args.web)
        else:
            build_site(args.out, describe_version(), ROOT / "data", args.schema)
    except ReleaseError as e:
        sys.exit(f"release: {e}")


if __name__ == "__main__":
    main()
