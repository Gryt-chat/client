/* eslint-env node */

/**
 * The version stamped on an embedded artefact is the highest tag on the commit
 * (GRYT-725).
 *
 * `git tag --sort=-v:refname` is a version sort but not semver precedence: it
 * does not know a prerelease is lower than the release it leads to unless
 * `versionsort.suffix` says which suffixes mean that. On git 2.50.1, with both
 * tags on one commit, the default order is
 *
 *     v1.6.15-beta.1
 *     v1.6.15
 *
 * so an artefact built from that commit would be stamped `1.6.15-beta.1` while
 * the release it is actually sitting on is `1.6.15`. Every desktop-hosted
 * server would then compare a prerelease against the newest release and be
 * offered an update to something it is already running.
 *
 * Harmless while `release-client.yml` embedded stable tags only, because a
 * prerelease tag was never checked out. GRYT-724 made the beta channel embed
 * prereleases, which is what put this in reach.
 *
 * Built as a real git repository rather than asserted against the source,
 * because the thing being checked is git's ordering, and a source check would
 * only prove the flags are spelled right.
 */

import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describeVersion } from "./lib/describeVersion.mjs";

const dir = mkdtempSync(join(tmpdir(), "gryt-describe-"));
const git = (command) =>
  execSync(command, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

try {
  git("git init -q .");
  git('git -c user.email=t@t -c user.name=t commit -q --allow-empty -m "release"');

  /* ── A commit carrying both a prerelease and its release ─────────── */

  // Tagged beta first, deliberately: creation order is what `git describe`
  // follows, and following it is the bug this whole function exists to avoid.
  git("git tag v1.6.15-beta.1");
  git("git tag v1.6.15");

  assert.equal(
    describeVersion(dir),
    "1.6.15",
    "a release outranks a prerelease of itself sitting on the same commit",
  );

  /* ── Prereleases among themselves ────────────────────────────────── */

  git("git tag -d v1.6.15 >/dev/null 2>&1 || true");
  git("git tag v1.6.15-beta.2");
  git("git tag v1.6.15-rc.1");

  assert.equal(
    describeVersion(dir),
    "1.6.15-rc.1",
    "rc outranks beta, and beta.2 outranks beta.1",
  );

  /* ── The case that was already right, still right ─────────────────── */

  // Both the SFU and the image worker have two stable tags on one commit,
  // tagged in the same second, and `git describe` returned the lower.
  const plain = mkdtempSync(join(tmpdir(), "gryt-describe-plain-"));
  const gitPlain = (command) =>
    execSync(command, { cwd: plain, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  try {
    gitPlain("git init -q .");
    gitPlain('git -c user.email=t@t -c user.name=t commit -q --allow-empty -m "release"');
    gitPlain("git tag v1.0.48");
    gitPlain("git tag v1.0.49");

    assert.equal(describeVersion(plain), "1.0.49", "the higher of two stable tags wins");
  } finally {
    rmSync(plain, { recursive: true, force: true });
  }

  /* ── A checkout that is not on a tag says so ──────────────────────── */

  const between = mkdtempSync(join(tmpdir(), "gryt-describe-between-"));
  const gitBetween = (command) =>
    execSync(command, { cwd: between, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  try {
    gitBetween("git init -q .");
    gitBetween('git -c user.email=t@t -c user.name=t commit -q --allow-empty -m "release"');
    gitBetween("git tag v1.0.49");
    gitBetween('git -c user.email=t@t -c user.name=t commit -q --allow-empty -m "after"');

    const v = describeVersion(between);
    assert.ok(
      v.startsWith("1.0.49-1-g"),
      `a commit past a tag should describe as the distance from it, got ${v}`,
    );
  } finally {
    rmSync(between, { recursive: true, force: true });
  }

  console.log("check-embedded-version: ok");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
