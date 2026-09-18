import { defineConfig, devices } from "@playwright/test";

const CI = !!process.env.CI;

export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results",
  globalSetup: "./global-setup.ts",
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  // Each worker starts its own server, and a server someone started by hand has one owner to give.
  workers: process.env.GRYT_E2E_SERVER ? 1 : CI ? 2 : 3,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: CI
    ? [["list"], ["github"], ["html", { outputFolder: "playwright-report", open: "never" }]]
    : [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    ...devices["Desktop Chrome"],
    // A public-looking address for the test servers, for the links that refuse loopback and LAN ones.
    launchOptions: { args: ["--host-resolver-rules=MAP e2e.gryt.chat 127.0.0.1"] },
    baseURL: process.env.GRYT_E2E_APP_URL,
    viewport: { width: 1280, height: 800 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium" }],
});
