import { useCallback, useSyncExternalStore } from "react";

/**
 * Something a server needs one person to see. **The server sends a kind and some
 * values. Every word on screen is here** — otherwise it is phishing with a border.
 */
export type ServerNotice = {
  kind: "outdated_client";
  /** The version they are stuck on. Validated before it is stored. */
  version: string;
};

/** The kinds this build knows how to render. */
const KNOWN_KINDS = new Set<ServerNotice["kind"]>(["outdated_client"]);

/**
 * `x.y.z` and nothing else. Checked again on the way in rather than trusted: the
 * server's own check protects against a bug, this protects against the server.
 */
function isPlainVersion(value: unknown): value is string {
  return typeof value === "string" && /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(value);
}

/**
 * Whether an arriving payload is a notice this build will render. Anything else
 * is dropped in silence — it is a server bug or a server trying something.
 */
export function parseServerNotice(payload: unknown): ServerNotice | null {
  if (!payload || typeof payload !== "object") return null;

  const kind = (payload as { kind?: unknown }).kind;
  if (typeof kind !== "string" || !KNOWN_KINDS.has(kind as ServerNotice["kind"])) {
    return null;
  }

  switch (kind) {
    case "outdated_client": {
      const version = (payload as { version?: unknown }).version;
      return isPlainVersion(version) ? { kind, version } : null;
    }
    default:
      return null;
  }
}

/**
 * At most one notice per server. A second replaces the first rather than
 * stacking, so no arrangement of them builds a wall over the conversation.
 */
type NoticeMap = Map<string, ServerNotice>;

let noticeMap: NoticeMap = new Map();
const listeners = new Set<() => void>();

function emitChange() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): NoticeMap {
  return noticeMap;
}

/** The store as it stands, for a test with no React to render into. */
export function getNoticeSnapshot(): NoticeMap {
  return noticeMap;
}

/**
 * What somebody has already said they do not want to see. Per device, per kind
 * and per host, and the server does not get to undo it.
 */
const DISMISS_KEY = "gryt.dismissedNotices";

function dismissedSet(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function dismissKey(host: string, kind: ServerNotice["kind"]): string {
  return `${host}:${kind}`;
}

/**
 * Take a notice off the screen for good. Nothing is told about this: a server
 * learning which notices are silenced is the beginning of working around it.
 */
export function dismissServerNotice(host: string, kind: ServerNotice["kind"]) {
  const set = dismissedSet();
  set.add(dismissKey(host, kind));
  try {
    localStorage.setItem(DISMISS_KEY, JSON.stringify([...set]));
  } catch {
    /* A device that cannot store it shows the notice again next time, which is
       the safe direction to fail in. */
  }

  if (!noticeMap.has(host)) return;
  const next = new Map(noticeMap);
  next.delete(host);
  noticeMap = next;
  emitChange();
}

/** Whether this build would show it, before anything is stored. */
export function isNoticeDismissed(host: string, kind: ServerNotice["kind"]): boolean {
  return dismissedSet().has(dismissKey(host, kind));
}

/**
 * Hold what a server just sent, if it is something to show. Returns whether it
 * was kept, which is what a test asserts on.
 */
export function setServerNotice(host: string, payload: unknown): boolean {
  const notice = parseServerNotice(payload);
  if (!notice) return false;
  if (isNoticeDismissed(host, notice.kind)) return false;

  const next = new Map(noticeMap);
  next.set(host, notice);
  noticeMap = next;
  emitChange();
  return true;
}

/** Drop everything for a server, on leaving it. */
export function clearServerNotices(host: string) {
  if (!noticeMap.has(host)) return;
  const next = new Map(noticeMap);
  next.delete(host);
  noticeMap = next;
  emitChange();
}

/** For tests: forget both the store and what has been dismissed. */
export function resetServerNotices() {
  noticeMap = new Map();
  try {
    localStorage.removeItem(DISMISS_KEY);
  } catch {
    /* Nothing to clear. */
  }
  emitChange();
}

export function useServerNotice(host: string | undefined): ServerNotice | null {
  const map = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return useCallback(() => (host ? map.get(host) ?? null : null), [map, host])();
}
