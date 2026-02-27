import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { join } from "path";

let usersDir: string | null = null;

// Track the latest full snapshot per user so we can flush on quit.
const dirtySnapshots = new Map<string, Record<string, unknown>>();

export function initUserStore(userDataPath: string): void {
  usersDir = join(userDataPath, "users");
  if (!existsSync(usersDir)) {
    mkdirSync(usersDir, { recursive: true });
  }
}

function userFilePath(userId: string): string {
  if (!usersDir) throw new Error("User store not initialised");
  const safe = userId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(usersDir, `${safe}.json`);
}

export function loadUser(userId: string): Record<string, unknown> {
  const filePath = userFilePath(userId);
  try {
    const data = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
    const servers = data["servers"];
    const serverCount = servers && typeof servers === "object" ? Object.keys(servers).length : 0;
    console.log(`[UserStore:main] loadUser(${userId}): ${Object.keys(data).length} keys, ${serverCount} servers from ${filePath}`);
    return data;
  } catch {
    console.warn(`[UserStore:main] loadUser(${userId}): file missing or unreadable at ${filePath}`);
    return {};
  }
}

function atomicWrite(filePath: string, data: Record<string, unknown>): void {
  const tmp = filePath + ".tmp";
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  renameSync(tmp, filePath);
}

export function saveUser(userId: string, data: Record<string, unknown>): void {
  console.log(`[UserStore:main] saveUser(${userId}): ${Object.keys(data).length} keys`);
  dirtySnapshots.set(userId, data);
  atomicWrite(userFilePath(userId), data);
}

export function patchUser(userId: string, key: string, value: unknown): void {
  const data = loadUser(userId);
  data[key] = value;
  if (key === "servers" && value && typeof value === "object") {
    console.log(`[UserStore:main] patchUser(${userId}, servers): writing ${Object.keys(value).length} servers`);
  }
  dirtySnapshots.set(userId, data);
  atomicWrite(userFilePath(userId), data);
}

/**
 * Flush any dirty snapshots to disk synchronously.
 * Called from the `will-quit` handler to guarantee data is persisted
 * before the process exits (important for auto-update flows).
 */
export function flushUserStore(): void {
  if (dirtySnapshots.size === 0) return;
  console.log(`[UserStore:main] flushUserStore: flushing ${dirtySnapshots.size} user(s)`);
  for (const [userId, data] of dirtySnapshots) {
    try {
      atomicWrite(userFilePath(userId), data);
    } catch (e) {
      console.error(`[UserStore:main] flushUserStore: failed for ${userId}:`, e);
    }
  }
  dirtySnapshots.clear();
}
