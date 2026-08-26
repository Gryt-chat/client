import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { cpSync, existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import { defineConfig } from "vite";
import electron from "vite-plugin-electron";
import renderer from "vite-plugin-electron-renderer";
import tsconfigPaths from "vite-tsconfig-paths";

import pkg from "./package.json";

/**
 * Copies MediaPipe's WASM into public/ so it is served from our own origin.
 *
 * It cannot come from Google's CDN at runtime: the desktop app runs under a CSP
 * that blocks it, and a voice client should not need a third party reachable to
 * frame a camera.
 *
 * This lives here rather than in a script under scripts/ because that directory
 * is excluded from the Docker build context, and it ran as a postinstall hook
 * before that — which the Dockerfile breaks by installing dependencies before it
 * copies any source. Every build goes through Vite, so this is the one place
 * that is always present and always runs.
 *
 * Copied rather than committed because it is about 34 MB of binary that moves
 * with the dependency. public/mediapipe is gitignored for the same reason
 * build/ is.
 */
function copyMediapipeWasm() {
  return {
    name: "gryt-copy-mediapipe-wasm",
    buildStart() {
      const from = resolve(
        __dirname,
        "node_modules/@mediapipe/tasks-vision/wasm",
      );
      if (!existsSync(from)) return;

      const to = resolve(__dirname, "public/mediapipe");
      mkdirSync(to, { recursive: true });
      cpSync(from, to, { recursive: true });
    },
  };
}

const isElectron = !!process.env.ELECTRON;

// https://vitejs.dev/config/
export default defineConfig({
  optimizeDeps: {
    // @gryt/voice constructs its RNNoise worker with
    // new URL("./rnnoiseWorker.js", import.meta.url).
    //
    // Pre-bundling rewrites the package into node_modules/.vite/deps, and that
    // URL then resolves relative to the bundle rather than to the package —
    // where no worker file exists. The failure is quiet: "Failed to initialize
    // RNNoise processor", and voice keeps working without noise suppression.
    //
    // Excluding it means Vite serves the package's own files, so import.meta.url
    // points at dist/audio/processors/ where the worker actually is.
    exclude: ["@gryt/voice"],
  },
  plugins: [
    react(),
    tailwindcss(),
    tsconfigPaths(),
    copyMediapipeWasm(),
    ...(isElectron
      ? [
          electron([
            {
              entry: "electron/main.ts",
              vite: {
                build: {
                  outDir: "dist-electron",
                  rollupOptions: { external: ["electron", "uiohook-napi"] },
                },
              },
            },
            {
              entry: "electron/preload.ts",
              onstart({ reload }) {
                reload();
              },
              vite: {
                build: {
                  outDir: "dist-electron",
                  lib: {
                    entry: "electron/preload.ts",
                    formats: ["cjs"],
                    // vite-plugin-electron defaults formats to ["es"] because
                    // package.json is "type": "module", and mergeConfig
                    // concatenates arrays rather than replacing them — so this
                    // really builds ["es", "cjs"]. Both used to land on the
                    // same [name].cjs and raced; whichever wrote last won.
                    // Electron parses a .cjs preload as CommonJS, so when the
                    // ESM one won it was a SyntaxError, the preload died
                    // before contextBridge ran, and the renderer silently
                    // looked like a browser. Give each format its own name.
                    fileName: (format) =>
                      format === "cjs" ? "[name].cjs" : "[name].mjs",
                  },
                  rollupOptions: { external: ["electron"] },
                },
              },
            },
          ]),
          renderer(),
        ]
      : []),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    // Not a preference — Keycloak registers redirect URIs per port, and only
    // http://localhost:3666/* is whitelisted. On any other port sign-in fails
    // with an invalid redirect_uri, which reads like broken auth rather than a
    // wrong port. Changing this means updating the Keycloak client first.
    port: 3666,
    allowedHosts: ["app.gryt.chat"],
  },
});
