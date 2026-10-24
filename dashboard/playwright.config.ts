import { defineConfig, devices } from "@playwright/test";

// Browser tests of the dashboard: the production build, served under the Worker's real
// Content-Security-Policy (vite preview), against the in-memory API (dashboard/mock).
const PORT = 4317;

export default defineConfig({
  testDir: "./e2e",
  // One in-memory mailbox shared by every test: they run one at a time and reset it first.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: "en-US",
    timezoneId: "America/Santiago",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      // edition.spec.ts and phone-edition.spec.ts exist only in the open-source export.
      testMatch: /\/(mail|workspace|edition)\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      name: "phone",
      testMatch: /\/phone(-workspace|-edition)?\.spec\.ts$/,
      // iPhone size and touch, rendered by Chromium (the only browser CI installs).
      use: { ...devices["iPhone 15"], browserName: "chromium" },
    },
  ],
  webServer: {
    command: `pnpm dashboard:build && GEORG_MOCK_API=1 GEORG_MOCK_E2E=1 pnpm exec vite preview --config dashboard/vite.config.ts --port ${PORT} --strictPort`,
    cwd: "..",
    url: `http://localhost:${PORT}/dashboard/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
