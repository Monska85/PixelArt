#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Assemble the release sites: the firmware release, the content release and the site Pages serves.

  tools/release.py version
      Print the firmware version of this checkout (PIXELART_VERSION, else git).
  tools/release.py content-version
      Print the content version of this checkout (PIXELART_CONTENT_VERSION, else the nearest content-vX.Y.Z tag).
  tools/release.py build [--out site] [--schema]
      Collect the files of every board from the PlatformIO build folders, write the third-party notices of the
      firmware (tools/firmware_notices.py), and write the firmware release site: firmware files, their ESP Web
      Tools manifests and a manifest.json with no animations and no playlists. Run `make release-firmware` to
      build everything first.
  tools/release.py content [--out site] [--schema]
      Write the content release site from the converted files in data/ (`make data`): animations/, playlists/,
      schedules/, schedules-v2/, play/ (the play file `make data` builds from content/play.yaml, when that file exists) and a
      manifest.json with no firmware. Run `make release-content`.
  tools/release.py check-site URL
      Fail when URL (the address GitHub Pages announces or serves the site at) is not the site address computed
      from this environment by the rules of tools/site_url.py, the address a firmware built here looks for. It
      reads no firmware. Used by the release workflow before and after the deployment.
  tools/release.py assemble --out DIR [--firmware DIR] [--content DIR] [--web DIR] [--schema]
      Merge a firmware site (the output of `build`), a content site (the output of `content`) and a built web app
      into the site GitHub Pages serves. Used by the release workflow and `make release-site`.

The layout and the manifest are specified in docs/format/manifest-v1.md. `build` needs PlatformIO (pio) on the
PATH, PyYAML is not used here. --schema needs jsonschema. Needs Python 3.8+ and works on Linux and macOS.
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
PAGE_SCHEMA = ROOT / "schema" / "content-page-1.schema.json"
LEGACY_CATALOG = ROOT / "content" / "legacy-catalog.json"
FORMAT = "pixelart-manifest/1"
PAGE_FORMAT = "pixelart-content-page/1"

# board (PlatformIO environment) -> esptool chip, ESP Web Tools chip family, bootloader address
BOARDS = {
    "esp32c3": {"chip": "esp32c3", "family": "ESP32-C3", "bootloader": 0x0},
    "esp32": {"chip": "esp32", "family": "ESP32", "bootloader": 0x1000},
    "esp32s3": {"chip": "esp32s3", "family": "ESP32-S3", "bootloader": 0x0},
}
# The parts of a firmware release, in the order ESP Web Tools writes them. No file system part: the firmware formats
# its partition at the first boot, and a firmware release never writes it (docs/format/manifest-v1.md, Firmware files).
FIRMWARE_PARTS = ("bootloader", "partitions", "boot_app0", "app")
PARTITIONS_OFFSET = 0x8000
BOOT_APP0_OFFSET = 0xE000

ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]{0,31}$")

# What a board accepts in a manifest (docs/board/wifi-and-updates-v1.md, "Checks")
# A board reads up to 64 KiB over http, but over HTTPS the manifest must fit next to the TLS connection: about
# 26 KB on an ESP32-C3 (docs/board/wifi-and-updates-v1.md, Checks). A release stays under that with room to spare.
MAX_MANIFEST_BYTES = 20 * 1024
MAX_MANIFEST_FILES = 200
MAX_CONTENT_PAGE_BYTES = 8 * 1024
MAX_CONTENT_PAGE_ENTRIES = 32
MAX_CONTENT_PAGES = 20
MAX_PUBLISHED_FILES = 320
# Room each application keeps in its slot, so the next releases still fit the layout
SLOT_MARGIN = 64 * 1024

# Partition table entry types and subtypes (ESP-IDF)
TYPE_APP = 0x00
SUBTYPE_OTA_0 = 0x10
ENTRY_MAGIC = b"\xaa\x50"
ENTRY_SIZE = 32


class ReleaseError(Exception):
    """A failure the user should see, printed without a traceback."""


def describe_version():
    try:
        return fw_version.describe_version(ROOT)
    except ValueError as err:
        raise ReleaseError(str(err)) from err


