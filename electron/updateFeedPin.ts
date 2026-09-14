/**
 * Which release a pressed Check for Updates should point the updater at, and
 * what to say when there is none (GRYT-1050).
 */

import semver from "semver";

export type PinnableRelease = {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
};

export type FeedPinChoice<R extends PinnableRelease> =
  /** Pin the feed to this one. */
  | { kind: "pinned"; release: R; version: string; skipped: string[] }
  /** Nothing is newer, so a check can only find what is already running. */
  | { kind: "nothing-newer" }
  /** Newer releases exist, but none has its files up yet. */
  | { kind: "none-installable"; skipped: string[] };

/** The version a release has to beat. A pending variant switch or leaving beta
    wants a release that is not newer, and allowDowngrade lets the updater take it. */
export function versionToBeat(opts: {
  current: string;
  wantPrerelease: boolean;
  variantSwitchPending: boolean;
}): string {
  if (opts.variantSwitchPending) return "0.0.0";
  if (!opts.wantPrerelease && semver.prerelease(opts.current)) return "0.0.0";
  return opts.current;
}

export async function chooseFeedRelease<R extends PinnableRelease>(
  releases: R[],
  opts: {
    current: string;
    wantPrerelease: boolean;
    variantSwitchPending: boolean;
    isInstallable: (release: R) => Promise<boolean>;
  }
): Promise<FeedPinChoice<R>> {
  const floor = versionToBeat(opts);

  const candidates = releases
    .filter((release) => !release.draft && (opts.wantPrerelease || !release.prerelease))
    .map((release) => ({
      release,
      version: (release.tag_name || "").replace(/^v/, ""),
    }))
    .filter(({ version }) => semver.valid(version) && semver.gt(version, floor))
    .sort((a, b) => semver.rcompare(a.version, b.version));

  if (candidates.length === 0) return { kind: "nothing-newer" };

  const skipped: string[] = [];

  for (const { release, version } of candidates) {
    if (await opts.isInstallable(release)) {
      return { kind: "pinned", release, version, skipped };
    }
    skipped.push(version);
  }

  return { kind: "none-installable", skipped };
}
