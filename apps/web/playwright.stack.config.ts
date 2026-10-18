import { defineConfig, devices } from "@playwright/test";

/**
 * Browser checks against a running Corner Room stack (AUDIO Phase 9 gate): the real web app talking
 * to a real API, at desktop and phone sizes. Start the stack first (web on E2E_BASE_URL, default
 * http://localhost:3000). Signed-in checks need E2E_FAN_EMAIL and E2E_FAN_PASSWORD (a listener on
 * that stack, never a real person's account); without them they are skipped and say so.
 *
 *   npx playwright test -c playwright.stack.config.ts
 */
export default defineConfig({
  testDir: "./e2e-stack",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  timeout: 60_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
