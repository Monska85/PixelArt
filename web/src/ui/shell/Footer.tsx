// SPDX-License-Identifier: GPL-3.0-or-later

import { FOOTER_TEXT, REPOSITORY_URL } from "../privacy";

const link = "underline underline-offset-2 hover:text-foreground";

/** The quiet line at the bottom of every view: the privacy promise, with the Privacy view and the source. */
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
      </p>
    </footer>
  );
}
