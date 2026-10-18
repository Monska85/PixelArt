#!/usr/bin/env python3
"""Converts animation and playlist sources (YAML or JSON) to the JSON files the board reads.

    python3 tools/pixelart.py build [--source DIR] [--out DIR] [--schema]

Reads <source>/animations/*.yaml|*.json and <source>/playlists/*.yaml|*.json and
writes compact JSON to <out>/animations/<id>.json and <out>/playlists/<id>.json,
the layout of the board's file system. The file name (without extension) is
the ID. With --schema, every file is also checked against the JSON Schemas in
schema/ (needs the jsonschema package). The full validation, including
references between sprites, runs in the engine: see `make validate`.

Needs Python 3.8+ and PyYAML.
"""

import argparse
import json
import re
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    sys.exit("pixelart: PyYAML is required (pip install pyyaml)")

ROOT = Path(__file__).resolve().parent.parent
ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]{0,31}$")
KINDS = {"animations": "pixelart-1.schema.json", "playlists": "playlist-1.schema.json"}


class StrictLoader(yaml.SafeLoader):
    """Safe YAML loader that rejects duplicate keys and keys that are not text."""


def _construct_mapping(loader, node, deep=False):
    mapping = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        if not isinstance(key, str):
            raise yaml.constructor.ConstructorError(
                None, None, f"key {key!r} is not text (YAML reads words like on, off, yes, no as true/false: quote them)",
                key_node.start_mark)
        if key in mapping:
            raise yaml.constructor.ConstructorError(None, None, f"duplicate key {key!r}", key_node.start_mark)
        mapping[key] = loader.construct_object(value_node, deep=deep)
    return mapping


StrictLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, _construct_mapping)


def load_source(path):
    text = path.read_text(encoding="utf-8")
    if path.suffix == ".json":
        return json.loads(text)
    return yaml.load(text, Loader=StrictLoader)


def build(source, out, use_schema):
    validators = {}
    if use_schema:
        try:
            import jsonschema
        except ImportError:
            sys.exit("pixelart: --schema needs the jsonschema package (pip install jsonschema)")
        for kind, schema in KINDS.items():
            validators[kind] = jsonschema.Draft202012Validator(json.loads((ROOT / "schema" / schema).read_text()))

    errors = 0
    written = 0
    for kind in KINDS:
        files = sorted(p for p in (source / kind).glob("*") if p.suffix in (".yaml", ".yml", ".json"))
        ids = {}
        for path in files:
            name = path.stem
            if not ID_PATTERN.match(name):
                print(f"{path}: invalid file name: use lowercase letters, digits, _ and -", file=sys.stderr)
                errors += 1
                continue
            if name in ids:
                print(f"{path}: same ID as {ids[name]}", file=sys.stderr)
                errors += 1
                continue
            ids[name] = path
            try:
                document = load_source(path)
            except (yaml.YAMLError, json.JSONDecodeError) as e:
                print(f"{path}: {e}", file=sys.stderr)
                errors += 1
                continue
            if kind in validators:
                problems = sorted(validators[kind].iter_errors(document), key=lambda e: list(e.absolute_path))
                for problem in problems:
                    where = ".".join(str(p) for p in problem.absolute_path) or "(root)"
                    print(f"{path}: {where}: {problem.message}", file=sys.stderr)
                if problems:
                    errors += 1
                    continue
            target = out / kind / f"{name}.json"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(json.dumps(document, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
            written += 1
    print(f"pixelart: wrote {written} files to {out}" + (f", {errors} failed" if errors else ""))
    return 1 if errors else 0


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    b = sub.add_parser("build", help="convert sources to the board's JSON files")
    b.add_argument("--source", type=Path, default=ROOT, help="folder with animations/ and playlists/ (default: repository)")
    b.add_argument("--out", type=Path, default=ROOT / "data", help="output folder (default: data/)")
    b.add_argument("--schema", action="store_true", help="also check every file against the JSON Schemas")
    args = parser.parse_args()
    if args.command == "build":
        sys.exit(build(args.source, args.out, args.schema))


if __name__ == "__main__":
    main()
