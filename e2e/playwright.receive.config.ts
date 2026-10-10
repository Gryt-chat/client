import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./receive-tests",
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  outputDir: "./receive-results",
  use: { headless: true, baseURL: "http://127.0.0.1:4778", viewport: { width: 1000, height: 800 }, screenshot: "only-on-failure" },
  webServer: { cwd: process.cwd(), command: "node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4778 --strictPort", url: "http://127.0.0.1:4778", reuseExistingServer: false },
});
