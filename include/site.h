// SPDX-License-Identifier: GPL-3.0-or-later

// The address of the project's site, where the web app and the release manifest are published: one
// address for the firmware manifest, the default animation source and the link on the board's page.
// The build sets it with -DPIXELART_SITE_URL (scripts/firmware_version.py, rules in tools/site_url.py),
// so a fork publishes and updates from its own site. Without it, the project's own site.

#pragma once

// The fallback below is checked against tools/site_url.py by tools/test_site_url.py (ProjectAddressTest).
#ifndef PIXELART_SITE_URL
#define PIXELART_SITE_URL "https://monska85.github.io/PixelArt/"
#endif

#define PIXELART_SITE_MANIFEST_URL PIXELART_SITE_URL "manifest.json"

namespace site
{

// Ends with a slash.
constexpr const char *URL = PIXELART_SITE_URL;

} // namespace site
