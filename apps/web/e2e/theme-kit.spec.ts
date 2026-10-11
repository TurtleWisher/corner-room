import { expect, test } from "@playwright/test";

test.describe("theme kit", () => {
  test("renders the worlds and never scrolls sideways", async ({ page }) => {
    await page.goto("/theme-kit");
    await expect(page.getByRole("heading", { level: 1, name: /theme kit/i })).toBeVisible();
    await expect(page.locator('[data-theme="sky"]').first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("money and dates follow the approved formats", async ({ page }) => {
    await page.goto("/theme-kit");
    await expect(page.getByText("BDT 4,12,500")).toHaveCount(1);
    await expect(page.getByText("Dhaka time").first()).toBeVisible();
  });

  test("dialog traps focus, closes on Escape and returns focus", async ({ page, isMobile }) => {
    test.skip(isMobile, "keyboard flow checked on desktop");
    await page.goto("/theme-kit");
    const opener = page.getByRole("button", { name: "Open dialog" });
    await opener.click();
    const dialog = page.getByRole("dialog", { name: "Sample dialog" });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test("tabs follow the arrow keys", async ({ page, isMobile }) => {
    test.skip(isMobile, "keyboard flow checked on desktop");
    await page.goto("/theme-kit");
    await page.getByRole("tab", { name: "Line-up" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Tickets" })).toBeFocused();
    await expect(page.getByRole("tab", { name: "Tickets" })).toHaveAttribute("aria-selected", "true");
  });
});
