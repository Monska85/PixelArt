import { describe, expect, it } from "vitest";
import { checkFirmware, compareSemVer, isDevelopmentBuild, parseSemVer } from "../src/release/semver";

const cmp = (a: string, b: string): number => {
  const x = parseSemVer(a);
  const y = parseSemVer(b);
  if (!x || !y) throw new Error(`invalid test version ${a} or ${b}`);
  return compareSemVer(x, y);
};

describe("parseSemVer", () => {
  it("accepts valid versions", () => {
    for (const v of [
      "0.0.0",
      "1.2.3",
      "1.0.0-alpha",
      "1.0.0-alpha.1",
      "1.0.0-0.3.7",
      "1.0.0-x.7.z.92",
      "1.0.0-x-y-z.--",
    ])
      expect(parseSemVer(v), v).not.toBeNull();
    expect(parseSemVer("1.0.0+20130313144700")).not.toBeNull();
    expect(parseSemVer("1.0.0-beta+exp.sha.5114f85")).not.toBeNull();
    expect(parseSemVer("1.2.0-dev.3+gabc1234.dirty")).not.toBeNull();
    expect(parseSemVer("0.0.0-unknown")).not.toBeNull();
  });

  it("rejects everything else", () => {
    for (const v of [
      "",
      "1",
      "1.2",
      "v1.2.3",
      "1.2.3.4",
      "01.2.3",
      "1.02.3",
      "1.2.03",
      "1.2.3-",
      "1.2.3-01",
      "1.2.3-a..b",
      "1.2.3+",
      "1.2.3+a..b",
      "1.2.3-é",
      "1.2.3 ",
      "-1.2.3",
      "unknown",
    ])
      expect(parseSemVer(v), JSON.stringify(v)).toBeNull();
  });
});

describe("compareSemVer", () => {
  it("orders the example of the specification", () => {
    const ordered = [
      "1.0.0-alpha",
      "1.0.0-alpha.1",
      "1.0.0-alpha.beta",
      "1.0.0-beta",
      "1.0.0-beta.2",
      "1.0.0-beta.11",
      "1.0.0-rc.1",
      "1.0.0",
      "2.0.0",
      "2.1.0",
      "2.1.1",
    ];
    for (let i = 0; i < ordered.length; i++)
      for (let j = 0; j < ordered.length; j++)
        expect(cmp(ordered[i] as string, ordered[j] as string), `${ordered[i]} ${ordered[j]}`).toBe(Math.sign(i - j));
  });

  it("compares numbers as numbers, not as text", () => {
    expect(cmp("1.10.0", "1.9.0")).toBe(1);
    expect(cmp("1.0.0-rc.10", "1.0.0-rc.9")).toBe(1);
    expect(cmp("10.0.0", "9.0.0")).toBe(1);
  });

  it("does not overflow on huge numbers", () => {
    expect(cmp("99999999999999999999999.0.0", "99999999999999999999998.0.0")).toBe(1);
    expect(cmp("1.0.0-99999999999999999999999", "1.0.0-99999999999999999999998")).toBe(1);
  });

  it("ignores build metadata", () => {
    expect(cmp("1.0.0+a", "1.0.0+b")).toBe(0);
    expect(cmp("1.0.0+a", "1.0.0")).toBe(0);
    expect(cmp("1.0.0-rc.1+zzz", "1.0.0-rc.1+aaa")).toBe(0);
    expect(cmp("1.0.1+aaa", "1.0.0+zzz")).toBe(1);
  });

  it("sorts a pre-release below its release and numeric identifiers below text", () => {
    expect(cmp("1.2.0-dev.3+gabc1234", "1.2.0")).toBe(-1);
    expect(cmp("0.0.0-unknown", "0.1.0")).toBe(-1);
    expect(cmp("1.0.0-1", "1.0.0-a")).toBe(-1);
    expect(cmp("1.0.0-alpha", "1.0.0-alpha.0")).toBe(-1);
    expect(cmp("1.0.0-a-b", "1.0.0-a")).toBe(1);
  });
});

describe("isDevelopmentBuild", () => {
  it("recognizes the versions of the firmware's own builds", () => {
    const dev = (v: string): boolean =>
      isDevelopmentBuild(parseSemVer(v) as NonNullable<ReturnType<typeof parseSemVer>>);
    expect(dev("1.2.0-dev.3+gabc1234")).toBe(true);
    expect(dev("0.0.0-unknown")).toBe(true);
    expect(dev("1.2.0-rc.1")).toBe(false);
    expect(dev("1.2.0")).toBe(false);
  });
});

describe("checkFirmware", () => {
  it("is older for a release below the latest", () => {
    expect(checkFirmware("1.0.0", "1.1.0")).toEqual({
      kind: "older",
      latest: "1.1.0",
      board: "1.0.0",
      development: false,
    });
  });
  it("is same for equal versions, whatever the build metadata", () => {
    expect(checkFirmware("1.1.0+gabc", "1.1.0")).toEqual({ kind: "same", development: false });
  });
  it("is newer above the latest", () => {
    expect(checkFirmware("1.2.0", "1.1.0")).toEqual({ kind: "newer", development: false });
    expect(checkFirmware("1.2.0-dev.1+gabc", "1.1.0")).toEqual({ kind: "newer", development: true });
  });
  it("counts a development build of the latest version as older and labels it", () => {
    expect(checkFirmware("1.1.0-dev.4+gabc.dirty", "1.1.0")).toEqual({
      kind: "older",
      latest: "1.1.0",
      board: "1.1.0-dev.4+gabc.dirty",
      development: true,
    });
    expect(checkFirmware("0.0.0-unknown", "0.1.0")).toMatchObject({ kind: "older", development: true });
  });
  it("does not compare an invalid version", () => {
    expect(checkFirmware("unknown", "1.0.0")).toEqual({ kind: "incomparable", board: "unknown", latest: "1.0.0" });
    expect(checkFirmware("1.0.0", "latest")).toMatchObject({ kind: "incomparable" });
    expect(checkFirmware("", "1.0.0")).toMatchObject({ kind: "incomparable" });
  });
});