def describe_content_version():
    try:
        return fw_version.describe_content_version(ROOT)
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
    }
    for path in sources.values():
        if not path.is_file():
            raise ReleaseError(f"{path} not found (pio run -e {board})")

    app = read_partitions(sources["partitions"])
    app_entry = find_partition(app, TYPE_APP, SUBTYPE_OTA_0, "first application")
    room = check_app_room(board, sources["app"].stat().st_size, app_entry[4])
    print(f"release: {board} application leaves {room} bytes free in its {app_entry[4]}-byte partition")
    app_bytes = sources["app"].read_bytes()
    if version.encode("ascii") not in app_bytes:
        raise ReleaseError(f"{board}: the firmware was not built with version {version}")
    check_firmware_address(board, app_bytes, site_address())

    offsets = {
        "bootloader": spec["bootloader"],
        "partitions": PARTITIONS_OFFSET,
        "boot_app0": BOOT_APP0_OFFSET,
        "app": app_entry[3],
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
    for part in (*FIRMWARE_PARTS, "factory"):
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


def manifest_text(document):
    """Compact only the published manifest; other JSON written here keeps its existing formatting."""
    return json.dumps(document, separators=(",", ":"), ensure_ascii=False) + "\n"


def write_json(path, document):
    path.write_text(json_text(document), encoding="utf-8")


def check_manifest_limits(manifest):
    """Refuses a manifest every board would refuse for its number of files or its size. A manifest of 200 files is over
    the size limit already, so the number is checked first and each limit gives its own message."""
    files = sum(len(manifest.get(key, [])) for key in PUBLISHED_KEYS)
    if files > MAX_MANIFEST_FILES:
        raise ReleaseError(f"manifest.json lists {files} animations, playlists, schedules and play files, more than the "
                           f"{MAX_MANIFEST_FILES} a board takes")
    size = len(manifest_text(manifest).encode("utf-8"))
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


def write_manifest(site, manifest, use_schema):
    """Validates the manifest (with the schema if asked), checks its limits and writes it as the site's manifest.json."""
    if use_schema:
        validate(manifest)
    check_manifest_limits(manifest)
    (site / "manifest.json").write_text(manifest_text(manifest), encoding="utf-8")


def legacy_entries(catalog):
    """The IDs explicitly selected for older clients, in the order a maintainer chose."""
    try:
        selection = json.loads(LEGACY_CATALOG.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise ReleaseError(f"cannot read the legacy catalog selection: {e}") from e
    if not isinstance(selection, dict) or set(selection) != set(CONTENT_KEYS):
        raise ReleaseError("the legacy catalog selection needs animations, playlists, schedules and play lists")
    legacy = {}
    for kind in CONTENT_KEYS:
        ids = selection[kind]
        if not isinstance(ids, list) or any(not isinstance(i, str) or not ID_PATTERN.fullmatch(i) for i in ids) or len(ids) != len(set(ids)):
            raise ReleaseError(f"the legacy catalog selection has invalid or repeated {kind} IDs")
        by_id = {entry["id"]: entry for entry in catalog[kind]}
        missing = [i for i in ids if i not in by_id]
        if missing:
            raise ReleaseError(f"the legacy catalog selection names an unpublished {kind} ID: {missing[0]}")
        legacy[kind] = [by_id[i] for i in ids]
    return legacy


def write_content_pages(site, catalog, use_schema):
    """Content-addressed page names avoid stale Pages caches across content releases."""
    pages = {}
    total = sum(len(catalog[kind]) for kind in PUBLISHED_KEYS)
    if total > MAX_PUBLISHED_FILES:
        raise ReleaseError(f"the content lists {total} files, more than the {MAX_PUBLISHED_FILES} paged catalog limit")
    count = 0
    for kind in PUBLISHED_KEYS:
        pages[kind] = []
        for offset in range(0, len(catalog[kind]), MAX_CONTENT_PAGE_ENTRIES):
            document = {"format": PAGE_FORMAT, "kind": kind, "entries": catalog[kind][offset:offset + MAX_CONTENT_PAGE_ENTRIES]}
            if use_schema:
                validate_page(document)
            body = manifest_text(document).encode("utf-8")
            if len(body) > MAX_CONTENT_PAGE_BYTES:
                raise ReleaseError(f"a {kind} content page exceeds {MAX_CONTENT_PAGE_BYTES} bytes")
            digest = hashlib.sha256(body).hexdigest()
            name = f"content-pages/{kind}-{digest[:16]}.json"
            target = site / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(body)
            pages[kind].append({"file": name, "size": len(body), "sha256": digest})
            count += 1
    if count > MAX_CONTENT_PAGES:
        raise ReleaseError(f"the content lists {count} pages, more than the {MAX_CONTENT_PAGES} page limit")
    return pages


def validate_page(document):
    try:
        import jsonschema
    except ImportError:
        raise ReleaseError("--schema needs the jsonschema package (pip install jsonschema)")
    schema = json.loads(PAGE_SCHEMA.read_text(encoding="utf-8"))
    problem = next(jsonschema.Draft202012Validator(schema).iter_errors(document), None)
    if problem:
        raise ReleaseError(f"content page does not match {PAGE_SCHEMA.name}: {problem.message}")


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


def build_site(out, version, use_schema):
    """The firmware release site: firmware files and manifests, no animations, playlists, schedules or play files."""
    if not fw_version.SAFE_VERSION.fullmatch(version):
        raise ReleaseError(f"'{version}' is not a valid version")
    site = site_path(out)
    reset_site(site)

    boot_app0 = boot_app0_path()
    firmware = []
    for board in BOARDS:
        firmware += build_board(board, version, site, boot_app0)

    source = source_url()
    manifest = {
        "format": FORMAT,
        "version": version,
        "released": released_date(),
        "source": source,
        "firmware": firmware,
        "animations": [],
        "playlists": [],
    }
    write_manifest(site, manifest, use_schema)
    try:
        notices = firmware_notices.build_notices(version, source)
    except firmware_notices.NoticesError as e:
        raise ReleaseError(f"third-party notices: {e}")
    (site / "firmware" / "THIRD_PARTY_NOTICES.txt").write_text(notices, encoding="utf-8")

    write_json(site / "firmware" / "install.json", web_tools_manifest(version, firmware, list(FIRMWARE_PARTS), True))
    write_json(site / "firmware" / "update.json", web_tools_manifest(version, firmware, list(FIRMWARE_PARTS), False))
    print(f"release: firmware version {version}, {len(firmware)} firmware files in {site}")


def build_content_site(out, version, data, use_schema):
    """The content release site: the animations, playlists, schedules and play file of `data` and a manifest with no
    firmware."""
    if not fw_version.SAFE_VERSION.fullmatch(version):
        raise ReleaseError(f"'{version}' is not a valid version")
    site = site_path(out)
    reset_site(site)

    animations = collect_documents(Path(data), "animations", site, True)
    playlists = collect_documents(Path(data), "playlists", site, False)
    if not animations or not playlists:
        raise ReleaseError(f"{data} has no animations or no playlists: run make data")
    schedules = collect_documents(Path(data), "schedules", site, False)
    schedules_v2 = collect_documents(Path(data), "schedules-v2", site, False)
    play = collect_documents(Path(data), "play", site, False)

    catalog = {"animations": animations, "playlists": playlists, "schedules": schedules,
               "schedules_v2": schedules_v2, "play": play}
    legacy = legacy_entries(catalog)
    pages = write_content_pages(site, catalog, use_schema)
    v2_pages = pages.pop("schedules_v2")
    manifest = {
        "format": FORMAT,
        "version": version,
        "released": released_date(),
        "source": source_url(),
        "content_version": version,
        "animations": legacy["animations"],
        "playlists": legacy["playlists"],
        "schedules": legacy["schedules"],
        "content_pages": pages,
    }
    # A content without a play.yaml has no play file in data/play/ (make data removes an old one) and no list
    if legacy["play"]:
        manifest["play"] = legacy["play"]
    if v2_pages:
        manifest["schedules_v2_pages"] = v2_pages
    write_manifest(site, manifest, use_schema)
    print(f"release: content version {version}, {len(animations)} animations, {len(playlists)} playlists, "
          f"{len(schedules)} schedules, {len(play)} play files in {site}")


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


# What an archive may hold besides its manifest.json. A firmware release published before the content package also
# carries animations/ and playlists/; no firmware release carries schedules/ or play/.
FIRMWARE_FOLDERS = ("firmware/", "animations/", "playlists/")
CONTENT_FOLDERS = ("animations/", "playlists/", "schedules/", "schedules-v2/", "play/", "content-pages/")
# The manifest lists of the content, which the 200-entry limit counts. schedules and play are optional.
CONTENT_KEYS = ("animations", "playlists", "schedules", "play")
PUBLISHED_KEYS = ("animations", "playlists", "schedules", "schedules_v2", "play")


def read_release_manifest(folder, label, files):
    """The manifest.json of a firmware or content site, as a dict of format pixelart-manifest/1."""
    if "manifest.json" not in files:
        raise ReleaseError(f"the {label} folder {folder} has no manifest.json")
    try:
        manifest = json.loads((Path(folder) / "manifest.json").read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise ReleaseError(f"the manifest.json of the {label} folder cannot be read: {e}")
    if not isinstance(manifest, dict) or manifest.get("format") != FORMAT:
        raise ReleaseError(f"the manifest.json of the {label} folder is not a {FORMAT} manifest")
    for key in (*PUBLISHED_KEYS, "schedules_v2_pages", "firmware"):
        if key in manifest and not (isinstance(manifest[key], list) and all(isinstance(e, dict) for e in manifest[key])):
            raise ReleaseError(f"the manifest.json of the {label} folder has a bad {key} list")
    if "content_pages" in manifest:
        pages = manifest["content_pages"]
        if not isinstance(pages, dict) or any(k in PUBLISHED_KEYS and
                                               (not isinstance(v, list) or any(not isinstance(p, dict) for p in v))
                                               for k, v in pages.items()):
            raise ReleaseError(f"the manifest.json of the {label} folder has bad content_pages")
    return manifest


def assembled_manifest(firmware, content):
    """The manifest of the site, by docs/format/manifest-v1.md, Assembling the site. Either input may be None."""
    if firmware is None:
        # A content release has no firmware: its manifest is the site's as it is
        manifest = dict(content)
    elif content is None:
        manifest = dict(firmware)
    else:
        manifest = merged_manifest(firmware, content)
    manifest.setdefault("animations", [])
    manifest.setdefault("playlists", [])
    return manifest


def merged_manifest(firmware, content):
    """The firmware's manifest with the content release's version, animations, playlists, schedules and play files."""
    version = content.get("version")
    if not isinstance(version, str) or not fw_version.SAFE_VERSION.fullmatch(version):
        raise ReleaseError("the content manifest has no valid version")
    manifest = {key: firmware[key] for key in ("format", "version", "released", "source") if key in firmware}
    manifest["content_version"] = version
    if "firmware" in firmware:
        manifest["firmware"] = firmware["firmware"]
    manifest["animations"] = content.get("animations", [])
    manifest["playlists"] = content.get("playlists", [])
    # A content release made before schedules has no list, and the site then has none either
    if "schedules" in content:
        manifest["schedules"] = content["schedules"]
    if "play" in content:
        manifest["play"] = content["play"]
    if "content_pages" in content:
        manifest["content_pages"] = content["content_pages"]
    for key in ("schedules_v2", "schedules_v2_pages"):
        if key in content:
            manifest[key] = content[key]
    return manifest


def check_listed_files(manifest, copied):
    """Every file the manifest names must be in the site, or a board and the web app would meet a missing file."""
    entries = [e for key in ("firmware", *PUBLISHED_KEYS) for e in manifest.get(key, [])]
    for entry in entries:
        name = entry.get("file")
        if not isinstance(name, str) or name not in copied:
            raise ReleaseError(f"the manifest lists {name!r}, which the assembled site does not hold")
    for pages in manifest.get("content_pages", {}).values():
        for page in pages:
            name = page.get("file")
            if not isinstance(name, str) or name not in copied:
                raise ReleaseError(f"the manifest lists page {name!r}, which the assembled site does not hold")
    for page in manifest.get("schedules_v2_pages", []):
        name = page.get("file")
        if not isinstance(name, str) or name not in copied:
            raise ReleaseError(f"the manifest lists page {name!r}, which the assembled site does not hold")


def check_content_pages(manifest, folder, copied, use_schema):
    """Check the referenced bytes and every published path before assembling a release archive."""
    pages = dict(manifest.get("content_pages", {}))
    locations = sum(("schedules_v2" in manifest, "schedules_v2_pages" in manifest,
                     "schedules_v2" in pages))
    if locations > 1:
        raise ReleaseError("schedules_v2 is declared in more than one catalog")
    if "schedules_v2_pages" in manifest:
        pages["schedules_v2"] = manifest["schedules_v2_pages"]
    if not pages:
        return
    if not isinstance(pages, dict) or any(kind in PUBLISHED_KEYS and not isinstance(refs, list)
                                        for kind, refs in pages.items()):
        raise ReleaseError("the content manifest has invalid page lists")
    if sum(len(refs) for kind, refs in pages.items() if kind in PUBLISHED_KEYS) > MAX_CONTENT_PAGES:
        raise ReleaseError("the content manifest lists too many pages")
    seen_paths = set()
    total = sum(len(manifest.get(kind, [])) for kind in PUBLISHED_KEYS if kind not in pages)
    for kind, refs in pages.items():
        if kind not in PUBLISHED_KEYS:
            continue
        seen_ids = set()
        for ref in refs:
            if not isinstance(ref, dict):
                raise ReleaseError("the content manifest has an invalid page reference")
            name, size, digest = ref.get("file"), ref.get("size"), ref.get("sha256")
            if (not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9._+-]+(?:/[A-Za-z0-9._+-]+)*", name)
                    or any(part in (".", "..") for part in name.split("/")) or len(name) > 160
                    or name in seen_paths or name not in copied):
                raise ReleaseError(f"invalid or missing content page path {name!r}")
            seen_paths.add(name)
            path = folder / name
            try:
                matches = path.stat().st_size == size and sha256_of(path) == digest
            except OSError as e:
                raise ReleaseError(f"content page {name!r} cannot be read: {e}") from e
            if (type(size) is not int or not 1 <= size <= MAX_CONTENT_PAGE_BYTES or
                    not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest) or not matches):
                raise ReleaseError(f"content page {name!r} does not match its declared size and SHA-256")
            try:
                document = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError, UnicodeError) as e:
                raise ReleaseError(f"content page {name!r} cannot be read: {e}") from e
            if (not isinstance(document, dict) or document.get("format") != PAGE_FORMAT or
                    document.get("kind") != kind or not isinstance(document.get("entries"), list) or
                    not 1 <= len(document["entries"]) <= MAX_CONTENT_PAGE_ENTRIES):
                raise ReleaseError(f"content page {name!r} has the wrong format, kind or count")
            if use_schema:
                validate_page(document)
            for entry in document["entries"]:
                if not isinstance(entry, dict) or not isinstance(entry.get("id"), str):
                    raise ReleaseError(f"content page {name!r} has an invalid entry")
                item_id = entry["id"]
                item_path = entry.get("file")
                expected_path = f"{('schedules-v2' if kind == 'schedules_v2' else kind)}/{item_id}.json"
                item_size, item_sha = entry.get("size"), entry.get("sha256")
                limit = {"animations": 65536, "playlists": 16384, "schedules": 16384,
                         "schedules_v2": 16384, "play": 1024}[kind]
                if (item_id in seen_ids or not ID_PATTERN.fullmatch(item_id) or item_path != expected_path or
                        item_path not in copied or type(item_size) is not int or item_size < 1 or
                        item_size > limit or not isinstance(item_sha, str) or not re.fullmatch(r"[0-9a-f]{64}", item_sha)):
                    raise ReleaseError(f"content page {name!r} repeats an ID or has an invalid file entry")
                name_value = entry.get("name")
                if (kind == "animations" and
                        (not isinstance(name_value, str) or not 1 <= len(name_value) <= 128 or
                         type(entry.get("version")) is not int or not 1 <= entry["version"] <= 2147483647)):
                    raise ReleaseError(f"content page {name!r} has invalid animation metadata")
                if (kind in ("playlists", "schedules", "schedules_v2") and "name" in entry and
                        (not isinstance(name_value, str) or not 1 <= len(name_value) <= 128)):
                    raise ReleaseError(f"content page {name!r} has invalid name")
                item_file = folder / item_path
                try:
                    matches = item_file.stat().st_size == item_size and sha256_of(item_file) == item_sha
                except OSError as e:
                    raise ReleaseError(f"content page {name!r} names an unreadable file: {e}") from e
                if not matches:
                    raise ReleaseError(f"content page {name!r} names a file with mismatched size or SHA-256")
                seen_ids.add(item_id)
            total += len(document["entries"])
            if total > MAX_PUBLISHED_FILES:
                raise ReleaseError("the content pages list too many files")


