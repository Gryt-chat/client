#!/usr/bin/env node
/**
 * A launch while a Windows update installs leaves the installer alone, and the installer and
 * the app agree on the files that say so (GRYT-1496).
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  clearInstallMarker,
  INSTALL_MARKER,
  installerRunning,
  launchVerdict,
  MARKER_MAX_AGE_MS,
  readInstallMarker,
  REOPEN_REQUEST,
  UPDATED_ARG,
  writeInstallMarker,
} from "../electron/updateInProgress.ts";

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

const now = 1_800_000_000_000;
const marker = { version: "1.11.46", installer: "C:\\pending\\Gryt.exe", reopens: true, at: now - 5_000 };
const running = () => true;
const gone = () => false;

check("no marker starts normally", () => {
  assert.equal(launchVerdict({ marker: null, argv: [], now, installerRunning: running }), "carry-on");
});

check("a launch while the installer runs waits", () => {
  assert.equal(launchVerdict({ marker, argv: ["Gryt Chat.exe"], now, installerRunning: running }), "wait");
});

check("the Gryt the installer starts carries on, with the marker kept for the installer", () => {
  assert.equal(launchVerdict({ marker, argv: ["Gryt Chat.exe", UPDATED_ARG], now, installerRunning: running }), "carry-on");
});

check("a finished or failed installer clears the marker", () => {
  assert.equal(launchVerdict({ marker, argv: [], now, installerRunning: gone }), "clear");
});

check("an old marker is cleared without asking about the installer", () => {
  const old = { ...marker, at: now - MARKER_MAX_AGE_MS - 1 };
  assert.equal(launchVerdict({ marker: old, argv: [], now, installerRunning: running }), "clear");
  const future = { ...marker, at: now + MARKER_MAX_AGE_MS + 1 };
  assert.equal(launchVerdict({ marker: future, argv: [], now, installerRunning: running }), "clear");
});

check("the marker round-trips, and a broken one reads as none", () => {
  const dir = mkdtempSync(join(tmpdir(), "gryt-update-"));
  assert.equal(readInstallMarker(dir), null);
  writeInstallMarker(dir, marker);
  assert.deepEqual(readInstallMarker(dir), marker);
  writeFileSync(join(dir, INSTALL_MARKER), "{not json");
  assert.equal(readInstallMarker(dir), null);
  clearInstallMarker(dir);
  clearInstallMarker(dir);
  assert.equal(readInstallMarker(dir), null);
});

check("a missing or writable installer is not running", () => {
  const dir = mkdtempSync(join(tmpdir(), "gryt-update-"));
  assert.equal(installerRunning(join(dir, "missing.exe")), false);
  const file = join(dir, "idle.exe");
  writeFileSync(file, "MZ");
  assert.equal(installerRunning(file), false);
});

check("installer.nsh looks for the same file names the app writes", () => {
  const nsh = readFileSync(new URL("../build/installer.nsh", import.meta.url), "utf8");
  assert.match(nsh, new RegExp(`!define GRYT_INSTALL_MARKER "${INSTALL_MARKER.replace(".", "\\.")}"`));
  assert.match(nsh, new RegExp(`!define GRYT_REOPEN_REQUEST "${REOPEN_REQUEST}"`));
  assert.match(nsh, new RegExp(`"open" "${UPDATED_ARG}"`));
});

if (failures) {
  console.error(`\nupdate in progress: ${failures} failed`);
  process.exit(1);
}
console.log("\nupdate in progress: ok");
