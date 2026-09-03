import { jwtDecode } from "jwt-decode";

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
  let result: string | null;
  if (mode === "session") {
    result = readFrom(sessionStorage, key) ?? readFrom(localStorage, key);
  } else {
    result = readFrom(localStorage, key) ?? readFrom(sessionStorage, key);
  }
  return result;
}

export function setStoredAccessToken(key: string, value: string): void {
  const mode = getAccessTokenStorageMode();
  console.log("[TokenStorage] setStoredAccessToken:", key, "mode:", mode, "length:", value.length);
  removeFrom(localStorage, key);
  removeFrom(sessionStorage, key);
  if (mode === "session") writeTo(sessionStorage, key, value);
  else writeTo(localStorage, key, value);

  const readBack = mode === "session"
    ? readFrom(sessionStorage, key)
    : readFrom(localStorage, key);
  if (readBack === null) {
    console.error("[TokenStorage] VERIFICATION FAILED — read-back null for", key);
  } else {
    console.log("[TokenStorage] verified OK for", key);
  }
}

export function removeStoredAccessToken(key: string): void {
  console.log("[TokenStorage] removeStoredAccessToken:", key);
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

// ── File tokens ───────────────────────────────────────────────────
//
// Reads uploads on one server and nothing else, and it travels in the query
// string of an `<img src>` because an image element cannot send a header. Kept
// apart from the access token for exactly that reason: this one ends up in URLs,
// in logs and in anything somebody pastes, and what leaks should be the weaker
// of the two. See GRYT-740.

export function getServerFileToken(host: string): string | null {
  return getStoredAccessToken(`fileToken_${host}`);
}

export function setServerFileToken(host: string, token: string): void {
  setStoredAccessToken(`fileToken_${host}`, token);
}

export function removeServerFileToken(host: string): void {
  removeStoredAccessToken(`fileToken_${host}`);
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
  console.log("[TokenStorage] clearAllServerTokens called");
  const clear = (storage: Storage | undefined, name: string) => {
    if (!storage) return;
    const keysToRemove: string[] = [];
    try {
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key && (key.startsWith("accessToken_") || key.startsWith("serverUserId_") || key.startsWith("refreshToken_"))) keysToRemove.push(key);
      }
      console.log(`[TokenStorage] clearAllServerTokens: removing ${keysToRemove.length} keys from ${name}:`, keysToRemove.join(", "));
      keysToRemove.forEach((k) => storage.removeItem(k));
    } catch {
      // ignore
    }
  };
  clear(localStorage, "localStorage");
  clear(sessionStorage, "sessionStorage");
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


/**
 * Your own per-server user id, read out of the access token for that host.
 *
 * The member list is the usual source of a serverUserId, but that only ever
 * tells you about other people — nothing in it says which entry is you. The
 * token is the one place the client holds its own, and it is needed wherever
 * your avatar has to be seeded the same way everyone else's is, so you are not
 * looking at two different faces for yourself on one screen.
 */
export function getOwnServerUserId(host: string | null | undefined): string | undefined {
  if (!host) return undefined;
  const token = getServerAccessToken(host);
  if (!token) return undefined;

  try {
    return jwtDecode<{ serverUserId?: string }>(token).serverUserId;
  } catch {
    return undefined;
  }
}

/**
 * The seed to draw your own generated avatar from.
 *
 * Your face has to be the one other people see, which means the id the server
 * knows you by — but the global surfaces (the All Servers profile tab, the
 * sidebar before you open anything) have no server in scope, and seeding those
 * on the Gryt account drew you a second face right next to the first one.
 *
 * So they borrow: the server you are looking at, then any server you are on,
 * and only then the account. In practice that means one face everywhere, and
 * it stops being a guess as soon as you are in a server.
 *
 * Nickname would match everywhere by construction and was rejected for it.
 * Nicknames are not unique, so two people called the same thing would share a
 * face in the member list the avatars exist to disambiguate — and a rename
 * would change the face people recognise you by.
 */
export function ownAvatarSeed(
  hosts: Array<string | null | undefined>,
  grytUserId?: string | null,
): string | undefined {
  for (const host of hosts) {
    const id = getOwnServerUserId(host);
    if (id) return id;
  }
  return grytUserId ?? undefined;
}
