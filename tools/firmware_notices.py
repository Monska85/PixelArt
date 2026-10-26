#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""The third-party notices of the firmware (LICENSES/README.md).

  tools/firmware_notices.py --version VERSION --out FILE [--source URL]
      Read the link map of every board in .pio/build/, list the third-party
      software each firmware links, and write the notices with the full text
      of every license. `make release-firmware` writes them into the release
      site through tools/release.py.

The link map says which archives were linked and from which package, so the
notices follow the build: the versions are read from the framework's library
packages and the compiler, and checked against the versions the texts in
LICENSES/firmware/ were taken from. An archive no section of
LICENSES/firmware.json names fails the run, so a new dependency cannot be
shipped without its notice.
"""

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUILD_DIR = ROOT / ".pio" / "build"
LIBDEPS_DIR = ROOT / ".pio" / "libdeps"
LICENSES = ROOT / "LICENSES"
CONFIG = LICENSES / "firmware.json"
BOARDS = ("esp32c3", "esp32", "esp32s3")
REPOSITORY = "https://github.com/Monska85/PixelArt"


class NoticesError(Exception):
    pass


def linked_archives(map_text):
    """The archives the linker took members from: the paths of the "Archive member included" section of a map."""
    start = map_text.find("Archive member included")
    if start < 0:
        raise NoticesError("the link map has no list of included archive members")
    section = map_text[start:]
    end = re.search(r"^(Discarded input sections|Allocating common symbols|Memory Configuration)", section, re.M)
    if end:
        section = section[: end.start()]
    return sorted({m.group(1) for m in re.finditer(r"^(\S[^\n(]*?\.a)\(", section, re.M)})


def package_root(path):
    """The PlatformIO package an archive comes from: the folder below `packages/`, or None for a project build."""
    parts = Path(path).parts
    if "packages" not in parts:
        return None
    i = len(parts) - 1 - parts[::-1].index("packages")
    return Path(*parts[: i + 2])


def read_versions(libs_root):
    """versions.txt of a framework library package: name to the first word of its value."""
    versions = {}
    for line in (libs_root / "versions.txt").read_text(encoding="utf-8").splitlines():
        name, sep, value = line.partition(":")
        if sep and value.split():
            versions[name.strip()] = value.split()[0]
    return versions


def package_version(root):
    return json.loads((root / "package.json").read_text(encoding="utf-8"))["version"]


def library_metadata(folder):
    """Version and source URL of a PlatformIO library from library.json or library.properties."""
    meta = folder / "library.json"
    if meta.is_file():
        data = json.loads(meta.read_text(encoding="utf-8"))
        repo = data.get("repository")
        url = repo.get("url") if isinstance(repo, dict) else repo
        url = url or ""
        return data.get("version"), url[: -len(".git")] if url.endswith(".git") else url
    props = {}
    for line in (folder / "library.properties").read_text(encoding="utf-8").splitlines():
        key, sep, value = line.partition("=")
        if sep:
            props[key.strip()] = value.strip()
    return props.get("version"), props.get("url", "")


class Notices:
    def __init__(self, config, project_libs):
        self.config = config
        self.project_libs = project_libs
        self.by_archive = {}
        for index, section in enumerate(config["sections"]):
            for archive in section["archives"]:
                self.by_archive.setdefault(archive, []).append(index)
        # Per section and per library: the boards that link it and the version and files found in the build
        self.sections = {}
        self.libraries = {}

    def add_board(self, board, archives, libdeps_dir):
        libs_root = tool_root = None
        for path in archives:
            root = package_root(path)
            if root is not None and root.name.startswith("framework-arduinoespressif32-") and root.name.endswith("-libs"):
                libs_root = root
            elif root is not None and root.name.startswith("toolchain-"):
                tool_root = root
        if libs_root is None or tool_root is None:
            raise NoticesError(f"{board}: the link map names no framework library package or no compiler package")
        versions = read_versions(libs_root)
        arduino = package_version(libs_root)
        toolchain = package_version(tool_root)
        self.check_pins(board, versions, arduino)

        used = set()
        linked_libs = set()
        for path in archives:
            name = Path(path).name
            root = package_root(path)
            stem = name[len("lib"):-len(".a")] if name.startswith("lib") else name
            if root is None and stem in self.project_libs:
                linked_libs.add(stem)
                continue
            if root is None and (libdeps_dir / stem).is_dir():
                self.add_library(board, libdeps_dir / stem)
                continue
            if name not in self.by_archive:
                raise NoticesError(f"{board}: {path} is linked but no section of {CONFIG.relative_to(ROOT)} names {name}")
            used.update(self.by_archive[name])
        for index, section in enumerate(self.config["sections"]):
            if section.get("always"):
                used.add(index)
        # A library that has no archive of its own (only headers) is compiled into the project library that needs it
        for lib in sorted(linked_libs):
            meta = self.project_libs[lib]
            for dependency in meta.get("dependencies", {}):
                folder = libdeps_dir / dependency.split("/")[-1]
                if folder.is_dir():
                    self.add_library(board, folder)
        for index in used:
            section = self.config["sections"][index]
            version = self.section_version(section, versions, arduino, toolchain)
            entry = self.sections.setdefault(index, {"boards": set(), "versions": set(), "files": []})
            entry["boards"].add(board)
            entry["versions"].add(version)
            for file in section["files"]:
                text = self.read_file(file, tool_root)
                if text not in entry["files"]:
                    entry["files"].append(text)

    def check_pins(self, board, versions, arduino):
        pins = self.config["pins"]
        found = {"esp-idf": versions.get("esp-idf"), "arduino": arduino}
        expected = {"esp-idf": pins["esp-idf"], "arduino": pins["arduino"]}
        for name, version in pins["components"].items():
            if name in versions:
                found[name] = versions[name]
                expected[name] = version
        for name, version in expected.items():
            if found[name] != version:
                raise NoticesError(f"{board}: the build uses {name} {found[name]}, but the texts in LICENSES/firmware/ "
                                   f"are those of {version}: take them again from the new version (LICENSES/README.md)")

    def section_version(self, section, versions, arduino, toolchain):
        kind = section["version"]
        if kind == "esp-idf":
            return versions["esp-idf"]
        if kind == "arduino":
            return arduino
        if kind == "toolchain":
            return toolchain
        if kind.startswith("component:"):
            name = kind.split(":", 1)[1]
            if name not in versions:
                raise NoticesError(f"versions.txt names no component {name}")
            return versions[name]
        raise NoticesError(f"unknown version source '{kind}'")

    def read_file(self, file, tool_root):
        if file.startswith("toolchain:"):
            path = tool_root / file.split(":", 1)[1]
        else:
            path = LICENSES / "firmware" / file
        if not path.is_file():
            raise NoticesError(f"{path} not found")
        return (path.name, path.read_text(encoding="utf-8", errors="replace"))

    def add_library(self, board, folder):
        name = folder.name.split("@", 1)[0]
        known = self.config["libraries"].get(name)
        if known is None:
            raise NoticesError(f"{board}: the library {folder.name} is linked but {CONFIG.relative_to(ROOT)} does not name it")
        version, url = library_metadata(folder)
        entry = self.libraries.setdefault(name, {"boards": set(), "versions": set(), "url": url, "files": []})
        entry["boards"].add(board)
        entry["versions"].add(version)
        for file in known["files"]:
            path = folder / file
            if not path.is_file():
                raise NoticesError(f"{path} not found: the license file of {folder.name}")
            text = (file, path.read_text(encoding="utf-8", errors="replace"))
            if text not in entry["files"]:
                entry["files"].append(text)

    def render(self, version, source):
        texts = []  # (label, text) in order of first use

        def refs(files, owner):
            numbers = []
            for name, text in files:
                key = hashlib.sha256(text.encode("utf-8")).hexdigest()
                for i, (k, _, _) in enumerate(texts):
                    if k == key:
                        numbers.append(i + 1)
                        break
                else:
                    texts.append((key, f"{owner}: {name}", text))
                    numbers.append(len(texts))
            return ", ".join(f"[{n}]" for n in numbers)

        entries = []
        for index in sorted(self.sections):
            section, found = self.config["sections"][index], self.sections[index]
            v = ", ".join(sorted(found["versions"]))
            entries.append((section["name"], v, section["license"], section["source"].replace("{version}", v),
                            sorted(found["boards"]), refs(found["files"], section["name"])))
        for name in sorted(self.libraries):
            found = self.libraries[name]
            v = ", ".join(sorted(found["versions"]))
            entries.append((name, v, self.config["libraries"][name]["license"], found["url"], sorted(found["boards"]),
                            refs(found["files"], name)))

        lines = [
            f"PixelArt firmware {version}: third-party notices",
            "",
            "The PixelArt firmware is free software: you can redistribute it and/or modify it under the terms of the",
            "GNU General Public License, version 3 or (at your option) any later version, with the additional",
            "permission in LICENSE-EXCEPTION for the binary-only libraries Espressif distributes. The source code,",
            "LICENSE and LICENSE-EXCEPTION are at:",
            "",
            f"    {source}",
            "",
            "The firmware of each board (" + ", ".join(BOARDS) + ") contains the third-party software below, as the",
            "build linked it. Each entry names its license; the full texts follow the list, numbered.",
            "",
        ]
        for n, (name, v, license, src, boards, numbers) in enumerate(entries, 1):
            lines += [f"{n}. {name}", f"   Version: {v}", f"   License: {license}", f"   Source: {src}",
                      f"   Boards: {', '.join(boards)}", f"   License text: {numbers}", ""]
        lines += ["", "License texts", "============="]
        for i, (_, label, text) in enumerate(texts, 1):
            lines += ["", f"[{i}] {label}", "-" * 78, text.rstrip("\n"), ""]
        return "\n".join(lines) + "\n"


def project_libraries(root=ROOT):
    """The project's own libraries in lib/, with their library.json."""
    libs = {}
    for folder in sorted((root / "lib").iterdir()):
        meta = folder / "library.json"
        if meta.is_file():
            libs[folder.name] = json.loads(meta.read_text(encoding="utf-8"))
    return libs


def build_notices(version, source, build_dir=BUILD_DIR, libdeps_dir=LIBDEPS_DIR):
    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    notices = Notices(config, project_libraries())
    for board in BOARDS:
        path = build_dir / board / "firmware.map"
        if not path.is_file():
            raise NoticesError(f"{path} not found (pio run -e {board})")
        archives = linked_archives(path.read_text(encoding="utf-8", errors="replace"))
        notices.add_board(board, archives, libdeps_dir / board)
    return notices.render(version, source)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--version", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--source", default=REPOSITORY)
    args = parser.parse_args()
    try:
        Path(args.out).write_text(build_notices(args.version, args.source), encoding="utf-8")
    except (NoticesError, OSError, ValueError, KeyError) as error:
        sys.exit(f"firmware_notices: {error}")


if __name__ == "__main__":
    main()
