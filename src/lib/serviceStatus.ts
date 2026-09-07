/**
 * Whether to tell a signed-in person that Gryt is having a problem, and what to
 * say.
 *
 * Two sources, and they answer different questions. A probe of the account
 * services says *whether* something is wrong. A file Sivert edits says *what* —
 * so a known outage reads "we're investigating" instead of the generic line.
 *
 * The file lives on gryt.chat, which runs on the Pi. Keycloak, the identity
 * service and the Gryt servers run on a different machine, so the notice
 * explaining the outage does not go down with the thing it describes.
 */

export interface ServiceStatus {
  title: string;
  body: string;
  link?: string;
  linkLabel?: string;
}

export type ServiceBanner =
  /** Sivert posted something. His words win. */
  | { kind: "declared"; status: ServiceStatus }
  /** Nothing posted, and the account services did not answer. */
  | { kind: "unreachable" };

export const STATUS_URL = "https://gryt.chat/status.json";

/** One loop does both checks, so this is the whole polling cost. */
export const POLL_INTERVAL_MS = 60_000;

/**
 * One failure is a blip. Two in a row, a minute apart, is a problem worth
 * interrupting somebody about.
 */
export const FAILURES_BEFORE_BANNER = 2;

const FETCH_TIMEOUT_MS = 8_000;

const MAX_TITLE = 80;
const MAX_BODY = 200;
const MAX_LINK_LABEL = 40;

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/**
 * https only. The banner renders this as something somebody clicks, and a
 * status file should never become a way to run anything in the app.
 */
function safeLink(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function parseStatus(raw: unknown): ServiceStatus | null {
  if (typeof raw !== "object" || raw === null) return null;

  const value = raw as Record<string, unknown>;
  if (value.active !== true) return null;

  const title = text(value.title, MAX_TITLE);

  /* An empty banner is worse than none: it says something is wrong and refuses
     to say what. Falls through to the probe, which has its own wording. */
  if (!title) return null;

  return {
    title,
    body: text(value.body, MAX_BODY),
    link: safeLink(value.link),
    linkLabel: text(value.linkLabel, MAX_LINK_LABEL) || "More",
  };
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

/** Null for a missing, broken or inactive file. Never throws. */
export async function fetchDeclaredStatus(
  url: string = STATUS_URL,
): Promise<ServiceStatus | null> {
  try {
    return parseStatus(await getJson(url));
  } catch {
    return null;
  }
}

/**
 * Can the account services be reached?
 *
 * The OIDC issuer's own discovery document, which every signed-in client
 * already depends on to refresh a token. A 5xx counts as unreachable the same
 * as a timeout — from here the difference does not change what to say.
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
 * What to show, given a declared notice and how many probes have failed.
 *
 * A declared notice always wins, including while everything is reachable —
 * that is the case where Sivert is warning people before he takes something
 * down, and it is the whole reason the file exists.
 */
export function decideBanner(
  declared: ServiceStatus | null,
  consecutiveFailures: number,
): ServiceBanner | null {
  if (declared) return { kind: "declared", status: declared };
  if (consecutiveFailures >= FAILURES_BEFORE_BANNER) return { kind: "unreachable" };
  return null;
}
