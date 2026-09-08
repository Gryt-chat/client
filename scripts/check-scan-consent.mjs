/* eslint-env node */

// The process list is read only after somebody allows it, and the gate is in
// the main process so a mistake in the panel cannot get past it. GRYT-1063.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const main = readFileSync(join(root, "electron/main.ts"), "utf8");
const panel = readFileSync(
  join(root, "src/packages/settings/src/components/watchedPrograms.tsx"),
  "utf8",
);

assert.match(
  main,
  /ipcMain\.handle\("processes-list-running",\s*\(\)\s*=>\s*\n?\s*processScanAllowed\(\)\s*\?\s*listRunningPrograms\(\)\s*:\s*\[\]/,
  "processes-list-running is not gated on processScanAllowed(), so the renderer can enumerate without consent",
);

assert.match(
  main,
  /processWatcher\.watch\(\s*\n?\s*processScanAllowed\(\)/,
  "the watcher starts from the stored list without checking consent, so a revoked device keeps polling after a restart",
);

// Withdrawing has to take the list with it, or the next consent silently
// resumes watching whatever was there before.
const revoke = main.match(/ipcMain\.handle\("processes-set-consent"[\s\S]*?\n {6}\}\);/);

assert.ok(revoke, "processes-set-consent is gone");
assert.match(revoke[0], /setGlobalValue\("watchedPrograms", \[\]\)/, "revoking does not clear the watch list");
assert.match(revoke[0], /processWatcher\?\.watch\(\[\]\)/, "revoking does not stop the watcher");

assert.match(
  panel,
  /if \(!supported \|\| !consentedAt\) return;/,
  "the panel still lists running programs before consent",
);

console.log("process scan consent: ok, gated in main and in the panel");
