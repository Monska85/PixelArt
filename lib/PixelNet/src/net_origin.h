// SPDX-License-Identifier: GPL-3.0-or-later

// Which web pages may open the board's WebSocket
// (docs/board/wifi-and-updates-v1.md#protocol-over-wifi). Plain C++ so the rule has native tests.

#pragma once

#include <string>

namespace pixelart_net
{

// Whether a connection with this `Origin` header is accepted. `origin` is null when the header is
// missing, which command line clients do. The rest must match exactly, as the browser writes it
// (lowercase, no trailing dot):
//   - https://monska85.github.io, without a port;
//   - the scheme http or https, then a host and optionally `:port` (1 to 5 digits, at most 65535),
//     with nothing after it: no path, no user information, no IPv6 literal. The host is `localhost`,
//     a name that ends in `.local` after at least one label, or an IPv4 address in 10.0.0.0/8,
//     172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16 or 127.0.0.0/8, written as four decimal
//     numbers without leading zeros.
//
// `site_origin` is the origin of the site that serves the web app, taken from the build's site address
// (see site_origin_of); the first rule above compares with it. Without it, the project's own site is used.
bool origin_allowed(const char *origin, const char *site_origin = nullptr);

// The origin (scheme, host and port) of a site address such as `https://owner.github.io/Repo/`:
// `https://owner.github.io`, written as a browser writes it: lowercase, without the port 443. Empty when the address is
// not an `https://` address with a host.
std::string site_origin_of(const char *site_url);

} // namespace pixelart_net
