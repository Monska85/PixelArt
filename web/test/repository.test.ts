// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from "vitest";
import { DEFAULT_REPOSITORY_URL, repositoryUrl } from "../scripts/repository";

const actions = (repository: string | undefined) => ({ GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: repository });

describe("the repository address of a build", () => {
  it("is the project's for a local build", () => {
    expect(repositoryUrl({})).toBe("https://github.com/Monska85/PixelArt");
    expect(DEFAULT_REPOSITORY_URL).toBe("https://github.com/Monska85/PixelArt");
  });

  it("is the project's outside GitHub Actions, whatever the variable says", () => {
    expect(repositoryUrl({ GITHUB_REPOSITORY: "other/fork" })).toBe(DEFAULT_REPOSITORY_URL);
    expect(repositoryUrl({ GITHUB_ACTIONS: "false", GITHUB_REPOSITORY: "other/fork" })).toBe(DEFAULT_REPOSITORY_URL);
  });

  it("is the project's in GitHub Actions without the variable", () => {
    expect(repositoryUrl({ GITHUB_ACTIONS: "true" })).toBe(DEFAULT_REPOSITORY_URL);
    expect(repositoryUrl(actions(""))).toBe(DEFAULT_REPOSITORY_URL);
  });

  it.each([
    ["Owner/Fork", "https://github.com/Owner/Fork"],
    ["a/b", "https://github.com/a/b"],
    ["my-org/pixel.art_2", "https://github.com/my-org/pixel.art_2"],
    ["owner/.github", "https://github.com/owner/.github"],
  ])("is the address of %s in GitHub Actions", (slug, url) => {
    expect(repositoryUrl(actions(slug))).toBe(url);
  });

  it.each([
    ["no slash", "Owner"],
    ["two slashes", "a/b/c"],
    ["a trailing slash", "owner/"],
    ["no owner", "/name"],
    ["an owner that starts with a hyphen", "-owner/name"],
    ["an owner with an underscore", "my_org/name"],
    ["an owner over 39 characters", `${"a".repeat(40)}/name`],
    ["a dot as the name", "owner/."],
    ["two dots as the name", "owner/.."],
    ["a name with a space", "owner/na me"],
    ["a name over 100 characters", `owner/${"n".repeat(101)}`],
    ["a path in the name", "owner/../x"],
  ])("fails the build for %s", (_why, slug) => {
    expect(() => repositoryUrl(actions(slug))).toThrow("is not owner/repository");
  });
});
