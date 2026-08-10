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
      const allLsKeys: string[] = [];
      const matchedKeys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k) allLsKeys.push(k);
        if (k?.startsWith(prefix)) {
          matchedKeys.push(k);
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
      console.log("[UserStore] loadForUser: localStorage has", allLsKeys.length, "total keys");
      console.log("[UserStore] loadForUser: matched", matchedKeys.length, "keys for prefix", JSON.stringify(prefix));
      if (matchedKeys.length > 0) {
        console.log("[UserStore] loadForUser: matched keys:", matchedKeys.join(", "));
      }
      console.log("[UserStore] loadForUser: all localStorage keys:", allLsKeys.join(", "));
      console.log("[UserStore] loadForUser: parsed data keys:", Object.keys(data).join(", "));
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
  const result = v === undefined ? fallback : (v as T);
  if (key === "servers" || key === "lastSelectedChannels" || key === "serverOrder") {
    const preview = typeof result === "object" && result !== null
      ? JSON.stringify(result).slice(0, 200)
      : String(result);
    console.log("[UserStore] getUserValue:", key, "→", v === undefined ? "(fallback)" : "(cached)", preview);
  }
  return result;
}

export function setUserValue(key: string, value: unknown): void {
  cache[key] = value;

  if (!cachedUserId) {
    console.warn("[UserStore] setUserValue: skipping save — no cachedUserId, key:", key);
    return;
  }

  const valuePreview = typeof value === "object" && value !== null
    ? JSON.stringify(value).slice(0, 200)
    : String(value);
  console.log("[UserStore] setUserValue:", key, "=", valuePreview, "for user", cachedUserId);

  if (isElectron()) {
    const api = getElectronAPI();
    if (api) {
      console.log("[UserStore] setUserValue: writing via Electron IPC");
      api.setUserData(cachedUserId, key, value);
      return;
    }
  }

  const lsKey = webKey(cachedUserId, key);
  const serialized = JSON.stringify(value);
  console.log("[UserStore] setUserValue: writing to localStorage key", JSON.stringify(lsKey), "length:", serialized.length);
  localStorage.setItem(lsKey, serialized);

  const readBack = localStorage.getItem(lsKey);
  if (readBack === null) {
    console.error("[UserStore] setUserValue: VERIFICATION FAILED — read-back is null for", lsKey);
  } else if (readBack !== serialized) {
    console.error("[UserStore] setUserValue: VERIFICATION FAILED — read-back mismatch for", lsKey, "wrote:", serialized.length, "read:", readBack.length);
  } else {
    console.log("[UserStore] setUserValue: verified OK for", lsKey);
  }
}

export function removeUserValue(key: string): void {
  console.log("[UserStore] removeUserValue:", key, "for user", cachedUserId);
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
  console.log("[UserStore] clearUserCache: clearing cache for", cachedUserId, "had", Object.keys(cache).length, "keys");
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
  console.log("[UserStore] migrateFromLocalStorage: starting for", userId);
  let migrated = false;
  const migratedKeys: string[] = [];

  for (const key of SETTINGS_KEYS) {
    if (data[key] !== undefined) continue;
    const raw = localStorage.getItem(key);
    if (raw === null) continue;

    try {
      data[key] = JSON.parse(raw) as unknown;
    } catch {
      data[key] = raw;
    }
    migratedKeys.push(key);
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
    console.log("[UserStore] migrateFromLocalStorage: migrated keys:", migratedKeys.join(", "));
    console.log("[UserStore] migrateFromLocalStorage: total data keys after migration:", Object.keys(data).join(", "));
    if (isElectron()) {
      const api = getElectronAPI();
      if (api) {
        console.log("[UserStore] migrateFromLocalStorage: saving via Electron IPC");
        api.saveUserData(userId, { ...data });
      }
    } else {
      console.log("[UserStore] migrateFromLocalStorage: saving to localStorage with prefix user:" + userId + ":");
      for (const [k, v] of Object.entries(data)) {
        localStorage.setItem(webKey(userId, k), JSON.stringify(v));
      }
    }
  } else {
    console.log("[UserStore] migrateFromLocalStorage: nothing to migrate");
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
  "faceFramingEnabled",
  "voiceTileLayout",
  "devFakeParticipants",
  "devFakeMembers",
  "devFakeChatSeconds",
  "devFakeMuted",
  "devFakeScreenShare",
  "devFakeDeafened",
  "devFakeSpeaking",
  "cameraFlipped",
  "screenShareQuality",
  "screenShareFps",
  "experimentalScreenShare",
  "screenShareGamingMode",
  "screenShareCodec",
  "screenShareMaxBitrate",
  "screenShareScalabilityMode",
  "userVolumes",
  "pinChannelsSidebar",
  "pinMembersSidebar",
  "afkTimeoutMinutes",
  "chatMediaVolume",
] as const;
