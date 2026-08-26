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

// Windows legacy installer migration.
//
// Old Gryt installations can contain a poisoned NSIS uninstaller that prevents
// electron-builder from upgrading them normally. The replacement installer
// moves that installation aside before electron-builder reaches its ordinary
// uninstall step, removes the two known stale uninstall registrations, and
// marks the machine as migrated after a successful installation.
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

assert.match(builder, /electronLanguages:\r?\n\s+- en\r?\n\s+- nb/);

// The Windows update handoff.
//
// There is no PowerShell helper any more. It was added to own the transition
// from the old install to the new one, and it never ran once: through v1.6.24
// the script could not parse, and after that was fixed the detached spawn
// still produced nothing. gryt-update-helper.log was never written on any
// machine in any version. quitAndInstall does the install on Windows, the way
// it already did everywhere else.
const main = readFileSync(
  new URL("../electron/main.ts", import.meta.url),
  "utf8",
);

assert.doesNotMatch(main, /launchWindowsInstallerAfterExit/);

assert.doesNotMatch(main, /WindowsPowerShell/);

// Install-on-quit is the second route, and the reason the helper's silence
// went unnoticed for nine releases is that there was no second route.
assert.match(main, /autoUpdater\.autoInstallOnAppQuit = true;/);

assert.doesNotMatch(main, /autoInstallOnAppQuit = process\.platform/);

// One quitAndInstall for every platform, no win32 branch around it.
assert.equal(main.match(/autoUpdater\.quitAndInstall\(/g)?.length, 1);

// The background check has to reach a real check, not just say a release
// exists (GRYT-625).
//
// It used to probe releases.atom, send "announced" and stop. `autoDownload`
// only decides what a check the library ran does next, and the library ran no
// check here — so nothing was ever fetched in the background, the toast
// offered a restart into an update that was not on disk, and restart-for-update
// found nothing to install. The splash covered this until GRYT-622 deleted it.
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

assert.match(
  bodyOf("startBackgroundDownload"),
  /autoUpdater\s*\.checkForUpdates\(\)/,
);

// Announcing is the update-available handler's job, because that is the first
// moment the release is known to be coming: the rollout slice has let this
// machine through and the download is starting. Announcing from the probe is
// what made the toast promise something that never arrived.
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
  /startBackgroundDownload\(release, \{ bypassRollout: true \}\)/,
);

// The off switch reads from config, so it survives a restart.
assert.match(main, /readBoolConfig\("autoUpdate", true\)/);

assert.match(backgroundCheck, /if \(!autoUpdateEnabled\)/);

console.log("Updater bridge packaging checks passed");
