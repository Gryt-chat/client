/* eslint-env node */

import { existsSync, rmSync } from "fs";
import { dirname, join } from "path";
import { create } from "tar";
import { fileURLToPath } from "url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const clientDir = join(scriptDir, "..");
const sourceDir = join(clientDir, "build", "embedded-server");
const archivePath = join(clientDir, "build", "embedded-server.tar.gz");

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

// One signed resource instead of ~14,000 loose files. Besides making the app
// smaller on disk, this lets old Squirrel.Mac clients finish staging before
// their legacy four-second forced-quit timer fires. Fixed timestamps and entry
// order keep blockmap deltas stable when the embedded components did not move.
await create(
  {
    cwd: sourceDir,
    file: archivePath,
    gzip: { level: 9 },
    mtime: new Date(0),
    portable: true,
  },
  ["server", "worker", sfuDir, "versions.json"],
);

console.log(`Embedded server archive ready: ${archivePath}`);
