import { useSyncExternalStore } from "react";

export type JoinPolicy = "invite" | "request" | "open";

/** Only the three words the server sends. Anything else is unknown, not open. */
export function readJoinPolicy(value: unknown): JoinPolicy | null {
  return value === "invite" || value === "request" || value === "open" ? value : null;
}

/* From `server:info`, which every server sends on connect and again after a settings change. */
let policies: ReadonlyMap<string, JoinPolicy> = new Map();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return policies;
}

export function setServerJoinPolicy(host: string, value: unknown): void {
  const policy = readJoinPolicy(value);
  if (!policy || policies.get(host) === policy) return;
  const next = new Map(policies);
  next.set(host, policy);
  policies = next;
  for (const listener of listeners) listener();
}

/** Null until the server has said, and on a server too old to say. */
export function useServerJoinPolicy(host: string | undefined): JoinPolicy | null {
  const map = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return host ? map.get(host) ?? null : null;
}
