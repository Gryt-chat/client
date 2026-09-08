/* eslint-env node */
/**
 * Builds the embedded server resources, SFU for this platform only.
 * Usage: node scripts/build-embedded-server.mjs [--skip-sfu|--skip-server|--skip-worker]
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
import { dirname, join, resolve, sep } from "path";
import { fileURLToPath } from "url";

import { describeVersion } from "./lib/describeVersion.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = join(__dirname, "..");

/** A worktree's `.git` is a file whose gitdir points back through the
    superproject, so everything before `/.git/` is its root. */
function superprojectRoot() {
  try {
    const pointer = readFileSync(join(CLIENT_DIR, ".git"), "utf8").trim();
    const named = /^gitdir:\s*(.+)$/.exec(pointer);
    if (!named) return null;

    /* A submodule in a normal clone writes this relative and a worktree writes it
       absolute, so both are resolved against the checkout first. */
    const gitDir = resolve(CLIENT_DIR, named[1]);

    const marker = `${sep}.git${sep}`;
    const index = gitDir.indexOf(marker);
    return index === -1 ? null : gitDir.slice(0, index);
  } catch {
    // `.git` is a directory, or unreadable. Either way there is nothing to read.
    return null;
  }
}

/**
 * Beside the client in a normal checkout and nowhere near it in a worktree, where
 * this used to fail as `spawnSync /bin/sh ENOENT` and name a shell.
 */
function packageDir(name) {
  const sibling = join(CLIENT_DIR, "..", name);
  if (existsSync(sibling)) return sibling;

  const root = superprojectRoot();
  if (root) {
    const inSuperproject = join(root, "packages", name);
    if (existsSync(inSuperproject)) return inSuperproject;
  }

  return sibling;
}

const SERVER_DIR = packageDir("server");
const SFU_DIR = packageDir("sfu");
const WORKER_DIR = packageDir("image-worker");
const OUTDIR = join(CLIENT_DIR, "build", "embedded-server");


/** Written at the end of every run, so it is the only record of which submodule
    commit each artefact came from. */
function readBuiltVersions() {
  try {
    return JSON.parse(readFileSync(join(OUTDIR, "versions.json"), "utf8"));
  } catch {
    return {};
  }
}

const args = process.argv.slice(2);
let skipSfu = args.includes("--skip-sfu");
let skipServer = args.includes("--skip-server");
let skipWorker = args.includes("--skip-worker");
// electron:dev wants this present but must not stall on it, so a build is skipped
// when the output is there and never blocks a session that cannot produce it.
const ifMissing = args.includes("--if-missing");

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

