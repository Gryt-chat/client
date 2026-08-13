/* eslint-env node */
/**
 * Cross-platform script to build the embedded server resources for dev preview.
 * Only builds the SFU binary for the current platform (not all targets).
 *
 * Usage: node scripts/build-embedded-server.mjs [--skip-sfu] [--skip-server] [--skip-worker]
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
const WORKER_DIR = join(CLIENT_DIR, "..", "image-worker");
const OUTDIR = join(CLIENT_DIR, "build", "embedded-server");

/**
 * What a submodule checkout is, as a version.
 *
 * The tag, not package.json. Every one of these repos releases by tagging and
 * leaves package.json alone — server's says 1.0.76 while it is released as
 * 1.3.0-beta.2, and the worker's says 1.0.6 while it is released as 1.2.0. The
 * SFU has no package.json at all. Reading those files would put three
 * confidently wrong numbers in front of someone deciding whether to update.
 *
 * A checkout that is not exactly on a tag reports the tag it descends from
 * plus the distance, which is what `git describe` gives and is honest about
 * being between releases.
 */
function describeVersion(dir) {
  try {
    const described = execSync("git describe --tags --always --dirty", {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .trim()
      .replace(/^v/, "");
    return described || "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * What the output on disk was built from, if anything.
 *
 * Written by this script at the end of every run, so it is the only record of
 * which submodule commit each artefact actually came from.
 */
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
// Used by electron:dev, which wants the embedded server present but must not
// fail or stall the dev loop over it. Skips the build when the output is
// already there, and never blocks a dev session that cannot produce it.
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
   * Present is not the same as current.
   *
   * This used to skip whenever all three files existed, which meant the output
   * was built once and then never again however far the submodules moved. A
   * bundle four days and ten commits behind `server:main` survived that way: it
   * still carried an identity CA that had been deleted, and knew nothing of
   * GRYT_IDENTITY_TIERS, which the client writes into every config it creates.
   * The app looked broken in exactly the area somebody was working on, and
   * nothing said why — the hint to rebuild is printed in the branch that skips,
   * where it scrolls past in dev-server output.
   *
   * So compare what is on disk against what the submodules are now. Only the
   * ones that moved are rebuilt, because the Go build is the slow part and
   * rebuilding all three to pick up a server change is most of the reason
   * skipping looked attractive in the first place.
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
    // Missing and out of date are different problems and the version pair only
    // means anything for the second — printing "1.2.1 → 1.2.1" for a deleted
    // file reads as a bug in the check rather than a missing artefact.
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

  // Building needs Go and a working native toolchain. Plenty of people work on
  // the UI without either, and hosting is optional, so a failure here must not
  // take the dev server down with it — the app already copes with the embedded
  // server being unavailable.
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

  // Install from the server's real manifest and its real lockfile, so the tree
  // that ships is the tree yarn.lock pins.
  //
  // This used to copy a package-lock.json that has never existed — the server is
  // a yarn project — log a warning, and run `npm install` anyway. Every release
  // therefore resolved its dependencies fresh from the registry: two builds of
  // the same commit could ship different transitive versions, and nothing
  // recorded which ones went out. The warning was printed into a passing build,
  // which is why it survived.
  //
  // The trimmed runtime package.json is written *after* the install, because
  // --frozen-lockfile compares the manifest against the lockfile and a trimmed
  // manifest does not match.
  const lockfileSrc = join(SERVER_DIR, "yarn.lock");
  assertExists(
    lockfileSrc,
    `Cannot pin embedded server dependencies: no yarn.lock at ${lockfileSrc}`
  );
  cpSync(lockfileSrc, join(serverOut, "yarn.lock"));
  cpSync(join(SERVER_DIR, "package.json"), join(serverOut, "package.json"));

  // No Electron ABI settings. The server moved from better-sqlite3 to
  // node:sqlite, which is part of the runtime, so there is no node-gyp addon
  // left to rebuild. sharp stays, but it is N-API and resolves its binary
  // through per-platform optional dependencies that npm picks by os/cpu — the
  // Electron settings never applied to it.
  // --frozen-lockfile is the whole point: it fails rather than re-resolving if
  // the manifest and the lockfile have drifted apart.
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

    // Stamp the binary. Without this, cmd/sfu/main.go keeps its `var Version =
    // "dev"` default and every embedded SFU reports itself as "vdev" in server
    // settings — which is not a version anyone can compare against a release.
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
// Bundled so a server hosted from the desktop app processes its image jobs.
// Without it the server queues work nothing ever reads: no thumbnails, no
// dominant colours, and — because the upload route skips the size limit for
// images on the assumption something will shrink them later — uploads sitting
// at full size on the host's disk forever.
//
// A separate process on purpose, as in a deployment. It hands stranger-uploaded
// bytes to libvips, and the point of the worker existing at all is that a
// corrupt image cannot take down the process holding the signing keys and every
// socket. Bundling it must not quietly undo that.
if (skipWorker) {
  console.log("[3/3] Skipping image worker (--skip-worker)");
} else {
  console.log("[3/3] Bundling image worker...");

  if (!existsSync(WORKER_DIR)) {
    // Loud, because the alternative is a release that quietly ships a client
    // whose hosted servers queue image jobs nothing will ever read — with no
    // error anywhere to say so. --if-missing is the dev path and downgrades
    // this to a warning through its uncaughtException handler.
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

    // No Electron ABI settings here, unlike the server bundle below the fold.
    // The worker has no node-gyp addon left to rebuild: it moved from
    // better-sqlite3 to node:sqlite, which is part of the runtime, and sharp is
    // N-API so its prebuilt binary loads under Electron unchanged. sharp also
    // resolves its binary through per-platform optional dependencies, which npm
    // picks by os/cpu — npm_config_runtime never applied to it.
    // Same pinning as the server above: install from the worker's own manifest
    // and lockfile, then write the trimmed runtime one over the top. This one
    // never even tried to copy a lockfile, so it has been resolving fresh from
    // the registry on every release since it was written.
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
    // The worker reads this as its fallback version, and the checked-in value
    // is decorative — the worker releases by tag and never bumps the file. The
    // copy that ships should say what was actually built.
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
 * What actually went into this bundle.
 *
 * The embedded server had no way to know its own version, so it fell back to
 * the hardcoded "1.0.0" in its config and every desktop-hosted server reported
 * that — next to a real latest-release number, which made it look permanently
 * out of date. The manager reads this file and tells each process what it is.
 *
 * Written from the sources actually built rather than from the client's own
 * version, because these three move independently of it and of each other.
 */
/**
 * Only what was actually built moves. A component that was skipped keeps the
 * version it was last built from, or the next run would read this file, believe
 * the old binary came from the current checkout, and skip it forever — which is
 * the bug this file exists to prevent.
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
