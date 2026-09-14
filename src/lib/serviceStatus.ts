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
  | { kind: "unreachable" }
  /** Launched with no internet, so the account could not be checked. */
  | { kind: "offline" };

/** What a check of the account services found, with offline kept apart from down. */
export type AccountsReach = "reachable" | "unreachable" | "offline";

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
export async function probeAccountServices(
  issuerUrl: string,
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
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
 * Hosts that say whether the internet works: the status page's VPS and the Pi.
 * Neither runs on the box that runs Keycloak, so one outage can't take out both.
 */
export const INTERNET_CHECK_URLS = ["https://status.gryt.chat/", "https://gryt.chat/"];

/** Shorter than the probe above, so the splash can say something before it goes. */
export const STARTUP_TIMEOUT_MS = 6_000;

/** True when any of the hosts answers at all. `no-cors`, so a CORS header is not needed. */
export async function internetReachable(
  urls: string[] = INTERNET_CHECK_URLS,
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await new Promise<boolean>((resolve) => {
      let failed = 0;
      for (const url of urls) {
        fetch(url, { mode: "no-cors", cache: "no-store", signal: controller.signal }).then(
          () => resolve(true),
          () => {
            if (++failed === urls.length) resolve(false);
          },
        );
      }
      if (urls.length === 0) resolve(false);
    });
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

/** The OS saying there is no network. Undefined outside a browser, which is not offline. */
function osSaysOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/**
 * Down only when the issuer fails and another host answers. When nothing
 * answers, the problem is this machine's connection.
 */
export function classifyReach(
  osOffline: boolean,
  issuerOk: boolean,
  internetOk: boolean,
): AccountsReach {
  if (osOffline) return "offline";
  if (issuerOk) return "reachable";
  return internetOk ? "unreachable" : "offline";
}

/** The second host is only asked once the issuer has failed, so a normal start costs one request. */
export async function checkAccountServices(
  issuerUrl: string,
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<AccountsReach> {
  if (osSaysOffline()) return "offline";
  if (await probeAccountServices(issuerUrl, timeoutMs)) return "reachable";
  return classifyReach(osSaysOffline(), false, await internetReachable(INTERNET_CHECK_URLS, timeoutMs));
}

/* What the launch check found, kept until a later check says accounts are back. */
let launchReach: AccountsReach | null = null;
let launchCheck: Promise<AccountsReach> | null = null;
let cameBack = false;
const launchListeners = new Set<() => void>();

/** Null when launch went fine, or once accounts have come back since. */
export function getLaunchTrouble(): AccountsReach | null {
  return launchReach === "reachable" ? null : launchReach;
}

export function subscribeLaunchTrouble(listener: () => void): () => void {
  launchListeners.add(listener);
  return () => launchListeners.delete(listener);
}

/** True once a later check reached accounts after launch couldn't. Stays true. */
export function accountsCameBack(): boolean {
  return cameBack;
}

/** Called with every later check. Only ever moves toward the truth, never invents trouble. */
export function settleLaunchTrouble(reach: AccountsReach): void {
  if (launchReach === null || launchReach === "reachable" || launchReach === reach) return;
  launchReach = reach;
  if (reach === "reachable") cameBack = true;
  launchListeners.forEach((l) => l());
}

/** Runs once per launch however many times it is asked. */
export function checkAccountsAtLaunch(issuerUrl: string): Promise<AccountsReach> {
  launchCheck ??= checkAccountServices(issuerUrl, STARTUP_TIMEOUT_MS).then((reach) => {
    launchReach = reach;
    launchListeners.forEach((l) => l());
    return reach;
  });
  return launchCheck;
}

/** For tests. */
export function resetLaunchCheck(): void {
  launchReach = null;
  launchCheck = null;
  cameBack = false;
}

/**
 * What to show, given an announcement, how many probes have failed and what
 * launch found. An announcement wins even while everything is reachable.
 */
export function decideBanner(
  announcement: Announcement | null,
  consecutiveFailures: number,
  launchTrouble: AccountsReach | null = null,
): ServiceBanner | null {
  if (announcement) return { kind: "announced", announcement };
  /* Launch already waited out the splash on this, so there's no second failure to wait for. */
  if (launchTrouble === "unreachable") return { kind: "unreachable" };
  if (launchTrouble === "offline") return { kind: "offline" };
  if (consecutiveFailures >= FAILURES_BEFORE_BANNER) return { kind: "unreachable" };
  return null;
}
