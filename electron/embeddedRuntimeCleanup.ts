import { lstat, readdir, rm } from "fs/promises";
import { join } from "path";

const VERSION = String.raw`\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?`;
const RELEASE = new RegExp(`^${VERSION}$`);
/** Tried before RELEASE: `1.12.0-beta.3.tmp-123` is also a valid version. */
const TEMPORARY = new RegExp(`^${VERSION}\\.tmp-(\\d+)$`);

const RECENT_MS = 24 * 60 * 60 * 1000;
/** Kept besides the one in use, newest extraction first. A server left running by a
    crashed app is almost always from the version that ran last. */
const KEEP_PREVIOUS = 2;

export interface RuntimeCleanup {
  removed: string[];
  kept: string[];
  bytes: number;
}

/**
 * Removes old version folders and abandoned `.tmp-<pid>` extractions from `parent`.
 * Only real directories named like one of those are touched, and never `current`.
 */
export async function pruneEmbeddedRuntimes(
  parent: string,
  current: string,
  log: (msg: string) => void = () => undefined,
): Promise<RuntimeCleanup> {
  const result: RuntimeCleanup = { removed: [], kept: [], bytes: 0 };

  try {
    if (!(await isReady(join(parent, current)))) {
      log(`Embedded runtime cleanup skipped: ${current} is not a ready folder`);
      return result;
    }

    const doomed: string[] = [];
    const releases: { name: string; modified: number; recent: boolean }[] = [];
    const now = Date.now();

    for (const name of await readdir(parent)) {
      if (name.toLowerCase() === current.toLowerCase()) continue;
      const temporary = TEMPORARY.exec(name);
      if (!temporary && !RELEASE.test(name)) continue;

      const stats = await lstat(join(parent, name)).catch(() => null);
      if (!stats?.isDirectory()) continue;
      const recent = now - stats.mtimeMs < RECENT_MS;

      if (!temporary) releases.push({ name, modified: stats.mtimeMs, recent });
      else if (recent && isAlive(Number(temporary[1]))) result.kept.push(name);
      else doomed.push(name);
    }

    releases.sort((a, b) => b.modified - a.modified);
    releases.forEach((release, index) => {
      if (index < KEEP_PREVIOUS || release.recent) result.kept.push(release.name);
      else doomed.push(release.name);
    });

    for (const name of doomed) {
      const path = join(parent, name);
      try {
        const bytes = await sizeOf(path).catch(() => 0);
        // The marker first, so a removal cut short never leaves a folder that looks ready.
        await rm(join(path, ".ready"), { force: true });
        await rm(path, { recursive: true, force: true });
        result.removed.push(name);
        result.bytes += bytes;
      } catch (err) {
        log(`Embedded runtime cleanup could not remove ${name}: ${describe(err)}`);
      }
    }

    if (result.removed.length > 0) {
      log(
        `Embedded runtime cleanup removed ${result.removed.join(", ")} ` +
          `(${formatBytes(result.bytes)} freed). ` +
          `Kept ${[`${current} (in use)`, ...result.kept].join(", ")}`,
      );
    }
  } catch (err) {
    log(`Embedded runtime cleanup failed: ${describe(err)}`);
  }

  return result;
}

async function isReady(folder: string): Promise<boolean> {
  try {
    return (await lstat(folder)).isDirectory() && (await lstat(join(folder, ".ready"))).isFile();
  } catch {
    return false;
  }
}

function isAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Disk used, as du counts it, so the log matches what somebody measured. */
async function sizeOf(path: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      total += await sizeOf(child);
    } else {
      const stats = await lstat(child);
      total += stats.blocks > 0 ? stats.blocks * 512 : stats.size;
    }
  }
  return total;
}

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
