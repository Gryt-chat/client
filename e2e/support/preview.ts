import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const CLIENT_ROOT = fileURLToPath(new URL("../..", import.meta.url));

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

export interface Preview {
  url: string;
  /** Resolves once the app answers. */
  ready: Promise<void>;
  stop(): void;
}

/** Serves the last `vite build` from dist/ on 127.0.0.1. */
export function startPreview(port: number): Preview {
  if (!existsSync(join(CLIENT_ROOT, "dist", "index.html"))) {
    throw new Error("No build in dist/. Run `yarn e2e`, which builds first, or `yarn vite build`.");
  }

  const url = `http://127.0.0.1:${port}`;
  const vite = join(CLIENT_ROOT, "node_modules", ".bin", "vite");
  const preview = spawn(vite, ["preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: CLIENT_ROOT,
    stdio: ["ignore", "ignore", "inherit"],
  });

  return {
    url,
    ready: waitForApp(url, preview),
    stop: () => {
      if (preview.exitCode === null) preview.kill("SIGTERM");
    },
  };
}
