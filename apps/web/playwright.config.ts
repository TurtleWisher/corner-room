import { defineConfig, devices } from "@playwright/test";

/**
 * Browser checks for Phase 16 (D-P16-06). First run: `npx playwright install chromium`.
 * Builds the app and serves it with the theme kit enabled. No API is needed for these specs.
 */
const PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `npm run build && npx next start --port ${PORT}`,
    url: `http://localhost:${PORT}/theme-kit`,
    env: { CR_THEME_KIT: "1" },
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
