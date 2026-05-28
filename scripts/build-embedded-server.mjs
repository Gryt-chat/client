/* eslint-env node */
/**
 * Cross-platform script to build the embedded server resources for dev preview.
 * Only builds the SFU binary for the current platform (not all targets).
 *
 * Usage: node scripts/build-embedded-server.mjs [--skip-sfu] [--skip-server]
 */

import { execSync } from "child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { dirname, join } from "path";
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
const ebOs =
  platform === "win32" ? "win" : platform === "darwin" ? "mac" : "linux";
const ebArch = arch === "arm64" ? "arm64" : "x64";

// Go naming: windows/darwin/linux, amd64/arm64
const goOs =
  platform === "win32" ? "windows" : platform === "darwin" ? "darwin" : "linux";
const goArch = arch === "arm64" ? "arm64" : "amd64";
const sfuExt = platform === "win32" ? ".exe" : "";

// Keep this in sync with the Electron version used by the client package.
// If this gets out of sync, native modules can rebuild against the wrong ABI.
const electronVersion = "40.6.0";

function run(command, options = {}) {
  execSync(command, {
    stdio: "inherit",
    ...options,
  });
}

function assertExists(path, message) {
  if (!existsSync(path)) {
    throw new Error(message || `Missing expected path: ${path}`);
  }
}

console.log("=== Building Embedded Server Resources ===");
console.log(`  Platform: ${ebOs}-${ebArch} (${goOs}/${goArch})`);
console.log(`  Client: ${CLIENT_DIR}`);
console.log(`  Server: ${SERVER_DIR}`);
console.log(`  SFU: ${SFU_DIR}`);
console.log(`  Output: ${OUTDIR}`);
console.log();

// ── 1. Server bundle ────────────────────────────────────────────────
if (skipServer) {
  console.log("[1/2] Skipping server bundle (--skip-server)");
} else {
  console.log("[1/2] Bundling server...");

  const bundleSrc = join(SERVER_DIR, "dist", "bundle.js");
  const serverOut = join(OUTDIR, "server");

  console.log("  Building fresh server bundle...");
  run("npm run build && npm run bundle", {
    cwd: SERVER_DIR,
  });

  assertExists(bundleSrc, `Server bundle was not created: ${bundleSrc}`);

  console.log("  Cleaning embedded server output...");
  rmSync(serverOut, { recursive: true, force: true });
  mkdirSync(serverOut, { recursive: true });

  cpSync(bundleSrc, join(serverOut, "bundle.js"));

  // Build a minimal runtime package.json, similar to the self-hosted server package.
  const serverPkg = JSON.parse(
    readFileSync(join(SERVER_DIR, "package.json"), "utf8")
  );

  delete serverPkg.devDependencies;
  serverPkg.name = "gryt-embedded-server";
  serverPkg.private = true;
  serverPkg.main = "bundle.js";

  writeFileSync(
    join(serverOut, "package.json"),
    JSON.stringify(serverPkg, null, 2) + "\n"
  );

  const lockfileSrc = join(SERVER_DIR, "package-lock.json");
  if (existsSync(lockfileSrc)) {
    cpSync(lockfileSrc, join(serverOut, "package-lock.json"));
  } else {
    console.warn(`  Warning: no package-lock.json found at ${lockfileSrc}`);
  }

  console.log("  Installing production dependencies for embedded server...");
  run("npm install --omit=dev --ignore-scripts=false", {
    cwd: serverOut,
    env: {
      ...process.env,
      npm_config_runtime: "electron",
      npm_config_target: electronVersion,
      npm_config_disturl: "https://electronjs.org/headers",
    },
  });

  console.log("  Rebuilding better-sqlite3 for Electron...");
  run("npm rebuild better-sqlite3 --build-from-source", {
    cwd: serverOut,
    env: {
      ...process.env,
      npm_config_runtime: "electron",
      npm_config_target: electronVersion,
      npm_config_disturl: "https://electronjs.org/headers",
      npm_config_build_from_source: "true",
    },
  });

  const nodeModulesPath = join(serverOut, "node_modules");
  const betterSqlitePath = join(nodeModulesPath, "better-sqlite3");
  const betterSqliteBindingDir = join(
    betterSqlitePath,
    "build",
    "Release"
  );

  assertExists(
    nodeModulesPath,
    `Embedded server node_modules was not created: ${nodeModulesPath}`
  );

  assertExists(
    betterSqlitePath,
    `Embedded server dependency missing after npm install: ${betterSqlitePath}`
  );

  assertExists(
    betterSqliteBindingDir,
    `better-sqlite3 native build output is missing: ${betterSqliteBindingDir}`
  );

  console.log("  Embedded server dependencies installed.");
  console.log(`  better-sqlite3: ${betterSqlitePath}`);
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

    const env = {
      ...process.env,
      GOOS: goOs,
      GOARCH: goArch,
      CGO_ENABLED: "0",
    };

    run(`go build -C "${SFU_DIR}" -o "${sfuOutPath}" ./cmd/sfu/`, {
      env,
    });

    if (platform !== "win32") {
      try {
        run(`chmod +x "${sfuOutPath}"`);
      } catch {
        /* best effort */
      }
    }

    assertExists(sfuOutPath, `SFU binary was not created: ${sfuOutPath}`);
    console.log(`  SFU binary ready: ${sfuOutPath}`);
  }
}

console.log();
console.log("=== Embedded server resources ready ===");
console.log(`  Output: ${OUTDIR}`);
