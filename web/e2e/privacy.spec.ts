// SPDX-License-Identifier: GPL-3.0-or-later

import { readFileSync } from "node:fs";
import { connectSimulator, expect, test } from "./fixtures";
import { repositoryUrl } from "../scripts/repository";

// The build the tests run against derives the address from the same environment as this process.
const REPOSITORY = repositoryUrl(process.env);
const REPOSITORY_LABEL = REPOSITORY.replace(/^https:\/\//, "");

// The version the build embeds is the one of web/package.json (vite.config.ts). The rule that tells a release from a
// development build is that of sourceOfVersion in src/ui/privacy.ts, which cannot be imported here: it reads build globals.
const APP_VERSION: string = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const IS_RELEASE = /^\d+\.\d+\.\d+$/.test(APP_VERSION) && APP_VERSION !== "0.0.0";

const FOOTER =
  "Runs entirely in your browser. Your animations, settings and WiFi details go only to your board. The board itself contacts only its update source and its time server.";

test("every view ends with the privacy line, a link to the Privacy view and a link to the source", async ({ page }) => {
  for (const view of ["board", "library", "firmware", "editor"]) {
    await page.goto(`/#${view}`);
    const footer = page.getByTestId("footer");
    await expect(footer.getByTestId("footer-text")).toHaveText(FOOTER);
    await expect(footer.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "#privacy");
    const source = footer.getByRole("link", { name: "Source" });
    await expect(source).toHaveAttribute("href", REPOSITORY);
    await expect(source).toHaveAttribute("rel", "noopener noreferrer");
    await expect(source).toHaveAttribute("target", "_blank");
  }
});

test("the footer link opens the Privacy view, which is not in the navigation", async ({ page }) => {
  await page.goto("/#board");
  await expect(
    page.getByRole("navigation", { name: "Views" }).first().getByRole("link", { name: "Privacy" }),
  ).toHaveCount(0);
  await page.getByTestId("footer").getByRole("link", { name: "Privacy" }).click();
  await expect(page).toHaveURL(/#privacy$/);
  const view = page.getByTestId("privacy");
  await expect(view.getByRole("heading", { level: 2, name: "Privacy" })).toBeVisible();
  for (const section of [
    "What stays in your browser",
    "What goes only to your board",
    "What your board contacts",
    "Limits",
    "What the site sees",
    "Check it yourself",
  ])
    await expect(view.getByRole("heading", { name: section })).toBeVisible();
  // Every key the app keeps is named, by purpose.
  const stored = view.getByTestId("privacy-stored");
  for (const key of [
    "pixelart.theme",
    "pixelart.simulator",
    "pixelart.wifi",
    "pixelart.token.<host>",
    "pixelart.editorNote",
    "pixelart-editor / drafts / current",
  ])
    await expect(stored).toContainText(key);
  // Open source, where to check it, and the honest note about the host.
  await expect(view).toContainText("GPL-3.0");
  const repository = view.getByRole("link", { name: REPOSITORY_LABEL });
  await expect(repository).toHaveAttribute("href", REPOSITORY);
  await expect(repository).toHaveText(REPOSITORY_LABEL);
  await expect(view).toContainText("default-src 'self'");
  await expect(view).toContainText("connect-src 'self' ws:");
  await expect(view).toContainText("web/src");
  await expect(view).toContainText("your IP address");
  await expect(view).toContainText("pool.ntp.org");
  // The time server is asked only while the board needs the time: a schedule, or a narrow install window.
  await expect(view.getByRole("region", { name: "What your board contacts" })).toContainText(
    "only while it needs the time: when Automatic plays a schedule, or when the install window is narrower than the whole day",
  );
  await expect(page.getByTestId("footer-text")).toHaveText(
    "Runs entirely in your browser. Your animations, settings and WiFi details go only to your board. The board itself contacts only its update source and its time server.",
  );
  await expect(view.getByTestId("privacy-limits")).toContainText("plain ws: WebSocket, not encrypted");
  await expect(view.getByTestId("privacy-limits")).toContainText("plain text");
  await expect(view.getByTestId("privacy-limits")).toContainText("as written (clear text)");
  await expect(view).toContainText("the page can reach no other site over HTTP or HTTPS");
  // The page is still the app: the footer stays, and the navigation is back to the views.
  await expect(page.getByTestId("footer")).toBeVisible();
});

test.describe("with a release and an update source", () => {
  test.use({ updateSource: {} });

  test("the whole browser context makes no request to a site other than its own and the board", async ({
    context,
    page,
    simulator,
  }) => {
    const own = "localhost:4173";
    const board = new URL(simulator.address).host;
    const seen = new Set<string>();
    const refused: string[] = [];
    // Every HTTP(S) request of every page of the context goes through here: anything but the app's own site is
    // recorded and aborted.
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      seen.add(url.host);
      if (url.host === own || url.protocol === "data:" || url.protocol === "blob:") return route.continue();
      refused.push(route.request().url());
      return route.abort();
    });
    const sockets = new Set<string>();
    const watch = (p: import("@playwright/test").Page): void => {
      p.on("websocket", (socket) => sockets.add(new URL(socket.url()).host));
      p.on("request", (request) => seen.add(new URL(request.url()).host));
    };
    watch(page);
    context.on("page", watch);

    await connectSimulator(page, simulator);
    // The flows that fetch on demand: the Board view's cards and an update check over the simulator.
    await expect(page.getByRole("region", { name: "WiFi" })).toBeVisible();
    await page.getByRole("region", { name: "Updates" }).getByRole("button", { name: "Check now" }).click();
    await expect(page.getByTestId("update-last-check")).toContainText("ago");
    // The Library view loads the release manifest, the Firmware view the install dialog, the Editor its parts.
    await page.goto("/#library");
    await expect(page.getByTestId("footer")).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Library" })).toBeVisible();
    await page.goto("/#firmware");
    await expect(page.getByRole("heading", { level: 2, name: "Firmware" })).toBeVisible();
    for (const view of ["editor", "privacy", "board"]) {
      await page.goto(`/#${view}`);
      await expect(page.getByTestId("footer")).toBeVisible();
    }

    expect(refused).toEqual([]);
    expect([...seen].filter((host) => host !== own)).toEqual([]);
    expect([...sockets].filter((host) => host !== board)).toEqual([]);
    expect(sockets.size).toBeGreaterThan(0); // the board connection was watched
    expect(context.serviceWorkers()).toEqual([]);
  });
});

