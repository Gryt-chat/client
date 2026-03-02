import { getElectronAPI, isElectron } from "../../../../lib/electron";

type UserData = Record<string, unknown>;

let cache: UserData = {};
let cachedUserId: string | null = null;
let pendingLoad: Promise<UserData> | null = null;

function webKey(userId: string, key: string): string {
  return `user:${userId}:${key}`;
}

export async function loadForUser(userId: string): Promise<UserData> {
  if (cachedUserId === userId && pendingLoad) {
    console.log("[UserStore] loadForUser: returning pending load for", userId);
    return pendingLoad;
  }
  if (cachedUserId === userId && Object.keys(cache).length > 0) {
    console.log("[UserStore] loadForUser: returning cache for", userId, "keys:", Object.keys(cache).length);
    return cache;
  }

  console.log("[UserStore] loadForUser: loading data for", userId, "prev:", cachedUserId);
  cachedUserId = userId;

  pendingLoad = (async () => {
    let data: UserData = {};

    if (isElectron()) {
      const api = getElectronAPI();
      if (api) {
        data = await api.loadUserData(userId);
        console.log("[UserStore] loadForUser: Electron IPC returned", Object.keys(data).length, "keys, hasServers:", data["servers"] !== undefined);
      }
    } else {
      const prefix = `user:${userId}:`;
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith(prefix)) {
          const short = k.slice(prefix.length);
          const raw = localStorage.getItem(k);
          if (raw !== null) {
            try {
              data[short] = JSON.parse(raw) as unknown;
            } catch {
              data[short] = raw;
            }
          }
        }
      }
      console.log("[UserStore] loadForUser: localStorage returned", Object.keys(data).length, "keys, hasServers:", data["servers"] !== undefined);
    }

    const hasExistingData = Object.keys(data).length > 0;
    if (!hasExistingData) {
      console.log("[UserStore] loadForUser: no existing data, running migration");
      data = migrateFromLocalStorage(userId, data);
    }

    const servers = data["servers"];
    if (servers && typeof servers === "object") {
      console.log("[UserStore] loadForUser: loaded", Object.keys(servers).length, "servers:", Object.keys(servers).join(", "));
    } else {
      console.warn("[UserStore] loadForUser: no servers in loaded data");
    }

    cache = data;
    pendingLoad = null;
    return data;
  })();

  return pendingLoad;
}

export function getUserValue<T>(key: string, fallback: T): T {
  const v = cache[key];
  return v === undefined ? fallback : (v as T);
}

export function setUserValue(key: string, value: unknown): void {
  cache[key] = value;

  if (!cachedUserId) {
    console.warn("[UserStore] setUserValue: skipping save — no cachedUserId, key:", key);
    return;
  }

  if (key === "servers" && value && typeof value === "object") {
    console.log("[UserStore] setUserValue: saving", Object.keys(value).length, "servers for", cachedUserId, "→", Object.keys(value).join(", "));
  }

  if (isElectron()) {
    const api = getElectronAPI();
    if (api) {
      api.setUserData(cachedUserId, key, value);
      return;
    }
  }

  localStorage.setItem(webKey(cachedUserId, key), JSON.stringify(value));
}

export function removeUserValue(key: string): void {
  delete cache[key];

  if (!cachedUserId) return;

  if (isElectron()) {
    const api = getElectronAPI();
    if (api) {
      api.setUserData(cachedUserId, key, null);
      return;
    }
  }

  localStorage.removeItem(webKey(cachedUserId, key));
}

export function clearUserCache(): void {
  cache = {};
  cachedUserId = null;
  pendingLoad = null;
}

/**
 * Migrate data from global localStorage keys into the per-user store.
 * Only migrates keys that don't already exist in the user's store.
 * Called automatically on first sign-in after upgrade when no JSON file exists.
 */
function migrateFromLocalStorage(userId: string, data: UserData): UserData {
  let migrated = false;

  for (const key of SETTINGS_KEYS) {
    if (data[key] !== undefined) continue;
    const raw = localStorage.getItem(key);
    if (raw === null) continue;

    try {
      data[key] = JSON.parse(raw) as unknown;
    } catch {
      data[key] = raw;
    }
    migrated = true;
  }

  // Migrate per-user server/channel keys from old format (servers:${userId})
  const legacyServers = localStorage.getItem(`servers:${userId}`);
  if (legacyServers && data["servers"] === undefined) {
    try {
      data["servers"] = JSON.parse(legacyServers) as unknown;
    } catch { /* ignore */ }
    migrated = true;
  }

  // Also try global "servers" key (pre-per-user era)
  if (data["servers"] === undefined) {
    const globalServers = localStorage.getItem("servers");
    if (globalServers) {
      try {
        data["servers"] = JSON.parse(globalServers) as unknown;
      } catch { /* ignore */ }
      migrated = true;
    }
  }

  const legacyChannels = localStorage.getItem(`lastSelectedChannels:${userId}`);
  if (legacyChannels && data["lastSelectedChannels"] === undefined) {
    try {
      data["lastSelectedChannels"] = JSON.parse(legacyChannels) as unknown;
    } catch { /* ignore */ }
    migrated = true;
  }

  if (data["lastSelectedChannels"] === undefined) {
    const globalChannels = localStorage.getItem("lastSelectedChannels");
    if (globalChannels) {
      try {
        data["lastSelectedChannels"] = JSON.parse(globalChannels) as unknown;
      } catch { /* ignore */ }
      migrated = true;
    }
  }

  if (migrated) {
    if (isElectron()) {
      const api = getElectronAPI();
      if (api) {
        api.saveUserData(userId, { ...data });
      }
    } else {
      for (const [k, v] of Object.entries(data)) {
        localStorage.setItem(webKey(userId, k), JSON.stringify(v));
      }
    }
  }

  return data;
}

export const SETTINGS_KEYS = [
  "nickname",
  "hasSeenWelcome",
  "micID",
  "outputDeviceID",
  "micVolume",
  "outputVolume",
  "noiseGate",
  "rnnoiseEnabled",
  "autoGainEnabled",
  "autoGainTargetDb",
  "compressorEnabled",
  "compressorAmount",
  "eSportsModeEnabled",
  "preEsportsSettings",
  "inputMode",
  "pushToTalkKey",
  "muteHotkey",
  "deafenHotkey",
  "disconnectHotkey",
  "connectSoundEnabled",
  "disconnectSoundEnabled",
  "connectSoundVolume",
  "disconnectSoundVolume",
  "customConnectSoundFile",
  "customDisconnectSoundFile",
  "messageSoundEnabled",
  "messageSoundVolume",
  "customMessageSoundFile",
  "notificationBadgeEnabled",
  "showDebugOverlay",
  "showPeerLatency",
  "blurProfanity",
  "smileyConversion",
  "disabledSmileys",
  "cameraID",
  "cameraQuality",
  "cameraMirrored",
  "cameraFlipped",
  "screenShareQuality",
  "screenShareFps",
  "experimentalScreenShare",
  "screenShareGamingMode",
  "screenShareCodec",
  "screenShareMaxBitrate",
  "userVolumes",
  "pinChannelsSidebar",
  "pinMembersSidebar",
  "afkTimeoutMinutes",
  "chatMediaVolume",
] as const;
