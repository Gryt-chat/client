// CommonJS because electron-builder loads the config, and this with it, through require().

const fs = require("node:fs");
const path = require("node:path");

/**
 * Drops the native prebuilds for platforms the package cannot run on.
 *
 * `uiohook-napi` ships one binary per platform in a single package and picks at
 * run time with node-gyp-build, so every build carried all five. Measured on the
 * 1.9.24 macOS build: 303KB of Linux and Windows binaries inside a .app.
 *
 * An afterPack hook rather than a `files` exclude, and that is not a style
 * choice. getNodeModuleFileMatcher in app-builder-lib takes only patterns
 * beginning with `!` for node_modules -- "grab only excludes" in its own
 * comment. So excluding the directory and re-including the one that matches
 * silently keeps the exclude and drops the re-include, which leaves an app that
 * starts and then fails the first time somebody presses a global hotkey.
 */

/** Directory names node-gyp-build looks for, `${platform}-${arch}`. */
function wantedDir(electronPlatformName, arch) {
  return `${electronPlatformName}-${arch}`;
}

/**
 * What to delete from one prebuilds directory.
 *
 * Separated from the filesystem so it can be tested against a list rather than
 * against a packaged app.
 */
function foreignPrebuilds(present, electronPlatformName, arch) {
  const keep = wantedDir(electronPlatformName, arch);
  return present.filter((name) => name !== keep).sort();
}

/**
 * Returns what it kept and removed, so a caller can fail rather than log.
 * Removing everything is the dangerous outcome, so finding no match is an error
 * rather than a quiet no-op.
 */
function prunePrebuilds(appOutDir, electronPlatformName, arch, { dryRun = false } = {}) {
  // Walked from appOutDir rather than from a fixed prefix. appOutDir is the
  // output *directory*, so on macOS the tree begins with `<name>.app/Contents`
  // and on Windows and Linux with `resources` -- and hard-coding either found
  // nothing on the other, silently, leaving every prebuild in place.
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
