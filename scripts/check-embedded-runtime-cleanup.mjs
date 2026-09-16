#!/usr/bin/env node
/**
 * Old embedded runtimes go once a new one is extracted, and nothing that could still be in
 * use goes with them. Runs the real cleanup against scratch directories (GRYT-1221).
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { pruneEmbeddedRuntimes } from "../electron/embeddedRuntimeCleanup.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const CURRENT = "1.11.22";

let failures = 0;
async function check(name, run) {
  try {
    await run();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL  ${name}\n        ${err.message}`);
  }
}

function age(path, ms) {
  const when = new Date(Date.now() - ms);
  utimesSync(path, when, when);
}

/* Aged last, because writing into a folder moves its mtime. */
function runtime(parent, name, old, { ready = true } = {}) {
  const dir = join(parent, name);
  mkdirSync(join(dir, "server"), { recursive: true });
  writeFileSync(join(dir, "server", "bundle.js"), `// ${name}\n`.repeat(40));
  if (ready) writeFileSync(join(dir, ".ready"), `${name}\n`);
  age(dir, old);
  return dir;
}

function link(target, path) {
  symlinkSync(target, path, process.platform === "win32" ? "junction" : "dir");
}

/* Blocks where there are any, which is what du reports and what the log claims. */
function sizeOf(path) {
  const stats = lstatSync(path);
  if (!stats.isDirectory()) return stats.blocks > 0 ? stats.blocks * 512 : stats.size;
  return readdirSync(path).reduce((sum, name) => sum + sizeOf(join(path, name)), 0);
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/* A process that has certainly exited, so its pid is not alive. */
function deadPid() {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { pid } = spawnSync(process.execPath, ["-e", ""]);
    if (pid && !isAlive(pid)) return pid;
  }
  throw new Error("could not find a pid that is not running");
}

const listing = (dir) => readdirSync(dir).sort();
const scratch = mkdtempSync(join(tmpdir(), "gryt-runtime-cleanup-"));
const DEAD = deadPid();
const LIVE = process.pid;

console.log("embedded runtime cleanup");

