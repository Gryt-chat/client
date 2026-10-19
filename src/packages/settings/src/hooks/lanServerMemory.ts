/* Which servers on this network this machine has looked at, and which it was
   told to hide. Both belong to the device, not to an account. GRYT-1142. */

/* Not prefixed `user:`, so initGlobalStorage backs these with a file in
   Electron's userData directory and they survive a restart. */
const SEEN = "lanServersSeen";
const DISMISSED = "lanServersDismissed";

/* Where they used to live, under whichever user id was current when the
   Discovery page happened to be open. */
const OLD_SEEN = "seenLanServers";
const OLD_DISMISSED = "dismissedLanServers";

function read(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    return [];
  }
}

function write(key: string, value: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* A full or blocked store loses the memory, not the app. */
  }
}

/* Every user id this device has stored under. The old keys were per-user, and
   which one holds the list depends on when Discovery was last open. */
function everyUserValue(key: string): string[] {
  const found: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const storageKey = localStorage.key(i);
      if (!storageKey?.startsWith("user:") || !storageKey.endsWith(`:${key}`)) continue;
      const raw = localStorage.getItem(storageKey);
      if (!raw) continue;
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const v of parsed) if (typeof v === "string") found.push(v);
      }
    }
  } catch {
    /* Nothing to carry over is the same as none of it parsing. */
  }
  return found;
}

/* Take what the per-user keys hold, once. Without it the first launch after the
   upgrade announces every server on the network again, which is the complaint. */
function migrate(deviceKey: string, oldKey: string): string[] {
  const already = read(deviceKey);
  if (already.length > 0) return already;

  const carried = Array.from(new Set(everyUserValue(oldKey)));
  if (carried.length > 0) write(deviceKey, carried);
  return carried;
}

export function seenLanServers(): string[] {
  return migrate(SEEN, OLD_SEEN);
}

export function dismissedLanServers(): string[] {
  return migrate(DISMISSED, OLD_DISMISSED);
}

/** Accumulates: a server that drops off the network and comes back is not new. */
export function rememberLanServersSeen(keys: string[]): string[] {
  const next = Array.from(new Set([...seenLanServers(), ...keys]));
  write(SEEN, next);
  return next;
}

export function rememberLanServerDismissed(key: string): string[] {
  const next = Array.from(new Set([...dismissedLanServers(), key]));
  write(DISMISSED, next);
  return next;
}

export function forgetLanServerDismissed(key: string): string[] {
  const next = dismissedLanServers().filter((k) => k !== key);
  write(DISMISSED, next);
  return next;
}
