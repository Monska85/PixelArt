// SPDX-License-Identifier: GPL-3.0-or-later

// What the Updates card says and how it turns its fields into settings
// (docs/web/web-app-v1.md#updates, docs/board/wifi-and-updates-v1.md#updates).

import type { UpdateStatus } from "../../protocol";

export const UPDATE_MODES: ReadonlyArray<{ value: string; label: string; text: string }> = [
  { value: "off", label: "Off", text: "The board never checks. Updates come over USB only." },
  {
    value: "notify",
    label: "Notify",
    text: "The board checks and tells you what is available. It installs only when you ask.",
  },
  {
    value: "automatic",
    label: "Automatic",
    text: "The board checks and installs what is available, inside the install window.",
  },
];

export const ANIMATION_NOTE =
  "The release wins: animations and playlists with the same name are replaced, and deleted ones come back. Turn this off to keep local changes.";

export const MIN_CHECK_HOURS = 1;
export const MAX_CHECK_HOURS = 168;
export const MAX_ANIMATION_SOURCE = 512;
const MINUTES_PER_DAY = 1440;

/** The hours between checks as the board takes them: a whole number from 1 to 168. Null when the text is not one. */
export function parseCheckHours(text: string): number | null {
  if (!/^\d{1,3}$/.test(text.trim())) return null;
  const hours = Number(text.trim());
  return hours >= MIN_CHECK_HOURS && hours <= MAX_CHECK_HOURS ? hours : null;
}

