/** One release as the site's changelog.json has it. */
export interface Release {
  version: string;
  date: string;
  line: string;
  changes?: { kind: string; text: string }[];
  channel?: string;
  note?: boolean;
}

export interface ReleasesToShow {
  /** Newest first. Empty while the running version has no line yet. */
  releases: Release[];
  /** The version they are newer than, when there is more than one. */
  since: string | null;
  /** More releases matched than fit, so the rest are on the site. */
  capped: boolean;
}

/** More than this and the dialog is a changelog; the site already is one. */
export const MAX_RELEASES = 10;

type Parsed = { core: number[]; pre: string[] };

function parse(version: string): Parsed | null {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version);
  if (!m) return null;
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split(".") : [] };
}

/** Semver precedence: a prerelease sits below its release, numeric parts compare as numbers. */
export function compareVersions(a: string, b: string): number {
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return NaN;

  for (let i = 0; i < 3; i++) {
    if (x.core[i] !== y.core[i]) return x.core[i] - y.core[i];
  }

  if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length;

  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn) return Number(p) - Number(q);
    if (pn !== qn) return pn ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

/**
 * The releases between the last one somebody saw and the one they are running.
 * Beta lines only reach a beta build; anything odd falls back to the running one.
 */
export function releasesToShow(
  app: Release[],
  seen: string | null,
  running: string,
  beta: boolean,
): ReleasesToShow {
  const current = app.find((r) => r.version === running);
  if (!current) return { releases: [], since: null, capped: false };

  const only = { releases: [current], since: null, capped: false };
  if (seen === null) return only;

  const between = app
    .filter((r) => beta || r.channel !== "beta" || r.version === running)
    .filter((r) => compareVersions(r.version, seen) > 0 && compareVersions(r.version, running) <= 0)
    .filter((r, i, all) => all.findIndex((o) => o.version === r.version) === i)
    .sort((a, b) => compareVersions(b.version, a.version));

  /* A downgrade or a seen value that isn't a version leaves nothing between. */
  if (between.length <= 1) return only;

  return {
    releases: between.slice(0, MAX_RELEASES),
    since: seen,
    capped: between.length > MAX_RELEASES,
  };
}
