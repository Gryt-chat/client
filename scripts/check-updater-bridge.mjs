/* eslint-env node */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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

// Install-on-quit, off only for the MSIX package, where the NSIS installer adds an
// unpackaged second copy. Pinned to `process.windowsStore`, not to "Windows".
assert.match(
  main,
  /autoUpdater\.autoInstallOnAppQuit = !updatesAreManagedByWindows;/,
);

assert.match(
  main,
  /const updatesAreManagedByWindows = process\.windowsStore === true;/,
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

assert.match(backgroundCheck, /startBackgroundDownload\(/);

// startBackgroundDownload offers the release to `updates`, which calls startDownload once
// the slot is free (check-update-supersede.mjs), and that is downloadRelease's real check.
assert.match(bodyOf("startBackgroundDownload"), /updates\.offer\(release, options\)/);

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

// A check started anywhere else still hands its download over, so it can be replaced too.
assert.equal(main.match(/\.checkForUpdates\(\)/g)?.length, 4);

assert.equal(main.match(/\.checkForUpdates\(\)\s*\.then\(updates\.track\)/g)?.length, 3);

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
  /startBackgroundDownload\(release, \{ bypassRollout: true, installWhenReady \}\)/,
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

assert.match(bodyOf("checkForUpdatesInBackground"), /if \(force\) announceDownloaded/);

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

// The off switch reads from config, so it survives a restart.
assert.match(main, /readBoolConfig\("autoUpdate", true\)/);

assert.match(backgroundCheck, /if \(!autoUpdateEnabled\)/);

console.log("Updater bridge packaging checks passed");
