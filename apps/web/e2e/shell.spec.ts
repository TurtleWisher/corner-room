import { expect, test } from "@playwright/test";

/*
 * Stage 5 shells. These run without the API: pages show their honest error or sign-in states,
 * which is enough to check the chrome around them.
 */

test("home shows the brand hero and no sideways scroll", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/city.s corner/i);
  await expect(page.getByRole("heading", { name: "Upcoming" })).toBeVisible();
  await expect(page.locator('[lang="bn"]').first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("public URLs keep working inside the new shell", async ({ page }) => {
  for (const path of ["/events", "/artists", "/releases", "/store", "/search", "/login"]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);
    await expect(page.getByRole("link", { name: "Corner Room home" })).toBeVisible();
  }
});

test("old event and venue addresses redirect to their new homes (D-EV-01)", async ({ page }) => {
  await page.goto("/discover");
  await expect(page).toHaveURL(/\/events$/);
  await page.goto("/discover/some-event");
  await expect(page).toHaveURL(/\/events\/some-event$/);
  await page.goto("/venues");
  await expect(page).toHaveURL(/\/staff\/venues$/);
});

test("phones get the bottom tab bar, desktops the header nav", async ({ page, isMobile }) => {
  await page.goto("/events");
  const tabs = page.getByRole("navigation", { name: "Main" });
  await expect(tabs).toBeVisible();
  await expect(tabs.getByRole("link", { name: "Events" })).toHaveAttribute("aria-current", "page");
  if (isMobile) {
    // exact: the logo's "Corner Room home" would also match a loose "Home".
    await expect(tabs.getByRole("link", { name: "Home", exact: true })).toBeVisible();
  } else {
    await expect(page.getByRole("link", { name: "Join" })).toBeVisible();
  }
});

test("staff pages use the staff shell with the workspace chip", async ({ page }) => {
  await page.goto("/staff/ops");
  // The workspace chip lives in the desktop sidebar, which phones hide (display: none removes it
  // from the accessibility tree), so look it up including hidden elements.
  await expect(page.getByRole("button", { name: /Acting in/, includeHidden: true }).first()).toBeAttached();
  await expect(page.getByRole("link", { name: "Corner Room home" }).first()).toBeAttached();
});

test("the listening room is in the Sky world", async ({ page }) => {
  await page.goto("/library");
  await expect(page.locator('header[data-theme="sky"]')).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Listening room" })).toBeVisible();
});

test("skip link reaches the main content", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard check runs on desktop");
  await page.goto("/events");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await expect(page.locator("main#main:visible")).toHaveCount(1);
});
