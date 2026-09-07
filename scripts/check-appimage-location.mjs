#!/usr/bin/env node
/**
 * Where the AppImage is, and what we offer to do about it (GRYT-965).
 *
 * The bug: an AppImage is the app rather than an installer, so people bin it
 * after running it. Linux keeps the process alive off the deleted inode, the
 * `gryt://` handler keeps pointing at the old path, and browser sign-in
 * silently never comes back.
 *
 * The part worth testing is the decision — present, trashed, or gone — because
 * each leads to a different dialog, and one of the three offers a button that
 * must not be shown when it cannot work. A real AppImage is not needed for any
 * of it: `appImageState` takes the path.
 */

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, statSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

import { appImageState, restoreFromTrash, APPS_DIR } from "../electron/appImageLocation.ts";

let failures = 0;
function check(name, run) {
  try {
    run();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL  ${name}\n        ${err.message}`);
  }
}

console.log("appimage location");

/* ── Which state we are in ───────────────────────────────────────────── */

const scratch = mkdtempSync(join(tmpdir(), "gryt-appimage-"));
const real = join(scratch, "Gryt-Chat-1.9.22-linux-x86_64.AppImage");
writeFileSync(real, "not really an appimage");

check("a build that is not a Linux AppImage is left alone", () => {
  assert.equal(appImageState(undefined, "linux").kind, "not-applicable");
  assert.equal(appImageState(real, "darwin").kind, "not-applicable");
  assert.equal(appImageState(real, "win32").kind, "not-applicable");
});

check("the normal case is present, and says nothing", () => {
  const state = appImageState(real, "linux");
  assert.equal(state.kind, "present");
  assert.equal(state.path, real);
});

check("gone, and nowhere we know to look, is missing", () => {
  const state = appImageState(join(scratch, "never-existed.AppImage"), "linux");
  assert.equal(state.kind, "missing");
});

/* ── The Trash case, which is the one that happened ──────────────────── */

/* The real trash, because that is the path the code looks in. A uniquely named
   file so this cannot collide with anything somebody actually binned, and it is
   removed at the end either way. */
const trashFiles = join(homedir(), ".local", "share", "Trash", "files");
const trashInfo = join(homedir(), ".local", "share", "Trash", "info");
const name = `Gryt-Chat-0.0.0-check-${process.pid}.AppImage`;
const trashed = join(trashFiles, name);
const trashedInfo = join(trashInfo, `${name}.trashinfo`);
const pretendPath = join(scratch, "Downloads", name);

let restored = null;
try {
  mkdirSync(trashFiles, { recursive: true });
  mkdirSync(trashInfo, { recursive: true });
  writeFileSync(trashed, "binned appimage");
  writeFileSync(trashedInfo, "[Trash Info]\n");

  check("a binned AppImage is found in the Trash", () => {
    const state = appImageState(pretendPath, "linux");
    assert.equal(state.kind, "trashed");
    assert.equal(state.trashedAt, trashed);
    /* The offer names where it will go, so the dialog can say it. */
    assert.equal(state.restoreTo, join(APPS_DIR, name));
  });

  check("restoring puts it somewhere permanent and executable", () => {
    const state = appImageState(pretendPath, "linux");
    restored = restoreFromTrash(state);

    assert.ok(existsSync(restored), "the restored file is not there");
    /* Not executable is the same symptom we are fixing: a desktop entry whose
       Exec cannot run. */
    assert.ok(statSync(restored).mode & 0o111, "restored file is not executable");
  });

  check("and takes it out of the Trash, sidecar included", () => {
    assert.ok(!existsSync(trashed), "the file is still in the Trash");
    assert.ok(!existsSync(trashedInfo), "the .trashinfo sidecar was left behind");
  });

  check("once restored it reads as present, so the dialog stops", () => {
    assert.equal(appImageState(restored, "linux").kind, "present");
  });
} finally {
  rmSync(trashed, { force: true });
  rmSync(trashedInfo, { force: true });
  if (restored) rmSync(restored, { force: true });
  rmSync(scratch, { recursive: true, force: true });
}

/* ── The dialog only offers what it can do ───────────────────────────── */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const main = readFileSync(`${ROOT}/electron/main.ts`, "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/[^\n]*/g, "");

check("the check runs before the browser, not at startup", () => {
  /* At startup the handler has just been rewritten from process.env.APPIMAGE,
     so it can never be stale there — the check would never fire. */
  const handler = main.slice(main.indexOf('"auth:open-external"'));
  assert.ok(
    handler.includes("warnIfAppImageMoved"),
    "sign-in no longer checks where the AppImage is",
  );
  assert.ok(
    handler.indexOf("warnIfAppImageMoved") < handler.indexOf("shell.openExternal"),
    "the browser is opened before the check",
  );
});

check("the move button is only offered when there is something to move", () => {
  const fn = main.slice(main.indexOf("async function warnIfAppImageMoved"));
  const trashedBranch = fn.slice(fn.indexOf('state.kind === "trashed"'), fn.indexOf("Gryt has moved"));
  assert.ok(trashedBranch.includes("restoreFromTrash"), "the trashed branch cannot restore");

  /* The missing branch must not offer it: nothing holds a deleted AppImage
     open, so there would be nothing to copy. */
  const missingBranch = fn.slice(fn.indexOf("Gryt has moved"));
  assert.ok(
    !missingBranch.includes("restoreFromTrash"),
    "the missing branch offers a restore that cannot work",
  );
});

console.log(
  failures === 0
    ? "\nappimage location: sign-in stops before it cannot come back."
    : `\nappimage location: ${failures} failed.`,
);
process.exit(failures === 0 ? 0 : 1);
