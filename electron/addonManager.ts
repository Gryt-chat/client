import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  watch,
} from "fs";
import { join, relative, resolve, sep } from "path";
import { gt, valid } from "semver";

interface AddonManifest {
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
  /** Plugin-only: if true, disabling the addon reloads the client */
  requiresReloadOnDisable?: boolean;
  /** `owner/repo` on GitHub. See isValidRepository. */
  repository?: string;
}

interface AddonUpdate {
  addonId: string;
  installed: string;
  latest: string;
  releaseUrl: string;
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

/** GitHub's own rule for a user or repository name, near enough. */
const REPO_SEGMENT = /^[A-Za-z0-9._-]{1,100}$/;

function isValidRepository(value: unknown): value is string {
  if (typeof value !== "string") return false;

  const parts = value.split("/");
  if (parts.length !== 2) return false;

  // "." and ".." pass the character class and are exactly what must not.
  return parts.every(
    (part) => REPO_SEGMENT.test(part) && part !== "." && part !== "..",
  );
}

function isValidManifest(data: unknown): data is AddonManifest {
  if (typeof data !== "object" || data === null) return false;

  const obj = data as Record<string, unknown>;

  if (typeof obj.id !== "string" || !obj.id.trim()) return false;
  if (typeof obj.name !== "string" || !obj.name.trim()) return false;
  if (typeof obj.version !== "string" || !obj.version.trim()) return false;
  if (obj.type !== "plugin" && obj.type !== "theme") return false;

  if (obj.banner != null && typeof obj.banner !== "string") return false;
  if (obj.description != null && typeof obj.description !== "string") {
    return false;
  }
  if (obj.author != null && typeof obj.author !== "string") return false;

  // Checked when the manifest is read rather than when the fetch happens. A
  // manifest is a file anybody can drop in the addons folder, and this value
  // decides what gets requested over the network — so the narrow shape is the
  // check. Two path segments of the characters GitHub allows in a name: no
  // scheme, no host, no `..`, no query string to point it somewhere else.
  if (obj.repository != null && !isValidRepository(obj.repository)) {
    return false;
  }

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
    if (
      obj.requiresReloadOnDisable != null &&
      typeof obj.requiresReloadOnDisable !== "boolean"
    ) {
      return false;
    }
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

/**
 * The newest release tag of a repository, without spending GitHub API quota.
 *
 * `/releases/latest` is a redirect to `/releases/tag/<tag>`, so the tag is in
 * the Location header of a request that never follows it. The same trick the
 * app's own update check uses, and for the same reason: api.github.com allows
 * 60 unauthenticated calls an hour per address, and somebody with a handful of
 * addons opening the page a few times would spend it.
 *
 * A repository with no releases redirects to `/releases` instead, which has no
 * tag in it, so that reads as "nothing to report" rather than an error.
 */
async function newestReleaseTag(
  repository: string,
): Promise<{ tag: string; url: string } | null> {
  try {
    const res = await fetch(
      `https://github.com/${repository}/releases/latest`,
      {
        redirect: "manual",
        signal: AbortSignal.timeout(8000),
        headers: { "User-Agent": "Gryt" },
      },
    );

    const location = res.headers.get("location");
    if (!location) return null;

    const match = location.match(/\/releases\/tag\/([^/?#]+)$/);
    if (!match) return null;

    return { tag: decodeURIComponent(match[1]), url: location };
  } catch {
    // Offline, blocked, renamed, deleted, rate-limited by something else. None
    // of it is worth a dialog: the page just does not offer an update.
    return null;
  }
}

/**
 * Which installed addons have a newer release than the version they declare.
 *
 * Only addons that named a repository, and only when the tag parses as a
 * version newer than the installed one. A tag that is not semver at all is
 * skipped rather than guessed at — "latest" and "v2-final" are real tag names
 * and neither says anything about ordering.
 *
 * Every repository is checked at once. They are independent, there are only
 * ever a handful, and doing them in sequence makes opening the page feel like
 * it hung on whichever one is slowest.
 */
export async function checkAddonUpdates(): Promise<AddonUpdate[]> {
  const withRepos = getAddons().filter((addon) => addon.repository);

  const results = await Promise.all(
    withRepos.map(async (addon) => {
      const release = await newestReleaseTag(addon.repository as string);
      if (!release) return null;

      const latest = release.tag.replace(/^v/, "");
      if (!valid(latest) || !valid(addon.version)) return null;
      if (!gt(latest, addon.version)) return null;

      return {
        addonId: addon.id,
        installed: addon.version,
        latest,
        releaseUrl: release.url,
      };
    }),
  );

  return results.filter((update): update is AddonUpdate => update !== null);
}
