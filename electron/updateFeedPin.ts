/**
 * Which release a pressed Check for Updates should point the updater at, and
 * what to say when there is none (GRYT-1050) or GitHub can't be asked (GRYT-1170).
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

/** The release list never arrived. `retryAt` is when GitHub said to ask again, in epoch ms. */
export type ReleaseLookupFailed = {
  kind: "lookup-failed";
  status?: number;
  retryAt?: number;
};

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

/** `retry-after` comes with GitHub's secondary limit, `x-ratelimit-reset` once the
    hour's 60 requests are spent. When both are there, the later one holds. */
export function rateLimitResetAt(headers: Headers, now: number): number | undefined {
  const times: number[] = [];

  const retryAfter = headers.get("retry-after")?.trim();
  if (retryAfter && /^\d+$/.test(retryAfter)) times.push(now + Number(retryAfter) * 1000);

  const reset = Number(headers.get("x-ratelimit-reset"));
  if (headers.get("x-ratelimit-remaining")?.trim() === "0" && reset > 0) {
    times.push(reset * 1000);
  }

  return times.length > 0 ? Math.max(...times) : undefined;
}

/** A thrown request, a status outside 2xx and a body that isn't a list all fail
    alike, and none of them may fall back to the updater's own github provider. */
export async function readReleaseList<R extends PinnableRelease>(
  request: () => Promise<Response>,
  now: () => number = Date.now
): Promise<{ kind: "listed"; releases: R[] } | ReleaseLookupFailed> {
  let res: Response;
  try {
    res = await request();
  } catch {
    return { kind: "lookup-failed" };
  }

  if (!res.ok) {
    res.body?.cancel().catch(() => {});
    return {
      kind: "lookup-failed",
      status: res.status,
      retryAt: rateLimitResetAt(res.headers, now()),
    };
  }

  const body: unknown = await res.json().catch(() => null);
  if (!Array.isArray(body)) return { kind: "lookup-failed", status: res.status };

  return { kind: "listed", releases: body as R[] };
}

/** What the feed pin asks GitHub, in order: the release list, then each candidate's files. */
export async function findFeedRelease<R extends PinnableRelease>(
  request: () => Promise<Response>,
  opts: {
    current: string;
    wantPrerelease: boolean;
    variantSwitchPending: boolean;
    isInstallable: (release: R) => Promise<boolean>;
    now?: () => number;
  }
): Promise<FeedPinChoice<R> | ReleaseLookupFailed> {
  const list = await readReleaseList<R>(request, opts.now);
  if (list.kind === "lookup-failed") return list;

  return chooseFeedRelease(list.releases, opts);
}

/** Shaped like the chat's timestamps. A locale tag ICU doesn't know throws instead
    of falling back, and "C.UTF-8" is one of those. */
export function clockTime(at: number, locale: string): string {
  const options = { hour: "numeric", minute: "2-digit" } as const;
  try {
    return new Date(at).toLocaleTimeString(locale, options);
  } catch {
    return new Date(at).toLocaleTimeString(undefined, options);
  }
}

/** Settings puts "Update error:" in front. The reset is rounded up to the minute,
    so the limit has lifted by the time the message names. */
export function lookupFailedMessage(
  failure: ReleaseLookupFailed,
  now: number,
  formatTime: (at: number) => string
): string {
  const couldNot = "Couldn't check GitHub for updates right now.";

  if (failure.retryAt === undefined || failure.retryAt <= now) {
    return `${couldNot} Try again in a few minutes.`;
  }

  const minute = Math.ceil(failure.retryAt / 60_000) * 60_000;
  return `${couldNot} Try again after ${formatTime(minute)}.`;
}
