// SPDX-License-Identifier: GPL-3.0-or-later

import { APP_VERSION, FOOTER_TEXT, REPOSITORY_URL } from "../privacy";

const link = "underline underline-offset-2 hover:text-foreground";

/** The privacy promise, links and web app version at the bottom of every view. */
export function Footer() {
  return (
    <footer className="mx-auto w-full max-w-6xl px-4 pb-6 text-xs text-muted-foreground" data-testid="footer">
      <p>
        <span data-testid="footer-text">{FOOTER_TEXT}</span>{" "}
        <a className={link} href="#privacy">
          Privacy
        </a>
        {" · "}
        <a className={link} href={REPOSITORY_URL} target="_blank" rel="noopener noreferrer">
          Source
        </a>
        {" · "}
        <span className="whitespace-nowrap" data-testid="footer-version">
          Web app v{APP_VERSION}
        </span>
      </p>
    </footer>
  );
}
