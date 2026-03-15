import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  watch,
} from "fs";
import { join, relative, resolve, sep } from "path";

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

function isSafePathInside(parentDir: string, candidatePath: string): boolean {
  const rel = relative(parentDir, candidatePath);
  return rel !== "" && !rel.startsWith("..") && !rel.includes(`..${sep}`);
}

function isValidManifest(data: unknown): data is AddonManifest {
  if (typeof data !== "object" || data === null) return false;

  const obj = data as Record<string, unknown>;

  if (typeof obj.id !== "string" || !obj.id.trim()) return false;
  if (typeof obj.name !== "string" || !obj.name.trim()) return false;
  if (typeof obj.version !== "string" || !obj.version.trim()) return false;
  if (obj.type !== "plugin" && obj.type !== "theme") return false;

  if (obj.banner != null && typeof obj.banner !== "string") return false;
  if (obj.description != null && typeof obj.description !== "string")
    return false;
  if (obj.author != null && typeof obj.author !== "string") return false;

  if (obj.type === "theme") {
    if (
      !Array.isArray(obj.styles) ||
      obj.styles.some((s) => typeof s !== "string" || !s.trim())
    ) {
      return false;
    }
  }

  if (obj.type === "plugin") {
    if (typeof obj.main !== "string" || !obj.main.trim()) return false;
  }

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

      const manifest = raw as AddonManifest;

      if (manifest.id !== entry) {
        console.warn(
          `[AddonManager] Manifest id "${manifest.id}" does not match folder "${entry}". Using folder name as addon id.`
        );
      }

      results.push({
        ...manifest,
        id: entry,
      });
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

export function onAddonsChanged(
  callback: (addons: AddonManifest[]) => void
): void {
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

  if (!pathname.startsWith("/addons/")) {
    return null;
  }

  const relativePath = pathname.slice("/addons/".length);
  if (!relativePath) return null;
  if (relativePath.includes("\0")) return null;

  const resolvedPath = resolve(dir, relativePath);

  if (!isSafePathInside(dir, resolvedPath)) {
    return null;
  }

  try {
    if (existsSync(resolvedPath) && statSync(resolvedPath).isFile()) {
      return resolvedPath;
    }
  } catch {
    // fall through
  }

  return null;
}
