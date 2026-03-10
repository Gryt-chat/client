#!/usr/bin/env node
/**
 * Cross-platform script to build the embedded server resources for dev preview.
 * Only builds the SFU binary for the current platform (not all targets).
 *
 * Usage: node scripts/build-embedded-server.mjs [--skip-sfu] [--skip-server]
 */

import { cpSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = join(__dirname, "..");
const SERVER_DIR = join(CLIENT_DIR, "..", "server");
const SFU_DIR = join(CLIENT_DIR, "..", "sfu");
const OUTDIR = join(CLIENT_DIR, "build", "embedded-server");

const args = process.argv.slice(2);
const skipSfu = args.includes("--skip-sfu");
const skipServer = args.includes("--skip-server");

const platform = process.platform;
const arch = process.arch;

// electron-builder naming: win/mac/linux, x64/arm64
const ebOs = platform === "win32" ? "win" : platform === "darwin" ? "mac" : "linux";
const ebArch = arch === "arm64" ? "arm64" : "x64";
// Go naming: windows/darwin/linux, amd64/arm64
const goOs = platform === "win32" ? "windows" : platform === "darwin" ? "darwin" : "linux";
const goArch = arch === "arm64" ? "arm64" : "amd64";
const sfuExt = platform === "win32" ? ".exe" : "";

console.log("=== Building Embedded Server Resources ===");
console.log(`  Platform: ${ebOs}-${ebArch} (${goOs}/${goArch})`);
console.log();

// ── 1. Server bundle ────────────────────────────────────────────────
if (skipServer) {
  console.log("[1/2] Skipping server bundle (--skip-server)");
} else {
  console.log("[1/2] Bundling server...");

  const bundleSrc = join(SERVER_DIR, "dist", "bundle.js");
  if (!existsSync(bundleSrc)) {
    console.log("  Server bundle not found. Building...");
    execSync("npm run build && npm run bundle", {
      cwd: SERVER_DIR,
      stdio: "inherit",
    });
  }

  const serverOut = join(OUTDIR, "server");
  mkdirSync(serverOut, { recursive: true });

  cpSync(bundleSrc, join(serverOut, "bundle.js"));

  // Copy better-sqlite3 native addon (skip .bin symlinks that break cpSync)
  const sqliteSrc = join(SERVER_DIR, "node_modules", "better-sqlite3");
  if (existsSync(sqliteSrc)) {
    cpSync(sqliteSrc, join(serverOut, "node_modules", "better-sqlite3"), {
      recursive: true,
      filter: (src) => !src.includes(join(".bin")),
    });
  }

  writeFileSync(
    join(serverOut, "package.json"),
    '{ "name": "gryt-embedded-server", "private": true, "main": "bundle.js" }\n',
  );

  console.log(`  Server bundle ready: ${serverOut}`);
}

// ── 2. SFU binary (current platform only) ───────────────────────────
if (skipSfu) {
  console.log("[2/2] Skipping SFU build (--skip-sfu)");
} else {
  console.log("[2/2] Compiling SFU...");

  if (!existsSync(SFU_DIR)) {
    console.log(`  Warning: SFU directory not found at ${SFU_DIR}, skipping`);
  } else {
    const sfuOutDir = join(OUTDIR, "sfu", `${ebOs}-${ebArch}`);
    const sfuOutPath = join(sfuOutDir, `gryt_sfu${sfuExt}`);
    mkdirSync(sfuOutDir, { recursive: true });

    const env = { ...process.env, GOOS: goOs, GOARCH: goArch, CGO_ENABLED: "0" };
    execSync(`go build -C "${SFU_DIR}" -o "${sfuOutPath}" ./cmd/sfu/`, {
      env,
      stdio: "inherit",
    });

    if (platform !== "win32") {
      try {
        execSync(`chmod +x "${sfuOutPath}"`);
      } catch { /* best effort */ }
    }

    console.log(`  SFU binary ready: ${sfuOutPath}`);
  }
}

console.log();
console.log("=== Embedded server resources ready ===");
console.log(`  Output: ${OUTDIR}`);
