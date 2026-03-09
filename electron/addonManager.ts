import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, watch } from "fs";
import { join, resolve } from "path";

export interface AddonManifest {
  id: string;
  name: string;
  version: string;
  type: "plugin" | "theme";
  description?: string;
  author?: string;
  banner?: string;
  /** Theme-only: CSS files to inject */
  styles?: string[];
  /** Plugin-only: JS entry point */
  main?: string;
}

let addonsDir: string | null = null;
let cachedAddons: AddonManifest[] = [];
let changeCallback: ((addons: AddonManifest[]) => void) | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

export function getAddonsDir(): string {
  if (!addonsDir) throw new Error("Addon manager not initialised");
  return addonsDir;
}

export function initAddonManager(userDataPath: string): void {
  addonsDir = join(userDataPath, "addons");
  if (!existsSync(addonsDir)) {
    mkdirSync(addonsDir, { recursive: true });
  }
  cachedAddons = scanAddons();
}

function isValidManifest(data: unknown): data is AddonManifest {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;
  if (typeof obj.id !== "string" || !obj.id) return false;
  if (typeof obj.name !== "string" || !obj.name) return false;
  if (typeof obj.version !== "string") return false;
  if (obj.type !== "plugin" && obj.type !== "theme") return false;
  if (obj.type === "theme" && !Array.isArray(obj.styles)) return false;
  if (obj.type === "plugin" && typeof obj.main !== "string") return false;
  return true;
}

export function scanAddons(): AddonManifest[] {
  const dir = getAddonsDir();
  const results: AddonManifest[] = [];

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }

  for (const entry of entries) {
    const entryPath = join(dir, entry);
    try {
      if (!statSync(entryPath).isDirectory()) continue;
    } catch {
      continue;
    }

    const manifestPath = join(entryPath, "addon.json");
    if (!existsSync(manifestPath)) continue;

    try {
      const raw = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
      if (!isValidManifest(raw)) {
        console.warn(`[AddonManager] Invalid manifest in ${entry}, skipping`);
        continue;
      }
      results.push(raw);
    } catch (err) {
      console.warn(`[AddonManager] Failed to parse ${manifestPath}:`, err);
    }
  }

  cachedAddons = results;
  return results;
}

export function getAddons(): AddonManifest[] {
  return cachedAddons;
}

export function onAddonsChanged(callback: (addons: AddonManifest[]) => void): void {
  changeCallback = callback;
}

export function watchAddons(): void {
  const dir = getAddonsDir();

  try {
    watch(dir, { recursive: true }, () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const addons = scanAddons();
        changeCallback?.(addons);
      }, 300);
    });
  } catch (err) {
    console.warn("[AddonManager] fs.watch failed:", err);
  }
}

/**
 * Resolve a request path like `/addons/my-theme/theme.css` to a safe
 * absolute filesystem path inside the addons directory, or null if the
 * path escapes the directory or the file doesn't exist.
 */
export function resolveAddonFilePath(pathname: string): string | null {
  const dir = getAddonsDir();
  const relative = pathname.replace(/^\/addons\//, "");
  if (!relative) return null;

  const safePath = resolve(dir, relative);
  if (!safePath.startsWith(dir)) return null;

  try {
    if (existsSync(safePath) && statSync(safePath).isFile()) {
      return safePath;
    }
  } catch {
    // fall through
  }
  return null;
}
