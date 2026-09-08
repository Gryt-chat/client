/* eslint-env node */

/**
 * What a submodule checkout is, as a version. Its own module so a check script
 * can call it without importing a file that runs a build.
 */

import { execSync } from "child_process";

/**
 * Makes `--sort=-v:refname` semver precedence rather than string order. Without
 * these, `v1.6.15-beta.1` sorts above `v1.6.15` (GRYT-725).
 */
const VERSION_SORT = [
  "-c versionsort.suffix=-alpha",
  "-c versionsort.suffix=-beta",
  "-c versionsort.suffix=-rc",
].join(" ");

/**
 * The tag, not package.json: these repos release by tagging and leave the file
 * alone. Tags on the commit come first, highest wins — describe picks the lower.
 */
export function describeVersion(dir) {
  const git = (command) =>
    execSync(command, {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

  try {
    // --sort=-v:refname is a version sort, descending, so v1.0.49 comes before
    // v1.0.48 rather than after it the way a plain string sort would put v1.0.9.
    const exact = git(`git ${VERSION_SORT} tag --points-at HEAD --sort=-v:refname`)
      .split("\n")
      .map((tag) => tag.trim())
      .filter(Boolean)[0];

    if (exact) {
      // describe --dirty would have said so, and a local build off a modified
      // checkout should not claim to be the release it is sitting on.
      const dirty = git("git status --porcelain") ? "-dirty" : "";
      return exact.replace(/^v/, "") + dirty;
    }

    const described = git("git describe --tags --always --dirty").replace(
      /^v/,
      "",
    );
    return described || "unknown";
  } catch {
    return "unknown";
  }
}
