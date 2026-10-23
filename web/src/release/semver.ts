// Semantic Versioning 2.0.0 precedence (https://semver.org/#spec-item-11).

interface SemVer {
  major: string;
  minor: string;
  patch: string;
  /** The dot-separated identifiers after `-`, empty for a release. */
  prerelease: string[];
}

const NUMERIC = "(0|[1-9][0-9]*)";
const IDENTIFIER = "[0-9A-Za-z-]+";
const PATTERN = new RegExp(
  `^${NUMERIC}\\.${NUMERIC}\\.${NUMERIC}(?:-(${IDENTIFIER}(?:\\.${IDENTIFIER})*))?(?:\\+(${IDENTIFIER}(?:\\.${IDENTIFIER})*))?$`,
);

/** The parts of a valid version, or null. Build metadata is checked and dropped: it never counts. */
export function parseSemVer(text: string): SemVer | null {
  const match = PATTERN.exec(text);
  if (!match) return null;
  const pre = match[4]?.split(".") ?? [];
  // A numeric pre-release identifier has no leading zero.
  if (pre.some((id) => /^[0-9]+$/.test(id) && id.length > 1 && id.startsWith("0"))) return null;
  return { major: match[1] as string, minor: match[2] as string, patch: match[3] as string, prerelease: pre };
}

// Digit strings without leading zeros compare as numbers by length first, so a huge number cannot overflow.
function compareDigits(a: string, b: string): number {
  if (a.length !== b.length) return a.length < b.length ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareIdentifier(a: string, b: string): number {
  const aNumeric = /^[0-9]+$/.test(a);
  const bNumeric = /^[0-9]+$/.test(b);
  if (aNumeric && bNumeric) return compareDigits(a, b);
  // Numeric identifiers sort below alphanumeric ones.
  if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** -1 when `a` has lower precedence than `b`, 0 when equal, 1 when higher. */
export function compareSemVer(a: SemVer, b: SemVer): -1 | 0 | 1 {
  const core = compareDigits(a.major, b.major) || compareDigits(a.minor, b.minor) || compareDigits(a.patch, b.patch);
  if (core !== 0) return core < 0 ? -1 : 1;
  // A pre-release sorts below its release.
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    if (a.prerelease.length === b.prerelease.length) return 0;
    return a.prerelease.length === 0 ? 1 : -1;
  }
  const shared = Math.min(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < shared; i++) {
    const result = compareIdentifier(a.prerelease[i] as string, b.prerelease[i] as string);
    if (result !== 0) return result < 0 ? -1 : 1;
  }
  if (a.prerelease.length === b.prerelease.length) return 0;
  return a.prerelease.length < b.prerelease.length ? -1 : 1;
}

/** Versions the firmware reports for builds that are not a release: `1.2.0-dev.3+gabc1234`, `0.0.0-unknown`. */
export function isDevelopmentBuild(version: SemVer): boolean {
  const first = version.prerelease[0];
  return first === "dev" || first === "unknown";
}

export type FirmwareCheck =
  | { kind: "older"; latest: string; board: string; development: boolean }
  | { kind: "same"; development: boolean }
  | { kind: "newer"; development: boolean }
  | { kind: "incomparable"; board: string; latest: string };

/** How the version a board reports compares with the latest release. Invalid versions are never compared. */
export function checkFirmware(board: string, latest: string): FirmwareCheck {
  const boardVersion = parseSemVer(board);
  const latestVersion = parseSemVer(latest);
  if (!boardVersion || !latestVersion) return { kind: "incomparable", board, latest };
  const development = isDevelopmentBuild(boardVersion);
  const order = compareSemVer(boardVersion, latestVersion);
  if (order < 0) return { kind: "older", latest, board, development };
  return { kind: order === 0 ? "same" : "newer", development };
}
