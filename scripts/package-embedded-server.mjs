/* eslint-env node */

import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  rmSync,
} from "fs";
import { dirname, join } from "path";
import { create } from "tar";
import { fileURLToPath } from "url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const clientDir = join(scriptDir, "..");
const sourceDir = join(clientDir, "build", "embedded-server");
const archivePath = join(clientDir, "build", "embedded-server.tar.gz");
const nativeDir = join(clientDir, "build", "embedded-native");

const ebOs =
  process.platform === "win32"
    ? "win"
    : process.platform === "darwin"
      ? "mac"
      : "linux";
const ebArch = process.arch === "arm64" ? "arm64" : "x64";
const sfuDir = join("sfu", `${ebOs}-${ebArch}`);

for (const entry of ["versions.json", "server", "worker", sfuDir]) {
  if (!existsSync(join(sourceDir, entry))) {
    throw new Error(`Cannot package embedded server: missing ${join(sourceDir, entry)}`);
  }
}

rmSync(archivePath, { force: true });
rmSync(nativeDir, { recursive: true, force: true });

const nativeEntries = new Set();
const binaryMagics = new Set([
  "7f454c46", // ELF
  "cafebabe", // Mach-O universal
  "cefaedfe", // Mach-O 32-bit, little endian
  "cffaedfe", // Mach-O 64-bit, little endian
  "feedface", // Mach-O 32-bit
  "feedfacf", // Mach-O 64-bit
]);

function isNativeBinary(path) {
  const fd = openSync(path, "r");
  try {
    const header = Buffer.alloc(4);
    if (readSync(fd, header, 0, header.length, 0) !== header.length) return false;
    return header.subarray(0, 2).toString("ascii") === "MZ" ||
      binaryMagics.has(header.toString("hex"));
  } finally {
    closeSync(fd);
  }
}

function stageNativeBinaries(relativeDir = "") {
  const absoluteDir = join(sourceDir, relativeDir);
  for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
    const relative = join(relativeDir, entry.name);
    const absolute = join(sourceDir, relative);
    if (entry.isDirectory()) {
      stageNativeBinaries(relative);
    } else if (entry.isFile() && isNativeBinary(absolute)) {
      const normalized = relative.replaceAll("\\", "/");
      nativeEntries.add(normalized);
      const destination = join(nativeDir, relative);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(absolute, destination);
    }
  }
}

stageNativeBinaries();
if (nativeEntries.size === 0) {
  throw new Error("Cannot package embedded server: no native runtime binaries found");
}

// One signed resource instead of ~14,000 loose files. Besides making the app
// smaller on disk, this lets old Squirrel.Mac clients finish staging before
// their legacy four-second forced-quit timer fires. Fixed timestamps and entry
// order keep blockmap deltas stable when the embedded components did not move.
await create(
  {
    cwd: sourceDir,
    file: archivePath,
    gzip: { level: 9 },
    filter: (path) => !nativeEntries.has(path.replaceAll("\\", "/")),
    mtime: new Date(0),
    portable: true,
  },
  ["server", "worker", sfuDir, "versions.json"],
);

console.log(`Embedded server archive ready: ${archivePath}`);
console.log(`Embedded native binaries ready: ${nativeDir} (${nativeEntries.size} files)`);
