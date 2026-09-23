/* eslint-env node */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { CHECKS, PRESSES } from "./lib/updateEntryPoints.mjs";

const installer = readFileSync(
  new URL("../build/installer.nsh", import.meta.url),
  "utf8",
);

const builder = readFileSync(
  new URL("../electron-builder.yml", import.meta.url),
  "utf8",
);

// Windows legacy installer migration. Old installs can carry a poisoned NSIS
// uninstaller, so the replacement moves that installation aside first.
assert.match(
  installer,
  /!define GRYT_MIGRATION_REG_VALUE "LegacyNsisMigrationV1"/,
);

assert.match(
  installer,
  /IfFileExists "\$INSTDIR\\Uninstall Gryt Chat\.exe" 0 grytMigrationDone/,
);

assert.match(installer, /StrCpy \$R0 "\$INSTDIR\.old"/);

assert.match(installer, /Rename "\$INSTDIR" "\$R0"/);

assert.match(installer, /6b194ad8-2c2d-5127-9a5d-67090636e2e2/);

assert.match(installer, /683825e5-efcf-57d3-b331-3f3d51300599/);

assert.match(
  installer,
  /WriteRegDWORD HKCU[\s\S]*"\$\{GRYT_MIGRATION_REG_VALUE\}"[\s\S]*\b1\b/,
);

// The old custom process-killing bridge must stay gone.
assert.doesNotMatch(installer, /tasklist \/FI "IMAGENAME eq \$\{_FILE\}"/);

