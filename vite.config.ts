import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import electron from "vite-plugin-electron";
import renderer from "vite-plugin-electron-renderer";
import tsconfigPaths from "vite-tsconfig-paths";

import pkg from "./package.json";

const isElectron = !!process.env.ELECTRON;

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tsconfigPaths(),
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
              entry: "electron/splash-preload.ts",
              vite: {
                build: {
                  outDir: "dist-electron",
                  lib: {
                    entry: "electron/splash-preload.ts",
                    formats: ["cjs"],
                    // Same race as preload above — keep the formats apart.
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
