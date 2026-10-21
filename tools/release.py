#!/usr/bin/env python3
"""Assemble the release site: firmware files, ESP Web Tools manifests, animations, playlists and manifest.json.

  tools/release.py version
      Print the firmware version of this checkout (PIXELART_VERSION, else git).
  tools/release.py build [--out site] [--version X] [--schema]
      Collect the files of every board from the PlatformIO build folders and
      write the site. Run `make release-site` to build everything first.
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
import fw_version  # noqa: E402

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
    if sources["app"].stat().st_size > app_entry[4]:
        raise ReleaseError(f"{board}: the application does not fit its partition")
    if sources["filesystem"].stat().st_size != fs_entry[4]:
        raise ReleaseError(f"{board}: the file system image is not the size of its partition")
    if version.encode("ascii") not in sources["app"].read_bytes():
        raise ReleaseError(f"{board}: the firmware was not built with version {version}")

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


def write_json(path, document):
    path.write_text(json.dumps(document, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


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


def build_site(out, version, data, use_schema):
    if not fw_version.SAFE_VERSION.fullmatch(version):
        raise ReleaseError(f"'{version}' is not a valid version")
    site = Path(out).resolve()
    if site == ROOT or site in ROOT.parents:
        raise ReleaseError(f"refusing to use {site} as the site folder")
    check_replaceable(site)
    if site.exists():
        shutil.rmtree(site)
    site.mkdir(parents=True)

    boot_app0 = boot_app0_path()
    firmware = []
    for board in BOARDS:
        firmware += build_board(board, version, site, boot_app0)
    animations = collect_documents(Path(data), "animations", site, True)
    playlists = collect_documents(Path(data), "playlists", site, False)
    if not animations or not playlists:
        raise ReleaseError(f"{data} has no animations or no playlists: run make data")

    manifest = {
        "format": FORMAT,
        "version": version,
        "released": released_date(),
        "firmware": firmware,
        "animations": animations,
        "playlists": playlists,
    }
    if use_schema:
        validate(manifest)
    write_json(site / "manifest.json", manifest)

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
    site = Path(out).resolve()
    if site == ROOT or site in ROOT.parents:
        raise ReleaseError(f"refusing to use {site} as the site folder")
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

    check_replaceable(site)
    if site.exists():
        shutil.rmtree(site)
    site.mkdir(parents=True)
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
    build.add_argument("--version", help="release version (default: PIXELART_VERSION or git, as the firmware)")
    build.add_argument("--data", default=str(ROOT / "data"), help="folder made by `tools/pixelart.py build`")
    build.add_argument("--schema", action="store_true", help="check manifest.json against the JSON Schema")
    assemble = commands.add_parser("assemble", help="merge a firmware site and a web app into one site")
    assemble.add_argument("--out", required=True, help="site folder, replaced if it is site/ or a site built by this tool")
    assemble.add_argument("--firmware", help="the firmware site made by `build`")
    assemble.add_argument("--web", help="the built web app (web/dist)")
    args = parser.parse_args()

    try:
        if args.command == "version":
            print(describe_version())
        elif args.command == "assemble":
            assemble_site(args.out, args.firmware, args.web)
        else:
            build_site(args.out, args.version or describe_version(), args.data, args.schema)
    except ReleaseError as e:
        sys.exit(f"release: {e}")


if __name__ == "__main__":
    main()
