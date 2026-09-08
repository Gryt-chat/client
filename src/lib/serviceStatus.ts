/**
 * Whether to tell a signed-in person that Gryt is having a problem, and what to
 * say. A probe says whether; the status page's own API says what.
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
 * The announcement worth showing, or null. Archived ones are history and
 * `operational` is the all-clear. Newest wins when more than one is live.
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

/**
 * What reading the feed came back with. A throw and a quiet day both arrived as
 * `null` before, which is how this stayed invisible from day one (GRYT-1052).
 */
export type AnnouncementResult =
  /** The feed answered. `announcement` is null when it had nothing live. */
  | { ok: true; announcement: Announcement | null }
  /** The feed could not be read at all. Not the same as nothing announced. */
  | { ok: false; reason: string };

/** Never throws. Callers decide what an unreadable feed means. */
export async function fetchAnnouncement(
  url: string = STATUS_API_URL,
): Promise<AnnouncementResult> {
  try {
    return { ok: true, announcement: pickAnnouncement(await getJson(url)) };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Can the account services be reached? The OIDC issuer, which every signed-in
 * client already depends on. A 5xx counts the same as a timeout.
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
 * What to show, given an announcement and how many probes have failed. An
 * announcement wins even while everything is reachable.
 */
export function decideBanner(
  announcement: Announcement | null,
  consecutiveFailures: number,
): ServiceBanner | null {
  if (announcement) return { kind: "announced", announcement };
  if (consecutiveFailures >= FAILURES_BEFORE_BANNER) return { kind: "unreachable" };
  return null;
}
