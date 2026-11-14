import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests: real browsers against the real app (Worker + Durable Objects +
 * local D1) running under `vite dev`. Calls use Chromium's fake mic/camera.
 *
 *   npm run test:e2e
 */
export default defineConfig({
  testDir: "./tests",
  timeout: 120_000,
  expect: { timeout: 10_000 },
  // Tests make calls between two browsers and share one local database: run them one at a time.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    actionTimeout: 15_000,
    screenshot: "only-on-failure",
    permissions: ["microphone", "camera"],
    launchOptions: {
      args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        "--autoplay-policy=no-user-gesture-required",
        "--auto-select-desktop-capture-source=Entire screen",
      ],
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], permissions: ["microphone", "camera"] } }],
  webServer: [
    {
      command: "npm run db:migrate:local && npx vite --port 5173 --strictPort",
      url: "http://localhost:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    // The production build, for what only exists there: the offline app shell and auto-update.
    {
      command: "npx vite build && npx vite preview --port 4173 --strictPort",
      url: "http://localhost:4173",
      reuseExistingServer: !process.env.CI,
      timeout: 240_000,
    },
  ],
});
