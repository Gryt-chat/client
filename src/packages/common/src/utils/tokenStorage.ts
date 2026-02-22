export type AccessTokenStorageMode = "local" | "session";

const MODE_KEY = "accessTokenStorageMode";

export function getAccessTokenStorageMode(): AccessTokenStorageMode {
  try {
    const v = (localStorage.getItem(MODE_KEY) || "").toLowerCase();
    return v === "session" ? "session" : "local";
  } catch {
    return "local";
  }
}

export function setAccessTokenStorageMode(mode: AccessTokenStorageMode): void {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // ignore
  }
}

function readFrom(storage: Storage | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeTo(storage: Storage | undefined, key: string, value: string): void {
  try {
    storage?.setItem(key, value);
  } catch {
    // ignore
  }
}

function removeFrom(storage: Storage | undefined, key: string): void {
  try {
    storage?.removeItem(key);
  } catch {
    // ignore
  }
}

export function getStoredAccessToken(key: string): string | null {
  const mode = getAccessTokenStorageMode();
  // Backward compatible read: check both (session first when mode=session).
  if (mode === "session") {
    return readFrom(sessionStorage, key) ?? readFrom(localStorage, key);
  }
  return readFrom(localStorage, key) ?? readFrom(sessionStorage, key);
}

export function setStoredAccessToken(key: string, value: string): void {
  const mode = getAccessTokenStorageMode();
  // Avoid stale duplicates.
  removeFrom(localStorage, key);
  removeFrom(sessionStorage, key);
  if (mode === "session") writeTo(sessionStorage, key, value);
  else writeTo(localStorage, key, value);
}

export function removeStoredAccessToken(key: string): void {
  removeFrom(localStorage, key);
  removeFrom(sessionStorage, key);
}

export function getServerAccessToken(host: string): string | null {
  return getStoredAccessToken(`accessToken_${host}`);
}

export function setServerAccessToken(host: string, token: string): void {
  setStoredAccessToken(`accessToken_${host}`, token);
}

export function removeServerAccessToken(host: string): void {
  removeStoredAccessToken(`accessToken_${host}`);
}

// ── Refresh tokens ────────────────────────────────────────────────

export function getServerRefreshToken(host: string): string | null {
  return getStoredAccessToken(`refreshToken_${host}`);
}

export function setServerRefreshToken(host: string, token: string): void {
  setStoredAccessToken(`refreshToken_${host}`, token);
}

export function removeServerRefreshToken(host: string): void {
  removeStoredAccessToken(`refreshToken_${host}`);
}

export function clearAllServerTokens(): void {
  const clear = (storage: Storage | undefined) => {
    if (!storage) return;
    const keysToRemove: string[] = [];
    try {
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key && (key.startsWith("accessToken_") || key.startsWith("serverUserId_") || key.startsWith("refreshToken_"))) keysToRemove.push(key);
      }
      keysToRemove.forEach((k) => storage.removeItem(k));
    } catch {
      // ignore
    }
  };
  clear(localStorage);
  clear(sessionStorage);
}

export function migrateAccessTokensToMode(mode: AccessTokenStorageMode): void {
  setAccessTokenStorageMode(mode);
  const keys = new Set<string>();
  const collect = (storage: Storage | undefined) => {
    if (!storage) return;
    try {
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key && (key.startsWith("accessToken_") || key.startsWith("refreshToken_"))) keys.add(key);
      }
    } catch {
      // ignore
    }
  };
  collect(localStorage);
  collect(sessionStorage);
  for (const k of keys) {
    const v = readFrom(localStorage, k) ?? readFrom(sessionStorage, k);
    if (v) setStoredAccessToken(k, v);
    else removeStoredAccessToken(k);
  }
}

