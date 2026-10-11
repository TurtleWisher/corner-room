import { expect, test } from "@playwright/test";

test.describe("letter cube", () => {
  test("is drawn from letter paths only, never set in type", async ({ page }) => {
    await page.goto("/theme-kit/cube");
    await expect(page.getByRole("heading", { level: 1, name: /letter cube/i })).toBeVisible();
    const generated = page.getByRole("img", { name: "Corner Room, generated" }).first();
    await expect(generated).toBeVisible();
    await expect(generated.locator("text")).toHaveCount(0);
    await expect(generated.locator('path[fill-rule="evenodd"]')).toHaveCount(4);
  });

  test("event titles become the cube", async ({ page }) => {
    await page.goto("/theme-kit/cube");
    await expect(page.getByText("front LOW / TIDE · left SESSIONS · top SESSIONS")).toBeVisible();
    await expect(page.getByRole("img", { name: "Low Tide, Sessions" }).first()).toBeVisible();
  });

  test("never scrolls sideways", async ({ page }) => {
    await page.goto("/theme-kit/cube");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