try {
  /* ── One directory with every kind of entry ─────────────────────────── */

  await check("old versions and stale extractions go, everything else stays", async () => {
    const parent = join(scratch, "all", "embedded-runtime");
    const outside = join(scratch, "all", "outside");
    mkdirSync(parent, { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "canary"), "still here");
    const lookalike = runtime(join(scratch, "all"), "not-a-child", 50 * DAY);

    // The one in use is the oldest folder here, so only its name protects it.
    runtime(parent, CURRENT, 40 * DAY);
    runtime(parent, "1.2.0", 2 * DAY);
    runtime(parent, "1.11.21", 3 * DAY);
    runtime(parent, "1.11.20", 4 * DAY);
    runtime(parent, "1.12.0-beta.2", 30 * DAY);
    runtime(parent, "1.6.13-beta.1", 31 * DAY);
    runtime(parent, "1.7.0", 32 * DAY, { ready: false });
    const escaping = runtime(parent, "1.6.9", 33 * DAY);
    link(outside, join(escaping, "escape"));
    age(escaping, 33 * DAY);

    runtime(parent, `1.6.34.tmp-${DEAD}`, 20 * DAY, { ready: false });
    runtime(parent, `${CURRENT}.tmp-${DEAD}`, HOUR, { ready: false });
    runtime(parent, `1.12.0-beta.3.tmp-${DEAD}`, HOUR, { ready: false });
    runtime(parent, `1.11.19.tmp-${LIVE}`, HOUR, { ready: false });
    runtime(parent, `1.11.18.tmp-${LIVE}`, 2 * DAY, { ready: false });

    link(lookalike, join(parent, "1.5.0"));
    link(outside, join(parent, `1.5.1.tmp-${DEAD}`));
    writeFileSync(join(parent, "notes.txt"), "not ours");
    writeFileSync(join(parent, "1.4.0"), "a file, not a folder");
    for (const name of ["backup", "v1.3.0", "1.3", "1.3.0.old", "1.3.0.tmp-", "1.3.0.tmp-12a"]) {
      mkdirSync(join(parent, name));
      age(join(parent, name), 50 * DAY);
    }

    const removed = [
      "1.11.20",
      "1.12.0-beta.2",
      "1.6.13-beta.1",
      "1.7.0",
      "1.6.9",
      `1.6.34.tmp-${DEAD}`,
      `${CURRENT}.tmp-${DEAD}`,
      `1.12.0-beta.3.tmp-${DEAD}`,
      `1.11.18.tmp-${LIVE}`,
    ];
    const before = listing(parent);
    const bytes = removed.reduce((sum, name) => sum + sizeOf(join(parent, name)), 0);
    const logged = [];

    const result = await pruneEmbeddedRuntimes(parent, CURRENT, (msg) => logged.push(msg));

    assert.deepEqual(listing(parent), before.filter((name) => !removed.includes(name)));
    assert.deepEqual([...result.removed].sort(), [...removed].sort(), "reported a different set than it removed");
    assert.equal(result.bytes, bytes, "the size it reports is not the size of what went");

    assert.ok(existsSync(join(parent, CURRENT, ".ready")), "the version in use lost its marker");
    assert.ok(existsSync(join(outside, "canary")), "a symlink was followed out of the directory");
    assert.ok(existsSync(join(lookalike, ".ready")), "a symlink named like a version was followed");
    assert.ok(lstatSync(join(parent, "1.5.0")).isSymbolicLink(), "a symlink named like a version was removed");

    const summary = logged.find((line) => line.includes("removed"));
    assert.ok(summary, `nothing logged what was removed: ${JSON.stringify(logged)}`);
    for (const name of removed) assert.ok(summary.includes(name), `the log does not name ${name}`);
    assert.ok(summary.includes(`${(bytes / 1024 / 1024).toFixed(1)} MB freed`), `the log does not say what was freed: ${summary}`);
    assert.ok(summary.includes(`${CURRENT} (in use)`), "the log does not say what was kept");
  });

  /* ── Recent extractions ─────────────────────────────────────────────── */

  await check("anything extracted in the last day stays, past the two it keeps anyway", async () => {
    const parent = join(scratch, "recent", "embedded-runtime");
    mkdirSync(parent, { recursive: true });
    runtime(parent, CURRENT, 10 * DAY);
    for (const [name, old] of [["2.0.0", HOUR], ["2.0.1", 2 * HOUR], ["2.0.2", 3 * HOUR], ["1.0.1", 23 * HOUR]]) {
      runtime(parent, name, old);
    }
    runtime(parent, "1.0.0", 25 * HOUR);

    const result = await pruneEmbeddedRuntimes(parent, CURRENT);

    assert.deepEqual(result.removed, ["1.0.0"]);
    assert.deepEqual(listing(parent), [CURRENT, "1.0.1", "2.0.0", "2.0.1", "2.0.2"].sort());
  });

  /* ── When it must not run at all ────────────────────────────────────── */

  await check("nothing goes unless the version in use is a ready folder", async () => {
    const parent = join(scratch, "unready", "embedded-runtime");
    mkdirSync(join(parent, CURRENT), { recursive: true });
    runtime(parent, "1.0.0", 30 * DAY);
    runtime(parent, `1.0.0.tmp-${DEAD}`, 30 * DAY, { ready: false });
    const logged = [];

    const unready = await pruneEmbeddedRuntimes(parent, CURRENT, (msg) => logged.push(msg));
    const missing = await pruneEmbeddedRuntimes(parent, "9.9.9");

    assert.deepEqual([unready.removed, missing.removed], [[], []]);
    assert.deepEqual(listing(parent), ["1.0.0", `1.0.0.tmp-${DEAD}`, CURRENT].sort());
    assert.ok(logged.some((line) => line.includes("skipped")), "a skipped cleanup said nothing");
  });

  await check("a directory that is not there is not an error", async () => {
    const result = await pruneEmbeddedRuntimes(join(scratch, "never", "embedded-runtime"), CURRENT);
    assert.deepEqual(result, { removed: [], kept: [], bytes: 0 });
  });

  /* ── A folder that cannot be removed ────────────────────────────────── */

  /* Read-only directories stand in for files that will not go. Root and Windows ignore that. */
  const canLock = process.platform !== "win32" && process.getuid?.() !== 0;
  const locked = [];
  const lock = (dir) => {
    chmodSync(dir, 0o555);
    locked.push(dir);
  };

  if (!canLock) console.log("  skip  the read-only folder cases, which need a non-root user off Windows");

  try {
    if (canLock) await check("one folder that will not go stops nothing, and the failure is logged", async () => {
      const parent = join(scratch, "locked", "embedded-runtime");
      mkdirSync(parent, { recursive: true });
      runtime(parent, CURRENT, 10 * DAY);
      runtime(parent, "1.9.0", 2 * DAY);
      runtime(parent, "1.9.1", 3 * DAY);
      runtime(parent, "1.0.0", 30 * DAY);
      runtime(parent, "1.0.1", 31 * DAY);
      runtime(parent, "1.0.2", 32 * DAY);
      lock(join(parent, "1.0.0", "server"));
      age(join(parent, "1.0.0"), 30 * DAY);
      const logged = [];

      const result = await pruneEmbeddedRuntimes(parent, CURRENT, (msg) => logged.push(msg));

      assert.deepEqual(result.removed, ["1.0.1", "1.0.2"]);
      assert.ok(existsSync(join(parent, "1.0.0")), "the locked folder is gone, so this proved nothing");
      assert.ok(!existsSync(join(parent, "1.0.0", ".ready")), "a half-removed folder still looks ready");
      assert.ok(logged.some((line) => line.includes("could not remove 1.0.0")), "the failure was not logged");
    });

    if (canLock) await check("a folder that cannot be removed at all stops looking ready first", async () => {
      const parent = join(scratch, "stuck", "embedded-runtime");
      mkdirSync(parent, { recursive: true });
      runtime(parent, CURRENT, 10 * DAY);
      runtime(parent, "1.9.0", 2 * DAY);
      runtime(parent, "1.9.1", 3 * DAY);
      runtime(parent, "1.0.0", 30 * DAY);
      lock(parent);

      const result = await pruneEmbeddedRuntimes(parent, CURRENT);

      assert.deepEqual(result.removed, []);
      assert.deepEqual(listing(parent), [CURRENT, "1.0.0", "1.9.0", "1.9.1"].sort());
      assert.ok(!existsSync(join(parent, "1.0.0", ".ready")), "a folder that stayed still looks ready");
      assert.ok(existsSync(join(parent, "1.9.0", ".ready")), "a folder it kept lost its marker");
      assert.ok(existsSync(join(parent, CURRENT, ".ready")), "the version in use lost its marker");
    });
  } finally {
    for (const dir of locked) chmodSync(dir, 0o755);
  }

  /* ── Where the manager calls it ─────────────────────────────────────── */

  const stripped = (path) =>
    readFileSync(join(ROOT, path), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
  const manager = stripped("electron/embeddedServerManager.ts");
  const bodyOf = (source, signature) => {
    const start = source.indexOf(signature);
    assert.notEqual(start, -1, `${signature} is gone. Move this check with it.`);
    return source.slice(start, source.indexOf("\n}\n", start));
  };

  await check("it runs after the extraction is renamed into place, and only then", () => {
    const prepare = bodyOf(manager, "export async function prepareEmbeddedServerRuntime(");
    const calls = prepare.split("pruneEmbeddedRuntimes(").length - 1;
    assert.equal(calls, 1, `prepareEmbeddedServerRuntime calls the cleanup ${calls} times`);

    const call = prepare.indexOf("pruneEmbeddedRuntimes(");
    assert.ok(call > prepare.indexOf("await rename(temporary, destination)"), "the cleanup runs before the rename");
    assert.ok(call > prepare.indexOf("throw error;"), "the cleanup runs inside the extraction's try, or before it");
    assert.match(prepare, /pruneEmbeddedRuntimes\(runtimeParent, app\.getVersion\(\)/, "it is not handed the folder just extracted");
  });

  await check("startup does not wait for it, and a failure cannot reach startup", () => {
    const prepare = bodyOf(manager, "export async function prepareEmbeddedServerRuntime(");
    assert.doesNotMatch(prepare, /(await|return)\s+pruneEmbeddedRuntimes/, "startup waits for the cleanup");
    assert.match(prepare, /pruneEmbeddedRuntimes\([^;]*\)\.catch\(/, "a rejected cleanup is not caught");
  });

  await check("it does not run while embedded processes were already up", () => {
    const prepare = bodyOf(manager, "export async function prepareEmbeddedServerRuntime(");
    const guard = prepare.indexOf("const safeToPrune = !embeddedProcessesRunning();");
    assert.notEqual(guard, -1, "the running-processes guard is gone");
    assert.ok(guard < prepare.indexOf("await extract("), "the guard is read after extraction starts");
    assert.match(prepare, /if \(safeToPrune\) \{\s*pruneEmbeddedRuntimes\(/, "the cleanup is not behind the guard");

    const running = bodyOf(manager, "function embeddedProcessesRunning(");
    for (const needle of ["sfuProcess", "instances.values()", "inst.server", "inst.worker"]) {
      assert.ok(running.includes(needle), `embeddedProcessesRunning no longer looks at ${needle}`);
    }
    assert.doesNotMatch(running, /return false;[\s\S]*return true;/, "embeddedProcessesRunning answers before looking");
  });

  await check("what it removed ends up in the startup log", () => {
    assert.match(stripped("electron/main.ts"), /prepareEmbeddedServerRuntime\(startupLog\)/);
  });

  /* ── The Mac App Store build ────────────────────────────────────────── */

  await check("the store build runs the runtime inside the app, and never unpacks it", () => {
    const prepare = bodyOf(manager, "export async function prepareEmbeddedServerRuntime(");
    const bail = prepare.indexOf("if (process.mas) return;");
    assert.notEqual(bail, -1, "the Mac App Store build unpacks into userData, where the sandbox won't run it");
    assert.ok(bail < prepare.indexOf("await extract("), "the store build bails out after extracting");

    const root = bodyOf(manager, "function packagedRuntimeRoot(");
    assert.match(root, /join\(process\.resourcesPath, "embedded-server"\)/, "the unpacked runtime in the app is not looked for");
  });

  await check("the store build still counts as the full build", () => {
    const slim = bodyOf(stripped("electron/main.ts"), "function isSlimInstall(");
    assert.match(slim, /process\.mas \? "embedded-server" : "embedded-server\.tar\.gz"/, "a full store build reads as slim");
  });
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log(
  failures === 0
    ? "\nembedded runtime cleanup: old versions go, and nothing that could be in use goes with them."
    : `\nembedded runtime cleanup: ${failures} failed.`,
);
process.exit(failures === 0 ? 0 : 1);
