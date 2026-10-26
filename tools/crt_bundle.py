#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""The certificate bundle the board checks HTTPS servers with (certs/README.md).

  tools/crt_bundle.py regenerate
      Download Espressif's bundle generator, the Mozilla certificate list and
      the list of common roots from esp-idf at the tag the framework is built
      from, check their SHA-256, and write certs/x509_crt_bundle.bin.

  tools/crt_bundle.py check
      Make the bundle the same way into a temporary folder and fail unless it
      is byte for byte the committed certs/x509_crt_bundle.bin. CI runs it.

Needs the cryptography package (requirements-ci.txt), Python 3.8+, and works
on Linux and macOS.
"""

import argparse
import hashlib
import shutil
import struct
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUNDLE = ROOT / "certs" / "x509_crt_bundle.bin"

# The esp-idf release of Arduino-ESP32 3.3.12 (its versions.txt), and the files
# of components/mbedtls/esp_crt_bundle at that tag, with their SHA-256.
IDF_TAG = "v5.5.5"
SOURCE_URL = "https://raw.githubusercontent.com/espressif/esp-idf/{tag}/components/mbedtls/esp_crt_bundle/{name}"
SOURCES = {
    "gen_crt_bundle.py": "367c046ed8138862e345b59620657f5fe7ec9af3d24f618a73fc17069cd7ef35",
    "cacrt_all.pem": "50a6277ec69113f00c5fd45f09e8b97a4b3e32daa35d3a95ab30137a55386cef",
    "cmn_crt_authorities.csv": "f9c291229eb867620f3deef9baa3fc2d1e0da1021b682bea1c31f3e85f986b79",
}


class BundleError(Exception):
    pass


def read_bundle(data):
    """The roots of a bundle as [(subject DER, public key DER)]. The bundle starts
    with the offset of each certificate (4 bytes each, little endian); each
    certificate is the length of its subject and of its key (2 bytes each), then both."""
    if len(data) < 4:
        raise BundleError("the bundle is empty")
    first = struct.unpack_from("<I", data, 0)[0]
    if first == 0 or first % 4 or first > len(data):
        raise BundleError("the bundle does not start with its offsets")
    roots = []
    for offset in struct.unpack_from("<%dI" % (first // 4), data, 0):
        if offset + 4 > len(data):
            raise BundleError("an offset is past the end of the bundle")
        name_len, key_len = struct.unpack_from("<HH", data, offset)
        end = offset + 4 + name_len + key_len
        if end > len(data):
            raise BundleError("a certificate is past the end of the bundle")
        roots.append((data[offset + 4 : offset + 4 + name_len], data[offset + 4 + name_len : end]))
    return roots


def fetch(name, folder):
    url = SOURCE_URL.format(tag=IDF_TAG, name=name)
    with urllib.request.urlopen(url, timeout=60) as response:
        body = response.read()
    digest = hashlib.sha256(body).hexdigest()
    if digest != SOURCES[name]:
        raise BundleError("%s has SHA-256 %s, expected %s" % (url, digest, SOURCES[name]))
    (folder / name).write_bytes(body)


def generate(output):
    """Makes the bundle from the pinned esp-idf files and writes it to `output`."""
    with tempfile.TemporaryDirectory() as tmp:
        folder = Path(tmp)
        for name in SOURCES:
            fetch(name, folder)
        command = [sys.executable, "-I", "gen_crt_bundle.py", "-q", "-i", "cacrt_all.pem", "-f", "cmn_crt_authorities.csv"]
        result = subprocess.run(command, cwd=folder, capture_output=True, text=True)
        if result.returncode != 0:
            raise BundleError("gen_crt_bundle.py failed:\n%s%s" % (result.stdout, result.stderr))
        shutil.copyfile(folder / "x509_crt_bundle", output)


def regenerate():
    generate(BUNDLE)
    roots = read_bundle(BUNDLE.read_bytes())
    print("%s: %d roots, %d bytes" % (BUNDLE.relative_to(ROOT), len(roots), BUNDLE.stat().st_size))


def check(make=generate):
    """Fails unless a bundle made again is the committed one, byte for byte."""
    with tempfile.TemporaryDirectory() as tmp:
        made = Path(tmp) / "x509_crt_bundle.bin"
        make(made)
        fresh, committed = made.read_bytes(), BUNDLE.read_bytes()
    if fresh != committed:
        raise BundleError(
            "the bundle made from esp-idf %s (%d roots, %d bytes) differs from %s (%d roots, %d bytes): "
            "run tools/crt_bundle.py regenerate, see certs/README.md"
            % (IDF_TAG, len(read_bundle(fresh)), len(fresh), BUNDLE.relative_to(ROOT), len(read_bundle(committed)), len(committed))
        )
    print("%s: the same as the bundle made from esp-idf %s" % (BUNDLE.relative_to(ROOT), IDF_TAG))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["regenerate", "check"])
    args = parser.parse_args()
    try:
        regenerate() if args.command == "regenerate" else check()
    except (BundleError, OSError) as error:
        sys.exit("crt_bundle: %s" % error)


if __name__ == "__main__":
    main()
