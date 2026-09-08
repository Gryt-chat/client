/* eslint-env node */

/**
 * Which native prebuilds survive packaging.
 *
 * `uiohook-napi` ships one binary per platform in a single package, so every
 * build carried all five: 303KB of Linux and Windows binaries inside the macOS
 * app, measured on 1.9.24.
 *
 * The dangerous outcome is not keeping too many, it is keeping none. node-gyp-build
 * resolves the binary the first time a global hotkey fires, so an over-eager
 * prune produces an app that starts, looks fine, and breaks later. That is why
 * the pruner throws on a missing match rather than removing everything, and why
 * that case is checked here.
 */

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { prunePrebuilds, foreignPrebuilds, wantedDir } = require("./prune-prebuilds.cjs");

const ALL = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-x64"];

// ── which directory each target wants ──────────────────────────────

assert.equal(wantedDir("darwin", "arm64"), "darwin-arm64");
assert.equal(wantedDir("darwin", "x64"), "darwin-x64");
assert.equal(wantedDir("win32", "x64"), "win32-x64");
assert.equal(wantedDir("linux", "arm64"), "linux-arm64");

// ── what goes, per target ──────────────────────────────────────────

assert.deepEqual(
  foreignPrebuilds(ALL, "darwin", "x64"),
  ["darwin-arm64", "linux-arm64", "linux-x64", "win32-x64"],
  "an Intel macOS build keeps darwin-x64 and nothing else",
);

assert.deepEqual(
  foreignPrebuilds(ALL, "darwin", "arm64"),
  ["darwin-x64", "linux-arm64", "linux-x64", "win32-x64"],
  "the two macOS arches must not keep each other",
);

assert.deepEqual(
  foreignPrebuilds(ALL, "win32", "x64"),
  ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"],
);

// Every target keeps exactly one.
for (const [platform, arch] of [["darwin", "x64"], ["darwin", "arm64"], ["win32", "x64"], ["linux", "x64"], ["linux", "arm64"]]) {
  const gone = foreignPrebuilds(ALL, platform, arch);
  assert.equal(gone.length, ALL.length - 1, `${platform}-${arch} must keep exactly one`);
  assert.ok(!gone.includes(wantedDir(platform, arch)), `${platform}-${arch} must not delete its own`);
}

// ── against a real directory tree ──────────────────────────────────

// appOutDir is the output directory, so the .app sits inside it. Getting that
// wrong found nothing on macOS and pruned nothing, which is what a build caught
// and this did not.
function fakeApp(dirs, layout = "Gryt Chat.app/Contents/Resources/app.asar.unpacked/node_modules") {
  const root = mkdtempSync(join(tmpdir(), "gryt-prebuilds-"));
  const prebuilds = join(root, layout, "uiohook-napi/prebuilds");
  for (const d of dirs) {
    mkdirSync(join(prebuilds, d), { recursive: true });
    writeFileSync(join(prebuilds, d, "node.napi.node"), "x");
  }
  return { root, prebuilds };
}

{
  const { root, prebuilds } = fakeApp(ALL);
  const { kept, removed } = prunePrebuilds(root, "darwin", "x64");

  assert.equal(removed.length, 4);
  assert.equal(kept.length, 1);
  assert.deepEqual(readdirSync(prebuilds).sort(), ["darwin-x64"]);
  assert.ok(existsSync(join(prebuilds, "darwin-x64", "node.napi.node")), "the binary itself must survive");
  rmSync(root, { recursive: true, force: true });
}

// Nothing to do is not a failure. A package with only its own prebuild is what
// this produces, and running it twice must not throw.
{
  const { root, prebuilds } = fakeApp(["darwin-arm64"]);
  const { removed } = prunePrebuilds(root, "darwin", "arm64");
  assert.deepEqual(removed, []);
  assert.deepEqual(readdirSync(prebuilds), ["darwin-arm64"]);
  rmSync(root, { recursive: true, force: true });
}

// The one that matters: no match means stop, not empty the directory.
{
  const { root, prebuilds } = fakeApp(["darwin-arm64", "linux-x64"]);
  assert.throws(
    () => prunePrebuilds(root, "darwin", "x64"),
    /has no darwin-x64/,
    "a missing target must throw rather than delete everything",
  );
  assert.deepEqual(readdirSync(prebuilds).sort(), ["darwin-arm64", "linux-x64"], "and must leave the tree alone");
  rmSync(root, { recursive: true, force: true });
}

// The Windows and Linux layout has no .app wrapper, and both must work.
{
  const { root, prebuilds } = fakeApp(ALL, "resources/app.asar.unpacked/node_modules");
  const { removed } = prunePrebuilds(root, "win32", "x64");
  assert.equal(removed.length, 4);
  assert.deepEqual(readdirSync(prebuilds).sort(), ["win32-x64"]);
  rmSync(root, { recursive: true, force: true });
}

// A package with no prebuilds at all is not an error; most have none.
{
  const root = mkdtempSync(join(tmpdir(), "gryt-prebuilds-"));
  mkdirSync(join(root, "Contents/Resources/app.asar.unpacked/node_modules/left-pad"), { recursive: true });
  const { kept, removed } = prunePrebuilds(root, "darwin", "arm64");
  assert.deepEqual(kept, []);
  assert.deepEqual(removed, []);
  rmSync(root, { recursive: true, force: true });
}

console.log("prebuild pruning: ok");
