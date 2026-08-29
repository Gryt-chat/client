/* eslint-env node */
/**
 * What a submodule checkout is, as a version.
 *
 * Its own module so `check-embedded-version.mjs` can call it. Importing
 * `build-embedded-server.mjs` would run a build, which is not a thing a check
 * script should do.
 */

import { execSync } from "child_process";

/**
 * Makes `--sort=-v:refname` semver precedence rather than string order.
 *
 * Git does not know a prerelease is lower than the release it leads to unless
 * it is told which suffixes mean that. Measured on git 2.50.1 with both tags
 * on one commit: without these, `v1.6.15-beta.1` sorts *above* `v1.6.15` and
 * the artefact gets versioned as the beta (GRYT-725).
 *
 * It did not matter while `release-client.yml` embedded stable tags only. It
 * does now that the beta channel embeds prereleases (GRYT-724).
 */
const VERSION_SORT = [
  "-c versionsort.suffix=-alpha",
  "-c versionsort.suffix=-beta",
  "-c versionsort.suffix=-rc",
].join(" ");

/**
 * The tag, not package.json.
 *
 * Every one of these repos releases by tagging and leaves package.json alone —
 * server's says 1.0.76 while it is released as 1.3.0-beta.2, and the worker's
 * says 1.0.6 while it is released as 1.2.0. The SFU has no package.json at all.
 * Reading those files would put three confidently wrong numbers in front of
 * someone deciding whether to update.
 *
 * A checkout that is not exactly on a tag reports the tag it descends from plus
 * the distance, which is what `git describe` gives and is honest about being
 * between releases.
 *
 * The tags on the commit are checked first, highest version wins, because
 * `git describe` picks a different one. Both the SFU and the image worker have
 * two tags on one commit — v1.0.48 and v1.0.49 are both 736fd25, tagged in the
 * same second, and v1.2.1 and v1.2.2 are both ad5d029 — and describe returned
 * the lower of each. So versions.json said 1.0.48 while the latest release was
 * 1.0.49, and every desktop-hosted server reported an update that did not
 * exist: the binary it was already running was that release.
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
