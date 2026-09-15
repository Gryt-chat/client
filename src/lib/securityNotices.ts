/**
 * Security fixes the site publishes in changelog.json, and which servers they
 * apply to. The banner that shows them is SecurityNoticeBanner.
 */

import { compareVersions } from "../components/whatsNewSince.ts";

/** One entry of `securityNotices`, once it has been checked. */
export interface SecurityNotice {
  id: string;
  /** "server", "voice", "images" or "app". Only "server" is acted on here. */
  surface: string;
  /** The first release with the fix. */
  fixedIn: string;
  title: string;
  url: string;
  published: string;
}

/** What the banner draws for one server. */
export interface ServerSecurityNotice {
  /** The highest `fixedIn` this server is below, so one update covers every notice. */
  fixedIn: string;
  /** The notice to read about: the highest fix nobody here has dismissed yet. */
  url: string;
  title: string;
  /** Every notice this server is below. Dismissing hides them all. */
  ids: string[];
}

/** Same rule as the site's check, so a hand-edited file can't smuggle in something odd. */
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

const isVersion = (value: unknown): value is string =>
  typeof value === "string" && !Number.isNaN(compareVersions(value, value));

function isHttps(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/** The notices this build can act on. A malformed one is dropped rather than guessed at. */
export function parseSecurityNotices(raw: unknown): SecurityNotice[] {
  if (!Array.isArray(raw)) return [];

  const notices: SecurityNotice[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const { id, surface, fixedIn, title, url, published } = entry as Record<string, unknown>;
    if (typeof id !== "string" || !ID.test(id)) continue;
    if (typeof surface !== "string" || !isVersion(fixedIn) || !isHttps(url)) continue;
    notices.push({
      id,
      surface,
      fixedIn,
      title: typeof title === "string" ? title : "",
      url,
      published: typeof published === "string" ? published : "",
    });
  }
  return notices;
}

/** The later of two notices by `fixedIn`. The first wins a tie, and the list is newest first. */
const higher = (a: SecurityNotice, b: SecurityNotice) => (compareVersions(b.fixedIn, a.fixedIn) > 0 ? b : a);

/**
 * What to tell whoever manages a server running `version`, or null. A server that
 * reports no version, or one this can't read, gets nothing.
 */
export function noticeForServer(
  notices: SecurityNotice[],
  version: string | undefined,
  dismissed: ReadonlySet<string>,
): ServerSecurityNotice | null {
  if (!isVersion(version)) return null;

  const below = notices.filter((n) => n.surface === "server" && compareVersions(version, n.fixedIn) < 0);
  const undismissed = below.filter((n) => !dismissed.has(n.id));
  if (undismissed.length === 0) return null;

  const read = undismissed.reduce(higher);
  return {
    fixedIn: below.reduce(higher).fixedIn,
    url: read.url,
    title: read.title,
    ids: below.map((n) => n.id),
  };
}

/** A server this app hosts is updated along with the app, so it says to update Gryt. */
export function securityNoticeText(fixedIn: string, hostedHere: boolean): string {
  return hostedHere
    ? `This server has a known security issue. Update Gryt and it’ll run ${fixedIn} or later.`
    : `This server has a known security issue. Update it to ${fixedIn} or later.`;
}

/**
 * The owner, and anyone holding the owner or admin role. By role rather than a
 * permission, because the servers most in need of this predate the newer ones.
 */
export function managesServer(info: { is_owner?: boolean; role?: string } | undefined): boolean {
  return info?.is_owner === true || info?.role === "owner" || info?.role === "admin";
}

/** Per device and per server, like the notices a server sends. */
const DISMISSED_KEY = "gryt.dismissedSecurityNotices";

const dismissalListeners = new Set<() => void>();

/** The stored dismissals as one string, which stays equal until they change. For useSyncExternalStore. */
export function dismissalSnapshot(): string {
  try {
    return localStorage.getItem(DISMISSED_KEY) ?? "";
  } catch {
    return "";
  }
}

export function subscribeDismissals(listener: () => void): () => void {
  dismissalListeners.add(listener);
  return () => dismissalListeners.delete(listener);
}

function parseDismissed(raw: string): Record<string, unknown> {
  try {
    const all: unknown = JSON.parse(raw || "{}");
    return all && typeof all === "object" && !Array.isArray(all) ? (all as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const idsIn = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];

export function dismissedNotices(host: string, snapshot: string = dismissalSnapshot()): Set<string> {
  return new Set(idsIn(parseDismissed(snapshot)[host]));
}

/** Remembered by id, so a notice published later shows again. */
export function dismissNotices(host: string, ids: string[]): void {
  const all = parseDismissed(dismissalSnapshot());
  all[host] = [...new Set([...idsIn(all[host]), ...ids])];
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(all));
  } catch {
    // A device that can't store it keeps showing the notice, which is the safe way to fail.
  }
  for (const listener of dismissalListeners) listener();
}
