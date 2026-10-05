import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { cpSync, existsSync, mkdirSync, rmSync } from "fs";
import { basename, resolve } from "path";
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
      // Emptied first. The filter decides what gets copied in and has no say
      // over what is already there, so without this a checkout that built once
      // before keeps serving — and shipping — the builds this now skips.
      rmSync(to, { recursive: true, force: true });
      mkdirSync(to, { recursive: true });
      cpSync(from, to, { recursive: true, filter: keepMediapipeBuild });
    },
  };
}

/**
 * Which of the three WASM builds in that directory anything can actually ask
 * for. All three are about 11 MB, so the two dead ones are most of the 34.
 *
 * FilesetResolver composes the filename rather than listing it:
 * `forVisionTasks(basePath, useModule = false)` asks for
 * `vision_wasm${useModule ? "_module" : ""}${simd ? "" : "_nosimd"}_internal`.
 * faceFraming.ts calls it with one argument, so useModule is false and the
 * `_module_` build is unreachable — no code path in this app can name it.
 *
 * `_nosimd_` is the fallback for an engine without WASM SIMD. Electron has had
 * it for far longer than the version this ships with, so the desktop build
 * drops that one too. The browser build keeps it: a browser old enough to need
 * it is the one place this can still be reached.
 */
function keepMediapipeBuild(source: string): boolean {
  const name = basename(source);
  if (name.includes("_module_")) return false;
  return !(isElectron && name.includes("_nosimd_"));
}

const isElectron = !!process.env.ELECTRON;

// No network, no inline script, nothing but its own file and the blob: URLs it makes.
const MEDIA_SANDBOX_HTML = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; media-src blob:; img-src blob:"><script src="mediaSandboxPage.js"></script>`;

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
            {
              entry: "electron/mediaSandboxPreload.ts",
              vite: {
                build: {
                  outDir: "dist-electron",
                  emptyOutDir: false,
                  lib: {
                    entry: "electron/mediaSandboxPreload.ts",
                    formats: ["cjs"],
                    // The same doubled formats as preload.ts above; only the .cjs is loaded.
                    fileName: (format) => (format === "cjs" ? "mediaSandboxPreload.cjs" : "mediaSandboxPreload.mjs"),
                  },
                  rollupOptions: { external: ["electron"] },
                },
              },
            },
            {
              // The sandbox page: plain browser code, with mediabunny bundled in and nothing loaded at run time.
              entry: "electron/mediaSandboxPage.ts",
              vite: {
                build: {
                  outDir: "dist-electron",
                  emptyOutDir: false,
                  lib: {
                    entry: "electron/mediaSandboxPage.ts",
                    formats: ["iife"],
                    name: "grytMediaSandbox",
                    fileName: (format) => (format === "iife" ? "mediaSandboxPage.js" : "mediaSandboxPage.mjs"),
                  },
                  rollupOptions: {
                    plugins: [
                      {
                        name: "gryt-media-sandbox-html",
                        generateBundle() {
                          this.emitFile({ type: "asset", fileName: "mediaSandbox.html", source: MEDIA_SANDBOX_HTML });
                        },
                      },
                    ],
                  },
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
