/**
 * Decision 4's record: people seen on MLS, per server, never sealed to with version 1 again.
 * A peer pin has no field for it yet, so it sits next to the pins in localStorage.
 */

const KEY_PREFIX = "gryt_mls_seen:";

export interface SeenOnMls {
  has(serverUserId: string): boolean;
  add(serverUserId: string): void;
}

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

export function seenOnMlsFor(scope: string, storage: Storage | undefined = globalThis.localStorage): SeenOnMls {
  const key = KEY_PREFIX + scope;
  // Read each time, so another tab's record counts here too.
  const read = (): string[] => {
    try {
      const raw = storage?.getItem(key);
      const list: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list.filter((id): id is string => typeof id === "string") : [];
    } catch {
      return [];
    }
  };
  return {
    has: (id) => read().includes(id),
    add(id) {
      const seen = read();
      if (seen.includes(id)) return;
      try {
        storage?.setItem(key, JSON.stringify([...seen, id]));
      } catch {
        // Full or blocked. The next MLS message records them again.
      }
    },
  };
}
