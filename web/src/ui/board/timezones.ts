// SPDX-License-Identifier: GPL-3.0-or-later

// The browser knows its time zone as an IANA name (`Europe/Rome`); the board wants a POSIX TZ string
// (`CET-1CEST,M3.5.0,M10.5.0/3`, docs/board/wifi-and-updates-v1.md#time). The rules of the zones people most often
// live in are carried here, in a small table, because the board has no time zone database. Offsets are written the
// POSIX way: the sign is the opposite of the usual one (CET-1 is one hour ahead of UTC).

/** Central European, Eastern European and Western European rules share the day and the hour (01:00 UTC). */
const CET = "CET-1CEST,M3.5.0,M10.5.0/3";
const EET = "EET-2EEST,M3.5.0/3,M10.5.0/4";
const WET = "WET0WEST,M3.5.0/1,M10.5.0";
const US = (std: string, offset: number, dst: string): string => `${std}${offset}${dst},M3.2.0,M11.1.0`;

const ZONES: Readonly<Record<string, string>> = {
  UTC: "UTC0",
  "Etc/UTC": "UTC0",
  "Etc/GMT": "UTC0",
  "Europe/London": "GMT0BST,M3.5.0/1,M10.5.0",
  "Europe/Dublin": "GMT0IST,M3.5.0/1,M10.5.0",
  "Europe/Lisbon": WET,
  "Atlantic/Canary": WET,
  "Atlantic/Reykjavik": "GMT0",
  "Europe/Madrid": CET,
  "Europe/Paris": CET,
  "Europe/Brussels": CET,
  "Europe/Amsterdam": CET,
  "Europe/Luxembourg": CET,
  "Europe/Berlin": CET,
  "Europe/Zurich": CET,
  "Europe/Vienna": CET,
  "Europe/Rome": CET,
  "Europe/Malta": CET,
  "Europe/Monaco": CET,
  "Europe/Andorra": CET,
  "Europe/San_Marino": CET,
  "Europe/Vatican": CET,
  "Europe/Copenhagen": CET,
  "Europe/Oslo": CET,
  "Europe/Stockholm": CET,
  "Europe/Prague": CET,
  "Europe/Bratislava": CET,
  "Europe/Budapest": CET,
  "Europe/Warsaw": CET,
  "Europe/Ljubljana": CET,
  "Europe/Zagreb": CET,
  "Europe/Sarajevo": CET,
  "Europe/Belgrade": CET,
  "Europe/Skopje": CET,
  "Europe/Podgorica": CET,
  "Europe/Tirane": CET,
  "Africa/Ceuta": CET,
  "Europe/Athens": EET,
  "Europe/Helsinki": EET,
  "Europe/Tallinn": EET,
  "Europe/Riga": EET,
  "Europe/Vilnius": EET,
  "Europe/Sofia": EET,
  "Europe/Bucharest": EET,
  "Europe/Kyiv": EET,
  "Europe/Kiev": EET,
  "Asia/Nicosia": EET,
  "Europe/Istanbul": "<+03>-3",
  "Europe/Moscow": "MSK-3",
  "Europe/Minsk": "<+03>-3",
  "Africa/Cairo": "EET-2EEST,M4.5.5/0,M10.5.4/24",
  "Africa/Johannesburg": "SAST-2",
  "Africa/Lagos": "WAT-1",
  "Africa/Nairobi": "EAT-3",
  "Africa/Casablanca": "<+01>-1",
  "Asia/Jerusalem": "IST-2IDT,M3.4.4/26,M10.5.0",
  "Asia/Dubai": "<+04>-4",
  "Asia/Riyadh": "<+03>-3",
  "Asia/Tehran": "<+0330>-3:30",
  "Asia/Karachi": "PKT-5",
  "Asia/Kolkata": "IST-5:30",
  "Asia/Calcutta": "IST-5:30",
  "Asia/Dhaka": "<+06>-6",
  "Asia/Bangkok": "<+07>-7",
  "Asia/Jakarta": "WIB-7",
  "Asia/Ho_Chi_Minh": "<+07>-7",
  "Asia/Singapore": "<+08>-8",
  "Asia/Kuala_Lumpur": "<+08>-8",
  "Asia/Manila": "PST-8",
  "Asia/Hong_Kong": "HKT-8",
  "Asia/Shanghai": "CST-8",
  "Asia/Taipei": "CST-8",
  "Asia/Seoul": "KST-9",
  "Asia/Tokyo": "JST-9",
  "Australia/Perth": "AWST-8",
  "Australia/Adelaide": "ACST-9:30ACDT,M10.1.0,M4.1.0/3",
  "Australia/Darwin": "ACST-9:30",
  "Australia/Brisbane": "AEST-10",
  "Australia/Sydney": "AEST-10AEDT,M10.1.0,M4.1.0/3",
  "Australia/Melbourne": "AEST-10AEDT,M10.1.0,M4.1.0/3",
  "Australia/Hobart": "AEST-10AEDT,M10.1.0,M4.1.0/3",
  "Pacific/Auckland": "NZST-12NZDT,M9.5.0,M4.1.0/3",
  "Pacific/Honolulu": "HST10",
  "America/Anchorage": US("AKST", 9, "AKDT"),
  "America/Los_Angeles": US("PST", 8, "PDT"),
  "America/Vancouver": US("PST", 8, "PDT"),
  "America/Tijuana": US("PST", 8, "PDT"),
  "America/Phoenix": "MST7",
  "America/Denver": US("MST", 7, "MDT"),
  "America/Edmonton": US("MST", 7, "MDT"),
  "America/Chicago": US("CST", 6, "CDT"),
  "America/Winnipeg": US("CST", 6, "CDT"),
  "America/Mexico_City": "CST6",
  "America/New_York": US("EST", 5, "EDT"),
  "America/Toronto": US("EST", 5, "EDT"),
  "America/Bogota": "<-05>5",
  "America/Lima": "<-05>5",
  "America/Halifax": US("AST", 4, "ADT"),
  "America/Caracas": "<-04>4",
  "America/Santiago": "<-04>4<-03>,M9.1.6/24,M4.1.6/24",
  "America/St_Johns": "NST3:30NDT,M3.2.0,M11.1.0",
  "America/Argentina/Buenos_Aires": "<-03>3",
  "America/Sao_Paulo": "<-03>3",
  "America/Montevideo": "<-03>3",
};

