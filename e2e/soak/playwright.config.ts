import { defineConfig } from "@playwright/test";

// One long test that sets its own timeout. The nightly's global setup serves the build on GRYT_E2E_APP_PORT, or 4173.
export default defineConfig({
  testDir: ".",
  testMatch: "soak.spec.ts",
  outputDir: "./test-results",
  globalSetup: "../nightly/global-setup.ts",
  workers: 1,
  retries: 0,
  // The call helpers are the nightly's, written for its 30-second expect timeout.
  expect: { timeout: 30_000 },
  // A click that can't happen has to fail rather than wait for hours. The evidence is the JSONL, not pictures.
  use: { actionTimeout: 30_000, navigationTimeout: 60_000, screenshot: "off", video: "off", trace: "off" },
  reporter: [["list"]],
});
