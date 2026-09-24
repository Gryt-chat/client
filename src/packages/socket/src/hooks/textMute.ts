import { useMemo, useSyncExternalStore } from "react";

/**
 * A mute stops text as well as voice, so the composer has to know about it.
 * `until` is null when the server named no end.
 */
export interface TextMute {
  until: Date | null;
}

/* Keyed by host: a mute belongs to one server, and the app can be on several. */
const mutes = new Map<string, TextMute>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();

/* Replaced rather than mutated, so useSyncExternalStore sees a new snapshot. */
let snapshot: ReadonlyMap<string, TextMute> = mutes;

function emit(): void {
  snapshot = new Map(mutes);
  for (const listener of listeners) listener();
}

/** A mute whose end has passed is over, whatever the server last said. */
function isOver(mute: TextMute): boolean {
  return mute.until !== null && mute.until.getTime() <= Date.now();
}

/* The entry stays on after it lapses, as the record that this host's mute has
   already ended. `isOver` is what decides whether it counts. */
function scheduleLift(host: string, until: Date | null): void {
  const existing = timers.get(host);
  if (existing) clearTimeout(existing);
  timers.delete(host);
  if (!until) return;

  const wait = until.getTime() - Date.now();
  // setTimeout takes a 32-bit delay, and a mute that long is re-read on arrival.
  if (wait <= 0 || wait > 2_147_483_647) return;
  timers.set(host, setTimeout(() => {
    timers.delete(host);
    emit();
  }, wait));
}

/**
 * What the server said in so many words: a `server:muted` push, or a send it
 * refused. Passing null is an unmute.
 */
export function setTextMute(host: string, mute: TextMute | null): void {
  if (!host) return;

  const existing = timers.get(host);
  if (existing) clearTimeout(existing);
  timers.delete(host);

  if (!mute) {
    if (!mutes.delete(host)) return;
    emit();
    return;
  }

  mutes.set(host, mute);
  scheduleLift(host, mute.until);
  emit();
}

/**
 * The member list carries a flag and no expiry, and caches it per socket, so it
 * can still read muted after one lapsed. It starts a mute, never restarts one.
 */
export function noteServerMute(host: string, muted: boolean): void {
  if (!host) return;
  if (!muted) {
    setTextMute(host, null);
    return;
  }
  if (mutes.has(host)) return;
  setTextMute(host, { until: null });
}

/** The mute in force on a server right now, or null. */
export function textMuteFor(host: string): TextMute | null {
  const mute = host ? mutes.get(host) : undefined;
  if (!mute || isOver(mute)) return null;
  return mute;
}

/** For tests, and for a sign-out that should leave no mute behind. */
export function resetTextMutes(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  mutes.clear();
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ReadonlyMap<string, TextMute> {
  return snapshot;
}

export function useTextMute(host: string | undefined): TextMute | null {
  const map = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return useMemo(() => {
    void map;
    return textMuteFor(host || "");
  }, [map, host]);
}

/**
 * When it lifts, the way somebody would say it: the time on its own today, the
 * date in front of it otherwise.
 */
export function muteLiftsAt(until: Date): string {
  const time = until.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const now = new Date();
  const sameDay = until.getFullYear() === now.getFullYear()
    && until.getMonth() === now.getMonth()
    && until.getDate() === now.getDate();
  if (sameDay) return time;
  return `${until.toLocaleDateString(undefined, { day: "numeric", month: "short" })}, ${time}`;
}

/** An `expiresAt` off the wire. Anything that is not a usable date is no end. */
export function parseMuteExpiry(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at;
}
