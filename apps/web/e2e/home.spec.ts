import { expect, test, type Page } from "@playwright/test";

/*
 * Home experience (brand v1.3). Like the shell specs these run without the API, so the data
 * sections show their honest error states; that is part of what is checked.
 */

/** Console errors that are not the expected "API is not running" network failures. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = m.text();
    if (/Failed to load resource|ERR_CONNECTION_REFUSED|Failed to fetch|NetworkError|status of 40[14]|blocked by CORS policy/.test(text)) return;
    errors.push(text);
  });
  return errors;
}

async function scrollThrough(page: Page) {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y <= height; y += 400) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(60);
  }
}

test("home sections are present, in order, with honest states and no sideways scroll", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/city.s corner/i);
  await expect(page.getByRole("heading", { name: /Upcoming/ })).toBeVisible();
  await expect(page.getByText("Events could not be loaded. Please try again later.")).toBeVisible();
  await scrollThrough(page);
  await expect(page.getByRole("heading", { name: /New releases/ })).toBeVisible();
  await expect(page.getByText("Releases could not be loaded. Please try again later.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Find the music you love. Help the artists who make it." })).toBeVisible();
  await expect(page.getByText("Contact details coming soon.")).toBeVisible();
  // No product tiles are invented when the store cannot be read.
  await expect(page.getByRole("list", { name: "In the Store now" })).toHaveCount(0);
  const order = await page.evaluate(() => [...document.querySelectorAll("main h2")].map((h) => h.textContent?.trim() ?? ""));
  const at = (re: RegExp) => order.findIndex((t) => re.test(t));
  expect(at(/Upcoming/)).toBeLessThan(at(/New releases/));
  expect(at(/New releases/)).toBeLessThan(at(/Find the music/));
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await expect(page.locator('[data-reveal="pending"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("no \"+\" registration textures remain", async ({ page }) => {
  await page.goto("/");
  const marked = await page.evaluate(() =>
    [...document.querySelectorAll("*")].some((el) => getComputedStyle(el).backgroundImage.includes("M32 28v8")),
  );
  expect(marked).toBe(false);
});

test("reduced motion leaves nothing hidden and nothing moving", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator('[data-reveal="pending"]')).toHaveCount(0);
  const moving = await page.evaluate(
    () => [...document.querySelectorAll("main *")].filter((el) => getComputedStyle(el).animationName !== "none").length,
  );
  expect(moving).toBe(0);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(page.getByRole("link", { name: /Visit the Store/ })).toBeVisible();
});

test("the poster effect never blocks the click", async ({ page, isMobile }) => {
  await page.goto("/");
  const poster = page.getByTestId("poster-tilt");
  await expect(poster).toBeVisible();
  if (!isMobile) {
    const box = await poster.boundingBox();
    if (box) await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.2);
  }
  // Without the API there is no event, so the poster leads to all events.
  await poster.getByRole("link", { name: "See all events" }).click();
  await expect(page).toHaveURL(/\/events$/);
});

test("the Store button goes to the Store", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /Visit the Store/ }).click();
  await expect(page).toHaveURL(/\/store$/);
});

test("keyboard reaches the poster and the Store button with a visible focus ring", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard check runs on desktop");
  await page.goto("/");
  const seen: string[] = [];
  for (let i = 0; i < 40 && !seen.some((s) => s.startsWith("Visit the Store")); i++) {
    await page.keyboard.press("Tab");
    seen.push(
      await page.evaluate(() => {
        const a = document.activeElement as HTMLElement;
        const ring = getComputedStyle(a).outlineStyle !== "none";
        return `${(a.getAttribute("aria-label") || a.textContent || "").trim()}|${ring}`;
      }),
    );
  }
  expect(seen.some((s) => s.startsWith("See all events|true"))).toBe(true);
  expect(seen.some((s) => s.startsWith("Visit the Store") && s.endsWith("|true"))).toBe(true);
});
