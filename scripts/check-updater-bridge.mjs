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
// The PowerShell helper is authored one line per array entry and joined.
// Several of those lines continue an expression onto the next: the two
// Where-Object filters, and Start-Process with its backtick continuations.
// Joining with "; " put a semicolon inside those expressions and left the
// backticks escaping it. PowerShell parses the whole -Command string before
// it runs any of it, so the helper never started, the installer never ran,
// and Windows sat on the version it had while re-downloading the new one.
const main = readFileSync(
  new URL("../electron/main.ts", import.meta.url),
  "utf8",
);

assert.doesNotMatch(main, /\]\.join\("; "\)/);

assert.match(main, /const script = commandLines\.join\("\\n"\);/);

// The helper's paths are literals in the script. Passed after -Command
// instead, PowerShell rebuilds them from the raw command line and splits
// them on spaces — and the installed executable is always "Gryt Chat.exe".
assert.match(main, /const psLiteral = .+replace\(\/'\/g, "''"\)/);

assert.doesNotMatch(main, /\$logPath = \$args\[/);

// Rebuild the helper body the way main.ts does, so a continuation line
// added later is checked rather than assumed safe.
const arrayStart = main.indexOf("const commandLines = [");
const arrayEnd = main.indexOf("\n    ];", arrayStart);

assert.ok(arrayStart !== -1 && arrayEnd > arrayStart);

const helperLines = main
  .slice(arrayStart, arrayEnd)
  .split("\n")
  .map((line) => line.trim().replace(/,$/, ""))
  .filter((line) => line.startsWith('"'))
  .map((line) => JSON.parse(line));

assert.ok(
  helperLines.length > 20,
  `helper body looks truncated: ${helperLines.length} lines`,
);

// A backtick continues a line only when nothing follows it on that line.
for (const line of helperLines) {
  const tick = line.indexOf("`");

  if (tick !== -1) {
    assert.equal(tick, line.length - 1, `backtick must end its line: ${line}`);
  }
}

console.log("Updater bridge packaging checks passed");
