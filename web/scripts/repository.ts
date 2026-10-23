// SPDX-License-Identifier: GPL-3.0-or-later
// The address of the repository the web app links to (docs/web/web-app-v1.md, Publishing): in GitHub Actions the
// repository the build runs for, so a fork links its own source, and the project's own for any other build. The
// rules for GITHUB_REPOSITORY are those of tools/site_url.py.

/** The project's repository: the address of a local build, and the only place it is written in the web app. */
export const DEFAULT_REPOSITORY_URL = "https://github.com/Monska85/PixelArt";

const OWNER = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
const NAME = /^[A-Za-z0-9._-]{1,100}$/;

/** `https://github.com/<owner>/<name>` for the `owner/name` of GITHUB_REPOSITORY, or an Error when it is not one. */
export function repositoryFromSlug(slug: string): string {
  const parts = slug.split("/");
  const [owner, name] = parts;
  if (parts.length !== 2 || !OWNER.test(owner ?? "") || !NAME.test(name ?? "") || name === "." || name === "..")
    throw new Error(`GITHUB_REPOSITORY ${JSON.stringify(slug)} is not owner/repository`);
  return `https://github.com/${owner}/${name}`;
}

/** The repository address of a build with this environment: the one of GitHub Actions, else the project's own. */
export function repositoryUrl(env: Record<string, string | undefined>): string {
  const slug = env.GITHUB_REPOSITORY;
  if (env.GITHUB_ACTIONS === "true" && slug !== undefined && slug !== "") return repositoryFromSlug(slug);
  return DEFAULT_REPOSITORY_URL;
}
