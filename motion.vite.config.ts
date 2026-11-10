// Serves motion.html for render-motion.mjs with live reload off, so editing the film never reloads a render mid-run.
import { createReadStream, existsSync } from "node:fs";
import { extname, join } from "node:path";

import { defineConfig, mergeConfig } from "vite";

import base from "./vite.config";

const TYPES: Record<string, string> = { ".avif": "image/avif", ".webp": "image/webp", ".mp4": "video/mp4", ".jpg": "image/jpeg", ".svg": "image/svg+xml" };

// The film's members point at /api/uploads/files/<name>; these answer from local copies.
const uploads = {
  name: "motion-uploads",
  configureServer(server: { middlewares: { use: (fn: (req: { url?: string }, res: { setHeader: (k: string, v: string) => void; statusCode: number; end: () => void }, next: () => void) => void) => void } }) {
    server.middlewares.use((req, res, next) => {
      const m = req.url?.match(/^\/api\/uploads\/files\/([\w.-]+)/);
      // Then the client's own public files, for Gryt's logo as his avatar.
      const file = m && [join(__dirname, "public/motion-assets/people", m[1]), join(__dirname, "public", m[1])].find((f) => existsSync(f));
      if (!file) return next();
      res.setHeader("Content-Type", TYPES[extname(file)] ?? "application/octet-stream");
      createReadStream(file).pipe(res as never);
    });
  },
};

export default defineConfig(async (env) =>
  mergeConfig(typeof base === "function" ? await base(env) : base, { plugins: [uploads], server: { port: 3778, strictPort: true, hmr: false, watch: null } }),
);
