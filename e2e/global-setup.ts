import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { ensureImage, freePort, removeRunContainersSync } from "./support/server";

const CLIENT_ROOT = fileURLToPath(new URL("..", import.meta.url));

async function waitForApp(url: string, preview: ChildProcess): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (preview.exitCode !== null) throw new Error(`vite preview exited with ${preview.exitCode}`);
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`vite preview never answered at ${url}`);
}

export default async function globalSetup() {
  if (!existsSync(join(CLIENT_ROOT, "dist", "index.html"))) {
    throw new Error("No build in dist/. Run `yarn e2e`, which builds first, or `yarn vite build`.");
  }

  const runId = randomBytes(6).toString("hex");
  process.env.GRYT_E2E_RUN_ID = runId;

  const port = Number(process.env.GRYT_E2E_APP_PORT) || (await freePort());
  const appUrl = `http://127.0.0.1:${port}`;
  process.env.GRYT_E2E_APP_URL = appUrl;

  const vite = join(CLIENT_ROOT, "node_modules", ".bin", "vite");
  const preview = spawn(vite, ["preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: CLIENT_ROOT,
    stdio: ["ignore", "ignore", "inherit"],
  });

  const cleanup = () => {
    if (preview.exitCode === null) preview.kill("SIGTERM");
    removeRunContainersSync(runId);
  };
  process.once("exit", cleanup);

  try {
    await Promise.all([
      waitForApp(appUrl, preview),
      process.env.GRYT_E2E_SERVER ? Promise.resolve() : ensureImage(),
    ]);
  } catch (err) {
    cleanup();
    throw err;
  }

  return async () => {
    cleanup();
    process.removeListener("exit", cleanup);
  };
}