/** An http or https URL with a host, at most 512 characters, as the board takes `animation_source`. */
export function animationSourceProblem(text: string): string | null {
  if (text.length > MAX_ANIMATION_SOURCE) return `At most ${MAX_ANIMATION_SOURCE} characters.`;
  if (/[^\x21-\x7e]/.test(text)) return "Plain ASCII characters only, and no spaces.";
  const host = /^https?:\/\/([^/?#]*)/.exec(text)?.[1];
  if (host === undefined || !/^[A-Za-z0-9[]/.test(host) || host.includes("@"))
    return "A web address that starts with https:// or http://, with a host and no user name or password.";
  return null;
}

/** The address of the project's own manifest: the default of a local build and of local development. */
// tools/test_site_url.py (ProjectAddressTest) keeps this in step with tools/site_url.py. The limit of
// MAX_ANIMATION_SOURCE below is the one of include/settings.h.
export const PROJECT_ANIMATION_SOURCE = "https://monska85.github.io/PixelArt/manifest.json";

/**
 * The manifest next to the page the app is served from, so a fork that publishes its own site (GitHub Pages or a
 * custom domain) needs no code change: `https://owner.github.io/Fork/` gives `https://owner.github.io/Fork/manifest.json`.
 * Only a page on https that is not a local address counts. A page on localhost, on a file, on http or on the
 * development server uses the project's address, as does a page whose manifest address the board would refuse.
 */
export function defaultAnimationSource(page: { href: string; protocol: string; hostname: string } | undefined): string {
  if (!page || page.protocol !== "https:" || /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(page.hostname))
    return PROJECT_ANIMATION_SOURCE;
  try {
    const url = new URL("manifest.json", page.href);
    url.search = "";
    url.hash = "";
    return animationSourceProblem(url.href) === null ? url.href : PROJECT_ANIMATION_SOURCE;
  } catch {
    return PROJECT_ANIMATION_SOURCE;
  }
}

export const DEFAULT_ANIMATION_SOURCE = defaultAnimationSource(globalThis.location);

/** Minutes after midnight as `HH:MM`, the value of a time field. */
export function minutesToTime(minutes: number): string {
  const m = Math.max(0, Math.min(MINUTES_PER_DAY - 1, Math.trunc(minutes)));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** `HH:MM` as minutes after midnight, or null when the text is not a time of day. */
export function timeToMinutes(text: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(text);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** "whole day", "08:00 to 17:00", or "22:00 to 06:00 (over midnight)". */
export function describeWindow(start: number, end: number): string {
  if (start === end) return "whole day";
  return `${minutesToTime(start)} to ${minutesToTime(end)}${end < start ? " (over midnight)" : ""}`;
}

/** "40 seconds", "12 minutes", "3 hours", "2 days": a short age, rounded down. */
export function ageText(seconds: number): string {
  const [size, unit] =
    seconds < 60 ? [1, "second"] : seconds < 3600 ? [60, "minute"] : seconds < 86400 ? [3600, "hour"] : [86400, "day"];
  const count = Math.floor(seconds / (size as number));
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

/** The sentence for the last check: "12 minutes ago" or "not since the board started". */
export const lastCheckText = (update: UpdateStatus): string =>
  update.lastCheck === null ? "not since the board started" : `${ageText(update.lastCheck)} ago`;

/** Words for the result of the last check or installation: `ok` and the update errors of the protocol. */
const RESULT_TEXT: Record<string, string> = {
  ok: "Done",
  network_error: "The server could not be reached, or the connection dropped",
  tls_error: "The server's certificate could not be checked",
  http_error: "The server answered with an error",
  bad_manifest: "The manifest is too large, not valid, or incomplete",
  checksum_mismatch: "A downloaded file differs from the manifest",
  invalid_file: "A downloaded file is not a valid animation or playlist",
  no_space: "Not enough free space for a file",
  out_of_memory: "Not enough free memory",
  storage_error: "The file system failed",
  flash_error: "The firmware could not be written",
};

/** The words for a manifest that answered 404: nothing is published at the address yet. */
export const NO_RELEASE_TEXT =
  "No release is published at this address yet. Check the animation source, or try again after the first release.";

/**
 * "Done", or the error's words and its code. A code this app does not know is shown as it is. `detail` is the
 * `last_detail` of the status: `no_release` replaces the words of `http_error`.
 */
export function describeResult(result: string, detail: string | null = null): string {
  if (result === "ok") return RESULT_TEXT.ok as string;
  if (result === "http_error" && detail === "no_release") return NO_RELEASE_TEXT;
  const words = Object.prototype.hasOwnProperty.call(RESULT_TEXT, result) ? RESULT_TEXT[result] : null;
  return words ? `${words} (${result})` : result;
}

/** What the board is doing, in a few words. */
export function describeState(update: UpdateStatus): string {
  switch (update.state) {
    case "checking":
      return "Checking for updates";
    case "downloading":
      return `Downloading, ${update.progress} %`;
    case "installing":
      return `Installing, ${update.progress} %`;
    case "waiting_for_time":
      return "Waiting for the time: the install window needs it";
    default:
      return "Idle";
  }
}

/** "updated" and "rolled_back" as sentences with the versions. */
export function describeInstall(install: NonNullable<UpdateStatus["lastInstall"]>): string {
  if (install.result === "updated") return `Updated from ${install.from} to ${install.to}`;
  if (install.result === "rolled_back")
    return `${install.to} did not start properly: the board went back to ${install.from}`;
  return `${install.result}: ${install.from} to ${install.to}`;
}

/** The buttons of the Updates card that can be disabled with a reason. */
export type UpdateAction = "check" | "animations" | "firmware";

const OFF_REASON: Record<UpdateAction, string> = {
  check: "Updates are off.",
  animations: "Animation updates are off.",
  firmware: "Firmware updates are off.",
};
const NOTHING_FOUND_REASON: Record<UpdateAction, string> = {
  check: "",
  animations: "The last check found nothing to install.",
  firmware: "The last check found no firmware update.",
};

/**
 * Why Check now or an Install button is disabled, or "" when it is not: the first of these that applies. `off` is the
 * switch of the action (for Check now, updates as a whole), `found` whether the last check found something for it.
 */
export function disabledReason(
  action: UpdateAction,
  { off, running, found, connected }: { off: boolean; running: boolean; found: boolean; connected: boolean },
): string {
  if (off) return OFF_REASON[action];
  if (running) return "A check or an installation is running.";
  if (!found) return NOTHING_FOUND_REASON[action];
  if (!connected) return "The board is not connected to WiFi.";
  return "";
}

/**
 * Whether the firmware the last check found is on the board's skip list: the version the last rollback left. The board
 * reports such a version as available, and only an installation by force installs it.
 */
export function firmwareSkipped(update: UpdateStatus): boolean {
  return (
    update.firmware !== null &&
    update.lastInstall?.result === "rolled_back" &&
    update.lastInstall.to === update.firmware
  );
}

/** What the last check found for the firmware, in words. */
export function describeFirmware(update: UpdateStatus): string {
  if (update.firmware === null) return "No firmware update";
  return firmwareSkipped(update)
    ? `Firmware ${update.firmware}, which the board rolled back and does not install by itself`
    : `Firmware ${update.firmware}`;
}

/** What the confirmation of a firmware installation says (the title, the text, the action). */
export function firmwareConfirmation(
  running: string | undefined,
  version: string,
  skipped: boolean,
): { title: string; text: string; action: string } {
  const back = running ? `the board goes back to ${running} by itself` : "the board goes back by itself";
  if (skipped)
    return {
      title: `Install firmware ${version} again?`,
      text: `This version was installed before and did not start properly, so ${back}. The board installs it anyway, restarts, and goes back again if it fails again. Your animations, playlists and settings stay.`,
      action: "Install anyway",
    };
  return {
    title: `Install firmware ${version}?`,
    text: `The board downloads it, checks it and restarts. The animation stops and the matrix shows a progress bar while it installs. Your animations, playlists and settings stay. If the new firmware does not start properly, ${back}.`,
    action: "Install firmware",
  };
}
