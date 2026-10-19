/* Sites somebody chose to always load embeds from, on this device (GRYT-1670). Asked per site,
   since trusting YouTube is not trusting whatever else gets linked. */

import { useSyncExternalStore } from "react";

import { getUserValue, setUserValue } from "@/settings/src/hooks/userStorage";

const KEY = "trustedEmbedHosts";
const listeners = new Set<() => void>();
let cached: readonly string[] | null = null;

// Read fresh each time, since the user's settings can load after the first render; the same
// array comes back while nothing changed, which useSyncExternalStore needs.
function read(): readonly string[] {
  const raw = getUserValue<unknown>(KEY, []);
  const list = Array.isArray(raw) ? raw.filter((h): h is string => typeof h === "string") : [];
  if (cached && cached.length === list.length && cached.every((h, i) => h === list[i])) return cached;
  cached = list;
  return cached;
}

function write(next: readonly string[]): void {
  cached = next;
  setUserValue(KEY, next);
  listeners.forEach((fn) => fn());
}

export function trustEmbedHost(host: string): void {
  const list = read();
  if (!list.includes(host)) write([...list, host]);
}

export function forgetEmbedHost(host: string): void {
  write(read().filter((h) => h !== host));
}

export function useTrustedEmbedHosts(): readonly string[] {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    read,
  );
}
