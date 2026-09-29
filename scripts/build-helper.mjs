/* eslint-env node */

/**
 * Builds helper/ (GRYT-1605) with Go.
 * Usage: node scripts/build-helper.mjs [--platform darwin|linux|win32] [--arch x64|arm64] [--out dir]
 */

import { execFileSync } from "child_process";
import { mkdirSync, readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const CLIENT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const GOOS = { darwin: "darwin", linux: "linux", win32: "windows" };
const GOARCH = { x64: "amd64", arm64: "arm64" };
/** Go fetches this toolchain if the one on PATH differs. The release sets up 1.22, whose Mac binaries lack LC_UUID. */
export const GO_TOOLCHAIN = "go1.26.5";

export function helperFileName(platform = process.platform) {
  return platform === "win32" ? "gryt-helper.exe" : "gryt-helper";
}

export function buildHelper({ platform = process.platform, arch = process.arch, out = join(CLIENT_DIR, "helper", "dist") } = {}) {
  if (!GOOS[platform] || !GOARCH[arch]) throw new Error(`no helper build for ${platform}-${arch}`);
  const version = JSON.parse(readFileSync(join(CLIENT_DIR, "package.json"), "utf8")).version;
  mkdirSync(out, { recursive: true });
  const file = join(resolve(out), helperFileName(platform));
  // Without windowsgui, starting it from the Run key opens a console window at login.
  const gui = platform === "win32" ? " -H windowsgui" : "";
  execFileSync(
    "go",
    ["build", "-trimpath", "-ldflags", `-s -w -X main.version=${version}${gui}`, "-o", file, "."],
    {
      cwd: join(CLIENT_DIR, "helper"),
      stdio: "inherit",
      env: { ...process.env, GOTOOLCHAIN: GO_TOOLCHAIN, GOOS: GOOS[platform], GOARCH: GOARCH[arch], CGO_ENABLED: "0" },
    },
  );
  return file;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (name) => {
    const at = process.argv.indexOf(`--${name}`);
    return at === -1 ? undefined : process.argv[at + 1];
  };
  console.log(buildHelper({ platform: arg("platform"), arch: arg("arch"), out: arg("out") }));
}
