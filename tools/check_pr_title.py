"""Checks that a pull request title is a conventional commit release-please accepts.

main takes squash merges only, and the squash commit takes the pull request's title, so the title becomes the commit
message release-please reads. The rule is in README.md, "Contributing". Standard library only.

    python3 tools/check_pr_title.py "feat(web): add a dark theme"
"""

import re
import sys

TYPES = ("feat", "fix", "docs", "ci", "chore", "refactor", "perf", "test", "build", "style", "revert")

# type, optional (scope), optional ! for a breaking change, ": ", then a description that does not start with a
# capital letter or a space and does not end with a period or a space.
TITLE = re.compile(
    r"(?P<type>" + "|".join(TYPES) + r")"
    r"(?:\((?P<scope>[a-z0-9][a-z0-9._/-]*)\))?"
    r"(?P<breaking>!)?"
    r": (?P<description>[^A-Z\s](?:.*[^.\s])?)"
)


def problem(title):
    """Why the title is refused, or None when it is accepted."""
    match = TITLE.fullmatch(title)
    # The pattern only knows A to Z: a capital letter of any alphabet, such as É, is refused here.
    if match and not match["description"][0].isupper():
        return None
    head, sep, description = title.partition(": ")
    if not sep:
        return 'it must start with a type and ": ", for example "fix: keep the brightness after a restart"'
    kind = re.sub(r"\(.*\)|!$", "", head)
    if kind not in TYPES:
        return f"the type must be one of {', '.join(TYPES)}"
    if not re.fullmatch(r"[a-z]+(?:\([a-z0-9][a-z0-9._/-]*\))?!?", head):
        return "the scope must be lowercase letters, digits, '.', '_', '/' or '-', in parentheses after the type"
    if not description.strip():
        return "the description must not be empty"
    if description[0].isupper() or description[0].isspace():
        return "the description must start with a lowercase letter"
    return "the description must not end with a period or a space"


def main(argv):
    if len(argv) != 2:
        print("usage: check_pr_title.py TITLE", file=sys.stderr)
        return 2
    reason = problem(argv[1])
    if reason is None:
        print("The title is a conventional commit.")
        return 0
    print(f"The pull request title is not a conventional commit: {reason}.", file=sys.stderr)
    print("main takes squash merges, so this title becomes the commit release-please reads.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