/** The POSIX TZ string of an IANA zone, or null when the table does not have it. */
export function posixTimeZone(iana: string): string | null {
  return Object.prototype.hasOwnProperty.call(ZONES, iana) ? (ZONES[iana] as string) : null;
}

/** The zones the table knows, for tests. */
export const knownTimeZones = (): string[] => Object.keys(ZONES);

/** The browser's IANA time zone, or null when it does not say. */
export function browserTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/**
 * The IANA zone that stands for the board's POSIX `timezone`: the browser's when it has the same rules, else the first
 * zone of the table with them, else null (a string the table does not know).
 */
export function zoneOfSetting(posix: string | undefined, browser: string | null): string | null {
  if (posix === undefined) return null;
  if (browser !== null && posixTimeZone(browser) === posix) return browser;
  return knownTimeZones().find((zone) => ZONES[zone] === posix) ?? null;
}

/** Today's date in an IANA zone, or in the browser's own zone when `zone` is null or unknown to the browser. */
export function localDateIn(zone: string | null, now: Date = new Date()): { year: number; month: number; day: number } {
  try {
    if (zone !== null) {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        year: "numeric",
        month: "numeric",
        day: "numeric",
      }).formatToParts(now);
      const part = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
      const date = { year: part("year"), month: part("month"), day: part("day") };
      if (Object.values(date).every(Number.isInteger)) return date;
    }
  } catch {
    // A zone the browser does not know: the browser's own date.
  }
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}
