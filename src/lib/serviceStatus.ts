/**
 * Whether to tell a signed-in person that Gryt is having a problem, and what to
 * say.
 *
 * Two sources answering different questions. A probe of the OIDC issuer says
 * *whether* something is wrong. An announcement on status.gryt.chat says
 * *what*, in Sivert's words, and can go up before anything has failed.
 *
 * The announcements come from the status page's own API rather than a file
 * invented for this. Gatus already has the feature, the page already renders
 * them, and one place to post means the banner and the page cannot disagree.
 *
 * It runs on a VPS rather than at home. Everything it describes is served from
 * home through a Cloudflare tunnel, so a notice hosted alongside would be
 * unreachable at the one moment anybody wants it.
 */

/** Gatus severities. `operational` is the all-clear, so it never raises a banner. */
export type AnnouncementType =
  | "outage"
  | "warning"
  | "information"
  | "operational"
  | "none";

export interface Announcement {
  message: string;
  type: AnnouncementType;
  timestamp: string;
}

export type ServiceBanner =
  /** Sivert posted something. His words win. */
  | { kind: "announced"; announcement: Announcement }
  /** Nothing posted, and the account services did not answer. */
  | { kind: "unreachable" };

export const STATUS_API_URL = "https://status.gryt.chat/api/v1/config";

/** One loop does both checks, so this is the whole polling cost. */
export const POLL_INTERVAL_MS = 60_000;

/**
 * One failure is a blip. Two in a row, a minute apart, is worth interrupting
 * somebody about.
 */
export const FAILURES_BEFORE_BANNER = 2;

const FETCH_TIMEOUT_MS = 8_000;

/** Long enough for a real notice, short enough not to bury the app. */
const MAX_MESSAGE = 240;

const TYPES: AnnouncementType[] = [
  "outage",
  "warning",
  "information",
  "operational",
  "none",
];

function parseOne(raw: unknown): Announcement | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;

  /* Gatus renders the message as markdown. This renders it as text, so the
     worst a stray asterisk does is look like an asterisk. */
  const message =
    typeof value.message === "string" ? value.message.trim().slice(0, MAX_MESSAGE) : "";
  if (!message) return null;

  const type = TYPES.includes(value.type as AnnouncementType)
    ? (value.type as AnnouncementType)
    : "none";

  return {
    message,
    type,
    timestamp: typeof value.timestamp === "string" ? value.timestamp : "",
  };
}

/**
 * The announcement worth showing, or null.
 *
 * Archived ones are the status page's history rather than something happening
 * now, and `operational` is the all-clear that closes an incident out — putting
 * either in a banner would interrupt somebody to tell them nothing is wrong.
 *
 * Newest wins when more than one is live, because that is the current word on
 * an incident that has been updated.
 */
export function pickAnnouncement(raw: unknown): Announcement | null {
  if (typeof raw !== "object" || raw === null) return null;

  const list = (raw as Record<string, unknown>).announcements;
  if (!Array.isArray(list)) return null;

  const live = list
    .filter(
      (a) =>
        typeof a === "object" &&
        a !== null &&
        (a as Record<string, unknown>).archived !== true,
    )
    .map(parseOne)
    .filter((a): a is Announcement => a !== null)
    .filter((a) => a.type !== "operational");

  if (live.length === 0) return null;

  return live.reduce((newest, a) =>
    a.timestamp > newest.timestamp ? a : newest,
  );
}

async function getJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Null for a missing or broken response, and for nothing announced. Never throws. */
export async function fetchAnnouncement(
  url: string = STATUS_API_URL,
): Promise<Announcement | null> {
  try {
    return pickAnnouncement(await getJson(url));
  } catch {
    return null;
  }
}

/**
 * Can the account services be reached?
 *
 * The OIDC issuer, which every signed-in client already depends on to refresh a
 * token. A 5xx counts the same as a timeout — from here the difference does not
 * change what to say.
 */
export async function probeAccountServices(issuerUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(issuerUrl, {
      signal: controller.signal,
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * What to show, given an announcement and how many probes have failed.
 *
 * An announcement wins even while everything is reachable — warning people
 * before taking something down is the case the status page exists for, and
 * nothing has failed yet at that point.
 */
export function decideBanner(
  announcement: Announcement | null,
  consecutiveFailures: number,
): ServiceBanner | null {
  if (announcement) return { kind: "announced", announcement };
  if (consecutiveFailures >= FAILURES_BEFORE_BANNER) return { kind: "unreachable" };
  return null;
}
