# SPDX-License-Identifier: GPL-3.0-or-later
"""The address of the project's site, shared by scripts/firmware_version.py, tools/release.py and the workflows.

The site is where the web app and the release manifest are published: `https://<owner>.github.io/<repo>/` on
GitHub Pages. The firmware takes its manifest, its default animation source and the link on its page from it,
so a fork needs no code change. Standard library only: the PlatformIO pre script imports this file by path.

Order of the rules, the first that applies wins:
  1. PIXELART_SITE_URL, for a custom domain or any other address (an empty value counts as not set);
  2. in GitHub Actions (GITHUB_ACTIONS=true), GITHUB_REPOSITORY=owner/repo gives
     https://<owner in lowercase>.github.io/<repo>/, and for a repository named <owner>.github.io (any case)
     the root of that host, https://<owner in lowercase>.github.io/;
  3. otherwise the project's own address, for local builds.

An address is normalized the way a browser writes an origin: the host is lowercased and an explicit port 443
is dropped, so `https://Art.Example.com:443/` is `https://art.example.com/`. The origin the board accepts for
the web app (lib/PixelNet/src/net_origin.cpp, site_origin_of) follows the same rule. Other ports stay, and
the path keeps its case. A port with a leading zero (`:0443`) is refused, so no spelling of 443 survives.
"""

import re
import sys

DEFAULT_SITE_URL = "https://monska85.github.io/PixelArt/"
MANIFEST_NAME = "manifest.json"
# docs/protocol/protocol-v1.md#settings_get-settings_set: the manifest address is the default animation_source.
# The limit is MAX_ANIMATION_SOURCE in include/settings.h, the source of this number (a test keeps them equal).
MAX_ANIMATION_SOURCE = 512
MAX_SITE_URL = MAX_ANIMATION_SOURCE - len(MANIFEST_NAME)

_OWNER = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})")
_REPOSITORY = re.compile(r"[A-Za-z0-9._-]{1,100}")
# Letters, digits and the characters of a plain path. No `%`, `+`, `&`, quote or angle bracket, so the address
# is safe in HTML and in a C string without any escaping.
_SITE_URL = re.compile(r"https://[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?(?::(?:0|[1-9][0-9]{0,4}))?(?:/[A-Za-z0-9._~-]+)*/")


def normalize(url):
    """`url` with the host in lowercase and an explicit port 443 dropped, when it starts like an https address."""
    match = re.match(r"(https://)([^/?#@]*)(.*)", url, flags=re.DOTALL) if isinstance(url, str) else None
    if not match:
        return url
    host = match.group(2).lower()
    if host.endswith(":443"):
        host = host[:-4]
    return match.group(1) + host + match.group(3)


def validate(url):
    """The normalized address when it is a usable site address, else ValueError.

    It is an https:// address with a host and an optional port, a path of plain segments and a trailing slash,
    with no user information, query or fragment, and short enough that `<site>manifest.json` is a valid
    animation_source (at most 512 characters).
    """
    url = normalize(url)
    if not isinstance(url, str) or not _SITE_URL.fullmatch(url):
        raise ValueError(
            f"the site address {url!r} is not an https:// address with a host, plain path segments and a trailing "
            "slash, and no user name, query or fragment")
    port = re.match(r"https://[^/:]*:([0-9]+)", url)
    if port and not 1 <= int(port.group(1)) <= 65535:
        raise ValueError(f"the site address {url!r} has a port outside 1 to 65535")
    if ".." in url.split("//", 1)[1].split("/") or "//" in url[8:]:
        raise ValueError(f"the site address {url!r} has an empty or relative path segment")
    if len(url) > MAX_SITE_URL:
        raise ValueError(f"the site address is {len(url)} characters, more than the {MAX_SITE_URL} that keep "
                         f"{MANIFEST_NAME} within the {MAX_ANIMATION_SOURCE} of an animation_source")
    return url


def from_repository(repository):
    """The GitHub Pages address of `owner/repo`."""
    owner, slash, name = (repository or "").partition("/")
    if not slash or "/" in name or not _OWNER.fullmatch(owner) or not _REPOSITORY.fullmatch(name) or name in (".", ".."):
        raise ValueError(f"GITHUB_REPOSITORY {repository!r} is not owner/repository")
    host = f"https://{owner.lower()}.github.io/"
    return host if name.lower() == f"{owner.lower()}.github.io" else f"{host}{name}/"


def site_url(environ):
    """The site address for a build, by the rules in the module's description. ValueError when it is not valid."""
    explicit = environ.get("PIXELART_SITE_URL", "").strip()
    if explicit:
        return validate(explicit)
    if environ.get("GITHUB_ACTIONS") == "true" and environ.get("GITHUB_REPOSITORY"):
        return validate(from_repository(environ["GITHUB_REPOSITORY"]))
    return DEFAULT_SITE_URL


def manifest_url(site):
    return site + MANIFEST_NAME


if __name__ == "__main__":
    import os

    try:
        print(site_url(os.environ))
    except ValueError as err:
        sys.exit(f"site_url: {err}")