function run(command, options = {}) {
  /* A missing cwd makes execSync report `spawnSync /bin/sh ENOENT`, which reads
     as a missing shell and sends people to their PATH. */
  if (options.cwd && !existsSync(options.cwd)) {
    throw new Error(
      `Cannot run \`${command}\`: ${options.cwd} does not exist.\n` +
        `Expected it beside the client, or under packages/ in the superproject.`,
    );
  }

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

if (ifMissing) {
  // Same paths embeddedServerManager.ts probes in dev.
  const haveServer = existsSync(join(OUTDIR, "server", "bundle.js"));
  const haveSfu = existsSync(
    join(OUTDIR, "sfu", `${ebOs}-${ebArch}`, `gryt_sfu${sfuExt}`)
  );
  const haveWorker = existsSync(join(OUTDIR, "worker", "dist", "index.js"));

  /**
   * Present is not current: skipping on existence alone built the output once and
   * never again, however far the submodules moved. Only what moved is rebuilt,
   * because the Go build is the slow part.
   */
  const built = readBuiltVersions();
  const stale = (have, builtVersion, dir) =>
    !have || (existsSync(dir) && builtVersion !== describeVersion(dir));

  const serverStale = stale(haveServer, built.server, SERVER_DIR);
  const sfuStale = stale(haveSfu, built.sfu, SFU_DIR);
  const workerStale = stale(haveWorker, built.worker, WORKER_DIR);

  if (!serverStale && !sfuStale && !workerStale) {
    console.log("Embedded server is up to date — skipping.");
    process.exit(0);
  }

  for (const [name, isStale, have, dir, builtVersion] of [
    ["server", serverStale, haveServer, SERVER_DIR, built.server],
    ["sfu", sfuStale, haveSfu, SFU_DIR, built.sfu],
    ["worker", workerStale, haveWorker, WORKER_DIR, built.worker],
  ]) {
    if (!isStale) continue;
    // Missing and out of date are different problems: "1.2.1 → 1.2.1" for a
    // deleted file reads as a bug in the check.
    console.log(
      !have
        ? `Embedded ${name} is missing — building.`
        : `Embedded ${name} is out of date (${builtVersion} → ${describeVersion(dir)}) — rebuilding.`
    );
  }

  // Anything already current is left alone.
  skipServer = skipServer || !serverStale;
  skipSfu = skipSfu || !sfuStale;
  skipWorker = skipWorker || !workerStale;

  // Plenty of people work on the UI without Go or a native toolchain, and the app
  // already copes with the embedded server being unavailable.
  process.on("uncaughtException", (err) => {
    console.warn();
    console.warn("Could not build the embedded server — continuing without it.");
    console.warn("Hosting a server from this dev client will be unavailable.");
    console.warn(`Reason: ${err?.message ?? err}`);
    console.warn("Build it later with: yarn build:embedded-server");
    process.exit(0);
  });
}

console.log("=== Building Embedded Server Resources ===");
console.log(`  Platform: ${ebOs}-${ebArch} (${goOs}/${goArch})`);
console.log(`  Client: ${CLIENT_DIR}`);
console.log(`  Server: ${SERVER_DIR}`);
console.log(`  SFU: ${SFU_DIR}`);
console.log(`  Worker: ${WORKER_DIR}`);
console.log(`  Output: ${OUTDIR}`);
console.log();

// ── 1. Server bundle ────────────────────────────────────────────────
if (skipServer) {
  console.log("[1/3] Skipping server bundle (--skip-server)");
} else {
  console.log("[1/3] Bundling server...");

  const bundleSrc = join(SERVER_DIR, "dist", "bundle.js");
  const serverOut = join(OUTDIR, "server");

  console.log("  Building fresh server bundle...");
  run("yarn build && yarn bundle", {
    cwd: SERVER_DIR,
  });

  assertExists(bundleSrc, `Server bundle was not created: ${bundleSrc}`);

  console.log("  Cleaning embedded server output...");
  rmSync(serverOut, { recursive: true, force: true });
  mkdirSync(serverOut, { recursive: true });

  cpSync(bundleSrc, join(serverOut, "bundle.js"));

  // The server's real manifest and lockfile, so the tree that ships is the one
  // yarn.lock pins. Trimmed after the install, which --frozen-lockfile compares.
  const lockfileSrc = join(SERVER_DIR, "yarn.lock");
  assertExists(
    lockfileSrc,
    `Cannot pin embedded server dependencies: no yarn.lock at ${lockfileSrc}`
  );
  cpSync(lockfileSrc, join(serverOut, "yarn.lock"));
  cpSync(join(SERVER_DIR, "package.json"), join(serverOut, "package.json"));

  // No Electron ABI settings: node:sqlite leaves no addon to rebuild and sharp is
  // N-API. --frozen-lockfile fails rather than re-resolving on a drift.
  console.log("  Installing production dependencies for embedded server...");
  run("yarn install --production --frozen-lockfile", { cwd: serverOut });

  // Now the runtime manifest, over the one the install needed.
  const serverPkg = JSON.parse(
    readFileSync(join(SERVER_DIR, "package.json"), "utf8")
  );
  delete serverPkg.devDependencies;
  delete serverPkg.scripts;
  serverPkg.name = "gryt-embedded-server";
  serverPkg.private = true;
  serverPkg.main = "bundle.js";
  writeFileSync(
    join(serverOut, "package.json"),
    JSON.stringify(serverPkg, null, 2) + "\n"
  );

  const nodeModulesPath = join(serverOut, "node_modules");

  assertExists(
    nodeModulesPath,
    `Embedded server node_modules was not created: ${nodeModulesPath}`
  );

  assertExists(
    join(nodeModulesPath, "sharp"),
    `Embedded server dependency missing after yarn install: sharp`
  );

  console.log("  Embedded server dependencies installed.");
  console.log(`  Server bundle ready: ${serverOut}`);
}

// ── 2. SFU binary (current platform only) ───────────────────────────
if (skipSfu) {
  console.log("[2/3] Skipping SFU build (--skip-sfu)");
} else {
  console.log("[2/3] Compiling SFU...");

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

    // Without this the SFU keeps its `var Version = "dev"` default and reports
    // itself as "vdev", which nobody can compare against a release.
    const sfuVersion = describeVersion(SFU_DIR);
    run(
      `go build -C "${SFU_DIR}" -ldflags "-X main.Version=${sfuVersion}" -o "${sfuOutPath}" ./cmd/sfu/`,
      { env },
    );

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

// ── 3. Image worker ─────────────────────────────────────────────────
// Without it a hosted server queues image jobs nothing reads. A separate process
// on purpose: it hands stranger-uploaded bytes to libvips.
if (skipWorker) {
  console.log("[3/3] Skipping image worker (--skip-worker)");
} else {
  console.log("[3/3] Bundling image worker...");

  if (!existsSync(WORKER_DIR)) {
    // Loud, or a release ships a client whose hosted servers queue image jobs
    // nothing reads. --if-missing downgrades this to a warning.
    throw new Error(
      `Image worker not found at ${WORKER_DIR}. ` +
        `The submodule is probably not checked out — a release must not ship ` +
        `a client without it. Run: git submodule update --init packages/image-worker`
    );
  } else {
    const workerOut = join(OUTDIR, "worker");

    console.log("  Building worker...");
    run("npm run build", { cwd: WORKER_DIR });

    const workerDistSrc = join(WORKER_DIR, "dist");
    assertExists(workerDistSrc, `Worker build output missing: ${workerDistSrc}`);

    console.log("  Cleaning worker output...");
    rmSync(workerOut, { recursive: true, force: true });
    mkdirSync(workerOut, { recursive: true });

    cpSync(workerDistSrc, join(workerOut, "dist"), { recursive: true });

    const workerPkg = JSON.parse(
      readFileSync(join(WORKER_DIR, "package.json"), "utf8")
    );

    // No Electron ABI settings, as above: no addon to rebuild and sharp is N-API.
    // Same pinning, which this one never had at all.
    const workerLockfile = join(WORKER_DIR, "yarn.lock");
    assertExists(
      workerLockfile,
      `Cannot pin image worker dependencies: no yarn.lock at ${workerLockfile}`
    );
    cpSync(workerLockfile, join(workerOut, "yarn.lock"));
    cpSync(join(WORKER_DIR, "package.json"), join(workerOut, "package.json"));

    console.log("  Installing worker dependencies...");
    run("yarn install --production --frozen-lockfile", { cwd: workerOut });

    delete workerPkg.devDependencies;
    delete workerPkg.scripts;
    workerPkg.name = "gryt-embedded-image-worker";
    workerPkg.private = true;
    workerPkg.main = "dist/index.js";
    // The checked-in value is decorative, since the worker releases by tag and
    // never bumps the file. The copy that ships should say what was built.
    workerPkg.version = describeVersion(WORKER_DIR);

    writeFileSync(
      join(workerOut, "package.json"),
      JSON.stringify(workerPkg, null, 2) + "\n"
    );

    assertExists(
      join(workerOut, "dist", "index.js"),
      `Worker entry point missing: ${join(workerOut, "dist", "index.js")}`
    );
    assertExists(
      join(workerOut, "node_modules", "sharp"),
      `Worker dependency missing after yarn install: sharp`
    );

    console.log(`  Image worker ready: ${workerOut}`);
  }
}

/**
 * The embedded server fell back to "1.0.0" and looked permanently out of date.
 * Only what was built moves: a skipped component keeps its old version, or the
 * next run believes the old binary is current and skips it forever.
 */
const previous = readBuiltVersions();
const versionFor = (skipped, dir, prior) => {
  if (skipped) return prior ?? "unknown";
  return existsSync(dir) ? describeVersion(dir) : "unknown";
};

writeFileSync(
  join(OUTDIR, "versions.json"),
  JSON.stringify(
    {
      server: versionFor(skipServer, SERVER_DIR, previous.server),
      sfu: versionFor(skipSfu, SFU_DIR, previous.sfu),
      worker: versionFor(skipWorker, WORKER_DIR, previous.worker),
      builtAt: new Date().toISOString(),
    },
    null,
    2,
  ) + "\n",
);

console.log();
console.log("=== Embedded server resources ready ===");
console.log(`  Output: ${OUTDIR}`);