def drop_superseded(label, files, has_content):
    """The files of a folder that the site takes from it.

    Legacy: a firmware release published before the content package carries animations/ and playlists/ too. They give
    way to the content release's. This can go once every published firmware release is newer than the content package.
    """
    if label == "firmware" and has_content:
        return [n for n in files if not n.startswith(CONTENT_FOLDERS)]
    return files


def plan_site(site, firmware, content, web, use_schema):
    """Every check of the merge, with nothing written: the files to copy from each folder, as {label: (folder, names)},
    and the manifest to write, or None when no input holds one."""
    inputs = [(label, Path(path)) for label, path in (("firmware", firmware), ("content", content), ("web", web)) if path]
    # Listed first, as given: a link must be seen before it is resolved
    listed = {label: (path, list_tree(path, label)) for label, path in inputs}
    for label, (path, _) in listed.items():
        real = path.resolve()
        if site == real or site in real.parents or real in site.parents:
            raise ReleaseError(f"the site folder {site} and the {label} folder {real} must not contain each other")

    manifests = {}
    for label, allowed in (("firmware", FIRMWARE_FOLDERS), ("content", CONTENT_FOLDERS)):
        if label in listed:
            path, files = listed[label]
            manifests[label] = read_release_manifest(path, label, files)
            stray = [n for n in files if n != "manifest.json" and not n.startswith(allowed)]
            if stray:
                raise ReleaseError(f"the {label} folder holds {stray[0]}, outside {', '.join(allowed)}")

    # The site's manifest.json is written from the manifests, so the folders' own are not copied
    plan = {}
    for label, (path, files) in listed.items():
        if label in manifests:
            files = [n for n in files if n != "manifest.json"]
        plan[label] = (path, drop_superseded(label, files, "content" in listed))

    manifest = None
    if manifests:
        manifest = assembled_manifest(manifests.get("firmware"), manifests.get("content"))
        if "manifest.json" in plan.get("web", (None, []))[1]:
            raise ReleaseError("the web app holds manifest.json, which the site's manifest would replace")
        check_listed_files(manifest, {n for _, files in plan.values() for n in files})
        if "content" in plan:
            check_content_pages(manifest, plan["content"][0], set(plan["content"][1]),
                                use_schema)
        check_manifest_limits(manifest)
        if use_schema:
            validate(manifest)

    labels = list(plan)
    for i, first in enumerate(labels):
        for second in labels[i + 1 :]:
            conflicts = find_conflicts(plan[first][1], plan[second][1])
            if conflicts:
                shown = ", ".join(conflicts[:10]) + (f" and {len(conflicts) - 10} more" if len(conflicts) > 10 else "")
                raise ReleaseError(f"the {first} and the {second} both hold: {shown}")
    return plan, manifest


