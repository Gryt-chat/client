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
                    fileName: () => "[name].cjs",
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
                    fileName: () => "[name].cjs",
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
    port: 3666,
    allowedHosts: ["app.gryt.chat"],
  },
});
