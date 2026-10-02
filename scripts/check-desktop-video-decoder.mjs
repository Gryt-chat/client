import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = await mkdtemp(join(tmpdir(), "gryt-decoder-test-"));
try {
  const module = join(scratch, "decoder.cjs");
  await build({ entryPoints: [join(root, "electron/desktopVideoDecoder.ts")], outfile: module,
    bundle: true, platform: "node", format: "cjs", external: ["electron"] });
  const env = { ...process.env, GRYT_DECODER_TEST_MODULE: module, GRYT_DECODER_TEST_PROFILE: scratch,
    GRYT_DECODER_TEST_FIXTURES: join(root, "e2e/fixtures") };
  delete env.ELECTRON_RUN_AS_NODE;
  const executable = process.env.GRYT_TEST_ELECTRON ?? createRequire(import.meta.url)("electron");
  const code = await new Promise((resolve, reject) => {
    const child = spawn(executable, [join(root, "scripts/test-desktop-video-decoder.cjs")], { env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", resolve);
  });
  assert.equal(code, 0, "desktop decoder test failed");
} finally {
  await rm(scratch, { recursive: true, force: true });
}