test("the Privacy view names the license, the version of the app and links the third-party notices", async ({
  page,
}) => {
  await page.goto("/#privacy");
  const version = page.getByTestId("privacy-version");
  await expect(version).toContainText(
    IS_RELEASE
      ? `This web app is version ${APP_VERSION}, built from the tag web-v${APP_VERSION}.`
      : `This web app is version ${APP_VERSION}, a build that is not a release`,
  );
  const licenses = page
    .getByRole("region", { name: "Licenses" })
    .or(page.locator("[aria-labelledby=privacy-licenses]"));
  await expect(licenses).toContainText("GNU General Public License, version 3 or any later version");
  // The release tag of a release, the repository for this build, which is not one.
  if (IS_RELEASE) {
    await expect(version.getByRole("link", { name: `web-v${APP_VERSION}` })).toHaveAttribute(
      "href",
      `${REPOSITORY}/tree/web-v${APP_VERSION}`,
    );
  } else {
    await expect(version.getByRole("link", { name: "repository" })).toHaveAttribute("href", REPOSITORY);
  }
  // The license files are the site's own, next to the notices, and shown as text.
  await expect(page.getByTestId("license")).toHaveAttribute("href", "./LICENSE.txt");
  await expect(page.getByTestId("license-exception")).toHaveAttribute("href", "./LICENSE-EXCEPTION.txt");
  const license = await page.request.get("./LICENSE.txt");
  expect(license.ok()).toBe(true);
  expect(license.headers()["content-type"]).toContain("text/plain");
  expect(await license.text()).toContain("GNU GENERAL PUBLIC LICENSE");
  const exception = await page.request.get("./LICENSE-EXCEPTION.txt");
  expect(exception.ok()).toBe(true);
  expect(exception.headers()["content-type"]).toContain("text/plain");
  expect(await exception.text()).toContain("PixelArt is free software: you can redistribute it and/or modify it");
  await expect(page.getByTestId("notices-web")).toHaveAttribute("href", "./THIRD_PARTY_NOTICES.txt");
  await expect(page.getByTestId("notices-firmware")).toHaveAttribute("href", "./firmware/THIRD_PARTY_NOTICES.txt");
  const notices = await page.request.get("./THIRD_PARTY_NOTICES.txt");
  expect(notices.ok()).toBe(true);
  expect(await notices.text()).toContain("PixelArt web app: third-party notices");
});
