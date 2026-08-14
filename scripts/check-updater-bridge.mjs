/* eslint-env node */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const installer = readFileSync(new URL("../build/installer.nsh", import.meta.url), "utf8");
const builder = readFileSync(new URL("../electron-builder.yml", import.meta.url), "utf8");

assert.match(installer, /tasklist \/FI "IMAGENAME eq \$\{_FILE\}" \/FO CSV \/NH/);
assert.match(installer, /findstr\.exe" \/B \/I/);
assert.doesNotMatch(installer, /!insertmacro _CHECK_APP_RUNNING/);
assert.match(builder, /from: build\/embedded-server\.tar\.gz/);
assert.match(builder, /from: build\/embedded-native\//);
assert.doesNotMatch(builder, /from: build\/embedded-server\/server\//);
assert.match(builder, /electronLanguages:\n\s+- en\n\s+- nb/);

console.log("Updater bridge packaging checks passed");