assert.doesNotMatch(installer, /findstr\.exe" \/B \/I/);

assert.doesNotMatch(installer, /!insertmacro _CHECK_APP_RUNNING/);

// Packaging invariants.
assert.match(builder, /from: build\/embedded-server\.tar\.gz/);

assert.match(builder, /from: build\/embedded-native\//);

assert.doesNotMatch(builder, /from: build\/embedded-server\/server\//);

/*
 * Both languages are in the list, wherever they sit in it. Requiring them adjacent
 * broke when `en-US` and `en-GB` were added between them (GRYT-875).
 */
const languages = builder.match(/electronLanguages:\r?\n((?:\s+-\s+\S+\r?\n)+)/)?.[1] ?? "";
for (const language of ["en", "nb"]) {
  assert.match(languages, new RegExp(`^\\s+-\\s+${language}\\s*$`, "m"), `electronLanguages is missing ${language}`);
}

// The Windows update handoff. There is no PowerShell helper any more — it never
// ran once, and quitAndInstall does the install the way it does everywhere else.
const main = readFileSync(
  new URL("../electron/main.ts", import.meta.url),
  "utf8",
);

assert.doesNotMatch(main, /launchWindowsInstallerAfterExit/);

assert.doesNotMatch(main, /WindowsPowerShell/);

// Install-on-quit, off only for a store package: MSIX, where the NSIS installer adds an
// unpackaged second copy, and the Mac App Store. Pinned to the process flags, not to a platform.
assert.match(
  main,
  /autoUpdater\.autoInstallOnAppQuit = !updatesComeFromAStore;/,
);

assert.match(
  main,
  /const updatesAreManagedByWindows = process\.windowsStore === true;/,
);

assert.match(main, /const updatesComeFromTheAppStore = process\.mas === true;/);

assert.match(
  main,
  /const updatesComeFromAStore = updatesAreManagedByWindows \|\| updatesComeFromTheAppStore;/,
);

assert.doesNotMatch(main, /autoInstallOnAppQuit = process\.platform/);

// One quitAndInstall for every platform, no win32 branch around it.
assert.equal(main.match(/autoUpdater\.quitAndInstall\(/g)?.length, 1);

// The background check has to reach a real check, not just say a release exists.
// Probing releases.atom fetched nothing, so restart-for-update found nothing (GRYT-625).
function bodyOf(name) {
  const start = main.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} is gone`);

  // Every one of these is a top-level declaration, so the first line that is a
  // lone closing brace ends it.
  const end = main.indexOf("\n}\n", start);
  assert.notEqual(end, -1, `${name} has no end`);

  return main.slice(start, end);
}

const backgroundCheck = bodyOf("checkForUpdatesInBackground");

// A store build never downloads. Both routes to a download stop before anything is fetched.
for (const name of ["checkForUpdatesInBackground", "offerRelease"]) {
  assert.match(bodyOf(name), /\{\s*(\/\*[\s\S]*?\*\/\s*)?if \(updatesComeFromAStore\) \{/, `${name} no longer stops first in a store build`);
}

// The Mac App Store build hides the tray's check and skips the variant switch's own check.
assert.match(main, /\.\.\.\(updatesComeFromTheAppStore\s*\?\s*\[\]\s*:\s*\[\s*\{\s*label: "Check for Updates",/);

assert.match(
  main.slice(main.indexOf('"set-slim-variant"'), main.indexOf('"get-beta-channel"')),
  /if \(updatesComeFromTheAppStore\) return;\s*void pinFeedToNewestCompleteRelease\(\)/,
);

assert.match(backgroundCheck, /offerRelease\(/);

// offerRelease hands the release to `updates`, which calls startDownload once the slot is
// free (check-update-supersede.mjs), and that is downloadRelease's real check.
assert.match(bodyOf("offerRelease"), /updates\.offer\(release, options\) === "ignored"/);

assert.match(main, /createPendingUpdate\(\{\s*startDownload: downloadRelease,/);

assert.match(
  bodyOf("downloadRelease"),
  /autoUpdater\.checkForUpdates\(\);[\s\S]*return check;/,
);

// The floor is what is held, so a newer release replaces it and the same one is never
// fetched twice. The probe passes it on to the filter the feed pin test covers (GRYT-1213).
assert.match(backgroundCheck, /const held = updates\.held\(\);\s*void newestReleaseWithoutApi\(held\?\.version\)/);

assert.match(bodyOf("newestReleaseWithoutApi"), /newerReleaseTags\(tags, \{\s*floor,/);

assert.match(main, /findNewer: \(floor\) => newestReleaseWithoutApi\(floor\),/);

// Every install button looks once more before installing. Before, the tray and the toast
// handed a stale download straight to quitAndInstall.
assert.match(main, /ipcMain\.on\(\s*"restart-for-update",\s*\(\) => installNewestUpdate\(\)\s*\)/);

assert.match(main, /label: `Restart and install \$\{updates\.ready\(\)\}`,\s*click: installNewestUpdate,/);

assert.match(bodyOf("installNewestUpdate"), /switch \(updates\.requestInstall\(\)\)/);

assert.match(bodyOf("installNewestUpdate"), /case "nothing":\s*downloadAnnouncedRelease\(\{ installWhenReady: true \}\);/);

// Only `updates` installs, after it has looked, with the toast told first.
assert.equal(main.match(/installDownloadedUpdate/g)?.length, 2);

assert.match(
  main,
  /install: \(\) => \{\s*sendToMain\("installing", [^\n]*\);\s*setTimeout\(installDownloadedUpdate, INSTALL_PAINT_DELAY_MS\);/,
);

// Each updater event reaches `updates`, which is what knows a download was replaced.
for (const [event, sink] of [
  ["update-available", /updates\.available\(info\.version\)/],
  ["update-not-available", /updates\.notAvailable\(\)/],
  ["update-downloaded", /updates\.downloaded\(info\.version\)/],
  ["error", /updates\.failed\(\)/],
]) {
  const start = main.indexOf(`autoUpdater.on("${event}"`);
  assert.notEqual(start, -1, `the ${event} handler is gone`);
  assert.match(main.slice(start, main.indexOf("\n  });\n", start)), sink, `${event} does not reach updates`);
}

// Squirrel.Mac installs what it staged last, so an install waits for it to stage the newest.
assert.match(main, /waitForStaging:\s*process\.platform === "darwin" && autoUpdater\.autoInstallOnAppQuit,/);

assert.match(
  main,
  /if \(process\.platform === "darwin"\) \{\s*nativeAutoUpdater\.on\("update-downloaded", \(\) => updates\.staged\(true\)\);\s*nativeAutoUpdater\.on\("error", \(\) => updates\.staged\(false\)\);/,
);

// One check reaches electron-updater: the download `updates` decided on. The variant switch
// used to run its own, unpinned, and on beta that answered "No published versions" (GRYT-1205).
assert.equal(main.match(/\.checkForUpdates\(\)/g)?.length, 1);

// Announcing is the update-available handler's job: that is the first moment the
// release is known to be coming. Announcing from the probe promised nothing real.
assert.doesNotMatch(backgroundCheck, /autoDownload: true/);

assert.match(
  main,
  /autoUpdater\.on\("update-available"[\s\S]{0,600}sendToMain\("announced"/,
);

// Asking for an update before one has been fetched starts the fetch. With
// automatic updates off this is the only thing that ever does.
assert.match(main, /ipcMain\.on\(\s*"download-update"/);

assert.match(
  bodyOf("downloadAnnouncedRelease"),
  /offerRelease\(release, \{ bypassRollout: true, asked: true, installWhenReady \}\)/,
);

// The probe only finds newer releases, so a press on a reported older stable or the other
// variant falls back to what the check reported. Only with nothing held, which is newer.
assert.match(
  bodyOf("downloadAnnouncedRelease"),
  /const release = newer \?\? \(held \? null : updates\.reported\(\)\);\s*if \(release\) \{\s*offerRelease\(release,/,
);

// Every pinned feed asks for one range at a time. Pinning puts the updater on the
// generic provider, which turns multi-range back on and refetches it all (GRYT-630).
assert.equal(
  main.match(/setFeedURL\(/g)?.length,
  main.match(/useMultipleRangeRequest: FEED_SUPPORTS_MULTI_RANGE/g)?.length,
);

assert.match(main, /const FEED_SUPPORTS_MULTI_RANGE = false;/);

// The repeating check must be able to fire: both the timer and the floor go through
// checkForUpdatesInBackground, so a floor above the interval cancels every other tick.
const interval = main.match(/const UPDATE_CHECK_INTERVAL_MS = (\d+) \* 60 \* 1000;/);
const floor = main.match(/const UPDATE_CHECK_FLOOR_MS = (\d+) \* 60 \* 1000;/);

assert.ok(interval && floor, "the update check interval and floor are gone");

assert.ok(
  Number(floor[1]) < Number(interval[1]),
  `the ${floor[1]}m floor is not below the ${interval[1]}m interval, so the timer cancels itself`,
);

// A check somebody pressed a button for skips the floor and answers either way.
// Sharing it made the tray item a no-op for the first fifteen minutes of a run.
assert.match(main, /checkForUpdatesInBackground\("tray", true\)/);

assert.match(bodyOf("checkForUpdatesInBackground"), /if \(force\) announceRelease/);

assert.match(bodyOf("checkForUpdatesInBackground"), /sendToMain\("up-to-date"/);

// Coming back to the window is a check.
assert.match(main, /checkForUpdatesInBackground\("focus"\)/);

// A finished download raises the toast whatever started it. Tied to the initiator,
// a download started from Settings announced nowhere once the panel closed.
assert.match(
  main,
  /autoUpdater\.on\("update-downloaded"[\s\S]{0,900}sendToMain\("announced"/,
);

// The renderer can ask for what it missed, so a reload does not lose the toast.
assert.match(main, /ipcMain\.on\(\s*"replay-update-status"/);

// Pressing restart says so before the window goes: restartForUpdate hands straight
// to the installer, so anything queued behind it never paints (GRYT-646).
const toast = readFileSync(
  new URL("../src/components/updateAnnouncement.tsx", import.meta.url),
  "utf8",
);

assert.match(toast, /case "installing":/);

assert.match(
  toast,
  /render\(\{ \.\.\.next, phase: "installing" \}\);\s*\n\s*getElectronAPI\(\)\?\.restartForUpdate\(\);/,
  "the toast must redraw before handing off to the installer",
);

// One toast id for every release, so a newer one redraws the toast instead of stacking a
// second beside it. The states it moves through are in check-update-supersede.mjs.
const toastState = readFileSync(
  new URL("../src/components/updateToastState.ts", import.meta.url),
  "utf8",
);

assert.match(toastState, /export const UPDATE_TOAST_ID = "update";/);

assert.match(toast, /\{ duration: Infinity, id: UPDATE_TOAST_ID \}/);

assert.equal(toast.match(/\bid: /g)?.length, 2, "the update toast and the up-to-date answer only");

assert.doesNotMatch(toast, /`update-\$\{/);

assert.doesNotMatch(toast, /toast\.dismiss\((?!t\.id\))/, "only the cross dismisses the update toast");

assert.match(toast, /const next = nextShown\(shown\.current, status\);\s*if \(next\) render\(next\);/);

// ── Automatic updates, at every check (GRYT-1206, GRYT-1218) ────────────

// electron-updater reads autoDownload after `update-available` fires. The handler put it
// back to true before the read, so the Settings check downloaded what it meant to report.
assert.equal(main.match(/\.autoDownload\s*=/g)?.length, 1, "autoDownload is set once, and never flipped");

assert.match(main, /^autoUpdater\.autoDownload = true;$/m);

assert.doesNotMatch(bodyOf("restoreRolloutCheck"), /autoDownload/);

for (const event of ["update-available", "update-not-available", "error"]) {
  const start = main.indexOf(`autoUpdater.on("${event}"`);
  assert.match(main.slice(start, main.indexOf("\n  });\n", start)), /restoreRolloutCheck\(\);/, `${event} puts the rollout check back`);
}

// Read from the file Settings writes, when asked. A copy read at startup is what the login
// launch never looked at.
assert.match(bodyOf("automaticUpdatesOn"), /return readBoolConfig\("autoUpdate", true\);/);

assert.equal(main.match(/"autoUpdate"/g)?.length, 1, "nothing else keeps its own copy of the switch");

assert.doesNotMatch(main, /autoUpdateEnabled/);

assert.match(main, /"get-auto-update",\s*\(\) => automaticUpdatesOn\(\)/);

assert.match(main, /"set-auto-update",\s*\(_event, enabled: boolean\) => \{\s*writeConfig\(\{\s*autoUpdate: enabled,/);

// `updates.offer` applies the switch, so it has to be given the live reading and a way to report.
assert.match(main, /automatic: automaticUpdatesOn,\s*report: \(release\) => reportRelease\(release\.version\),/);

// The launch, the timer, waking, focus, turning the switch on, the tray and Settings with
// something held all go through the background check, which is the first entry below.
for (const call of ['"launch"', '"interval"', '"resume"', '"focus"', '"setting"', '"tray", true', '"settings", true']) {
  assert.ok(main.includes(`checkForUpdatesInBackground(${call})`), `checkForUpdatesInBackground(${call}) is gone`);
}

// Every check that finds a release hands it to offerRelease with the options the supersede
// test runs. A new one has to be listed in scripts/lib/updateEntryPoints.mjs.
const entryPoints = { ...CHECKS, ...PRESSES };

for (const [name, { from, to, call }] of Object.entries(entryPoints)) {
  const start = main.indexOf(from);
  assert.notEqual(start, -1, `${name}: ${from} is gone`);

  const slice = main.slice(start, main.indexOf(to, start + from.length));
  assert.ok(slice.includes(call), `${name} has to call ${call}`);
  assert.doesNotMatch(slice, /\.checkForUpdates\(\)|autoDownload\s*=/, `${name} must not reach the updater itself`);
}

assert.equal(
  main.match(/offerRelease\(/g)?.length,
  Object.keys(entryPoints).length + 1,
  "a call to offerRelease that scripts/lib/updateEntryPoints.mjs doesn't list",
);

// Reported rather than fetched: the toast gets a button, and Settings gets "available".
assert.match(
  bodyOf("reportRelease"),
  /sendToMain\("announced", \{\s*version,\s*from: app\.getVersion\(\),\s*autoDownload: false,\s*reannounce,\s*\}\);\s*sendToMain\("available", \{ version \}\);/,
);

// Putting a toast back for a release that is only reported keeps its button. Announced as a
// download, a second press of Check for Updates drew a progress bar that never moved.
assert.match(
  bodyOf("announceRelease"),
  /if \(held\?\.version !== version\) \{\s*reportRelease\(version, true\);\s*return;\s*\}[\s\S]*autoDownload: true,/,
);

console.log("Updater bridge packaging checks passed");
