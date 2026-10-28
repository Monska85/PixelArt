// SPDX-License-Identifier: GPL-3.0-or-later

import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import { PageHeader } from "../common/Page";
import { Card, CardContent, CardHeader, CardTitle } from "../components/card";
import { APP_VERSION, REPOSITORY_URL, STORED_ITEMS, repositoryLabel, sourceOfVersion } from "../privacy";

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <Card aria-labelledby={id}>
      <CardHeader>
        <CardTitle id={id}>{title}</CardTitle>
      </CardHeader>
      <CardContent className="gap-3 text-sm">{children}</CardContent>
    </Card>
  );
}

const link = "font-medium underline underline-offset-2 hover:text-foreground";

/** The Privacy view, reached from the footer: what stays in the browser, what goes to the board, what the site sees. */
export function PrivacyView() {
  return (
    <div className="flex flex-col gap-4" data-testid="privacy">
      <PageHeader
        title="Privacy"
        description="Nothing personal leaves your browser and your board. This page says what the app keeps, what it sends and where, and how to check it."
      />
      <Section id="privacy-browser" title="What stays in your browser">
        <p>
          Your animations, playlists, settings and WiFi details are not sent to any server. The app keeps only these
          things in this browser, and you can remove them by clearing the site data:
        </p>
        <ul className="flex list-disc flex-col gap-1 pl-5" data-testid="privacy-stored">
          {STORED_ITEMS.map((item) => (
            <li key={item.key}>
              <code className="break-all rounded bg-muted px-1 py-0.5 text-xs">{item.key}</code> ({item.kind}):{" "}
              {item.purpose}
            </li>
          ))}
        </ul>
        <p>The app sets no cookies.</p>
      </Section>
      <Section id="privacy-board" title="What goes only to your board">
        <p>
          The files you upload, the settings you change and the WiFi network name and password you enter go to your
          board and nowhere else: over USB, or over a WebSocket to the address of your board. The WiFi password goes
          over USB only. To log in over WiFi the app sends your board a code derived from your token with a one-time
          number from the board, never the token itself.
        </p>
      </Section>
      <Section id="privacy-site" title="What the site sees">
        <p>
          The site only serves files: this app, the list of released animations and playlists, and the firmware. The app
          loads them from its own address and from nowhere else: no fonts, analytics, error reporting, advertising or
          other third-party service, and no request to any site other than this one and your board (a link opens another
          site only when you click it). It does not tell the site which board you use or what is on it.
        </p>
        <p>
          Like any website, the host of the site (GitHub Pages) sees the standard data of every request: your IP
          address, your browser&apos;s user agent and the files you ask for. The project itself does not collect it.
        </p>
      </Section>
      <Section id="privacy-board-contacts" title="What your board contacts">
        <p>
          To check for updates the board itself contacts the release site (the firmware manifest) and the animation
          source. For the time it asks the time server of its Time server setting (pool.ntp.org unless you change it),
          and only while it needs the time: when Automatic plays a schedule, or when the install window is narrower than
          the whole day. Those requests carry none of your data, and those hosts see the board&apos;s IP address. Set
          the update mode to Off to stop the update checks; the time requests stop when no schedule and no narrow
          install window needs the time.
        </p>
      </Section>
      <Section id="privacy-limits" title="Limits">
        <ul className="flex list-disc flex-col gap-1 pl-5" data-testid="privacy-limits">
          <li>
            The connection to the board over WiFi is a plain <code>ws:</code> WebSocket, not encrypted. On your local
            network, someone who can watch the traffic can see what you send and the network name in the status. With
            the network login off there is no login at all.
          </li>
          <li>
            The board keeps the WiFi network name and password in plain text, and anyone who holds the board can read
            them.
          </li>
          <li>
            The token is stored in this browser as written (clear text), readable by anyone with access to this browser
            profile.
          </li>
        </ul>
      </Section>
      <Section id="privacy-check" title="Check it yourself">
        <p>
          PixelArt is free software under the GPL-3.0-or-later license, so anyone can read the code and verify that it
          does what this page says. The repository is{" "}
          <a className={link} href={REPOSITORY_URL} target="_blank" rel="noopener noreferrer">
            {repositoryLabel(REPOSITORY_URL)}
            <ExternalLink className="ml-1 inline size-3" aria-hidden="true" />
          </a>
          .
        </p>
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>
            The content security policy in <code className="rounded bg-muted px-1 py-0.5 text-xs">web/index.html</code>{" "}
            lets the app load everything only from its own site (<code>default-src &apos;self&apos;</code>) and connect
            only to its own site and to WebSocket addresses (<code>connect-src &apos;self&apos; ws:</code>), which is
            how it reaches a board on your network, whose address is not known in advance. The browser enforces it: the
            page can reach no other site over HTTP or HTTPS. It can open a WebSocket to any address, and the app opens
            one only to the board you choose.
          </li>
          <li>
            The web app source is in <code className="rounded bg-muted px-1 py-0.5 text-xs">web/src</code>, and the
            firmware source is in <code className="rounded bg-muted px-1 py-0.5 text-xs">src/</code> and{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">lib/</code>.
          </li>
        </ul>
      </Section>
      <Licenses />
    </div>
  );
}

/** The license of PixelArt, the version of this app with its source, and the third-party notices. */
function Licenses() {
  const source = sourceOfVersion(APP_VERSION);
  const external = (href: string, text: string) => (
    <a className={link} href={href} target="_blank" rel="noopener noreferrer">
      {text}
      <ExternalLink className="ml-1 inline size-3" aria-hidden="true" />
    </a>
  );
  return (
    <Section id="privacy-licenses" title="Licenses">
      <p data-testid="privacy-version">
        This web app is version {APP_VERSION}
        {source.tag ? (
          <>, built from the tag {external(source.url, source.tag)}.</>
        ) : (
          <>, a build that is not a release: its source is in the {external(source.url, "repository")}.</>
        )}
      </p>
      <ul className="flex list-disc flex-col gap-1 pl-5">
        <li>
          PixelArt is licensed under the GNU General Public License, version 3 or any later version:{" "}
          <a className={link} href="./LICENSE.txt" data-testid="license">
            LICENSE
          </a>
          . The firmware adds a permission to combine it with the binary-only libraries Espressif distributes:{" "}
          <a className={link} href="./LICENSE-EXCEPTION.txt" data-testid="license-exception">
            LICENSE-EXCEPTION
          </a>
          .
        </li>
        <li>
          The third-party software in this app, with the license texts:{" "}
          <a className={link} href="./THIRD_PARTY_NOTICES.txt" data-testid="notices-web">
            third-party notices of the web app
          </a>
          .
        </li>
        <li>
          The third-party software in the firmware this site publishes:{" "}
          <a className={link} href="./firmware/THIRD_PARTY_NOTICES.txt" data-testid="notices-firmware">
            third-party notices of the firmware
          </a>
          , also attached to every firmware release.
        </li>
      </ul>
    </Section>
  );
}
