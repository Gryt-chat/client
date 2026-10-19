/**
 * The site's changelog.json, fetched once for everything in the app that reads it.
 * What's new wants the release lines, the security notice wants `securityNotices`.
 */

/** The site emits this on every build. See the site's emit-changelog-json.mjs. */
export const CHANGELOG_URL = "https://gryt.chat/changelog.json";

/* A desktop app opens before the wifi is up, and the site rebuilds on a timer
   after a release. One attempt at launch missed both (GRYT-1110). */
export const RETRY_DELAYS_MS = [5_000, 30_000, 120_000];

/** The file's top-level keys. Each caller checks the part it reads. */
export type ChangelogFeed = Record<string, unknown>;

type Fetcher = (url: string, init: RequestInit) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

export interface LoadOptions {
  /** Whether an answer is the one being waited for. Anything else is asked for again. */
  accept?: (feed: ChangelogFeed) => boolean;
  /** A copy fetched less than this long ago is used without asking. */
  maxAgeMs?: number;
  /** For tests. */
  fetch?: Fetcher;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

let latest: ChangelogFeed | null = null;
let latestAt = 0;
let inflight: Promise<ChangelogFeed | null> | null = null;
const listeners = new Set<() => void>();

/** Waits, or gives up early once the caller has gone. */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

async function request(fetcher: Fetcher): Promise<ChangelogFeed | null> {
  try {
    /* no-cache, not the default. nginx sends max-age=600, and the ten
       minutes after an update are the ten that matter. */
    const res = await fetcher(CHANGELOG_URL, { cache: "no-cache" });
    const data = res.ok ? await res.json() : null;
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    latest = data as ChangelogFeed;
    latestAt = Date.now();
    for (const listener of listeners) listener();
    return latest;
  } catch {
    // Offline, or the site is down. Nothing to tell anybody about.
    return null;
  }
}

/** One request at a time, however many callers are waiting on it. */
function fetchOnce(fetcher: Fetcher): Promise<ChangelogFeed | null> {
  inflight ??= request(fetcher).finally(() => {
    inflight = null;
  });
  return inflight;
}

/**
 * The changelog, asked for again on the delays above until `accept` likes it.
 * Null once the retries run out, or when the caller has gone.
 */
export async function loadChangelog(signal: AbortSignal, options: LoadOptions = {}): Promise<ChangelogFeed | null> {
  const {
    accept = () => true,
    maxAgeMs = 0,
    fetch: fetcher = (url, init) => fetch(url, init),
    sleep: wait = sleep,
  } = options;

  if (latest && Date.now() - latestAt < maxAgeMs && accept(latest)) return latest;

  for (let attempt = 0; !signal.aborted; attempt++) {
    const feed = await fetchOnce(fetcher);
    if (feed && accept(feed)) return feed;

    if (attempt >= RETRY_DELAYS_MS.length) break;
    await wait(RETRY_DELAYS_MS[attempt], signal);
  }

  return null;
}

/** The last copy fetched, for useSyncExternalStore. */
export function getChangelog(): ChangelogFeed | null {
  return latest;
}

export function subscribeChangelog(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** For tests: forget the copy and anything in flight. */
export function resetChangelogFeed(): void {
  latest = null;
  latestAt = 0;
  inflight = null;
}
