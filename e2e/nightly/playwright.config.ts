import { defineConfig, devices } from "@playwright/test";

const CI = !!process.env.CI;

export default defineConfig({
  testDir: ".",
  outputDir: "./test-results",
  globalSetup: "./global-setup.ts",
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  // The tests share one server and its one voice channel.
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  reporter: CI
    ? [["list"], ["github"], ["html", { outputFolder: "playwright-report", open: "never" }]]
    : [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: process.env.GRYT_E2E_APP_URL,
    viewport: { width: 1280, height: 800 },
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "call",
      testMatch: ["voice.spec.ts", "screen-share.spec.ts"],
      use: {
        permissions: ["microphone", "camera"],
        // Chrome's own test pattern and beep for the camera, the microphone and the screen, with no prompts.
        launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
      },
    },
    { name: "electron", testMatch: "electron.spec.ts" },
  ],
});
