import { expect, test } from "@playwright/test";

const MODULES = ["Events", "Ticketing", "Music", "Artists", "Store", "Marketing", "Finance", "Admin", "Account"];

test("module art direction board shows all nine modules without sideways scroll", async ({ page }) => {
  await page.goto("/theme-kit/modules");
  for (const name of MODULES) {
    await expect(page.getByRole("heading", { level: 2, name: new RegExp(`^${name}`) })).toBeVisible();
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("module styles stay inside their module", async ({ page }) => {
  await page.goto("/theme-kit/modules");
  const pool = (selector: string) =>
    page.locator(selector).first().evaluate((el) => getComputedStyle(el).getPropertyValue("--cr-light-pool").trim());
  // Events and Ticketing override the Ember light differently; the Sky world keeps its own.
  const events = await pool('[data-module="events"] [data-theme="ember"]');
  const ticketing = await pool('[data-module="ticketing"] [data-theme="ember"]');
  const sky = await pool('[data-theme="sky"]');
  expect(events).not.toEqual(ticketing);
  expect(sky).toMatch(/53c8ea|83,? ?200,? ?234/i);
});