def assemble_site(out, firmware, content, web, use_schema=False):
    """Merge the firmware site, the content site and the web app into `out`. A path in two of them is an error and
    nothing is written."""
    if firmware is None and content is None and web is None:
        raise ReleaseError("assemble needs --firmware, --content, --web or several of them")
    site = site_path(out)
    plan, manifest = plan_site(site, firmware, content, web, use_schema)

    reset_site(site)
    for label, (path, files) in plan.items():
        for name in files:
            target = site / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path / name, target)
        print(f"release: {len(files)} files of the {label} copied to {site}")
    if manifest is not None:
        (site / "manifest.json").write_text(manifest_text(manifest), encoding="utf-8")
        print(f"release: manifest.json written, content version {manifest.get('content_version', 'none')}")


def check_version(manifest_path, tag_prefix):
    """The tag of a release must name the version the build produced. RELEASE_TAG is empty on a dry run, which must
    then have no version set either."""
    env_name = {"v": "PIXELART_VERSION", "content-v": "PIXELART_CONTENT_VERSION"}[tag_prefix]
    try:
        manifest = json.loads(Path(manifest_path).read_text(encoding="utf-8"))
        built = manifest["version"]
    except (OSError, ValueError, KeyError, TypeError) as e:
        raise ReleaseError(f"{manifest_path} cannot be read: {e}")
    kind = "content" if tag_prefix == "content-v" else "firmware"
    if kind == "content" and manifest.get("content_version") != built:
        raise ReleaseError(f"the content manifest has version {built} and content_version {manifest.get('content_version')}")
    tag = os.environ.get("RELEASE_TAG", "")
    if tag:
        if tag != tag_prefix + built:
            raise ReleaseError(f"the release is {tag} but the {kind} is version {built}")
    elif os.environ.get(env_name):
        raise ReleaseError(f"{env_name} is set without a release tag")
    print(f"{kind} release version {built}")


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("version", help="print the firmware version of this checkout")
    commands.add_parser("content-version", help="print the content version of this checkout")
    build = commands.add_parser("build", help="assemble the firmware release site from the build folders")
    build.add_argument("--out", default="site", help="site folder, replaced if it exists (default: site)")
    build.add_argument("--schema", action="store_true", help="check manifest.json against the JSON Schema")
    content = commands.add_parser("content", help="assemble the content release site from data/")
    content.add_argument("--out", default="site", help="site folder, replaced if it exists (default: site)")
    content.add_argument("--schema", action="store_true", help="check manifest.json against the JSON Schema")
    check = commands.add_parser("check-site", help="check the address the site is served at against the firmware's")
    check.add_argument("url", help="the address Pages serves the site at")
    assemble = commands.add_parser("assemble", help="merge a firmware site, a content site and a web app into one site")
    assemble.add_argument("--out", required=True, help="site folder, replaced if it is site/ or a site built by this tool")
    assemble.add_argument("--firmware", help="the firmware site made by `build`")
    assemble.add_argument("--content", help="the content site made by `content`")
    assemble.add_argument("--web", help="the built web app (web/dist)")
    assemble.add_argument("--schema", action="store_true", help="check the site's manifest.json against the JSON Schema")
    version_check = commands.add_parser("check-version", help="check the release tag against the version of a built manifest")
    version_check.add_argument("--manifest", required=True, help="the manifest.json the build wrote")
    version_check.add_argument("--tag-prefix", required=True, choices=("v", "content-v"), help="v for the firmware, content-v for the content")
    args = parser.parse_args()

    try:
        if args.command == "version":
            print(describe_version())
        elif args.command == "content-version":
            print(describe_content_version())
        elif args.command == "check-site":
            check_site(args.url)
        elif args.command == "check-version":
            check_version(args.manifest, args.tag_prefix)
        elif args.command == "assemble":
            assemble_site(args.out, args.firmware, args.content, args.web, args.schema)
        elif args.command == "content":
            build_content_site(args.out, describe_content_version(), ROOT / "data", args.schema)
        else:
            build_site(args.out, describe_version(), args.schema)
    except ReleaseError as e:
        sys.exit(f"release: {e}")


if __name__ == "__main__":
    main()
