import type { MlsOwnDevice } from "@gryt/core";

/* "New device linked" (GRYT-1583): when one of your devices turns up on a server, your other
   devices say so, once per device id. The phone has the same in src/mls/linkedDevices.ts. */

export interface LinkedDeviceNotice {
  host: string;
  scope: string;
  deviceId: string;
  name: string | null;
  /** When the server says it was added, or when this device noticed. */
  at: number;
}

/** Ids already known for a server, and the ones that are new since. The first look is a baseline. */
export function newOwnDevices(
  known: readonly string[] | undefined,
  devices: readonly MlsOwnDevice[],
): { known: string[]; fresh: MlsOwnDevice[] } {
  const ids = devices.map((d) => d.deviceId);
  if (!known) return { known: ids, fresh: [] };
  const seen = new Set(known);
  const fresh = devices.filter((d) => !d.thisDevice && !seen.has(d.deviceId));
  return { known: [...seen, ...ids.filter((id) => !seen.has(id))], fresh };
}

export function linkedDeviceLine(notice: Pick<LinkedDeviceNotice, "name" | "at">, withTime: boolean): string {
  const name = notice.name ? `: ${notice.name}` : "";
  if (!withTime) return `New device linked${name}. Not you? Remove it.`;
  const when = new Date(notice.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return `New device linked${name}, ${when}. Not you? Remove it.`;
}

// ── Kept per browser, so a notice outlives a reload until it's dismissed ──

const KNOWN_KEY = "gryt_known_own_devices";
const NOTICES_KEY = "gryt_linked_device_notices";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the notice shows this once and may show again next time.
  }
}

let notices: readonly LinkedDeviceNotice[] = read<LinkedDeviceNotice[]>(NOTICES_KEY, []);
const listeners = new Set<() => void>();

function setNotices(next: readonly LinkedDeviceNotice[]): void {
  notices = next;
  write(NOTICES_KEY, next);
  for (const l of listeners) l();
}

export const linkedDeviceNotices = {
  get: () => notices,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  dismiss(deviceId: string): void {
    setNotices(notices.filter((n) => n.deviceId !== deviceId));
  },
};

/** A device this one linked itself: known already, so it never gets a notice here. */
export function expectOwnDevice(scope: string, deviceId: string): void {
  const all = read<Record<string, string[]>>(KNOWN_KEY, {});
  const known = all[scope];
  // No baseline yet: the next look takes one, and that already includes this device.
  if (!known || known.includes(deviceId)) return;
  write(KNOWN_KEY, { ...all, [scope]: [...known, deviceId] });
}

/** Compares a server's device list with what was known, and returns the notices to show now. */
export function noteOwnDevices(host: string, scope: string, devices: readonly MlsOwnDevice[]): LinkedDeviceNotice[] {
  const all = read<Record<string, string[]>>(KNOWN_KEY, {});
  const { known, fresh } = newOwnDevices(all[scope], devices);
  write(KNOWN_KEY, { ...all, [scope]: known });
  if (!fresh.length) return [];
  const added = fresh.map((d) => {
    const at = d.addedAt ? Date.parse(d.addedAt) : NaN;
    return { host, scope, deviceId: d.deviceId, name: d.name, at: Number.isNaN(at) ? Date.now() : at };
  });
  setNotices([...notices.filter((n) => !added.some((a) => a.deviceId === n.deviceId)), ...added]);
  return added;
}
