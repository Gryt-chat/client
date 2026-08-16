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

assert.match(builder, /electronLanguages:\n\s+- en\n\s+- nb/);

console.log("Updater bridge packaging checks passed");
