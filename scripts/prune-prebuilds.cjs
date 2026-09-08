// CommonJS because electron-builder loads the config, and this with it, through require().

const fs = require("node:fs");
const path = require("node:path");

/**
 * Drops the native prebuilds for platforms the package cannot run on. An
 * afterPack hook, because node_modules `files` patterns take only excludes.
 */

/** Directory names node-gyp-build looks for, `${platform}-${arch}`. */
function wantedDir(electronPlatformName, arch) {
  return `${electronPlatformName}-${arch}`;
}

/**
 * What to delete from one prebuilds directory. Separated from the filesystem so
 * it can be tested against a list rather than a packaged app.
 */
function foreignPrebuilds(present, electronPlatformName, arch) {
  const keep = wantedDir(electronPlatformName, arch);
  return present.filter((name) => name !== keep).sort();
}

/**
 * Returns what it kept and removed, so a caller can fail rather than log. Finding
 * no match is an error: removing everything is the dangerous outcome.
 */
function prunePrebuilds(appOutDir, electronPlatformName, arch, { dryRun = false } = {}) {
  // Walked from appOutDir rather than a fixed prefix: macOS begins with
  // `<name>.app/Contents` and the others with `resources`.
  const roots = [];
  const walk = (dir, depth) => {
    if (depth > 10) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === "prebuilds") {
        roots.push(path.join(dir, entry.name));
        continue;
      }
      walk(path.join(dir, entry.name), depth + 1);
    }
  };

  walk(appOutDir, 0);

  const removed = [];
  const kept = [];

  for (const root of roots) {
    const present = fs.readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);

    const keep = wantedDir(electronPlatformName, arch);
    if (!present.includes(keep)) {
      throw new Error(
        `${root} has no ${keep}. Present: ${present.join(", ") || "nothing"}. ` +
          "Pruning would leave the package with no binary it can load.",
      );
    }

    for (const name of foreignPrebuilds(present, electronPlatformName, arch)) {
      if (!dryRun) fs.rmSync(path.join(root, name), { recursive: true, force: true });
      removed.push(`${path.basename(path.dirname(root))}/${name}`);
    }
    kept.push(`${path.basename(path.dirname(root))}/${keep}`);
  }

  return { kept, removed };
}

module.exports = { prunePrebuilds, foreignPrebuilds, wantedDir };
